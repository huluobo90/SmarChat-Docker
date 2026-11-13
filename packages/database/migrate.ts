import { readFile } from "node:fs/promises";
import { makePool, workspace, pool } from "./db";
import { secret, hashPassword } from "../security/crypto";
import { initializeTeam } from "./team";
import { incrementalMigrations } from "./migrations";
const owner = makePool("postgres"),
  db = await owner.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(7811492)");
  for (const [role, key] of [
    ["smarchat_api", "api_password"],
    ["smarchat_worker", "worker_password"],
  ]) {
    if (
      !(await db.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]))
        .rowCount
    ) {
      const password = secret(key);
      if (!/^[a-f0-9]{64}$/.test(password))
        throw Error("Invalid generated database secret");
      await db.query(
        `CREATE ROLE ${role} LOGIN ${role === "smarchat_worker" ? "BYPASSRLS" : "NOBYPASSRLS"} PASSWORD '${password}'`,
      );
    }
  }
  const existing = await db.query(
    "SELECT to_regclass('public.schema_versions') AS table",
  );
  if (!existing.rows[0].table)
    await db.query(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
  await incrementalMigrations(db);
  await db.query(
    "INSERT INTO workspaces VALUES($1,$2) ON CONFLICT DO NOTHING",
    [workspace, "SmarChat"],
  );
  await db.query(
    "INSERT INTO settings(workspace_id) VALUES($1) ON CONFLICT DO NOTHING",
    [workspace],
  );
  await initializeTeam(db, workspace);
  await db.query("COMMIT");
  console.log("Database migrations and bootstrap complete");
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  db.release();
  await owner.end();
  await pool.end();
}
