import { commandSchema, type Command } from "@shared/domain/commands";
import {
  buildSettlement,
  type ActivityView,
  effectiveHistory,
  newActivityId,
  newIdentityId,
  newPaymentId,
  involvementOf,
  pickIdentityColor,
  replay,
  type ActivityMeta,
  type Identity,
  type LedgerState,
  type Payment,
} from "@shared/domain";
import { hashPassword, verifyPassword } from "./password";
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

  store.createActivity(activityId, now, { activity, creator });
  if (input.password) {
    store.setAdminPasswordHash(activityId, hashPassword(input.password));
  }

  return { activityId, identityId: creator.id };
}

export function getActivityView(store: EventStore, activityId: string): ActivityView {
  const row = requireActivity(store, activityId);
  return buildView(store, row);
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
  const event = buildEvent(store, row, state, actor, command);
  if (event) store.append(activityId, [event]);

  return buildView(store, row);
}

function buildEvent(
  store: EventStore,
  row: ActivityRow,
  state: LedgerState,
  actor: Actor,
  command: Command,
): NewEvent | null {
  const activity = requireState(state);
  const now = Date.now();
  const actorId = actor.identityId;
  const base = { actorIdentityId: actorId, createdAt: now };

  switch (command.type) {
    case "identity.create": {
      requireMember(state, actorId);
      const identity: Identity = {
        id: newIdentityId(),
        name: command.name,
        color: pickIdentityColor(`${command.name}:${actorId}`),
        createdAt: now,
        isCreator: false,
      };
      return { ...base, type: "identity.created", payload: { identity } };
    }

    case "payment.create": {
      requireMember(state, actorId);
      for (const payer of command.payers) requireIdentity(state, payer.identityId);
      for (const participant of command.participants) {
        requireIdentity(state, participant.identityId);
      }
      const payment: Payment = {
        id: newPaymentId(),
        title: command.title,
        amountCents: command.amountCents,
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
      if (command.identityId !== actorId) {
        requirePaymentManager(row, state, actor, payment);
      } else {
        requireMember(state, actorId);
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
      if (command.identityId !== actorId) {
        requirePaymentManager(row, state, actor, payment);
      } else {
        requireMember(state, actorId);
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
      if (command.identityId !== actorId) {
        requirePaymentManager(row, state, actor, payment);
      } else {
        requireMember(state, actorId);
      }
      return {
        ...base,
        type: "participant.set",
        payload: {
          paymentId: payment.id,
          identityId: command.identityId,
          ...(command.shareCents !== undefined ? { shareCents: command.shareCents } : {}),
          confirmed: command.identityId === actorId,
        },
      };
    }

    case "participant.remove": {
      const payment = requirePayment(state, command.paymentId);
      requireIdentity(state, command.identityId);
      if (command.identityId !== actorId) {
        requirePaymentManager(row, state, actor, payment);
      } else {
        requireMember(state, actorId);
      }
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

    case "admin.verify": {
      requireAdmin(row, state, actor);
      return null;
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
      store.setAdminPasswordHash(row.id, hashPassword(command.newPassword));
      return { ...base, type: "settings.password_changed", payload: {} };
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
    settlement: buildSettlement(state.payments),
    events: events.map((event) => ({ ...event, voided: voided.has(event.seq) })),
    headSeq: store.maxSeq(row.id),
  };
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
