import type Database from "better-sqlite3";
import { Hono } from "hono";

import type { ApiError } from "../shared/api";
import { openDatabase, resolveDatabasePath } from "./db/database";
import { readWorkspaceSnapshot } from "./workspace/read-workspace";

type ApiDependencies = {
  openWorkspaceDatabase: () => Database.Database;
  now: () => Date;
  logger: Pick<Console, "error">;
};

const defaultDependencies: ApiDependencies = {
  openWorkspaceDatabase: () => openDatabase(resolveDatabasePath()),
  now: () => new Date(),
  logger: console,
};

export function createApi(
  dependencies: ApiDependencies = defaultDependencies,
): Hono {
  const app = new Hono().basePath("/api");

  app.get("/health", (c) => {
    return c.json({ status: "ok" });
  });

  app.get("/workspace", (c) => {
    c.header("Cache-Control", "no-store");

    let sqlite: Database.Database | undefined;
    try {
      sqlite = dependencies.openWorkspaceDatabase();
      return c.json(readWorkspaceSnapshot(sqlite, dependencies.now()));
    } catch (error) {
      dependencies.logger.error("Failed to read the workspace snapshot", error);
      const body: ApiError = {
        error: {
          code: "WORKSPACE_UNAVAILABLE",
          message: "Workspace data is unavailable.",
        },
      };
      return c.json(body, 500);
    } finally {
      sqlite?.close();
    }
  });

  return app;
}

export const api = createApi();
