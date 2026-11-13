import { writeFile } from "node:fs/promises";
import { makePool, pool, workspace } from "../packages/database/db";
import { token, digest } from "../packages/security/crypto";
const username = process.argv[2];
if (!username) throw Error("Usage: recover-admin.ts USERNAME");
const owner = makePool("postgres"),
  db = await owner.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(7811493)");
  const user = (
    await db.query(
      "SELECT * FROM users WHERE username=$1 AND role='superadmin' FOR UPDATE",
      [username],
    )
  ).rows[0];
  if (!user) throw Error("指定超级管理员不存在");
  const raw = token();
  await db.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
  await db.query("DELETE FROM reset_tokens WHERE user_id=$1", [user.id]);
  await db.query(
    "INSERT INTO reset_tokens VALUES($1,$2,now()+interval '30 minutes')",
    [digest(raw), user.id],
  );
  await db.query("UPDATE users SET active=true WHERE id=$1", [user.id]);
  await db.query(
    "INSERT INTO audit_events(workspace_id,user_id,action) VALUES($1,$2,'admin.host_recovery')",
    [workspace, user.id],
  );
  await db.query("COMMIT");
  await writeFile("/ops/admin-recovery.txt", raw + "\n", { mode: 0o600 });
  console.log(
    "Recovery token written to /ops/admin-recovery.txt; expires in 30 minutes. No password changed yet.",
  );
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  db.release();
  await owner.end();
  await pool.end();
}
