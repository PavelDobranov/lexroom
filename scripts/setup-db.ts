import { resolveDatabasePath } from "../src/server/db/database";
import { setupDatabase } from "../src/server/db/setup";

const databasePath = resolveDatabasePath();

try {
  setupDatabase(databasePath);
  console.log(`Database is ready at ${databasePath}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Database setup failed: ${message}`);
  process.exitCode = 1;
}
