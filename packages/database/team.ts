import { hashPassword, secret } from "../security/crypto";
export async function initializeTeam(db: any, workspace: string) {
  if (
    (
      await db.query(
        "SELECT initialized FROM team_state WHERE workspace_id=$1",
        [workspace],
      )
    ).rows[0]?.initialized
  )
    return;
  const rows = (
    await db.query("SELECT * FROM users ORDER BY created_at FOR UPDATE")
  ).rows;
  if (
    rows.some(
      (u) => u.username !== "superadmin" && !/^Bison0[1-7]$/.test(u.username),
    )
  )
    throw Error("存在非 Bison 团队账号，请先核对迁移映射，未修改原账号");
  let root = rows.find((u) => u.username === "Bison01"),
    bootstrap = rows.find((u) => u.username === "superadmin");
  if (root && bootstrap) {
    const owned = (
      await db.query(
        "SELECT EXISTS(SELECT 1 FROM accounts WHERE owner_id=$1) OR EXISTS(SELECT 1 FROM conversations WHERE assignee_id=$1) AS any",
        [bootstrap.id],
      )
    ).rows[0].any;
    if (owned) throw Error("旧 superadmin 有业务数据，请先分配到 Bison01");
    await db.query("DELETE FROM users WHERE id=$1", [bootstrap.id]);
  } else if (!root && bootstrap) {
    await db.query("UPDATE users SET username='Bison01' WHERE id=$1", [
      bootstrap.id,
    ]);
    root = bootstrap;
  }
  if (!root)
    await db.query(
      "INSERT INTO users(workspace_id,username,name,role,password_hash) VALUES($1,'Bison01','Bison01','superadmin',$2)",
      [workspace, await hashPassword(secret("bootstrap_password"))],
    );
  await db.query(
    "UPDATE users SET role=CASE WHEN username='Bison01' THEN 'superadmin' ELSE 'member' END,active=CASE WHEN username='Bison01' THEN true ELSE active END",
  );
  for (let n = 2; n <= 7; n++) {
    const username = `Bison0${n}`;
    if (
      !(await db.query("SELECT 1 FROM users WHERE username=$1", [username]))
        .rowCount
    )
      await db.query(
        "INSERT INTO users(workspace_id,username,name,role,password_hash) VALUES($1,$2,$2,'member',$3)",
        [workspace, username, await hashPassword(secret(`team_${username}`))],
      );
  }
  await db.query(
    "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check",
  );
  await db.query(
    "ALTER TABLE users ADD CONSTRAINT users_team_check CHECK((username='Bison01' AND role='superadmin' AND active) OR (username ~ '^Bison0[2-7]$' AND role='member'))",
  );
  // One owner per platform account; reassign all existing conversations consistently.
  await db.query(
    "UPDATE conversations c SET assignee_id=a.owner_id,revision=revision+1 FROM accounts a WHERE c.account_id=a.id AND c.assignee_id IS DISTINCT FROM a.owner_id",
  );
  await db.query("DELETE FROM account_grants");
  await db.query(
    "INSERT INTO account_grants SELECT id,owner_id FROM accounts WHERE owner_id IS NOT NULL",
  );
  await db.query(
    "UPDATE accounts SET enabled=false,auto_reply=false,qr=NULL,generation=generation+1,lease_until=NULL,lease_owner=NULL",
  );
  await db.query(
    "UPDATE jobs SET status='cancelled' WHERE status IN('queued','running')",
  );
  await db.query("UPDATE outbox SET status='cancelled' WHERE status='queued'");
  await db.query("DELETE FROM sessions");
  await db.query(
    "INSERT INTO team_state VALUES($1,true) ON CONFLICT(workspace_id) DO UPDATE SET initialized=true",
    [workspace],
  );
}
