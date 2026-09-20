import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "@hono/node-server/conninfo";
import { toAvatarDataUrl } from "./avatar";
import {
  AppError,
  applyCommand,
  createActivity,
  createIdentity,
  getActivityView,
  verifyAdminPassword,
} from "./service";
import {
  clearFailures,
  isRateLimited,
  recordFailure,
} from "./rate-limit";
import type { EventStore } from "./store";

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

export function createApp(store: EventStore) {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/activities", async (c) => {
    return run(c, async () => {
      const body = await readJson(c.req.raw);
      const result = createActivity(store, {
        name: String(body.name ?? ""),
        description: body.description === undefined ? undefined : String(body.description),
        creatorName: String(body.creatorName ?? ""),
        password: body.password === undefined || body.password === null ? undefined : String(body.password),
      });
      return c.json(result, 201);
    });
  });

  app.post("/api/activities/:id/identities", async (c) => {
    return run(c, async () => {
      const body = await readJson(c.req.raw);
      const result = createIdentity(store, c.req.param("id"), String(body.name ?? ""));
      return c.json(result, 201);
    });
  });

  app.post("/api/activities/:id/admin/verify", async (c) => {
    return run(c, async () => {
      const activityId = c.req.param("id");
      assertPasswordAttemptAllowed(c, activityId);
      const body = await readJson(c.req.raw);
      try {
        verifyAdminPassword(store, activityId, String(body.password ?? ""));
      } catch (error) {
        recordPasswordAttempt(c, activityId, error);
        throw error;
      }
      clearPasswordAttempts(c, activityId);
      return c.json({ ok: true });
    });
  });

  app.post(
    "/api/avatars",
    bodyLimit({
      maxSize: MAX_AVATAR_BYTES,
      onError: (c) =>
        c.json(
          { error: { code: "image_too_large", message: "图片不能超过 10MB" } },
          413,
        ),
    }),
    async (c) => {
      return run(c, async () => {
        const contentType = c.req.header("content-type") ?? "";
        if (!contentType.startsWith("image/")) {
          throw new AppError(400, "invalid_image", "请上传图片文件");
        }
        const buffer = Buffer.from(await c.req.arrayBuffer());
        if (buffer.length === 0) {
          throw new AppError(400, "invalid_image", "图片内容为空");
        }
        if (buffer.length > MAX_AVATAR_BYTES) {
          throw new AppError(400, "image_too_large", "图片不能超过 10MB");
        }
        return c.json({ avatar: await toAvatarDataUrl(buffer) });
      });
    },
  );

  app.get("/api/activities/:id", (c) => {
    return run(c, () => c.json(getActivityView(store, c.req.param("id"))));
  });

  app.post("/api/activities/:id/commands", async (c) => {
    return run(c, async () => {
      const activityId = c.req.param("id");
      const body = await readJson(c.req.raw);
      const adminPassword =
        body.adminPassword === undefined ? undefined : String(body.adminPassword);

      if (adminPassword !== undefined) {
        assertPasswordAttemptAllowed(c, activityId);
      }

      let view;
      try {
        view = applyCommand(
          store,
          activityId,
          {
            identityId: String(body.actorIdentityId ?? ""),
            adminPassword,
          },
          body.command,
        );
      } catch (error) {
        if (adminPassword !== undefined) recordPasswordAttempt(c, activityId, error);
        throw error;
      }

      if (adminPassword !== undefined) clearPasswordAttempts(c, activityId);
      return c.json(view);
    });
  });

  return app;
}

function clientKey(c: Context, activityId: string): { ip: string; activity: string } {
  let address = "unknown";
  try {
    address = getConnInfo(c).remote?.address ?? "unknown";
  } catch {
    // Running without the Node adapter (e.g. tests): fall back to a shared key.
  }
  return { ip: `ip:${activityId}:${address}`, activity: `activity:${activityId}` };
}

function assertPasswordAttemptAllowed(c: Context, activityId: string): void {
  const { ip, activity } = clientKey(c, activityId);
  if (isRateLimited(ip) || isRateLimited(activity)) {
    throw new AppError(429, "too_many_attempts", "密码尝试次数过多，请稍后再试");
  }
}

function recordPasswordAttempt(c: Context, activityId: string, error: unknown): void {
  if (!(error instanceof AppError) || error.code !== "wrong_password") return;
  const { ip, activity } = clientKey(c, activityId);
  recordFailure(ip);
  recordFailure(activity);
}

function clearPasswordAttempts(c: Context, activityId: string): void {
  const { ip, activity } = clientKey(c, activityId);
  clearFailures(ip);
  clearFailures(activity);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new AppError(400, "invalid_body", "请求格式不正确");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "invalid_body", "请求格式不正确");
  }
}

type Ctx = Context;

async function run(c: Ctx, handler: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AppError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
    }
    console.error(error);
    return c.json({ error: { code: "internal", message: "服务器出错了，请稍后再试" } }, 500);
  }
}
