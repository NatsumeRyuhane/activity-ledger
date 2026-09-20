import { z } from "zod";
import {
  buildSettlement,
  effectiveHistory,
  newActivityId,
  newIdentityId,
  newPaymentId,
  pickIdentityColor,
  replay,
  type ActivityMeta,
  type Identity,
  type LedgerEvent,
  type LedgerState,
  type Payment,
  type SettlementReport,
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

export interface ActivityView {
  activity: ActivityMeta;
  identities: Identity[];
  payments: Payment[];
  settlement: SettlementReport;
  events: (LedgerEvent & { voided: boolean })[];
  headSeq: number;
}

const MAX_DATE_LENGTH = 32;
const dateString = z
  .string()
  .max(MAX_DATE_LENGTH)
  .regex(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/, "时间格式不正确");

const paymentPatchSchema = z
  .object({
    title: z.string().trim().min(1, "标题不能为空").max(40).optional(),
    amountCents: z.number().int().min(0).max(100_000_000_000).optional(),
    paidAt: dateString.nullable().optional(),
    description: z.string().trim().max(200).nullable().optional(),
    splitMode: z.enum(["equal", "custom"]).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "没有需要修改的内容");

const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("identity.create"),
    name: z.string().trim().min(1, "请输入名字").max(20, "名字太长了"),
  }),
  z.object({
    type: z.literal("payment.create"),
    title: z.string().trim().min(1, "请输入标题").max(40, "标题太长了"),
    amountCents: z.number().int().min(0).max(100_000_000_000),
    paidAt: dateString.optional(),
    description: z.string().trim().max(200).optional(),
    splitMode: z.enum(["equal", "custom"]),
    payers: z
      .array(
        z.object({
          identityId: z.string().min(1),
          amountCents: z.number().int().min(0).max(100_000_000_000),
        }),
      )
      .min(1, "至少需要一位付款人")
      .max(100),
    participants: z
      .array(
        z.object({
          identityId: z.string().min(1),
          shareCents: z.number().int().min(0).max(100_000_000_000).optional(),
        }),
      )
      .max(100),
  }),
  z.object({
    type: z.literal("payment.update"),
    paymentId: z.string().min(1),
    patch: paymentPatchSchema,
  }),
  z.object({ type: z.literal("payment.void"), paymentId: z.string().min(1) }),
  z.object({
    type: z.literal("payer.set"),
    paymentId: z.string().min(1),
    identityId: z.string().min(1),
    amountCents: z.number().int().min(0).max(100_000_000_000),
  }),
  z.object({
    type: z.literal("payer.remove"),
    paymentId: z.string().min(1),
    identityId: z.string().min(1),
  }),
  z.object({
    type: z.literal("participant.set"),
    paymentId: z.string().min(1),
    identityId: z.string().min(1),
    shareCents: z.number().int().min(0).max(100_000_000_000).optional(),
  }),
  z.object({
    type: z.literal("participant.remove"),
    paymentId: z.string().min(1),
    identityId: z.string().min(1),
  }),
  z.object({
    type: z.literal("rollback"),
    targetSeq: z.number().int().min(1),
    reason: z.string().trim().max(100).optional(),
  }),
  z.object({
    type: z.literal("settings.update"),
    name: z.string().trim().min(1).max(30).optional(),
    description: z.string().trim().max(200).nullable().optional(),
  }),
  z.object({
    type: z.literal("admin.setPassword"),
    newPassword: z.string().min(4, "密码至少 4 位").max(128),
  }),
]);

export type Command = z.infer<typeof commandSchema>;

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
  store.append(activityId, [event]);

  return buildView(store, row);
}

function buildEvent(
  store: EventStore,
  row: ActivityRow,
  state: LedgerState,
  actor: Actor,
  command: Command,
): NewEvent {
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
        })),
        participants: command.participants.map((participant) => ({
          identityId: participant.identityId,
          ...(command.splitMode === "custom"
            ? { shareCents: participant.shareCents ?? 0 }
            : {}),
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
