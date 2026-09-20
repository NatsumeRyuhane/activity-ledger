import { Hono } from "hono";
import type { Context } from "hono";
import { toAvatarDataUrl } from "./avatar";
import {
  AppError,
  applyCommand,
  createActivity,
  createIdentity,
  getActivityView,
  verifyAdminPassword,
} from "./service";
import type { EventStore } from "./store";

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
      const body = await readJson(c.req.raw);
      verifyAdminPassword(store, c.req.param("id"), String(body.password ?? ""));
      return c.json({ ok: true });
    });
  });

  app.post("/api/avatars", async (c) => {
    return run(c, async () => {
      const contentType = c.req.header("content-type") ?? "";
      if (!contentType.startsWith("image/")) {
        throw new AppError(400, "invalid_image", "请上传图片文件");
      }
      const buffer = Buffer.from(await c.req.arrayBuffer());
      if (buffer.length === 0) {
        throw new AppError(400, "invalid_image", "图片内容为空");
      }
      if (buffer.length > 10 * 1024 * 1024) {
        throw new AppError(400, "image_too_large", "图片不能超过 10MB");
      }
      return c.json({ avatar: await toAvatarDataUrl(buffer) });
    });
  });

  app.get("/api/activities/:id", (c) => {
    return run(c, () => c.json(getActivityView(store, c.req.param("id"))));
  });

  app.post("/api/activities/:id/commands", async (c) => {
    return run(c, async () => {
      const body = await readJson(c.req.raw);
      const view = applyCommand(store, c.req.param("id"), {
        identityId: String(body.actorIdentityId ?? ""),
        adminPassword: body.adminPassword === undefined ? undefined : String(body.adminPassword),
      }, body.command);
      return c.json(view);
    });
  });

  return app;
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
