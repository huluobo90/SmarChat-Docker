import { z } from "zod";
import {
  pool,
  tx,
  admin,
  superadmin,
  audit,
  fail,
  workspace,
} from "../../packages/database/db";
import {
  token,
  digest,
  hashPassword,
  verifyPassword,
} from "../../packages/security/crypto";
import { cleanupDeletedBlobs } from "../../packages/domain/cleanup";
export const userView = (u: any) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  email: u.email,
  role: u.role,
  active: u.active,
  mustChange: u.must_change,
});
export const cookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.COOKIE_SECURE === "true",
  maxAge: 43200,
};
export async function identify(req: any) {
  const raw = req.cookies.smarchat;
  if (!raw) return null;
  const r = await pool.query(
    "SELECT u.*,s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>now() AND u.active",
    [digest(raw)],
  );
  return r.rows[0] || null;
}
export async function authRoutes(app: any) {
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req: any, reply: any) => {
      const b = z
        .object({
          username: z.string().min(1).max(80),
          password: z.string().min(1).max(256),
        })
        .parse(req.body);
      return tx(
        {
          id: "00000000-0000-4000-8000-000000000000",
          role: "service",
          workspace_id: workspace,
        },
        async (db) => {
          const u = (
            await db.query("SELECT * FROM users WHERE username=$1 FOR UPDATE", [
              b.username,
            ])
          ).rows[0];
          if (
            !u ||
            !u.active ||
            !(await verifyPassword(b.password, u.password_hash))
          )
            fail(401, "账号或密码不正确");
          const raw = token();
          await db.query(
            "INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
            [digest(raw), u.id],
          );
          // Use authenticated actor context for append-only audit RLS.
          await db.query(
            "SELECT set_config('app.user_id',$1,true),set_config('app.role',$2,true)",
            [u.id, u.role],
          );
          await audit(db, u, "login");
          reply.setCookie("smarchat", raw, cookieOptions);
          return userView(u);
        },
      );
    },
  );
  app.get("/api/auth/me", async (req: any) => userView(req.actor));
  app.post("/api/auth/logout", async (req: any, reply: any) => {
    await pool.query("DELETE FROM sessions WHERE id=$1", [
      req.actor.session_id,
    ]);
    reply.clearCookie("smarchat", { path: "/" });
    return { ok: true };
  });
  app.post("/api/auth/password", async (req: any) => {
    const b = z
      .object({
        current: z.string().max(256),
        password: z.string().min(6, "密码至少 6 个字符").max(256),
      })
      .parse(req.body);
    return tx(req.actor, async (db) => {
      const u = (
        await db.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
          req.actor.id,
        ])
      ).rows[0];
      if (!(await verifyPassword(b.current, u.password_hash)))
        fail(401, "当前密码不正确");
      if (b.current === b.password) fail(400, "请使用不同的新密码");
      await db.query(
        "UPDATE users SET password_hash=$2,must_change=false WHERE id=$1",
        [u.id, await hashPassword(b.password)],
      );
      await db.query("DELETE FROM sessions WHERE user_id=$1 AND id<>$2", [
        u.id,
        req.actor.session_id,
      ]);
      await audit(db, u, "password.change");
      return { ok: true };
    });
  });
  app.get("/api/auth/sessions", async (req: any) =>
    (
      await pool.query(
        "SELECT id,created_at,expires_at FROM sessions WHERE user_id=$1 ORDER BY created_at DESC",
        [req.actor.id],
      )
    ).rows.map((s) => ({ ...s, current: s.id === req.actor.session_id })),
  );
  app.delete("/api/auth/sessions/:id", async (req: any) => {
    await pool.query("DELETE FROM sessions WHERE id=$1 AND user_id=$2", [
      req.params.id,
      req.actor.id,
    ]);
    return { ok: true };
  });
  app.get("/api/users", async (req: any) => {
    admin(req.actor);
    return (
      await pool.query(
        "SELECT * FROM users WHERE workspace_id=$1 ORDER BY username",
        [req.actor.workspace_id],
      )
    ).rows.map(userView);
  });
  app.post("/api/users", async (req: any) => {
    admin(req.actor);
    const b = z
      .object({
        username: z.string().regex(/^Bison0[2-7]$/),
        name: z.string().min(1).max(100),
        email: z.union([z.email(), z.literal("")]).default(""),
        role: z.literal("member").default("member"),
      })
      .parse(req.body);
    if (b.role !== "member") superadmin(req.actor);
    const password = "bison666";
    return tx(req.actor, async (db) => {
      const u = (
        await db.query(
          "INSERT INTO users(workspace_id,username,name,email,role,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            req.actor.workspace_id,
            b.username,
            b.name,
            b.email,
            b.role,
            await hashPassword(password),
          ],
        )
      ).rows[0];
      await audit(db, req.actor, "user.create", u.id, { role: b.role });
      return { user: userView(u), temporaryPassword: password };
    });
  });
  app.patch("/api/users/:id", async (req: any) => {
    admin(req.actor);
    const id = z.uuid().parse(req.params.id),
      b = z
        .object({
          active: z.boolean().optional(),
          role: z.enum(["member", "superadmin"]).optional(),
          name: z.string().min(1).max(100).optional(),
        })
        .parse(req.body);
    return tx(
      req.actor,
      async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(7811493)");
        const u = (
          await db.query(
            "SELECT * FROM users WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
            [id, req.actor.workspace_id],
          )
        ).rows[0];
        if (!u) fail(404, "用户不存在");
        if (b.role && b.role !== u.role)
          fail(400, "Bison01 固定为超管，Bison02–Bison07 固定为成员");
        if (u.role === "superadmin" && b.active === false)
          fail(409, "不能停用 Bison01");
        await db.query(
          "UPDATE users SET active=COALESCE($2,active),role=COALESCE($3,role),name=COALESCE($4,name) WHERE id=$1",
          [id, b.active, b.role, b.name],
        );
        await db.query("DELETE FROM sessions WHERE user_id=$1", [id]);
        await db.query(
          "UPDATE jobs SET status='cancelled' WHERE user_id=$1 AND status IN('queued','running')",
          [id],
        );
        await db.query(
          "UPDATE outbox SET status='cancelled' WHERE user_id=$1 AND status='queued'",
          [id],
        );
        if (b.active === false) {
          await db.query("SELECT cancel_team_work($1,false)", [id]);
          await db.query(
            "UPDATE accounts SET enabled=false,auto_reply=false,status='disabled',qr=NULL,generation=generation+1,lease_until=NULL,lease_owner=NULL WHERE owner_id=$1",
            [id],
          );
          await db.query(
            "UPDATE conversations SET mode='PAUSED',revision=revision+1 WHERE assignee_id=$1 OR account_id IN(SELECT id FROM accounts WHERE owner_id=$1)",
            [id],
          );
          await db.query(
            "UPDATE jobs SET status='cancelled',updated_at=now() WHERE status IN('queued','running') AND (user_id=$1 OR conversation_id IN(SELECT id FROM conversations WHERE assignee_id=$1))",
            [id],
          );
          await db.query(
            "UPDATE outbox SET status='cancelled' WHERE status='queued' AND (user_id=$1 OR account_id IN(SELECT id FROM accounts WHERE owner_id=$1))",
            [id],
          );
          await db.query("DELETE FROM reset_tokens WHERE user_id=$1", [id]);
        }
        await audit(db, req.actor, "user.update", id, b);
        return { ok: true };
      },
      true,
    );
  });
  app.get("/api/users/:id/deletion-preview", async (req: any) => {
    superadmin(req.actor);
    return tx(req.actor, async (db) => {
      const u = (
        await db.query(
          "SELECT id,username,role FROM users WHERE id=$1 AND workspace_id=$2",
          [z.uuid().parse(req.params.id), req.actor.workspace_id],
        )
      ).rows[0];
      if (!u) fail(404, "成员不存在");
      if (u.role !== "member") fail(403, "不能删除超级管理员");
      const counts = (
        await db.query(
          "SELECT (SELECT count(*) FROM accounts WHERE owner_id=$1)::int AS accounts,(SELECT count(*) FROM conversations WHERE assignee_id=$1 OR account_id IN(SELECT id FROM accounts WHERE owner_id=$1))::int AS customers,(SELECT count(*) FROM messages WHERE conversation_id IN(SELECT id FROM conversations WHERE assignee_id=$1 OR account_id IN(SELECT id FROM accounts WHERE owner_id=$1)))::int AS messages,(SELECT count(*) FROM assets WHERE conversation_id IN(SELECT id FROM conversations WHERE assignee_id=$1 OR account_id IN(SELECT id FROM accounts WHERE owner_id=$1)))::int AS files",
          [u.id],
        )
      ).rows[0];
      return { ...u, ...counts };
    });
  });
  app.delete("/api/users/:id", async (req: any) => {
    superadmin(req.actor);
    const b = z
      .object({
        confirmation: z.string(),
        currentPassword: z.string().min(1).max(256),
      })
      .parse(req.body);
    const result = await tx(
      req.actor,
      async (db) => {
        const actor = (
          await db.query("SELECT password_hash FROM users WHERE id=$1", [
            req.actor.id,
          ])
        ).rows[0];
        if (!(await verifyPassword(b.currentPassword, actor.password_hash)))
          fail(401, "当前密码不正确");
        return (
          await db.query("SELECT purge_member($1,$2) AS result", [
            z.uuid().parse(req.params.id),
            b.confirmation,
          ])
        ).rows[0].result;
      },
      true,
    );
    let pendingFiles: number | null = null;
    try {
      pendingFiles = await cleanupDeletedBlobs(req.actor);
    } catch {}
    return { ...result, pendingFiles };
  });
  app.post("/api/users/:id/reset", async (req: any) => {
    admin(req.actor);
    return tx(req.actor, async (db) => {
      const u = (
        await db.query("SELECT * FROM users WHERE id=$1 AND workspace_id=$2", [
          z.uuid().parse(req.params.id),
          req.actor.workspace_id,
        ])
      ).rows[0];
      if (!u) fail(404, "用户不存在");
      if (u.role !== "member") superadmin(req.actor);
      const raw = token();
      await db.query("DELETE FROM reset_tokens WHERE user_id=$1", [u.id]);
      await db.query(
        "INSERT INTO reset_tokens VALUES($1,$2,now()+interval '30 minutes')",
        [digest(raw), u.id],
      );
      await db.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
      await audit(db, req.actor, "user.reset", u.id);
      return { resetToken: raw };
    });
  });
  app.post("/api/auth/reset", async (req: any) => {
    const b = z
      .object({
        token: z.string().min(20).max(100),
        password: z.string().min(6, "密码至少 6 个字符").max(256),
      })
      .parse(req.body);
    return tx(
      {
        id: "00000000-0000-4000-8000-000000000000",
        role: "service",
        workspace_id: workspace,
      },
      async (db) => {
        const t = (
          await db.query(
            "SELECT * FROM reset_tokens WHERE id=$1 AND expires_at>now() FOR UPDATE",
            [digest(b.token)],
          )
        ).rows[0];
        if (!t) fail(400, "重置令牌无效或已过期");
        const u = (
          await db.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
            t.user_id,
          ])
        ).rows[0];
        await db.query(
          "UPDATE users SET password_hash=$2,must_change=false WHERE id=$1",
          [u.id, await hashPassword(b.password)],
        );
        await db.query("DELETE FROM reset_tokens WHERE user_id=$1", [u.id]);
        await db.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
        return { ok: true };
      },
    );
  });
}
