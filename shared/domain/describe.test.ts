import { describe, expect, it } from "vitest";
import { describeEvent, descriptionToText, type LedgerEvent } from "@shared/domain";

const ctx = { paymentTitles: new Map([["pay-1", "晚餐"]]) };
const nameOf = (id: string) => ({ alice: "Alice", bob: "Bob" })[id] ?? id;

describe("describeEvent", () => {
  it("leads with the acting identity and can embed another member", () => {
    const event: LedgerEvent = {
      seq: 4,
      type: "payer.set",
      actorIdentityId: "alice",
      createdAt: 0,
      payload: {
        paymentId: "pay-1",
        identityId: "bob",
        amountCents: 1200,
        confirmed: false,
      },
    };

    const description = describeEvent(event, ctx);
    expect(description.actorIdentityId).toBe("alice");
    expect(description.parts).toContainEqual({ kind: "identity", identityId: "bob" });
    expect(descriptionToText(description, nameOf)).toBe(
      "Alice 登记 Bob 在付款「晚餐」中支付了 ¥12.00",
    );
  });

  it("does not repeat the actor for self actions", () => {
    const description = describeEvent(
      {
        seq: 5,
        type: "entry.declined",
        actorIdentityId: "bob",
        createdAt: 0,
        payload: { paymentId: "pay-1", identityId: "bob" },
      },
      ctx,
    );
    expect(description.parts.every((part) => part.kind === "text")).toBe(true);
    expect(descriptionToText(description, nameOf)).toBe("Bob 声明未参与付款「晚餐」");
  });

  it("shows the joining member as the lead identity", () => {
    const description = describeEvent(
      {
        seq: 2,
        type: "identity.created",
        actorIdentityId: null,
        createdAt: 0,
        payload: {
          identity: { id: "bob", name: "Bob", color: "#111", createdAt: 0, isCreator: false },
        },
      },
      ctx,
    );
    expect(description.actorIdentityId).toBe("bob");
    expect(descriptionToText(description, nameOf)).toBe("Bob 加入了活动");
  });
});
