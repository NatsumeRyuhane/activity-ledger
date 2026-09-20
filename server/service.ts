import { commandSchema, type Command } from "@shared/domain/commands";
import {
  buildSettlement,
  type ActivityView,
  effectiveHistory,
  isPaymentValid,
  newActivityId,
  newIdentityId,
  newPaymentId,
  involvementOf,
  pickIdentityColor,
  replay,
  type ActivityCreatedPayload,
  type ActivityMeta,
  type Identity,
  type IdentityCreatedPayload,
  type IdentityUpdatedPayload,
  type LedgerEvent,
  type LedgerEventPayload,
  type LedgerState,
  type Payment,
} from "@shared/domain";
import { MAX_PASSWORD_LENGTH, hashPassword, verifyPassword } from "./password";
import type { ActivityRow, EventStore, NewEvent } from "./store";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}



export interface CreateActivityInput {
  name: string;
  description?: string;
  creatorName: string;
  password?: string;
}

export interface Actor {
  identityId: string;
  adminPassword?: string;
}

export function createActivity(
  store: EventStore,
  input: CreateActivityInput,
): { activityId: string; identityId: string } {
  const name = input.name.trim();
  const creatorName = input.creatorName.trim();
  if (!name) throw new AppError(400, "invalid_name", "请输入活动名称");
  if (name.length > 30) throw new AppError(400, "invalid_name", "活动名称太长了");
  if (!creatorName) throw new AppError(400, "invalid_name", "请输入你的名字");
  if (creatorName.length > 20) throw new AppError(400, "invalid_name", "名字太长了");
  if (input.password !== undefined && input.password !== "" && input.password.length < 4) {
    throw new AppError(400, "invalid_password", "密码至少 4 位");
  }
  // verifyPassword refuses over-long passwords, so storing one would lock the
  // admin out for good.
  if (input.password !== undefined && input.password.length > MAX_PASSWORD_LENGTH) {
    throw new AppError(400, "invalid_password", "密码不能超过 128 位");
  }

  let activityId = newActivityId();
  for (let attempt = 0; attempt < 5 && store.getActivity(activityId); attempt++) {
    activityId = newActivityId();
  }

  const now = Date.now();
  const creator: Identity = {
    id: newIdentityId(),
    name: creatorName,
    color: pickIdentityColor(creatorName),
    createdAt: now,
    isCreator: true,
  };
  const activity: ActivityMeta = {
    id: activityId,
    name,
    description: input.description?.trim() || undefined,
    createdAt: now,
    creatorIdentityId: creator.id,
    hasPassword: false,
  };

  store.createActivity(
    activityId,
    now,
    { activity, creator },
    input.password ? hashPassword(input.password) : null,
  );

  return { activityId, identityId: creator.id };
}

export function getActivityView(store: EventStore, activityId: string): ActivityView {
  const row = requireActivity(store, activityId);
  return buildView(store, row);
}

/** Joining an activity needs no identity: anyone with the link may create one. */
/**
 * Checks the admin password without requiring an actor: used when someone
 * switches to the admin identity, before they are acting as that identity.
 */
export function verifyAdminPassword(
  store: EventStore,
  activityId: string,
  password: string,
): void {
  const row = requireActivity(store, activityId);
  if (!row.adminPasswordHash) {
    throw new AppError(403, "no_password", "这个活动还没有设置管理员密码");
  }
  if (!password || !verifyPassword(password, row.adminPasswordHash)) {
    throw new AppError(403, "wrong_password", "管理员密码不正确");
  }
}

export function createIdentity(
  store: EventStore,
  activityId: string,
  rawName: string,
): { view: ActivityView; identityId: string } {
  const row = requireActivity(store, activityId);
  const name = rawName.trim();
  if (!name) throw new AppError(400, "invalid_name", "请输入名字");
  if (name.length > 20) throw new AppError(400, "invalid_name", "名字太长了");

  const identityId = newIdentityId();
  const identity: Identity = {
    id: identityId,
    name,
    color: pickIdentityColor(`${name}:${identityId}`),
    createdAt: Date.now(),
    isCreator: false,
  };
  store.append(activityId, [
    { type: "identity.created", actorIdentityId: null, payload: { identity } },
  ]);
  return { view: buildView(store, row), identityId: identity.id };
}

export function applyCommand(
  store: EventStore,
  activityId: string,
  actor: Actor,
  rawCommand: unknown,
): ActivityView {
  const row = requireActivity(store, activityId);
  const parsed = commandSchema.safeParse(rawCommand);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "请求格式不正确";
    throw new AppError(400, "invalid_command", message);
  }
  const command = parsed.data;

  const events = store.loadEvents(activityId);
  const state = replay(events);
  const built = buildEvents(store, row, state, actor, command);
  if (built.events.length > 0 || built.adminPasswordHash !== undefined) {
    store.append(activityId, built.events, built.adminPasswordHash);
  }

  return buildView(store, row);
}

interface BuiltCommands {
  events: NewEvent[];
  /** Set when the admin password hash must commit with these events. */
  adminPasswordHash?: string;
}

function buildEvents(
  store: EventStore,
  row: ActivityRow,
  state: LedgerState,
  actor: Actor,
  command: Command,
): BuiltCommands {
  if (command.type === "activity.close") {
    return { events: buildCloseEvents(row, state, actor, command.forced ?? false) };
  }
  if (command.type === "payment.edit") {
    return { events: buildPaymentEditEvents(row, state, actor, command) };
  }

  const built = buildEvent(store, row, state, actor, command);
  if (!built) return { events: [] };
  if ("event" in built) {
    return { events: [built.event], adminPasswordHash: built.adminPasswordHash };
  }
  return { events: [built] };
}

/**
 * Applies a full payment edit (fields + payer/participant lists) as one batch:
 * every generated event is appended in a single transaction, so a failure can
 * never leave a half-edited payment behind.
 */
function buildPaymentEditEvents(
  row: ActivityRow,
  state: LedgerState,
  actor: Actor,
  command: Extract<Command, { type: "payment.edit" }>,
): NewEvent[] {
  const payment = requirePayment(state, command.paymentId);
  requirePaymentManager(row, state, actor, payment);
  for (const payer of command.payers) requireIdentity(state, payer.identityId);
  for (const participant of command.participants) {
    requireIdentity(state, participant.identityId);
  }
  if (!command.payers.some((payer) => payer.identityId === payment.createdBy)) {
    throw new AppError(400, "creator_must_pay", "付款创建者必须是付款人，不能被移除");
  }

  const actorId = actor.identityId;
  const createdAt = Date.now();
  const events: NewEvent[] = [
    {
      type: "payment.updated",
      actorIdentityId: actorId,
      createdAt,
      payload: {
        paymentId: payment.id,
        patch: {
          title: command.title,
          paidAt: command.paidAt ?? null,
          description: command.description ?? null,
          splitMode: command.splitMode,
        },
      },
    },
  ];

  for (const payer of command.payers) {
    const existing = payment.payers.find((item) => item.identityId === payer.identityId);
    if (!existing || existing.amountCents !== payer.amountCents) {
      events.push({
        type: "payer.set",
        actorIdentityId: actorId,
        createdAt,
        payload: {
          paymentId: payment.id,
          identityId: payer.identityId,
          amountCents: payer.amountCents,
          confirmed: payer.identityId === actorId,
        },
      });
    }
  }
  for (const existing of payment.payers) {
    if (!command.payers.some((item) => item.identityId === existing.identityId)) {
      events.push({
        type: "payer.removed",
        actorIdentityId: actorId,
        createdAt,
        payload: { paymentId: payment.id, identityId: existing.identityId },
      });
    }
  }

  for (const participant of command.participants) {
    const existing = payment.participants.find(
      (item) => item.identityId === participant.identityId,
    );
    const changed =
      !existing ||
      (command.splitMode === "custom" && existing.shareCents !== participant.shareCents);
    if (changed) {
      events.push({
        type: "participant.set",
        actorIdentityId: actorId,
        createdAt,
        payload: {
          paymentId: payment.id,
          identityId: participant.identityId,
          ...(command.splitMode === "custom"
            ? { shareCents: participant.shareCents ?? 0 }
            : {}),
          confirmed: participant.identityId === actorId,
        },
      });
    }
  }
  for (const existing of payment.participants) {
    if (!command.participants.some((item) => item.identityId === existing.identityId)) {
      events.push({
        type: "participant.removed",
        actorIdentityId: actorId,
        createdAt,
        payload: { paymentId: payment.id, identityId: existing.identityId },
      });
    }
  }

  return events;
}

function buildCloseEvents(
  row: ActivityRow,
  state: LedgerState,
  actor: Actor,
  forced: boolean,
): NewEvent[] {
  requireAdmin(row, state, actor);
  const activity = requireState(state);
  if (activity.closedAt) throw new AppError(400, "already_closed", "活动已经关闭");

  const actorId = actor.identityId;
  const createdAt = Date.now();
  const memberIds = state.identities.map((identity) => identity.id);
  const { pending } = buildSettlement(state.payments, memberIds, false);

  const newEvents: NewEvent[] = [];
  if (pending.length > 0) {
    if (!forced) {
      throw new AppError(
        400,
        "pending_confirmations",
        `还有 ${pending.length} 项未确认，无法关闭活动；也可以强制关闭，未确认的成员将按未参与处理`,
      );
    }

    // Force close: assignments made by others are assumed to be true, so any
    // unconfirmed enrollment simply becomes confirmed. Members with no
    // assignment at all are treated as not participating.
    for (const payment of state.payments) {
      if (!isPaymentValid(payment)) continue;

      const unconfirmed = new Set<string>();
      for (const payer of payment.payers) {
        if (!payer.confirmed) unconfirmed.add(payer.identityId);
      }
      for (const participant of payment.participants) {
        if (!participant.confirmed) unconfirmed.add(participant.identityId);
      }
      for (const memberId of unconfirmed) {
        newEvents.push({
          type: "entry.confirmed",
          actorIdentityId: actorId,
          createdAt,
          payload: { paymentId: payment.id, identityId: memberId },
        });
      }

      const involved = new Set<string>([
        ...payment.payers.map((payer) => payer.identityId),
        ...payment.participants.map((participant) => participant.identityId),
      ]);
      const declined = new Set(payment.declinedBy);
      for (const memberId of memberIds) {
        if (!involved.has(memberId) && !declined.has(memberId)) {
          newEvents.push({
            type: "entry.declined",
            actorIdentityId: actorId,
            createdAt,
            payload: { paymentId: payment.id, identityId: memberId },
          });
        }
      }
    }
  }

  newEvents.push({
    type: "activity.closed",
    actorIdentityId: actorId,
    createdAt,
    payload: { forced },
  });
  return newEvents;
}

type BuiltEvent =
  | NewEvent
  | { event: NewEvent; adminPasswordHash: string };

function buildEvent(
  store: EventStore,
  row: ActivityRow,
  state: LedgerState,
  actor: Actor,
  command: Exclude<Command, { type: "activity.close" } | { type: "payment.edit" }>,
): BuiltEvent | null {
  const activity = requireState(state);
  if (activity.closedAt && command.type !== "rollback") {
    throw new AppError(
      400,
      "activity_closed",
      "活动已关闭，如需修改请先在「记录」中回滚关闭操作",
    );
  }

  const now = Date.now();
  const actorId = actor.identityId;
  const base = { actorIdentityId: actorId, createdAt: now };

  switch (command.type) {
    case "identity.update": {
      const identity = requireIdentity(state, command.identityId);
      if (identity.id !== actorId) {
        throw new AppError(403, "not_self", "只能修改自己的名字和头像");
      }
      return {
        ...base,
        type: "identity.updated",
        payload: {
          identityId: identity.id,
          ...(command.name !== undefined ? { name: command.name } : {}),
          ...(command.avatar !== undefined ? { avatar: command.avatar } : {}),
        },
      };
    }

    case "payment.create": {
      requireMember(state, actorId);
      for (const payer of command.payers) requireIdentity(state, payer.identityId);
      for (const participant of command.participants) {
        requireIdentity(state, participant.identityId);
      }
      if (!command.payers.some((payer) => payer.identityId === actorId)) {
        throw new AppError(400, "creator_must_pay", "付款创建者必须是付款人");
      }
      const payment: Payment = {
        id: newPaymentId(),
        title: command.title,
        paidAt: command.paidAt,
        description: command.description || undefined,
        splitMode: command.splitMode,
        createdBy: actorId,
        createdAt: now,
        payers: command.payers.map((payer) => ({
          identityId: payer.identityId,
          amountCents: payer.amountCents,
          confirmed: payer.identityId === actorId,
        })),
        participants: command.participants.map((participant) => ({
          identityId: participant.identityId,
          ...(command.splitMode === "custom"
            ? { shareCents: participant.shareCents ?? 0 }
            : {}),
          confirmed: participant.identityId === actorId,
        })),
        declinedBy: [],
        voided: false,
      };
      return { ...base, type: "payment.created", payload: { payment } };
    }

    case "payment.update": {
      const payment = requirePayment(state, command.paymentId);
      requirePaymentManager(row, state, actor, payment);
      return {
        ...base,
        type: "payment.updated",
        payload: { paymentId: payment.id, patch: command.patch },
      };
    }

    case "payment.void": {
      const payment = requirePayment(state, command.paymentId);
      requirePaymentManager(row, state, actor, payment);
      if (payment.voided) throw new AppError(400, "already_voided", "这笔付款已经作废");
      return { ...base, type: "payment.voided", payload: { paymentId: payment.id } };
    }

    case "payer.set": {
      const payment = requirePayment(state, command.paymentId);
      requireIdentity(state, command.identityId);
      if (command.identityId === actorId) {
        // Members may enlist themselves as a payer and adjust their own amount.
        requireMember(state, actorId);
      } else {
        requirePaymentManager(row, state, actor, payment);
      }
      return {
        ...base,
        type: "payer.set",
        payload: {
          paymentId: payment.id,
          identityId: command.identityId,
          amountCents: command.amountCents,
          confirmed: command.identityId === actorId,
        },
      };
    }

    case "payer.remove": {
      const payment = requirePayment(state, command.paymentId);
      requireIdentity(state, command.identityId);
      requirePaymentManager(row, state, actor, payment);
      if (command.identityId === payment.createdBy) {
        throw new AppError(400, "creator_must_pay", "付款创建者必须是付款人，无法移除");
      }
      const existing = payment.payers.find((p) => p.identityId === command.identityId);
      if (!existing) throw new AppError(400, "not_a_payer", "该用户不在这笔付款的付款人里");
      return {
        ...base,
        type: "payer.removed",
        payload: { paymentId: payment.id, identityId: command.identityId },
      };
    }

    case "participant.set": {
      const payment = requirePayment(state, command.paymentId);
      requireIdentity(state, command.identityId);
      const isSelf = command.identityId === actorId;
      const existing = payment.participants.find((p) => p.identityId === command.identityId);

      if (isSelf) {
        // Members may only add themselves; shares and role changes belong to
        // the payment creator or the activity admin. Managers may edit their
        // own entries too.
        if (!isPaymentManager(row, state, actor, payment)) {
          requireMember(state, actorId);
          if (existing) {
            throw new AppError(403, "manager_only", "只有付款创建者可以修改参与信息");
          }
          if (command.shareCents !== undefined) {
            throw new AppError(403, "manager_only", "分摊金额由付款创建者设置");
          }
        }
      } else {
        requirePaymentManager(row, state, actor, payment);
      }

      return {
        ...base,
        type: "participant.set",
        payload: {
          paymentId: payment.id,
          identityId: command.identityId,
          ...(command.shareCents !== undefined ? { shareCents: command.shareCents } : {}),
          confirmed: isSelf,
        },
      };
    }

    case "participant.remove": {
      const payment = requirePayment(state, command.paymentId);
      requireIdentity(state, command.identityId);
      requirePaymentManager(row, state, actor, payment);
      const existing = payment.participants.find((p) => p.identityId === command.identityId);
      if (!existing) throw new AppError(400, "not_a_participant", "该用户不在这笔付款的参与人里");
      return {
        ...base,
        type: "participant.removed",
        payload: { paymentId: payment.id, identityId: command.identityId },
      };
    }

    case "entry.confirm": {
      const payment = requirePayment(state, command.paymentId);
      requireMember(state, actorId);
      const { needsConfirmation, isPayer, isParticipant } = involvementOf(payment, actorId);
      if (!isPayer && !isParticipant) {
        throw new AppError(400, "not_involved", "你不在这笔付款里");
      }
      if (!needsConfirmation) {
        throw new AppError(400, "already_confirmed", "你的参与已经确认过了");
      }
      return {
        ...base,
        type: "entry.confirmed",
        payload: { paymentId: payment.id, identityId: actorId },
      };
    }

    case "entry.decline": {
      const payment = requirePayment(state, command.paymentId);
      requireMember(state, actorId);
      if (payment.voided) throw new AppError(400, "already_voided", "这笔付款已经作废");
      const involvement = involvementOf(payment, actorId);
      if (involvement.isPayer || involvement.isParticipant) {
        throw new AppError(
          403,
          "already_involved",
          "你已被登记在这笔付款里，请联系付款创建者或活动管理员处理",
        );
      }
      if (payment.declinedBy.includes(actorId)) {
        throw new AppError(400, "already_declined", "你已经声明未参与这笔付款");
      }
      return {
        ...base,
        type: "entry.declined",
        payload: { paymentId: payment.id, identityId: actorId },
      };
    }

    case "rollback": {
      requireAdmin(row, state, actor);
      const events = store.loadEvents(row.id);
      const { effective } = effectiveHistory(events);
      const removable = effective.filter((event) => event.seq > command.targetSeq);
      if (removable.length === 0) {
        throw new AppError(400, "nothing_to_rollback", "这个位置之后没有可撤销的记录");
      }
      return {
        ...base,
        type: "rollback",
        payload: { targetSeq: command.targetSeq, ...(command.reason ? { reason: command.reason } : {}) },
      };
    }

    case "settings.update": {
      requireAdmin(row, state, actor);
      return {
        ...base,
        type: "settings.updated",
        payload: {
          ...(command.name !== undefined ? { name: command.name } : {}),
          ...(command.description !== undefined ? { description: command.description } : {}),
        },
      };
    }

    case "admin.setPassword": {
      if (actorId !== activity.creatorIdentityId) {
        throw new AppError(403, "not_creator", "只有活动创建者可以设置管理员密码");
      }
      requireMember(state, actorId);
      if (row.adminPasswordHash) {
        if (!actor.adminPassword || !verifyPassword(actor.adminPassword, row.adminPasswordHash)) {
          throw new AppError(403, "wrong_password", "当前管理员密码不正确");
        }
      }
      // The hash is applied together with this event in one transaction.
      return {
        event: { ...base, type: "settings.password_changed", payload: {} },
        adminPasswordHash: hashPassword(command.newPassword),
      };
    }
  }
}

export function buildView(store: EventStore, row: ActivityRow): ActivityView {
  const events = store.loadEvents(row.id);
  const { voided } = effectiveHistory(events);
  const state = replay(events);
  const activity = requireState(state);

  return {
    activity: { ...activity, hasPassword: row.adminPasswordHash !== null },
    identities: state.identities,
    payments: state.payments,
    settlement: buildSettlement(
      state.payments,
      state.identities.map((identity) => identity.id),
      state.activity?.closedAt !== undefined,
    ),
    events: events.map((event) => ({
      ...event,
      payload: stripAvatarForClient(event),
      voided: voided.has(event.seq),
    })),
    headSeq: store.maxSeq(row.id),
  };
}

/** Avatars live on the identities, so event payloads can drop the image bytes. */
function stripAvatarForClient(event: LedgerEvent): LedgerEventPayload {
  if (event.type === "activity.created") {
    const payload = event.payload as ActivityCreatedPayload;
    const creator = { ...payload.creator };
    delete creator.avatar;
    return { ...payload, creator };
  }
  if (event.type === "identity.created") {
    const payload = event.payload as IdentityCreatedPayload;
    const identity = { ...payload.identity };
    delete identity.avatar;
    return { ...payload, identity };
  }
  if (event.type === "identity.updated") {
    const payload = event.payload as IdentityUpdatedPayload;
    if (payload.avatar === undefined) return payload;
    return { ...payload, avatar: payload.avatar === null ? null : "[图片]" };
  }
  return event.payload;
}

function requireActivity(store: EventStore, activityId: string): ActivityRow {
  const row = store.getActivity(activityId);
  if (!row) throw new AppError(404, "not_found", "活动不存在或链接有误");
  return row;
}

function requireState(state: LedgerState): ActivityMeta {
  if (!state.activity) throw new AppError(404, "not_found", "活动不存在");
  return state.activity;
}

function requireMember(state: LedgerState, identityId: string): Identity {
  return requireIdentity(state, identityId);
}

function requireIdentity(state: LedgerState, identityId: string): Identity {
  const identity = state.identities.find((item) => item.id === identityId);
  if (!identity) throw new AppError(403, "unknown_identity", "请先选择或创建你的身份");
  return identity;
}

function requirePayment(state: LedgerState, paymentId: string): Payment {
  const payment = state.payments.find((item) => item.id === paymentId);
  if (!payment) throw new AppError(404, "payment_not_found", "付款不存在");
  return payment;
}

function isPaymentManager(
  row: ActivityRow,
  state: LedgerState,
  actor: Actor,
  payment: Payment,
): boolean {
  if (actor.identityId === payment.createdBy) return true;
  const activity = requireState(state);
  if (actor.identityId !== activity.creatorIdentityId) return false;
  if (!row.adminPasswordHash || !actor.adminPassword) return false;
  return verifyPassword(actor.adminPassword, row.adminPasswordHash);
}

function requirePaymentManager(
  row: ActivityRow,
  state: LedgerState,
  actor: Actor,
  payment: Payment,
): void {
  if (actor.identityId === payment.createdBy) return;
  requireAdmin(row, state, actor);
}

function requireAdmin(row: ActivityRow, state: LedgerState, actor: Actor): void {
  const activity = requireState(state);
  if (actor.identityId !== activity.creatorIdentityId) {
    throw new AppError(403, "not_admin", "只有活动创建者可以执行此操作");
  }
  if (!row.adminPasswordHash) {
    throw new AppError(403, "no_password", "请先在「管理」中设置管理员密码");
  }
  if (!actor.adminPassword || !verifyPassword(actor.adminPassword, row.adminPasswordHash)) {
    throw new AppError(403, "wrong_password", "管理员密码不正确");
  }
}
