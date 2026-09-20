import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { createApp } from "./app";
import { openDatabase } from "./db";
import { EventStore } from "./store";

const db = openDatabase();
const store = new EventStore(db);
const app = createApp(store);

const clientDir = "dist/client";
if (existsSync(clientDir)) {
  app.use("/*", serveStatic({ root: `./${clientDir}` }));
  app.get("*", serveStatic({ path: `./${clientDir}/index.html` }));
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Ledger server listening on http://localhost:${info.port}`);
});
