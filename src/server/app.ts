import { Hono } from "hono";

export const api = new Hono().basePath("/api");

api.get("/health", (c) => {
  return c.json({ status: "ok" });
});