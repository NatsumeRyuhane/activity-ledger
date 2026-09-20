import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "./app";
import { openDatabase } from "./db";
import { EventStore } from "./store";

let app: Hono;
let store: EventStore;

beforeEach(() => {
  store = new EventStore(openDatabase(":memory:"));
  app = createApp(store);
});

async function post(path: string, body: unknown) {
  const response = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function get(path: string) {
  const response = await app.request(path);
  return { status: response.status, body: (await response.json()) as any };
}

async function createActivity(password?: string) {
  const { body } = await post("/api/activities", {
    name: "露营",
    creatorName: "队长",
    password,
  });
  return body as { activityId: string; identityId: string };
}

async function addIdentity(activityId: string, actor: string, name: string) {
  const { body } = await post(`/api/activities/${activityId}/commands`, {
    actorIdentityId: actor,
    command: { type: "identity.create", name },
  });
  const identity = body.identities.find((item: any) => item.name === name);
  return identity.id as string;
}

async function createPayment(
  activityId: string,
  actor: string,
  overrides: Record<string, unknown> = {},
) {
  const { body } = await post(`/api/activities/${activityId}/commands`, {
    actorIdentityId: actor,
    command: {
      type: "payment.create",
      title: "晚餐",
      amountCents: 30000,
      splitMode: "equal",
      payers: [{ identityId: actor, amountCents: 30000 }],
      participants: [{ identityId: actor }],
      ...overrides,
    },
  });
  return body as any;
}

describe("activities", () => {
  it("creates an activity and returns its state", async () => {
    const { activityId, identityId } = await createActivity();
    expect(activityId).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/);

    const { status, body } = await get(`/api/activities/${activityId}`);
    expect(status).toBe(200);
    expect(body.activity.name).toBe("露营");
    expect(body.activity.creatorIdentityId).toBe(identityId);
    expect(body.identities).toHaveLength(1);
    expect(body.activity.hasPassword).toBe(false);
  });

  it("returns 404 for unknown activities", async () => {
    const { status } = await get("/api/activities/doesnotexist");
    expect(status).toBe(404);
  });

  it("rejects commands from unknown identities", async () => {
    const { activityId } = await createActivity();
    const { status, body } = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: "nobody",
      command: { type: "identity.create", name: "Bob" },
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("unknown_identity");
  });

  it("rejects malformed commands", async () => {
    const { activityId, identityId } = await createActivity();
    const { status } = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: identityId,
      command: { type: "payment.create", title: "" },
    });
    expect(status).toBe(400);
  });
});

describe("payments", () => {
  it("creates payments, waits for confirmations and then settles", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");

    const view = await createPayment(activityId, alice, {
      participants: [{ identityId: alice }, { identityId: bob }],
    });

    expect(view.payments).toHaveLength(1);
    // Alice confirmed her own commit; Bob has not confirmed his participation yet.
    expect(view.settlement.canSettle).toBe(false);
    expect(view.settlement.transfers).toEqual([]);
    expect(view.settlement.unconfirmed).toEqual([
      { identityId: bob, paymentId: view.payments[0].id, role: "participant" },
    ]);

    const confirm = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "entry.confirm", paymentId: view.payments[0].id },
    });
    expect(confirm.status).toBe(200);
    expect(confirm.body.settlement.canSettle).toBe(true);
    expect(confirm.body.settlement.balances).toEqual([
      { identityId: alice, balanceCents: 15000 },
      { identityId: bob, balanceCents: -15000 },
    ]);
    expect(confirm.body.settlement.transfers).toEqual([
      { from: bob, to: alice, amountCents: 15000 },
    ]);
  });

  it("treats manager edits as needing re-confirmation", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");
    const view = await createPayment(activityId, alice, {
      participants: [{ identityId: alice }, { identityId: bob }],
    });
    const paymentId = view.payments[0].id;

    await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "entry.confirm", paymentId },
    });

    const edited = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: {
        type: "participant.set",
        paymentId,
        identityId: bob,
      },
    });
    expect(edited.status).toBe(200);
    const bobParticipant = edited.body.payments[0].participants.find(
      (p: any) => p.identityId === bob,
    );
    expect(bobParticipant.confirmed).toBe(false);
    expect(edited.body.settlement.canSettle).toBe(false);

    const again = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "entry.confirm", paymentId },
    });
    expect(again.status).toBe(200);
    expect(again.body.settlement.canSettle).toBe(true);
  });

  it("resets other confirmations when the total changes", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");
    const view = await createPayment(activityId, alice, {
      participants: [{ identityId: alice }, { identityId: bob }],
    });
    const paymentId = view.payments[0].id;

    await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "entry.confirm", paymentId },
    });

    const updated = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: { type: "payment.update", paymentId, patch: { amountCents: 40000 } },
    });
    expect(updated.status).toBe(200);
    expect(
      updated.body.payments[0].participants.find((p: any) => p.identityId === bob).confirmed,
    ).toBe(false);
    expect(
      updated.body.payments[0].participants.find((p: any) => p.identityId === alice).confirmed,
    ).toBe(true);
  });

  it("refuses to confirm for someone else", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");
    const view = await createPayment(activityId, alice, {
      participants: [{ identityId: alice }, { identityId: bob }],
    });
    const paymentId = view.payments[0].id;

    const response = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "entry.confirm", paymentId },
    });
    expect(response.status).toBe(200);
    // Bob only ever confirms himself; Alice's entry stays as it was.
    expect(
      response.body.payments[0].participants.find((p: any) => p.identityId === alice).confirmed,
    ).toBe(true);

    const wrong = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      command: { type: "entry.confirm", paymentId },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("not_involved");
  });


  it("lets members enroll themselves but not remove others", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");
    await createPayment(activityId, alice, { participants: [{ identityId: alice }] });
    const paymentId = (await get(`/api/activities/${activityId}`)).body.payments[0].id;

    const enroll = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "participant.set", paymentId, identityId: bob },
    });
    expect(enroll.status).toBe(200);
    expect(enroll.body.payments[0].participants).toHaveLength(2);

    const removeOther = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "participant.remove", paymentId, identityId: alice },
    });
    expect(removeOther.status).toBe(403);

    const removeSelf = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "participant.remove", paymentId, identityId: bob },
    });
    expect(removeSelf.status).toBe(200);
    expect(removeSelf.body.payments[0].participants).toHaveLength(1);
  });

  it("lets the payment creator manage enrollment", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");
    await createPayment(activityId, alice, {
      participants: [{ identityId: alice }, { identityId: bob }],
    });
    const paymentId = (await get(`/api/activities/${activityId}`)).body.payments[0].id;

    const response = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: { type: "participant.remove", paymentId, identityId: bob },
    });
    expect(response.status).toBe(200);
    expect(response.body.payments[0].participants.map((p: any) => p.identityId)).toEqual([alice]);
  });

  it("records a custom share when enrolling in custom mode", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");
    await createPayment(activityId, alice, {
      splitMode: "custom",
      participants: [{ identityId: alice, shareCents: 20000 }],
    });
    const paymentId = (await get(`/api/activities/${activityId}`)).body.payments[0].id;

    const response = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "participant.set", paymentId, identityId: bob, shareCents: 10000 },
    });
    expect(response.status).toBe(200);
    expect(response.body.settlement.transfers).toEqual([
      { from: bob, to: alice, amountCents: 10000 },
    ]);
  });

  it("marks inconsistent payments as excluded from settlement", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const view = await createPayment(activityId, captain, {
      amountCents: 30000,
      payers: [{ identityId: captain, amountCents: 20000 }],
    });
    expect(view.settlement.excludedPaymentIds).toHaveLength(1);
    expect(view.settlement.transfers).toEqual([]);
  });
});

describe("admin", () => {
  it("requires the admin password for rollback", async () => {
    const { activityId, identityId: captain } = await createActivity("hunter2");
    const alice = await addIdentity(activityId, captain, "Alice");
    await createPayment(activityId, alice, { participants: [{ identityId: alice }] });

    const wrong = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      adminPassword: "nope",
      command: { type: "rollback", targetSeq: 1 },
    });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("wrong_password");

    const right = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      adminPassword: "hunter2",
      command: { type: "rollback", targetSeq: 2 },
    });
    expect(right.status).toBe(200);
    expect(right.body.payments).toHaveLength(0);
    expect(right.body.identities).toHaveLength(2);
    expect(right.body.events.filter((e: any) => e.voided)).toHaveLength(1);
  });

  it("refuses admin actions until a password is set", async () => {
    const { activityId, identityId: captain } = await createActivity();
    await addIdentity(activityId, captain, "Alice");
    const { status, body } = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      command: { type: "rollback", targetSeq: 1 },
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("no_password");
  });

  it("only lets the creator set the password and requires the old one to change it", async () => {
    const { activityId, identityId: captain } = await createActivity("first-pass");
    const alice = await addIdentity(activityId, captain, "Alice");

    const byOther = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: { type: "admin.setPassword", newPassword: "hacked" },
    });
    expect(byOther.status).toBe(403);

    const withoutOld = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      command: { type: "admin.setPassword", newPassword: "second-pass" },
    });
    expect(withoutOld.status).toBe(403);

    const change = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      adminPassword: "first-pass",
      command: { type: "admin.setPassword", newPassword: "second-pass" },
    });
    expect(change.status).toBe(200);
    expect(change.body.activity.hasPassword).toBe(true);
  });

  it("rejects rollbacks that would change nothing", async () => {
    const { activityId, identityId: captain } = await createActivity("hunter2");
    await addIdentity(activityId, captain, "Alice");
    const { status, body } = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      adminPassword: "hunter2",
      command: { type: "rollback", targetSeq: 2 },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("nothing_to_rollback");
  });

  it("rolls back activity settings too", async () => {
    const { activityId, identityId: captain } = await createActivity("hunter2");
    await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      adminPassword: "hunter2",
      command: { type: "settings.update", name: "新名字" },
    });
    expect((await get(`/api/activities/${activityId}`)).body.activity.name).toBe("新名字");

    const { body } = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      adminPassword: "hunter2",
      command: { type: "rollback", targetSeq: 1 },
    });
    expect(body.activity.name).toBe("露营");
  });
});
