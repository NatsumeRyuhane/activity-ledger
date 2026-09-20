import type {
  LedgerEvent,
  LedgerState,
  Payment,
  RollbackPayload,
} from "./types";

export interface EffectiveHistory {
  /** Events that form the current state, in order. */
  effective: LedgerEvent[];
  /** Events that were undone by a rollback. */
  voided: Set<number>;
}

export function sortBySeq(events: LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((a, b) => a.seq - b.seq);
}

/**
 * Folds the raw event log into the effective timeline.
 *
 * A rollback event truncates every currently-effective event that came after
 * its target. Voided events never come back, and events appended after a
 * rollback simply continue the effective timeline.
 */
export function effectiveHistory(rawEvents: LedgerEvent[]): EffectiveHistory {
  const events = sortBySeq(rawEvents);
  const effective: LedgerEvent[] = [];
  const voided = new Set<number>();

  for (const event of events) {
    if (event.type === "rollback") {
      const { targetSeq } = event.payload as RollbackPayload;
      for (let i = effective.length - 1; i >= 0; i--) {
        if (effective[i].seq > targetSeq) {
          voided.add(effective[i].seq);
          effective.splice(i, 1);
        }
      }
    } else {
      effective.push(event);
    }
  }

  return { effective, voided };
}

export function replay(rawEvents: LedgerEvent[]): LedgerState {
  const { effective } = effectiveHistory(rawEvents);
  return fold(effective);
}

export function fold(events: LedgerEvent[]): LedgerState {
  const state: LedgerState = { activity: null, identities: [], payments: [] };

  for (const event of events) {
    switch (event.type) {
      case "activity.created": {
        const payload = event.payload as import("./types").ActivityCreatedPayload;
        state.activity = { ...payload.activity };
        state.identities.push({ ...payload.creator });
        break;
      }

      case "identity.created": {
        const payload = event.payload as import("./types").IdentityCreatedPayload;
        if (!state.identities.some((i) => i.id === payload.identity.id)) {
          state.identities.push({ ...payload.identity });
        }
        break;
      }

      case "payment.created": {
        const payload = event.payload as import("./types").PaymentCreatedPayload;
        state.payments.push(normalizePayment(payload.payment));
        break;
      }

      case "payment.updated": {
        const payload = event.payload as import("./types").PaymentUpdatedPayload;
        const payment = findPayment(state, payload.paymentId);
        if (!payment) break;
        const patch = payload.patch;
        if (patch.title !== undefined) payment.title = patch.title;
        if (patch.amountCents !== undefined) payment.amountCents = patch.amountCents;
        if (patch.splitMode !== undefined) payment.splitMode = patch.splitMode;
        if (patch.paidAt !== undefined) {
          if (patch.paidAt === null) delete payment.paidAt;
          else payment.paidAt = patch.paidAt;
        }
        if (patch.description !== undefined) {
          if (patch.description === null) delete payment.description;
          else payment.description = patch.description;
        }
        // Changing the total or the split mode invalidates previous
        // confirmations of everyone but the person who made the change.
        if (patch.amountCents !== undefined || patch.splitMode !== undefined) {
          for (const payer of payment.payers) {
            if (payer.identityId !== event.actorIdentityId) payer.confirmed = false;
          }
          for (const participant of payment.participants) {
            if (participant.identityId !== event.actorIdentityId) participant.confirmed = false;
          }
        }
        break;
      }

      case "payment.voided": {
        const payload = event.payload as import("./types").PaymentVoidedPayload;
        const payment = findPayment(state, payload.paymentId);
        if (payment) payment.voided = true;
        break;
      }

      case "payer.set": {
        const payload = event.payload as import("./types").PayerSetPayload;
        const payment = findPayment(state, payload.paymentId);
        if (!payment) break;
        const existing = payment.payers.find((p) => p.identityId === payload.identityId);
        const confirmed = payload.confirmed ?? existing?.confirmed ?? false;
        if (existing) {
          existing.amountCents = payload.amountCents;
          existing.confirmed = confirmed;
        } else {
          payment.payers.push({
            identityId: payload.identityId,
            amountCents: payload.amountCents,
            confirmed,
          });
        }
        break;
      }

      case "payer.removed": {
        const payload = event.payload as import("./types").PayerRemovedPayload;
        const payment = findPayment(state, payload.paymentId);
        if (!payment) break;
        payment.payers = payment.payers.filter((p) => p.identityId !== payload.identityId);
        break;
      }

      case "participant.set": {
        const payload = event.payload as import("./types").ParticipantSetPayload;
        const payment = findPayment(state, payload.paymentId);
        if (!payment) break;
        const existing = payment.participants.find((p) => p.identityId === payload.identityId);
        const confirmed = payload.confirmed ?? existing?.confirmed ?? false;
        if (payment.splitMode === "custom") {
          const shareCents = payload.shareCents ?? existing?.shareCents ?? 0;
          if (existing) {
            existing.shareCents = shareCents;
            existing.confirmed = confirmed;
          } else {
            payment.participants.push({
              identityId: payload.identityId,
              shareCents,
              confirmed,
            });
          }
        } else if (existing) {
          delete existing.shareCents;
          existing.confirmed = confirmed;
        } else {
          payment.participants.push({
            identityId: payload.identityId,
            confirmed,
          });
        }
        break;
      }

      case "entry.confirmed": {
        const payload = event.payload as import("./types").EntryConfirmedPayload;
        const payment = findPayment(state, payload.paymentId);
        if (!payment) break;
        for (const payer of payment.payers) {
          if (payer.identityId === payload.identityId) payer.confirmed = true;
        }
        for (const participant of payment.participants) {
          if (participant.identityId === payload.identityId) participant.confirmed = true;
        }
        break;
      }

      case "participant.removed": {
        const payload = event.payload as import("./types").ParticipantRemovedPayload;
        const payment = findPayment(state, payload.paymentId);
        if (!payment) break;
        payment.participants = payment.participants.filter((p) => p.identityId !== payload.identityId);
        break;
      }

      case "settings.updated": {
        const payload = event.payload as import("./types").SettingsUpdatedPayload;
        if (!state.activity) break;
        if (payload.name !== undefined) state.activity.name = payload.name;
        if (payload.description !== undefined) {
          if (payload.description === null) delete state.activity.description;
          else state.activity.description = payload.description;
        }
        break;
      }

      case "settings.password_changed":
      case "rollback":
        break;
    }
  }

  return state;
}

function normalizePayment(payment: Payment): Payment {
  return {
    ...payment,
    payers: payment.payers.map((p) => ({ ...p, confirmed: p.confirmed ?? false })),
    participants: payment.participants.map((p) => ({ ...p, confirmed: p.confirmed ?? false })),
    voided: payment.voided ?? false,
  };
}

function findPayment(state: LedgerState, paymentId: string): Payment | undefined {
  return state.payments.find((p) => p.id === paymentId);
}
