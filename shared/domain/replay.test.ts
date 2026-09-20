import { describe, expect, it } from "vitest";
import { effectiveHistory, replay, type LedgerEvent, type Payment } from "@shared/domain";

const CREATOR = "creator-id";
const ALICE = "alice-id";
const BOB = "bob-id";

function basePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    title: "晚餐",
    splitMode: "equal",
    createdBy: ALICE,
    createdAt: 3,
    payers: [{ identityId: ALICE, amountCents: 30000, confirmed: true }],
    participants: [
      { identityId: ALICE, confirmed: true },
      { identityId: BOB, confirmed: true },
    ],
    voided: false,
    ...overrides,
  };
}

function events(): LedgerEvent[] {
  return [
    {
      seq: 1,
      type: "activity.created",
      actorIdentityId: null,
      createdAt: 1,
      payload: {
        activity: {
          id: "act-1",
          name: "露营",
          createdAt: 1,
          creatorIdentityId: CREATOR,
          hasPassword: false,
        },
        creator: { id: CREATOR, name: "队长", color: "#000", createdAt: 1, isCreator: true },
      },
    },
    {
      seq: 2,
      type: "identity.created",
      actorIdentityId: CREATOR,
      createdAt: 2,
      payload: { identity: { id: ALICE, name: "Alice", color: "#111", createdAt: 2, isCreator: false } },
    },
    {
      seq: 3,
      type: "payment.created",
      actorIdentityId: ALICE,
      createdAt: 3,
      payload: { payment: basePayment() },
    },
    {
      seq: 4,
      type: "participant.set",
      actorIdentityId: BOB,
      createdAt: 4,
      payload: { paymentId: "pay-1", identityId: BOB, confirmed: true },
    },
    {
      seq: 5,
      type: "payer.set",
      actorIdentityId: ALICE,
      createdAt: 5,
      payload: { paymentId: "pay-1", identityId: BOB, amountCents: 10000, confirmed: false },
    },
  ];
}

describe("replay", () => {
  it("folds the full log into state", () => {
    const state = replay(events());
    expect(state.activity?.name).toBe("露营");
    expect(state.identities.map((i) => i.name)).toEqual(["队长", "Alice"]);
    expect(state.payments).toHaveLength(1);
    // Alice registered Bob's payment afterwards, so that entry awaits Bob.
    expect(state.payments[0].payers).toEqual([
      { identityId: ALICE, amountCents: 30000, confirmed: true },
      { identityId: BOB, amountCents: 10000, confirmed: false },
    ]);
    // Bob joining moved everyone's equal share, so both participant entries
    // need a fresh confirmation even though nobody's paid amount changed.
    expect(state.payments[0].participants).toEqual([
      { identityId: ALICE, confirmed: false },
      { identityId: BOB, confirmed: false },
    ]);
  });

  it("voids events after a rollback target", () => {
    const log = events();
    log.push({
      seq: 6,
      type: "rollback",
      actorIdentityId: CREATOR,
      createdAt: 6,
      payload: { targetSeq: 3, reason: "误操作" },
    });

    const { effective, voided } = effectiveHistory(log);
    expect(effective.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect([...voided].sort()).toEqual([4, 5]);

    const state = replay(log);
    expect(state.payments[0].payers).toEqual([
      { identityId: ALICE, amountCents: 30000, confirmed: true },
    ]);
    expect(state.identities).toHaveLength(2);
  });

  it("keeps events appended after a rollback", () => {
    const log = events();
    log.push(
      { seq: 6, type: "rollback", actorIdentityId: CREATOR, createdAt: 6, payload: { targetSeq: 3 } },
      {
        seq: 7,
        type: "participant.set",
        actorIdentityId: BOB,
        createdAt: 7,
        payload: { paymentId: "pay-1", identityId: BOB, confirmed: true },
      },
    );

    const { effective, voided } = effectiveHistory(log);
    expect(effective.map((e) => e.seq)).toEqual([1, 2, 3, 7]);
    expect([...voided].sort()).toEqual([4, 5]);
    expect(replay(log).payments[0].participants).toHaveLength(2);
  });

  it("never resurrects voided events on a later rollback", () => {
    const log = events();
    log.push(
      { seq: 6, type: "rollback", actorIdentityId: CREATOR, createdAt: 6, payload: { targetSeq: 3 } },
      {
        seq: 7,
        type: "payer.set",
        actorIdentityId: ALICE,
        createdAt: 7,
        payload: { paymentId: "pay-1", identityId: BOB, amountCents: 5000 },
      },
      { seq: 8, type: "rollback", actorIdentityId: CREATOR, createdAt: 8, payload: { targetSeq: 5 } },
    );

    const state = replay(log);
    // 4 and 5 stay voided even though targetSeq 5 is beyond them.
    expect(state.payments[0].payers).toEqual([
      { identityId: ALICE, amountCents: 30000, confirmed: true },
    ]);
    const { effective, voided } = effectiveHistory(log);
    expect(effective.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect([...voided].sort()).toEqual([4, 5, 7]);
  });
});
