import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
