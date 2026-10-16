import { handle } from "@hono/vercel";
import { api } from "@/server/app";

export const GET = handle(api);
export const POST = handle(api);