import { describe, expect, it } from "vitest";
import {
  buildSettlement,
  computeShares,
  involvementOf,
  memberResponseState,
  validatePayment,
  type Payment,
} from "@shared/domain";

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    title: "晚餐",
    splitMode: "equal",
    createdBy: "alice",
    createdAt: 1,
    payers: [{ identityId: "alice", amountCents: 30000, confirmed: true }],
    participants: [
      { identityId: "alice", confirmed: true },
      { identityId: "bob", confirmed: true },
      { identityId: "carol", confirmed: true },
    ],
    declinedBy: [],
    voided: false,
    ...overrides,
  };
}

describe("computeShares", () => {
  it("splits equally", () => {
    const shares = computeShares(payment());
    expect(shares.get("alice")).toBe(10000);
    expect(shares.get("bob")).toBe(10000);
    expect(shares.get("carol")).toBe(10000);
  });

  it("distributes remainder cents deterministically", () => {
    const shares = computeShares(
      payment({ payers: [{ identityId: "alice", amountCents: 10001, confirmed: true }] }),
    );
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(10001);
    expect([...shares.values()].sort((a, b) => b - a)).toEqual([3334, 3334, 3333]);
    expect(shares.get("alice")).toBe(3334);
    expect(shares.get("bob")).toBe(3334);
    expect(shares.get("carol")).toBe(3333);
  });

  it("uses custom shares", () => {
    const shares = computeShares(
      payment({
        splitMode: "custom",
        participants: [
          { identityId: "alice", shareCents: 20000, confirmed: true },
          { identityId: "bob", shareCents: 10000, confirmed: true },
        ],
      }),
    );
    expect(shares.get("alice")).toBe(20000);
    expect(shares.get("bob")).toBe(10000);
  });
});

describe("validatePayment", () => {
  it("accepts a consistent equal-split payment", () => {
    expect(validatePayment(payment())).toEqual([]);
  });

  it("flags custom shares that do not sum to the total", () => {
    const issues = validatePayment(
      payment({
        splitMode: "custom",
        participants: [
          { identityId: "alice", shareCents: 10000, confirmed: true },
          { identityId: "bob", shareCents: 10000, confirmed: true },
        ],
      }),
    );
    expect(issues).toContain("share-sum-mismatch");
  });

  it("flags missing payers or participants", () => {
    expect(validatePayment(payment({ payers: [] }))).toContain("no-payers");
    expect(validatePayment(payment({ participants: [] }))).toContain("no-participants");
  });
});

describe("buildSettlement", () => {
  it("computes balances that sum to zero for valid payments", () => {
    const report = buildSettlement([payment()]);
    expect(report.balances).toEqual([
      { identityId: "alice", balanceCents: 20000 },
      { identityId: "bob", balanceCents: -10000 },
      { identityId: "carol", balanceCents: -10000 },
    ]);
    expect(report.transfers).toEqual([
      { from: "bob", to: "alice", amountCents: 10000 },
      { from: "carol", to: "alice", amountCents: 10000 },
    ]);
    expect(report.excludedPaymentIds).toEqual([]);
  });

  it("simplifies chains into fewer transfers", () => {
    const report = buildSettlement([
      payment({
        id: "p1",
        payers: [{ identityId: "alice", amountCents: 20000, confirmed: true }],
        participants: [
          { identityId: "alice", confirmed: true },
          { identityId: "bob", confirmed: true },
        ],
      }),
      payment({
        id: "p2",
        payers: [{ identityId: "bob", amountCents: 20000, confirmed: true }],
        participants: [
          { identityId: "bob", confirmed: true },
          { identityId: "carol", confirmed: true },
        ],
      }),
    ]);

    expect(report.transfers).toEqual([
      { from: "carol", to: "alice", amountCents: 10000 },
    ]);
  });

  it("excludes incomplete and voided payments", () => {
    const report = buildSettlement([
      payment({ id: "incomplete", participants: [] }),
      payment({ id: "voided", voided: true }),
      payment({ id: "ok" }),
    ]);
    expect(report.includedPaymentIds).toEqual(["ok"]);
    expect(report.excludedPaymentIds.sort()).toEqual(["incomplete", "voided"]);
  });

  it("handles multiple creditors and debtors with minimal movements", () => {
    const report = buildSettlement([
      payment({
        id: "p1",
        payers: [{ identityId: "alice", amountCents: 40000, confirmed: true }],
        participants: [
          { identityId: "alice", confirmed: true },
          { identityId: "bob", confirmed: true },
          { identityId: "carol", confirmed: true },
          { identityId: "dave", confirmed: true },
        ],
      }),
      payment({
        id: "p2",
        payers: [{ identityId: "dave", amountCents: 40000, confirmed: true }],
        participants: [
          { identityId: "alice", confirmed: true },
          { identityId: "bob", confirmed: true },
          { identityId: "carol", confirmed: true },
          { identityId: "dave", confirmed: true },
        ],
      }),
    ]);

    // alice +20000, dave +20000, bob -20000, carol -20000
    expect(report.transfers).toHaveLength(2);
    const settled = new Map(report.balances.map((b) => [b.identityId, b.balanceCents]));
    for (const transfer of report.transfers) {
      settled.set(transfer.from, (settled.get(transfer.from) ?? 0) + transfer.amountCents);
      settled.set(transfer.to, (settled.get(transfer.to) ?? 0) - transfer.amountCents);
    }
    expect([...settled.values()].every((v) => v === 0)).toBe(true);
  });

  it("blocks transfers while any entry is unconfirmed", () => {
    const report = buildSettlement([
      payment({
        participants: [
          { identityId: "alice", confirmed: true },
          { identityId: "bob", confirmed: true },
          { identityId: "carol", confirmed: false },
        ],
      }),
    ]);

    expect(report.canSettle).toBe(false);
    expect(report.transfers).toEqual([]);
    expect(report.pending).toEqual([
      { identityId: "carol", paymentId: "pay-1", role: "participant" },
    ]);
    // Balances are still shown so people can see where they stand.
    expect(report.balances.find((b) => b.identityId === "carol")?.balanceCents).toBe(-10000);
  });

  it("blocks transfers for members who never responded", () => {
    const report = buildSettlement(
      [
        payment({
          participants: [
            { identityId: "alice", confirmed: true },
            { identityId: "bob", confirmed: true },
          ],
        }),
      ],
      ["alice", "bob", "dave"],
    );

    expect(report.canSettle).toBe(false);
    expect(report.pending).toEqual([
      { identityId: "dave", paymentId: "pay-1", role: "unknown" },
    ]);
  });

  it("accepts an explicit decline as an answer", () => {
    const report = buildSettlement(
      [
        payment({
          declinedBy: ["dave"],
          participants: [
            { identityId: "alice", confirmed: true },
            { identityId: "bob", confirmed: true },
          ],
        }),
      ],
      ["alice", "bob", "dave"],
    );

    expect(report.canSettle).toBe(true);
    expect(report.pending).toEqual([]);
    expect(report.transfers.length).toBeGreaterThan(0);
  });

  it("keeps tracking someone who joined after declining", () => {
    const report = buildSettlement(
      [
        payment({
          declinedBy: [],
          participants: [
            { identityId: "alice", confirmed: true },
            { identityId: "dave", confirmed: false },
          ],
        }),
      ],
      ["alice", "dave"],
    );
    expect(report.pending).toEqual([
      { identityId: "dave", paymentId: "pay-1", role: "participant" },
    ]);
  });

  it("reports unconfirmed payers too", () => {
    const report = buildSettlement([
      payment({
        payers: [{ identityId: "alice", amountCents: 30000, confirmed: false }],
      }),
    ]);
    expect(report.canSettle).toBe(false);
    expect(report.pending).toContainEqual({
      identityId: "alice",
      paymentId: "pay-1",
      role: "payer",
    });
  });

  it("ignores unanswered states of voided payments", () => {
    const report = buildSettlement(
      [
        payment({
          voided: true,
          participants: [
            { identityId: "alice", confirmed: true },
            { identityId: "bob", confirmed: false },
          ],
        }),
      ],
      ["alice", "bob", "dave"],
    );
    expect(report.canSettle).toBe(true);
    expect(report.pending).toEqual([]);
  });

  it("classifies each member's response state", () => {
    const base = payment();
    expect(memberResponseState(base, "alice")).toBe("involved");
    expect(
      memberResponseState(
        payment({
          participants: [
            { identityId: "alice", confirmed: true },
            { identityId: "bob", confirmed: false },
          ],
        }),
        "bob",
      ),
    ).toBe("unconfirmed");
    expect(memberResponseState(payment({ declinedBy: ["dave"] }), "dave")).toBe("declined");
    expect(memberResponseState(base, "dave")).toBe("unknown");
  });

  it("describes a person's involvement in a payment", () => {
    const unpaid = involvementOf(payment(), "bob");
    expect(unpaid).toMatchObject({ isPayer: false, isParticipant: true, needsConfirmation: false });

    const pending = involvementOf(
      payment({
        participants: [
          { identityId: "alice", confirmed: true },
          { identityId: "bob", confirmed: false },
        ],
      }),
      "bob",
    );
    expect(pending.needsConfirmation).toBe(true);

    const none = involvementOf(payment(), "stranger");
    expect(none).toMatchObject({ isPayer: false, isParticipant: false });
  });
});
