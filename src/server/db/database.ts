import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const DEFAULT_DATABASE_PATH = "data/lexroom.db";
export const BUSY_TIMEOUT_MS = 5_000;

export function resolveDatabasePath(databaseUrl = process.env.DATABASE_URL): string {
  return path.resolve(databaseUrl || DEFAULT_DATABASE_PATH);
}

export function openDatabase(
  databasePath: string,
  options: { create?: boolean } = {},
): Database.Database {
  const resolvedPath = path.resolve(databasePath);
  if (options.create) {
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const sqlite = new Database(resolvedPath, {
    fileMustExist: !options.create,
  });
  sqlite.pragma("foreign_keys = ON");
  // A finite busy timeout lets ordinary competing writers serialize instead of
  // failing immediately with SQLITE_BUSY (M2-REQ-4).
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return sqlite;
}
