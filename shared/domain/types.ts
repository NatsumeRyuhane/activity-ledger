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
  /** Data URL of the 100x100 WebP avatar, when one is set. */
  avatar?: string;
  createdAt: number;
  isCreator: boolean;
}

export interface Payer {
  identityId: IdentityId;
  amountCents: number;
  confirmed: boolean;
}

export interface Participant {
  identityId: IdentityId;
  shareCents?: number;
  confirmed: boolean;
}

export interface Payment {
  id: PaymentId;
  title: string;
  paidAt?: string;
  description?: string;
  splitMode: SplitMode;
  createdBy: IdentityId;
  createdAt: number;
  payers: Payer[];
  participants: Participant[];
  /** Identities who explicitly stated they are not part of this payment. */
  declinedBy: IdentityId[];
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
  | "identity.updated"
  | "payment.created"
  | "payment.updated"
  | "payment.voided"
  | "payer.set"
  | "payer.removed"
  | "participant.set"
  | "participant.removed"
  | "entry.confirmed"
  | "entry.declined"
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

export interface IdentityUpdatedPayload {
  identityId: IdentityId;
  name?: string;
  avatar?: string | null;
}

export interface PaymentCreatedPayload {
  payment: Payment;
}

export interface PaymentPatch {
  title?: string;
  paidAt?: string | null;
  description?: string | null;
  splitMode?: SplitMode;
}

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
  confirmed: boolean;
}

export interface PayerRemovedPayload {
  paymentId: PaymentId;
  identityId: IdentityId;
}

export interface ParticipantSetPayload {
  paymentId: PaymentId;
  identityId: IdentityId;
  shareCents?: number;
  confirmed: boolean;
}

export interface ParticipantRemovedPayload {
  paymentId: PaymentId;
  identityId: IdentityId;
}

export interface EntryConfirmedPayload {
  paymentId: PaymentId;
  identityId: IdentityId;
}

export interface EntryDeclinedPayload {
  paymentId: PaymentId;
  identityId: IdentityId;
}

export interface SettingsUpdatedPayload {
  name?: string;
  description?: string | null;
}

export interface RollbackPayload {
  targetSeq: number;
  reason?: string;
}

export type LedgerEventPayload =
  | ActivityCreatedPayload
  | IdentityCreatedPayload
  | IdentityUpdatedPayload
  | PaymentCreatedPayload
  | PaymentUpdatedPayload
  | PaymentVoidedPayload
  | PayerSetPayload
  | PayerRemovedPayload
  | ParticipantSetPayload
  | ParticipantRemovedPayload
  | EntryConfirmedPayload
  | EntryDeclinedPayload
  | SettingsUpdatedPayload
  | RollbackPayload;

export interface LedgerEvent<P = LedgerEventPayload> {
  seq: number;
  type: LedgerEventType;
  actorIdentityId: IdentityId | null;
  payload: P;
  createdAt: number;
}
