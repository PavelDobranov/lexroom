import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const DEFAULT_DATABASE_PATH = "data/lexroom.db";

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
  return sqlite;
}
