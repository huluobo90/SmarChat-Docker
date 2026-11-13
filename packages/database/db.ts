import pg from "pg";
import { secret } from "../security/crypto";
export type Actor = {
  id: string;
  role: string;
  workspace_id: string;
  session_id?: string;
};
export const workspace = "00000000-0000-4000-8000-000000000001";
export const service: Actor = {
  id: "00000000-0000-4000-8000-000000000000",
  role: "service",
  workspace_id: workspace,
};
export function makePool(role = process.env.DB_ROLE || "smarchat_api") {
  return new pg.Pool({
    host: process.env.PGHOST || "db",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "smarchat",
    user: role,
    password: secret(
      role === "postgres"
        ? "db_password"
        : role === "smarchat_worker"
          ? "worker_password"
          : "api_password",
    ),
    max: 12,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}
export const pool = makePool();
export async function tx<T>(
  actor: Actor,
  fn: (db: pg.PoolClient) => Promise<T>,
  exclusive = false,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      exclusive
        ? "SELECT pg_advisory_xact_lock(7811494)"
        : "SELECT pg_advisory_xact_lock_shared(7811494)",
    );
    if (actor.session_id) {
      const current = (
        await c.query(
          "SELECT u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=$1 AND u.active AND u.workspace_id=$2 AND s.id=$3 AND s.expires_at>now()",
          [actor.id, actor.workspace_id, actor.session_id],
        )
      ).rows[0];
      if (!current || current.role !== actor.role)
        fail(401, "登录或权限已变更，请重新登录");
      if (
        (await c.query("SELECT active FROM maintenance WHERE id=1")).rows[0]
          ?.active
      )
        fail(503, "系统正在备份或恢复");
    }
    await c.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.role',$2,true),set_config('app.workspace',$3,true)",
      [actor.id, actor.role, actor.workspace_id],
    );
    const v = await fn(c);
    await c.query("COMMIT");
    return v;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function audit(
  db: pg.PoolClient,
  actor: Actor,
  action: string,
  resource?: string,
  details: unknown = {},
) {
  await db.query(
    "INSERT INTO audit_events(workspace_id,user_id,action,resource,details) VALUES($1,$2,$3,$4,$5)",
    [
      actor.workspace_id,
      actor.role === "service" ? null : actor.id,
      action,
      resource || null,
      JSON.stringify(details),
    ],
  );
}
export function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
export function admin(actor: Actor) {
  if (actor.role !== "superadmin") fail(403, "需要管理员权限");
}
export function superadmin(actor: Actor) {
  if (actor.role !== "superadmin") fail(403, "需要超级管理员权限");
}
export async function conversation(
  db: pg.PoolClient,
  id: string,
  lock = false,
) {
  const r = await db.query(
    `SELECT * FROM conversations WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
    [id],
  );
  if (!r.rowCount) fail(404, "客户不存在或无访问权限");
  return r.rows[0];
}
