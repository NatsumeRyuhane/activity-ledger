import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "./app";
import { openDatabase } from "./db";
import { resetRateLimits } from "./rate-limit";
import { EventStore } from "./store";

let app: Hono;
let store: EventStore;

beforeEach(() => {
  resetRateLimits();
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

async function addIdentity(activityId: string, _actor: string, name: string) {
  const { body } = await post(`/api/activities/${activityId}/identities`, { name });
  return body.identityId as string;
}

async function decline(activityId: string, actor: string, paymentId: string) {
  return post(`/api/activities/${activityId}/commands`, {
    actorIdentityId: actor,
    command: { type: "entry.decline", paymentId },
  });
}

async function closeActivity(activityId: string, actor: string, password: string) {
  return post(`/api/activities/${activityId}/commands`, {
    actorIdentityId: actor,
    adminPassword: password,
    command: { type: "activity.close" },
  });
}

async function confirm(activityId: string, actor: string, paymentId: string) {
  return post(`/api/activities/${activityId}/commands`, {
    actorIdentityId: actor,
    command: { type: "entry.confirm", paymentId },
  });
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

  it("lets anyone with the link join by creating an identity", async () => {
    const { activityId, identityId: captain } = await createActivity();
    await createPayment(activityId, captain, {
      participants: [{ identityId: captain }],
    });

    const { status, body } = await post(`/api/activities/${activityId}/identities`, {
      name: "路人甲",
    });
    expect(status).toBe(201);
    expect(body.identityId).toBeTruthy();
    expect(body.view.identities.map((i: any) => i.name)).toContain("路人甲");
    // A brand new member has not reacted to the existing payment yet.
    expect(body.view.settlement.canSettle).toBe(false);
    expect(
      body.view.settlement.pending.some(
        (entry: any) => entry.identityId === body.identityId && entry.role === "unknown",
      ),
    ).toBe(true);

    const empty = await post(`/api/activities/${activityId}/identities`, { name: "  " });
    expect(empty.status).toBe(400);
  });

  it("rejects commands from unknown identities", async () => {
    const { activityId } = await createActivity();
    const { status, body } = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: "nobody",
      command: { type: "identity.update", identityId: "nobody", name: "Bob" },
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

describe("abuse protection", () => {
  it("throttles repeated admin password attempts", async () => {
    const { activityId } = await createActivity("hunter2");

    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await post(`/api/activities/${activityId}/admin/verify`, {
        password: `wrong-${attempt}`,
      });
      expect(response.status).toBe(403);
    }

    const blocked = await post(`/api/activities/${activityId}/admin/verify`, {
      password: "hunter2",
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("too_many_attempts");

    // Rate limiting also covers the command path that carries a password.
    const command = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: "whoever",
      adminPassword: "hunter2",
      command: { type: "rollback", targetSeq: 1 },
    });
    expect(command.status).toBe(429);
  });

  it("clears the failure counter after a successful verification", async () => {
    const { activityId } = await createActivity("hunter2");

    for (let attempt = 0; attempt < 5; attempt++) {
      await post(`/api/activities/${activityId}/admin/verify`, { password: "nope" });
    }
    const ok = await post(`/api/activities/${activityId}/admin/verify`, { password: "hunter2" });
    expect(ok.status).toBe(200);

    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await post(`/api/activities/${activityId}/admin/verify`, {
        password: "nope",
      });
      expect(response.status).toBe(403);
    }
  });

  it("rejects oversized avatar uploads before buffering them", async () => {
    const oversized = Buffer.alloc(11 * 1024 * 1024, 1);
    const response = await app.request("/api/avatars", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: oversized,
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("image_too_large");
  });

  it("rejects over-long admin passwords at activity creation", async () => {
    const { status, body } = await post("/api/activities", {
      name: "长密码",
      creatorName: "队长",
      password: "x".repeat(129),
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_password");
  });
});

describe("profiles and avatars", () => {
  it("lets people rename themselves and rejects renaming others", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");

    const own = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: { type: "identity.update", identityId: alice, name: "爱丽丝" },
    });
    expect(own.status).toBe(200);
    expect(own.body.identities.find((i: any) => i.id === alice).name).toBe("爱丽丝");

    const other = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: { type: "identity.update", identityId: captain, name: "黑客" },
    });
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe("not_self");
  });

  it("sets and clears an avatar through identity updates", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const dataUrl = `data:image/webp;base64,${Buffer.from("fake").toString("base64")}`;

    const set = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      command: { type: "identity.update", identityId: captain, avatar: dataUrl },
    });
    expect(set.status).toBe(200);
    expect(set.body.identities.find((i: any) => i.id === captain).avatar).toBe(dataUrl);

    const clear = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      command: { type: "identity.update", identityId: captain, avatar: null },
    });
    expect(clear.status).toBe(200);
    expect(clear.body.identities.find((i: any) => i.id === captain).avatar).toBeUndefined();
  });

  it("rejects invalid avatar payloads", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const { status } = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      command: {
        type: "identity.update",
        identityId: captain,
        avatar: "data:image/png;base64,AAAA",
      },
    });
    expect(status).toBe(400);
  });

  it("keeps avatar bytes out of the client event log", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const dataUrl = `data:image/webp;base64,${Buffer.from("fake").toString("base64")}`;
    await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      command: { type: "identity.update", identityId: captain, avatar: dataUrl },
    });

    const { body } = await get(`/api/activities/${activityId}`);
    expect(body.identities.find((i: any) => i.id === captain).avatar).toBe(dataUrl);
    const updateEvent = body.events.find((e: any) => e.type === "identity.updated");
    expect(updateEvent.payload.avatar).toBe("[图片]");
  });

  it("compresses uploads to a 100x100 webp data url", async () => {
    const { default: sharp } = await import("sharp");
    const source = await sharp({
      create: { width: 320, height: 180, channels: 3, background: "#3366ff" },
    })
      .png()
      .toBuffer();

    const response = await app.request("/api/avatars", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: source,
    });
    expect(response.status).toBe(200);
    const { avatar } = (await response.json()) as { avatar: string };
    expect(avatar.startsWith("data:image/webp;base64,")).toBe(true);

    const bytes = Buffer.from(avatar.split(",")[1], "base64");
    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(100);
  });

  it("rejects non-image uploads", async () => {
    const response = await app.request("/api/avatars", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    expect(response.status).toBe(400);
  });
});

describe("payments", () => {
  it("creates payments, waits for every member to respond and then settles", async () => {
    const { activityId, identityId: captain } = await createActivity("hunter2");
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");

    const view = await createPayment(activityId, alice, {
      participants: [{ identityId: alice }, { identityId: bob }],
    });
    const paymentId = view.payments[0].id;

    expect(view.payments).toHaveLength(1);
    // Bob is enrolled but has not confirmed; the captain never reacted at all.
    expect(view.settlement.canSettle).toBe(false);
    expect(view.settlement.transfers).toEqual([]);
    expect(view.settlement.pending).toEqual([
      { identityId: captain, paymentId, role: "unknown" },
      { identityId: bob, paymentId, role: "participant" },
    ]);

    const bobConfirm = await confirm(activityId, bob, paymentId);
    expect(bobConfirm.status).toBe(200);
    // The captain is still an open question, so nothing can be settled yet.
    expect(bobConfirm.body.settlement.canSettle).toBe(false);

    const captainDecline = await decline(activityId, captain, paymentId);
    expect(captainDecline.status).toBe(200);
    expect(captainDecline.body.payments[0].declinedBy).toEqual([captain]);
    expect(captainDecline.body.settlement.canSettle).toBe(true);
    expect(captainDecline.body.settlement.balances).toEqual([
      { identityId: alice, balanceCents: 15000 },
      { identityId: bob, balanceCents: -15000 },
    ]);
    // Everyone responded, but the plan only materializes after the admin closes.
    expect(captainDecline.body.settlement.transfers).toEqual([]);

    const closed = await closeActivity(activityId, captain, "hunter2");
    expect(closed.status).toBe(200);
    expect(closed.body.activity.closedAt).toBeGreaterThan(0);
    expect(closed.body.settlement.closed).toBe(true);
    expect(closed.body.settlement.transfers).toEqual([
      { from: bob, to: alice, amountCents: 15000 },
    ]);

    // Closed means locked: no more edits.
    const lateEdit = await confirm(activityId, bob, paymentId);
    expect(lateEdit.status).toBe(400);
    expect(lateEdit.body.error.code).toBe("activity_closed");
  });

  it("requires an explicit decline from uninvolved members", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");
    const view = await createPayment(activityId, alice, {
      participants: [{ identityId: alice }],
    });
    const paymentId = view.payments[0].id;

    // Someone who is enrolled cannot decline their way out.
    const involved = await decline(activityId, alice, paymentId);
    expect(involved.status).toBe(403);
    expect(involved.body.error.code).toBe("already_involved");

    const first = await decline(activityId, captain, paymentId);
    expect(first.status).toBe(200);
    const twice = await decline(activityId, captain, paymentId);
    expect(twice.status).toBe(400);
    expect(twice.body.error.code).toBe("already_declined");

    // Joining later clears the decline and records a fresh confirmation.
    const join = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      command: { type: "participant.set", paymentId, identityId: captain },
    });
    expect(join.status).toBe(200);
    expect(join.body.payments[0].declinedBy).toEqual([]);
    expect(
      join.body.payments[0].participants.find((p: any) => p.identityId === captain),
    ).toMatchObject({ confirmed: true });
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

    const again = await confirm(activityId, bob, paymentId);
    expect(again.status).toBe(200);
    expect(again.body.settlement.canSettle).toBe(false);

    await decline(activityId, captain, paymentId);
    const finalView = await get(`/api/activities/${activityId}`);
    expect(finalView.body.settlement.canSettle).toBe(true);
  });

  it("only asks the edited member to confirm again", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");
    const view = await createPayment(activityId, alice, {
      payers: [
        { identityId: alice, amountCents: 20000 },
        { identityId: bob, amountCents: 10000 },
      ],
      participants: [{ identityId: alice }, { identityId: bob }],
    });
    const paymentId = view.payments[0].id;
    await confirm(activityId, bob, paymentId);
    await decline(activityId, captain, paymentId);
    expect((await get(`/api/activities/${activityId}`)).body.settlement.canSettle).toBe(true);

    // Bob edits his own amount: it is his own field, so no confirmation is lost.
    const ownEdit = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "payer.set", paymentId, identityId: bob, amountCents: 12000 },
    });
    expect(ownEdit.status).toBe(200);
    expect(
      ownEdit.body.payments[0].participants.find((p: any) => p.identityId === alice).confirmed,
    ).toBe(true);
    expect(ownEdit.body.settlement.canSettle).toBe(true);

    // Alice edits Bob's records: Bob is the one who has to confirm again.
    const otherEdit = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: { type: "payer.set", paymentId, identityId: bob, amountCents: 13000 },
    });
    expect(otherEdit.status).toBe(200);
    expect(
      otherEdit.body.payments[0].payers.find((p: any) => p.identityId === bob).confirmed,
    ).toBe(false);
    expect(
      otherEdit.body.payments[0].participants.find((p: any) => p.identityId === alice).confirmed,
    ).toBe(true);
    expect(otherEdit.body.settlement.canSettle).toBe(false);
  });

  it("lets the payment creator edit their own participation", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");
    await createPayment(activityId, alice, {
      splitMode: "custom",
      participants: [{ identityId: alice, shareCents: 30000 }],
    });
    const paymentId = (await get(`/api/activities/${activityId}`)).body.payments[0].id;

    // Alice is both the payment creator and a participant; editing her own
    // share must not be mistaken for a member meddling with the payment.
    const ownShare = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: {
        type: "participant.set",
        paymentId,
        identityId: alice,
        shareCents: 25000,
      },
    });
    expect(ownShare.status).toBe(200);
    expect(
      ownShare.body.payments[0].participants.find((p: any) => p.identityId === alice),
    ).toMatchObject({ shareCents: 25000, confirmed: true });
  });

  it("only lets the payment creator set custom shares", async () => {
    const { activityId, identityId: captain } = await createActivity("hunter2");
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");
    await createPayment(activityId, alice, {
      splitMode: "custom",
      participants: [{ identityId: alice, shareCents: 20000 }],
    });
    const paymentId = (await get(`/api/activities/${activityId}`)).body.payments[0].id;

    // Bob cannot declare his own share.
    const selfShare = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "participant.set", paymentId, identityId: bob, shareCents: 10000 },
    });
    expect(selfShare.status).toBe(403);
    expect(selfShare.body.error.code).toBe("manager_only");

    // Bob may join without a share; the creator fills it in.
    const join = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "participant.set", paymentId, identityId: bob },
    });
    expect(join.status).toBe(200);
    // Joining without a share leaves the payment incomplete, so it is kept out
    // of settlement until the creator assigns the missing amount.
    expect(join.body.settlement.excludedPaymentIds).toHaveLength(1);

    const assign = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: { type: "participant.set", paymentId, identityId: bob, shareCents: 10000 },
    });
    expect(assign.status).toBe(200);
    // The creator's edit needs Bob's confirmation before transfers are computed.
    expect(assign.body.settlement.canSettle).toBe(false);

    const bobConfirm = await confirm(activityId, bob, paymentId);
    expect(bobConfirm.status).toBe(200);
    await decline(activityId, captain, paymentId);

    const closed = await closeActivity(activityId, captain, "hunter2");
    expect(closed.status).toBe(200);
    expect(closed.body.settlement.transfers).toEqual([
      { from: bob, to: alice, amountCents: 10000 },
    ]);
  });

  it("requires the payment creator to stay a payer", async () => {
    const { activityId, identityId: captain } = await createActivity("hunter2");
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");

    const missingCreator = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: {
        type: "payment.create",
        title: "晚餐",
        splitMode: "equal",
        payers: [{ identityId: bob, amountCents: 30000 }],
        participants: [{ identityId: alice }],
      },
    });
    expect(missingCreator.status).toBe(400);
    expect(missingCreator.body.error.code).toBe("creator_must_pay");

    await createPayment(activityId, alice, { participants: [{ identityId: alice }] });
    const paymentId = (await get(`/api/activities/${activityId}`)).body.payments[0].id;

    const selfRemove = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: { type: "payer.remove", paymentId, identityId: alice },
    });
    expect(selfRemove.status).toBe(400);

    const adminRemove = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      adminPassword: "hunter2",
      command: { type: "payer.remove", paymentId, identityId: alice },
    });
    expect(adminRemove.status).toBe(400);
    expect(adminRemove.body.error.code).toBe("creator_must_pay");
  });

  it("lets a non-creator payer adjust their own amount only", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");
    await createPayment(activityId, alice, {
      payers: [
        { identityId: alice, amountCents: 20000 },
        { identityId: bob, amountCents: 10000 },
      ],
      participants: [{ identityId: alice }, { identityId: bob }],
    });
    const paymentId = (await get(`/api/activities/${activityId}`)).body.payments[0].id;

    const own = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "payer.set", paymentId, identityId: bob, amountCents: 12000 },
    });
    expect(own.status).toBe(200);
    const bobPayer = own.body.payments[0].payers.find((p: any) => p.identityId === bob);
    expect(bobPayer).toMatchObject({ amountCents: 12000, confirmed: true });

    const other = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: { type: "payer.set", paymentId, identityId: alice, amountCents: 5000 },
    });
    expect(other.status).toBe(403);
  });

  it("marks inconsistent payments as excluded from settlement", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const view = await createPayment(activityId, captain, {
      splitMode: "custom",
      participants: [{ identityId: captain, shareCents: 10000 }],
    });
    expect(view.settlement.excludedPaymentIds).toHaveLength(1);
    expect(view.settlement.transfers).toEqual([]);
  });
});

describe("payment edits", () => {
  it("applies a full edit as one batch", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");
    const carol = await addIdentity(activityId, captain, "Carol");
    const view = await createPayment(activityId, alice, {
      payers: [{ identityId: alice, amountCents: 30000 }],
      participants: [{ identityId: alice }],
    });
    const paymentId = view.payments[0].id;

    const edited = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: {
        type: "payment.edit",
        paymentId,
        title: "晚餐（改）",
        paidAt: "2026-09-20T19:30",
        description: "含饮料",
        splitMode: "custom",
        payers: [
          { identityId: alice, amountCents: 24000 },
          { identityId: bob, amountCents: 6000 },
        ],
        participants: [
          { identityId: alice, shareCents: 15000 },
          { identityId: carol, shareCents: 15000 },
        ],
      },
    });

    expect(edited.status).toBe(200);
    const payment = edited.body.payments.find((p: any) => p.id === paymentId);
    expect(payment).toMatchObject({
      title: "晚餐（改）",
      paidAt: "2026-09-20T19:30",
      description: "含饮料",
      splitMode: "custom",
    });
    expect(payment.payers).toEqual([
      { identityId: alice, amountCents: 24000, confirmed: true },
      { identityId: bob, amountCents: 6000, confirmed: false },
    ]);
    expect(payment.participants).toContainEqual({
      identityId: carol,
      shareCents: 15000,
      confirmed: false,
    });
    // 240.00 + 60.00 paid, 150.00 + 150.00 owed.
    expect(edited.body.settlement.canSettle).toBe(false);
    expect(
      edited.body.events.filter((e: any) => e.type === "payer.set" || e.type === "participant.set")
        .length,
    ).toBeGreaterThan(1);
  });

  it("rejects a batch edit from non-managers and invalid targets", async () => {
    const { activityId, identityId: captain } = await createActivity();
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");
    const view = await createPayment(activityId, alice, {
      payers: [{ identityId: alice, amountCents: 30000 }],
      participants: [{ identityId: alice }],
    });
    const paymentId = view.payments[0].id;
    const headSeq = view.headSeq;

    const base = {
      type: "payment.edit",
      paymentId,
      title: "改一下",
      splitMode: "equal",
      payers: [{ identityId: alice, amountCents: 30000 }],
      participants: [{ identityId: alice }],
    };

    const byMember = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: bob,
      command: base,
    });
    expect(byMember.status).toBe(403);

    const droppingCreator = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: { ...base, payers: [{ identityId: bob, amountCents: 30000 }] },
    });
    expect(droppingCreator.status).toBe(400);
    expect(droppingCreator.body.error.code).toBe("creator_must_pay");

    const unknownIdentity = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: { ...base, participants: [{ identityId: "nobody" }] },
    });
    expect(unknownIdentity.status).toBe(403);
    expect(unknownIdentity.body.error.code).toBe("unknown_identity");

    // Validation happens before anything is written.
    const after = await get(`/api/activities/${activityId}`);
    expect(after.body.headSeq).toBe(headSeq);
    expect(after.body.payments[0].title).toBe("晚餐");
  });
});

describe("closing the activity", () => {
  it("refuses to close while members have not responded", async () => {
    const { activityId, identityId: captain } = await createActivity("hunter2");
    const alice = await addIdentity(activityId, captain, "Alice");
    await createPayment(activityId, alice, { participants: [{ identityId: alice }] });

    const blocked = await closeActivity(activityId, captain, "hunter2");
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe("pending_confirmations");
  });

  it("treats recorded assignments as true on a forced close", async () => {
    const { activityId, identityId: captain } = await createActivity("hunter2");
    const alice = await addIdentity(activityId, captain, "Alice");
    const bob = await addIdentity(activityId, captain, "Bob");
    const view = await createPayment(activityId, alice, {
      payers: [
        { identityId: alice, amountCents: 20000 },
        { identityId: bob, amountCents: 10000 },
      ],
      participants: [{ identityId: alice }, { identityId: bob }],
    });
    const paymentId = view.payments[0].id;

    const forced = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      adminPassword: "hunter2",
      command: { type: "activity.close", forced: true },
    });
    expect(forced.status).toBe(200);
    expect(forced.body.activity.closedForced).toBe(true);
    expect(forced.body.settlement.closed).toBe(true);
    expect(forced.body.settlement.pending).toEqual([]);

    // Bob was registered by Alice but never confirmed: the assignment stands.
    const payment = forced.body.payments.find((p: any) => p.id === paymentId);
    expect(payment.payers.map((p: any) => p.identityId)).toEqual([alice, bob]);
    expect(payment.payers.every((p: any) => p.confirmed)).toBe(true);
    expect(payment.participants.map((p: any) => p.identityId)).toEqual([alice, bob]);
    expect(payment.participants.every((p: any) => p.confirmed)).toBe(true);
    expect(payment.declinedBy).not.toContain(bob);

    // The captain was never registered anywhere, so they count as uninvolved.
    expect(payment.declinedBy).toContain(captain);

    // 300.00 split between the two participants; Bob paid 100.00 and owes 150.00.
    expect(forced.body.settlement.transfers).toEqual([
      { from: bob, to: alice, amountCents: 5000 },
    ]);
  });

  it("counts strangers as not participating on a forced close", async () => {
    const { activityId, identityId: captain } = await createActivity("hunter2");
    const alice = await addIdentity(activityId, captain, "Alice");
    const view = await createPayment(activityId, alice, {
      participants: [{ identityId: alice }],
    });
    const paymentId = view.payments[0].id;

    const forced = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      adminPassword: "hunter2",
      command: { type: "activity.close", forced: true },
    });
    expect(forced.status).toBe(200);
    const payment = forced.body.payments.find((p: any) => p.id === paymentId);
    // Alice registered herself, so her participation stands; the captain did nothing.
    expect(payment.participants.map((p: any) => p.identityId)).toEqual([alice]);
    expect(payment.declinedBy).toEqual([captain]);
    expect(forced.body.settlement.canSettle).toBe(true);
  });

  it("only the admin can close, and rollback can reopen", async () => {
    const { activityId, identityId: captain } = await createActivity("hunter2");
    const alice = await addIdentity(activityId, captain, "Alice");
    await createPayment(activityId, alice, { participants: [{ identityId: alice }] });

    const byMember = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: alice,
      command: { type: "activity.close" },
    });
    expect(byMember.status).toBe(403);

    await decline(activityId, captain, await firstPaymentId(activityId));
    await confirm(activityId, alice, await firstPaymentId(activityId));
    const closed = await closeActivity(activityId, captain, "hunter2");
    expect(closed.status).toBe(200);

    const rolledBack = await post(`/api/activities/${activityId}/commands`, {
      actorIdentityId: captain,
      adminPassword: "hunter2",
      command: { type: "rollback", targetSeq: closed.body.headSeq - 1 },
    });
    expect(rolledBack.status).toBe(200);
    expect(rolledBack.body.activity.closedAt).toBeUndefined();
    expect(rolledBack.body.settlement.closed).toBe(false);
  });
});

async function firstPaymentId(activityId: string): Promise<string> {
  return (await get(`/api/activities/${activityId}`)).body.payments[0].id;
}

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

  it("verifies the admin password without acting as the creator", async () => {
    const { activityId } = await createActivity("hunter2");

    const wrong = await post(`/api/activities/${activityId}/admin/verify`, { password: "nope" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("wrong_password");

    // Anyone holding the link may check the password before adopting the admin
    // identity; a correct password is what gates the switch.
    const right = await post(`/api/activities/${activityId}/admin/verify`, { password: "hunter2" });
    expect(right.status).toBe(200);
    expect(right.body.ok).toBe(true);

    const noPassword = await createActivity();
    const fallback = await post(`/api/activities/${noPassword.activityId}/admin/verify`, {
      password: "whatever",
    });
    expect(fallback.status).toBe(403);
    expect(fallback.body.error.code).toBe("no_password");
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
