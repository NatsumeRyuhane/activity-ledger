export type IdentityId = string;
export type PaymentId = string;
export type ActivityId = string;

export type SplitMode = "equal" | "custom";

export interface ActivityMeta {
  id: ActivityId;
  name: string;
  description?: string;
  createdAt: number;
  creatorIdentityId: IdentityId;
  hasPassword: boolean;
}

export interface Identity {
  id: IdentityId;
  name: string;
  color: string;
  createdAt: number;
  isCreator: boolean;
}

export interface Payer {
  identityId: IdentityId;
  amountCents: number;
}

export interface Participant {
  identityId: IdentityId;
  shareCents?: number;
}

export interface Payment {
  id: PaymentId;
  title: string;
  amountCents: number;
  paidAt?: string;
  description?: string;
  splitMode: SplitMode;
  createdBy: IdentityId;
  createdAt: number;
  payers: Payer[];
  participants: Participant[];
  voided: boolean;
}

export interface LedgerState {
  activity: ActivityMeta | null;
  identities: Identity[];
  payments: Payment[];
}

export type LedgerEventType =
  | "activity.created"
  | "identity.created"
  | "payment.created"
  | "payment.updated"
  | "payment.voided"
  | "payer.set"
  | "payer.removed"
  | "participant.set"
  | "participant.removed"
  | "settings.updated"
  | "settings.password_changed"
  | "rollback";

export interface ActivityCreatedPayload {
  activity: ActivityMeta;
  creator: Identity;
}

export interface IdentityCreatedPayload {
  identity: Identity;
}

export interface PaymentCreatedPayload {
  payment: Payment;
}

export type PaymentPatch = Partial<
  Pick<Payment, "title" | "amountCents" | "paidAt" | "description" | "splitMode">
>;

export interface PaymentUpdatedPayload {
  paymentId: PaymentId;
  patch: PaymentPatch;
}

export interface PaymentVoidedPayload {
  paymentId: PaymentId;
}

export interface PayerSetPayload {
  paymentId: PaymentId;
  identityId: IdentityId;
  amountCents: number;
}

export interface PayerRemovedPayload {
  paymentId: PaymentId;
  identityId: IdentityId;
}

export interface ParticipantSetPayload {
  paymentId: PaymentId;
  identityId: IdentityId;
  shareCents?: number;
}

export interface ParticipantRemovedPayload {
  paymentId: PaymentId;
  identityId: IdentityId;
}

export interface SettingsUpdatedPayload {
  name?: string;
  description?: string;
}

export interface RollbackPayload {
  targetSeq: number;
  reason?: string;
}

export type LedgerEventPayload =
  | ActivityCreatedPayload
  | IdentityCreatedPayload
  | PaymentCreatedPayload
  | PaymentUpdatedPayload
  | PaymentVoidedPayload
  | PayerSetPayload
  | PayerRemovedPayload
  | ParticipantSetPayload
  | ParticipantRemovedPayload
  | SettingsUpdatedPayload
  | RollbackPayload
  | Record<string, never>;

export interface LedgerEvent<P = LedgerEventPayload> {
  seq: number;
  type: LedgerEventType;
  actorIdentityId: IdentityId | null;
  payload: P;
  createdAt: number;
}
