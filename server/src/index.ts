import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { rest } from "./routes/rest.js";
import { ask } from "./routes/ask.js";

const app = new Hono();
app.use("*", cors());
app.get("/health", (c) => c.json({ ok: true }));
app.route("/", rest);
app.route("/", ask);

const port = Number(process.env.PORT ?? 4111);
serve({ fetch: app.fetch, port });
console.log(`server on http://localhost:${port}`);
