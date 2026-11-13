import { phoneCountries } from "../../packages/domain/phone-country";
import { accountRules } from "../../packages/domain/rules";
import { z } from "zod";
import {
  tx,
  admin,
  superadmin,
  audit,
  fail,
  conversation,
} from "../../packages/database/db";
import { digest, encryptText } from "../../packages/security/crypto";
import { putAsset, loadBlob, mimeFor } from "../../packages/domain/assets";
import { reportPeriod } from "../../packages/domain/period";
import { privateConversation } from "../../packages/domain/insights";
const uuid = z.uuid(),
  id = (r: any) => uuid.parse(r.params.id),
  page = (r: any) => Math.min(100, Math.max(1, Number(r.query.limit) || 50));
const settingsSchema = z.object({
  transcriptionProviderId: z.union([uuid, z.literal("")]).default(""),
  transcriptionModel: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._:/-]+$/)
    .default("whisper-1"),
  globalAuto: z.boolean(),
  cloudConsent: z.boolean(),
  riskConsent: z.boolean(),
  providerId: z.union([uuid, z.literal("")]),
  tone: z.string().max(1000),
  language: z.string().max(100),
  companyInfo: z.string().max(12000),
  boundaries: z.string().max(4000),
  maxRepliesPerHour: z.number().int().min(1).max(60),
});
export async function businessRoutes(app: any) {
  app.post("/api/conversations/:id/view", async (r: any) =>
    tx(r.actor, async (db) => {
      const c = await conversation(db, id(r));
      await db.query(
        "INSERT INTO conversation_views(conversation_id,user_id) VALUES($1,$2) ON CONFLICT(conversation_id,user_id) DO UPDATE SET seen_at=now()",
        [c.id, r.actor.id],
      );
      return (
        await db.query(
          "SELECT u.name FROM conversation_views v JOIN users u ON u.id=v.user_id WHERE v.conversation_id=$1 AND v.user_id<>$2 AND v.seen_at>now()-interval '12 seconds' AND u.active AND (u.role<>'member' OR (u.id=$3 AND EXISTS(SELECT 1 FROM account_grants g WHERE g.account_id=$4 AND g.user_id=u.id)))",
          [c.id, r.actor.id, c.assignee_id, c.account_id],
        )
      ).rows.filter(() => r.actor.role === "superadmin");
    }),
  );
  app.get("/api/accounts", async (r: any) =>
    tx(
      r.actor,
      async (db) =>
        (
          await db.query(
            `SELECT id,name,owner_id,enabled,auto_reply,status,phone,settings,created_at ${r.actor.role === "member" ? "" : ",qr"} FROM accounts WHERE workspace_id=$1 AND ($2 OR owner_id=$3) ORDER BY created_at`,
            [r.actor.workspace_id, r.actor.role !== "member", r.actor.id],
          )
        ).rows,
    ),
  );
  app.post("/api/accounts", async (r: any) => {
    admin(r.actor);
    const b = z.object({ name: z.string().min(1).max(100) }).parse(r.body);
    return tx(r.actor, async (db) => {
      const a = (
        await db.query(
          "INSERT INTO accounts(workspace_id,name) VALUES($1,$2) RETURNING id",
          [r.actor.workspace_id, b.name],
        )
      ).rows[0];
      await audit(db, r.actor, "account.create", a.id);
      return a;
    });
  });
  app.get("/api/accounts/:id/grants", async (r: any) => {
    admin(r.actor);
    return tx(r.actor, async (db) =>
      (
        await db.query(
          "SELECT user_id FROM account_grants WHERE account_id=$1",
          [id(r)],
        )
      ).rows.map((x) => x.user_id),
    );
  });
  app.patch("/api/accounts/:id", async (r: any) => {
    admin(r.actor);
    const b = z
      .object({
        name: z.string().min(1).max(100).optional(),
        ownerId: uuid.nullable().optional(),
        enabled: z.boolean().optional(),
        autoReply: z.boolean().optional(),
        grants: z.array(uuid).max(100).optional(),
        settings: z
          .object({
            providerId: z.union([uuid, z.literal("")]).optional(),
            tone: z.string().max(1000).optional(),
            language: z.string().max(100).optional(),
            boundaries: z.string().max(4000).optional(),
          })
          .optional(),
      })
      .parse(r.body);
    return tx(
      r.actor,
      async (db) => {
        const a = (
          await db.query(
            "SELECT * FROM accounts WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
            [id(r), r.actor.workspace_id],
          )
        ).rows[0];
        if (!a) fail(404, "账号不存在");
        const owner = b.ownerId === undefined ? a.owner_id : b.ownerId;
        const grants = owner ? [owner] : [];
        if (b.grants?.some((u: string) => u !== owner))
          fail(400, "每个 WhatsApp 接入只能分配给一位负责人");
        if (
          owner &&
          !(
            await db.query(
              "SELECT 1 FROM users WHERE id=$1 AND workspace_id=$2 AND active",
              [owner, r.actor.workspace_id],
            )
          ).rowCount
        )
          fail(400, "负责人必须是启用的团队账号");
        if ((b.enabled === true || b.autoReply === true) && !owner)
          fail(400, "请先分配负责人");
        if (owner !== a.owner_id) {
          await db.query("SELECT cancel_team_work($1,true)", [a.id]);
          if (
            (
              await db.query(
                "SELECT 1 FROM outbox WHERE account_id=$1 AND status='sending'",
                [a.id],
              )
            ).rowCount
          )
            fail(409, "存在正在发送的消息，请稍后再转交");
          await db.query(
            "UPDATE accounts SET enabled=false,auto_reply=false,status='disconnected',qr=NULL,lease_until=NULL,lease_owner=NULL,generation=generation+1 WHERE id=$1",
            [a.id],
          );
          await db.query(
            "UPDATE conversations SET assignee_id=$2,mode='PAUSED',revision=revision+1 WHERE account_id=$1",
            [a.id, owner],
          );
          await db.query(
            "UPDATE jobs SET status='cancelled',updated_at=now() WHERE conversation_id IN(SELECT id FROM conversations WHERE account_id=$1) AND status IN('queued','running')",
            [a.id],
          );
          if (b.enabled === true || b.autoReply === true)
            fail(400, "转交后请单独重新启用接入");
        }
        await db.query("DELETE FROM account_grants WHERE account_id=$1", [
          a.id,
        ]);
        for (const user of new Set(grants))
          await db.query("INSERT INTO account_grants VALUES($1,$2)", [
            a.id,
            user,
          ]);
        if (b.autoReply === true) {
          const s = (
            await db.query(
              "SELECT value FROM personal_rules WHERE user_id=$1",
              [owner],
            )
          ).rows[0]?.value;
          if (!s) fail(400, "请先分配负责人");
          if (!s.cloudConsent || !s.riskConsent)
            fail(400, "请先在 AI 与规则中确认数据处理和自动接待授权");
        }
        await db.query(
          "UPDATE accounts SET name=COALESCE($2,name),owner_id=$3,enabled=COALESCE($4,enabled),auto_reply=COALESCE($5,auto_reply),settings=COALESCE($6,settings) WHERE id=$1",
          [
            a.id,
            b.name,
            owner,
            b.enabled,
            b.autoReply,
            b.settings ? JSON.stringify(b.settings) : null,
          ],
        );
        await db.query(
          "UPDATE conversations SET revision=revision+1 WHERE account_id=$1",
          [a.id],
        );
        await db.query(
          "UPDATE outbox SET status='cancelled' WHERE account_id=$1 AND status='queued'",
          [a.id],
        );
        await audit(db, r.actor, "account.update", a.id, {
          owner,
          grants,
          enabled: b.enabled,
          autoReply: b.autoReply,
        });
        return { ok: true };
      },
      true,
    );
  });
  app.get("/api/conversations", async (r: any) =>
    tx(r.actor, async (db) => {
      const archived = r.query.trash === "true";
      const rows = (
        await db.query(
          `SELECT c.*,NULL::jsonb AS analysis,NULL::jsonb AS summary,a.name AS account_name,u.name AS assignee_name FROM conversations c JOIN accounts a ON a.id=c.account_id LEFT JOIN users u ON u.id=c.assignee_id WHERE c.merged_into IS NULL AND c.deleted_at IS ${archived ? "NOT " : ""}NULL AND ($1='' OR c.name ILIKE '%'||$1||'%' OR c.jid ILIKE '%'||$1||'%') AND ($2::uuid IS NULL OR c.account_id=$2) AND ($3::timestamptz IS NULL OR (c.updated_at,c.id)<($3::timestamptz,$4::uuid)) ORDER BY c.updated_at DESC,c.id DESC LIMIT $5`,
          [
            String(r.query.q || "").slice(0, 100),
            r.query.account ? uuid.parse(r.query.account) : null,
            r.query.before || null,
            r.query.cursor ? uuid.parse(r.query.cursor) : null,
            page(r),
          ],
        )
      ).rows;
      return phoneCountries(db, rows);
    }),
  );
  app.get("/api/conversations/:id", async (r: any) =>
    tx(r.actor, async (db) =>
      privateConversation(db, r.actor, await conversation(db, id(r))),
    ),
  );
  app.patch("/api/conversations/:id", async (r: any) => {
    const b = z
      .object({
        revision: z.number().int(),
        mode: z.enum(["AUTO", "HUMAN", "PAUSED"]).optional(),
        name: z.string().min(1).max(120).optional(),
        country: z.never().optional(),
        notes: z.never().optional(),
        tags: z.array(z.string().max(40)).max(20).optional(),
        assigneeId: uuid.nullable().optional(),
        deleted: z.boolean().optional(),
      })
      .parse(r.body);
    return tx(r.actor, async (db) => {
      const c = await conversation(db, id(r), true);
      if (c.revision !== b.revision) fail(409, "会话已更新，请刷新后重试");
      if (b.assigneeId !== undefined && b.assigneeId !== c.assignee_id)
        fail(400, "请在 WhatsApp 接入管理中统一转交负责人和全部客户");
      if (b.assigneeId !== undefined) {
        admin(r.actor);
        if (
          b.assigneeId &&
          !(
            await db.query(
              "SELECT 1 FROM account_grants g JOIN users u ON u.id=g.user_id WHERE g.account_id=$1 AND g.user_id=$2 AND u.active",
              [c.account_id, b.assigneeId],
            )
          ).rowCount
        )
          fail(400, "接收人需要该 WhatsApp 账号权限");
      }
      const assignee =
        b.assigneeId === undefined ? c.assignee_id : b.assigneeId;
      await db.query(
        "UPDATE conversations SET name=COALESCE($2,name),mode=COALESCE($3,mode),tags=COALESCE($4,tags),assignee_id=$5,deleted_at=$6,revision=revision+1 WHERE id=$1",
        [
          c.id,
          b.name,
          b.deleted === false ? "PAUSED" : b.mode,
          b.tags ? JSON.stringify(b.tags) : null,
          assignee,
          b.deleted === true
            ? new Date()
            : b.deleted === false
              ? null
              : c.deleted_at,
        ],
      );
      await db.query(
        "UPDATE jobs SET status='cancelled',updated_at=now() WHERE conversation_id=$1 AND status IN('queued','running')",
        [c.id],
      );
      await db.query(
        "UPDATE outbox SET status='cancelled' WHERE conversation_id=$1 AND status='queued'",
        [c.id],
      );
      await audit(db, r.actor, "conversation.update", c.id, {
        mode: b.mode,
        assignee,
        deleted: b.deleted,
      });
      return { ok: true };
    });
  });
  app.get("/api/conversations/:id/messages", async (r: any) =>
    tx(r.actor, async (db) => {
      await conversation(db, id(r));
      return (
        await db.query(
          "SELECT m.*,a.name AS asset_name,a.mime AS asset_mime,a.preview_id AS asset_preview_id FROM messages m LEFT JOIN assets a ON a.id=m.asset_id WHERE m.conversation_id=$1 AND ($2::timestamptz IS NULL OR (m.sent_at,m.id)<($2::timestamptz,$3::uuid)) ORDER BY m.sent_at DESC,m.id DESC LIMIT $4",
          [
            id(r),
            r.query.before || null,
            r.query.cursor ? uuid.parse(r.query.cursor) : null,
            page(r),
          ],
        )
      ).rows.reverse();
    }),
  );
  app.get("/api/conversations/:id/draft", async (r: any) =>
    tx(r.actor, async (db) => {
      await conversation(db, id(r));
      return (
        (
          await db.query(
            "SELECT text,revision FROM drafts WHERE conversation_id=$1 AND user_id=$2",
            [id(r), r.actor.id],
          )
        ).rows[0] || { text: "", revision: 0 }
      );
    }),
  );
  app.put("/api/conversations/:id/draft", async (r: any) =>
    tx(r.actor, async (db) => {
      const b = z
        .object({ text: z.string().max(12000), revision: z.number().int() })
        .parse(r.body);
      await conversation(db, id(r));
      await db.query(
        "INSERT INTO drafts(conversation_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id(r), r.actor.id],
      );
      const d = (
        await db.query(
          "UPDATE drafts SET text=$3,revision=revision+1 WHERE conversation_id=$1 AND user_id=$2 AND revision=$4 RETURNING *",
          [id(r), r.actor.id, b.text, b.revision],
        )
      ).rows[0];
      if (!d) fail(409, "草稿已在另一个窗口更新");
      return d;
    }),
  );
  app.post("/api/conversations/:id/send", async (r: any) =>
    tx(r.actor, async (db) => {
      const b = z
          .object({
            text: z.string().max(12000).default(""),
            assetId: uuid.optional(),
            revision: z.number().int(),
            idempotencyKey: z.string().min(16).max(100),
          })
          .parse(r.body),
        c = await conversation(db, id(r), true),
        hash = digest(
          JSON.stringify({ text: b.text, assetId: b.assetId || null }),
        );
      const old = (
        await db.query(
          "SELECT * FROM outbox WHERE conversation_id=$1 AND idempotency_key=$2",
          [c.id, b.idempotencyKey],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== hash) fail(409, "发送标识已用于其他内容");
        return old;
      }
      if (c.deleted_at) fail(409, "会话已在回收站");
      if (c.revision !== b.revision)
        fail(409, "会话已更新，请检查最新消息再发送");
      if (!b.text.trim() && !b.assetId) fail(400, "请输入消息或选择文件");
      const a = (
        await db.query("SELECT enabled,status FROM accounts WHERE id=$1", [
          c.account_id,
        ])
      ).rows[0];
      if (!a.enabled || a.status !== "connected")
        fail(409, "WhatsApp 账号未连接");
      if (b.assetId) {
        const asset = (
          await db.query("SELECT * FROM assets WHERE id=$1", [b.assetId])
        ).rows[0];
        if (
          !asset ||
          (asset.conversation_id && asset.conversation_id !== c.id) ||
          (!asset.conversation_id && !asset.external)
        )
          fail(403, "文件没有外发权限");
      }
      await db.query(
        "UPDATE conversations SET mode='HUMAN',revision=revision+1 WHERE id=$1",
        [c.id],
      );
      await db.query(
        "UPDATE outbox SET status='cancelled' WHERE conversation_id=$1 AND automatic AND status='queued'",
        [c.id],
      );
      await db.query(
        "UPDATE jobs SET status='cancelled' WHERE conversation_id=$1 AND kind='auto' AND status IN('queued','running')",
        [c.id],
      );
      const row = (
        await db.query(
          "INSERT INTO outbox(workspace_id,conversation_id,account_id,user_id,idempotency_key,request_hash,text,asset_id,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            c.workspace_id,
            c.id,
            c.account_id,
            r.actor.id,
            b.idempotencyKey,
            hash,
            b.text,
            b.assetId || null,
            c.revision + 1,
          ],
        )
      ).rows[0];
      await audit(db, r.actor, "message.enqueue", row.id, {
        conversation: c.id,
        asset: b.assetId,
      });
      return row;
    }),
  );
  app.get("/api/conversations/:id/outbox", async (r: any) =>
    tx(r.actor, async (db) => {
      await conversation(db, id(r));
      return (
        await db.query(
          "SELECT id,text,status,error,created_at FROM outbox WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 30",
          [id(r)],
        )
      ).rows;
    }),
  );
  app.post("/api/conversations/:id/jobs", async (r: any) =>
    tx(r.actor, async (db) => {
      const b = z
          .object({
            kind: z.enum([
              "reply",
              "analyze",
              "translate",
              "summary",
              "transcribe",
            ]),
            messageId: uuid.optional(),
          })
          .parse(r.body),
        c = await conversation(db, id(r));
      if (c.deleted_at) fail(409, "请先恢复会话");
      if (
        ["translate", "transcribe"].includes(b.kind) &&
        !(
          await db.query(
            "SELECT 1 FROM messages WHERE id=$1 AND conversation_id=$2",
            [b.messageId, c.id],
          )
        ).rowCount
      )
        fail(404, "消息不存在");
      if (b.kind === "transcribe") {
        const m = (
          await db.query(
            "SELECT * FROM messages WHERE id=$1 AND conversation_id=$2",
            [b.messageId, c.id],
          )
        ).rows[0];
        if (!m || m.kind !== "audio" || !m.asset_id)
          fail(400, "语音文件尚未下载或消息不是语音");
        if (m.text) fail(409, "该语音已有转写文字");
        const rules = await accountRules(db, c.account_id);
        if (!rules.value.cloudConsent)
          fail(400, "请先在对话规则中允许云端数据处理");
      }
      const old = (
        await db.query(
          "SELECT * FROM jobs WHERE conversation_id=$1 AND user_id=$2 AND kind=$3 AND status IN('queued','running') AND ($3 NOT IN ('translate','transcribe') OR payload->>'messageId'=$4)",
          [c.id, r.actor.id, b.kind, b.messageId || null],
        )
      ).rows[0];
      if (old) return old;
      const s = await accountRules(db, c.account_id);
      const job = (
        await db.query(
          "INSERT INTO jobs(workspace_id,conversation_id,user_id,kind,revision,settings_revision,payload) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            c.workspace_id,
            c.id,
            r.actor.id,
            b.kind,
            c.revision,
            s.revision,
            JSON.stringify({ messageId: b.messageId }),
          ],
        )
      ).rows[0];
      await audit(db, r.actor, `ai.${b.kind}`, job.id, { conversation: c.id });
      return job;
    }),
  );
  app.get("/api/jobs", async (r: any) =>
    tx(
      r.actor,
      async (db) =>
        (await db.query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 40"))
          .rows,
    ),
  );
  app.post("/api/jobs/:id/cancel", async (r: any) =>
    tx(r.actor, async (db) => {
      await db.query(
        "UPDATE jobs SET status='cancelled',updated_at=now() WHERE id=$1 AND status IN('queued','running')",
        [id(r)],
      );
      return { ok: true };
    }),
  );
  app.get("/api/settings", async (r: any) =>
    tx(
      r.actor,
      async (db) =>
        (
          await db.query("SELECT * FROM personal_rules WHERE user_id=$1", [
            r.actor.id,
          ])
        ).rows[0],
    ),
  );
  app.put("/api/settings", async (r: any) => {
    const b = z
      .object({ revision: z.number().int(), value: settingsSchema })
      .parse(r.body);
    return tx(
      r.actor,
      async (db) => {
        if (
          b.value.providerId &&
          !(
            await db.query(
              "SELECT id FROM providers WHERE id=$1 AND workspace_id=$2",
              [b.value.providerId, r.actor.workspace_id],
            )
          ).rowCount
        )
          fail(400, "AI 接口不存在");
        if (
          !(
            await db.query(
              "UPDATE personal_rules SET value=$2,revision=nextval('personal_rules_revision') WHERE user_id=$1 AND revision=$3",
              [r.actor.id, JSON.stringify(b.value), b.revision],
            )
          ).rowCount
        )
          fail(409, "配置已被更新，请刷新");
        await db.query(
          "UPDATE outbox SET status='cancelled' WHERE automatic AND status='queued' AND account_id IN(SELECT id FROM accounts WHERE owner_id=$1)",
          [r.actor.id],
        );
        await audit(db, r.actor, "personal_rules.update", r.actor.id);
        return { ok: true };
      },
      true,
    );
  });
  app.get("/api/providers", async (r: any) =>
    tx(
      r.actor,
      async (db) =>
        (
          await db.query(
            r.actor.role === "member"
              ? "SELECT id,name,tested FROM providers WHERE workspace_id=$1 ORDER BY name"
              : "SELECT id,name,base_url,model,tested,(key_cipher<>'') AS has_key FROM providers WHERE workspace_id=$1 ORDER BY name",
            [r.actor.workspace_id],
          )
        ).rows,
    ),
  );
  app.post("/api/providers", async (r: any) => {
    admin(r.actor);
    const b = z
      .object({
        id: uuid.optional(),
        name: z.string().min(1).max(80),
        baseUrl: z.url().max(500),
        model: z.string().min(1).max(100),
        apiKey: z.string().max(3000),
      })
      .parse(r.body);
    const url = new URL(b.baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      fail(400, "接口需要使用不含凭据和查询参数的 HTTPS 地址");
    return tx(r.actor, async (db) => {
      let p;
      if (b.id) {
        p = (
          await db.query(
            "UPDATE providers SET name=$2,base_url=$3,model=$4,key_cipher=CASE WHEN $5='' THEN key_cipher ELSE $5 END,tested=false WHERE id=$1 AND workspace_id=$6 RETURNING id",
            [
              b.id,
              b.name,
              b.baseUrl,
              b.model,
              b.apiKey ? encryptText(b.apiKey) : "",
              r.actor.workspace_id,
            ],
          )
        ).rows[0];
      } else {
        if (!b.apiKey) fail(400, "请输入 API 密钥");
        p = (
          await db.query(
            "INSERT INTO providers(workspace_id,name,base_url,model,key_cipher) VALUES($1,$2,$3,$4,$5) RETURNING id",
            [
              r.actor.workspace_id,
              b.name,
              b.baseUrl,
              b.model,
              encryptText(b.apiKey),
            ],
          )
        ).rows[0];
      }
      if (!p) fail(404, "接口不存在");
      await db.query(
        "UPDATE settings SET revision=revision+1 WHERE workspace_id=$1",
        [r.actor.workspace_id],
      );
      await audit(db, r.actor, "provider.save", p.id);
      return p;
    });
  });
  app.post("/api/providers/:id/test", async (r: any) => {
    admin(r.actor);
    return tx(r.actor, async (db) => {
      if (
        !(
          await db.query(
            "SELECT 1 FROM providers WHERE id=$1 AND workspace_id=$2",
            [id(r), r.actor.workspace_id],
          )
        ).rowCount
      )
        fail(404, "接口不存在");
      return (
        await db.query(
          "INSERT INTO jobs(workspace_id,user_id,kind,payload) VALUES($1,$2,'provider_test',$3) RETURNING *",
          [
            r.actor.workspace_id,
            r.actor.id,
            JSON.stringify({ providerId: id(r) }),
          ],
        )
      ).rows[0];
    });
  });
  app.get("/api/folders", async (r: any) =>
    tx(
      r.actor,
      async (db) =>
        (
          await db.query(
            "SELECT * FROM folders WHERE workspace_id=$1 ORDER BY name",
            [r.actor.workspace_id],
          )
        ).rows,
    ),
  );
  app.post("/api/folders", async (r: any) => {
    admin(r.actor);
    const b = z.object({ name: z.string().min(1).max(80) }).parse(r.body);
    return tx(
      r.actor,
      async (db) =>
        (
          await db.query(
            "INSERT INTO folders(workspace_id,name) VALUES($1,$2) RETURNING *",
            [r.actor.workspace_id, b.name],
          )
        ).rows[0],
    );
  });
  app.delete("/api/folders/:id", async (r: any) => {
    admin(r.actor);
    return tx(r.actor, async (db) => {
      await db.query("UPDATE assets SET folder_id=NULL WHERE folder_id=$1", [
        id(r),
      ]);
      await db.query("DELETE FROM folders WHERE id=$1 AND workspace_id=$2", [
        id(r),
        r.actor.workspace_id,
      ]);
      return { ok: true };
    });
  });
  app.get("/api/assets", async (r: any) =>
    tx(
      r.actor,
      async (db) =>
        (
          await db.query(
            "SELECT id,name,mime,bytes,hash,folder_id,ai_readable,reply_usable,external,extraction_status,preview_id,created_at FROM assets a WHERE conversation_id IS NULL AND NOT EXISTS(SELECT 1 FROM assets parent WHERE parent.preview_id=a.id) AND ($1::uuid IS NULL OR folder_id=$1) AND name ILIKE $2 ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4",
            [
              r.query.folder ? uuid.parse(r.query.folder) : null,
              `%${String(r.query.q || "").slice(0, 100)}%`,
              page(r),
              Math.min(100000, Math.max(0, Number(r.query.offset) || 0)),
            ],
          )
        ).rows,
    ),
  );
  app.post("/api/assets", async (r: any) => {
    const part = await r.file();
    if (!part) fail(400, "请选择文件");
    const bytes = await part.toBuffer();
    if (part.file.truncated) fail(413, "文件不能超过 20 MB");
    const chat = r.query.conversation ? uuid.parse(r.query.conversation) : null;
    if (!chat) admin(r.actor);
    return tx(r.actor, async (db) => {
      if (chat) await conversation(db, chat);
      const folder = r.query.folder ? uuid.parse(r.query.folder) : null;
      if (
        folder &&
        !(
          await db.query(
            "SELECT 1 FROM folders WHERE id=$1 AND workspace_id=$2",
            [folder, r.actor.workspace_id],
          )
        ).rowCount
      )
        fail(404, "分类不存在");
      const asset = await putAsset(
        db,
        r.actor.workspace_id,
        chat,
        part.filename,
        mimeFor(part.filename),
        bytes,
        folder,
      );
      await db.query(
        "INSERT INTO jobs(workspace_id,conversation_id,user_id,kind,payload) VALUES($1,$2,$3,'extract',$4)",
        [
          r.actor.workspace_id,
          chat,
          r.actor.id,
          JSON.stringify({ assetId: asset.id }),
        ],
      );
      await audit(db, r.actor, "asset.upload", asset.id);
      return asset;
    });
  });
  app.get("/api/assets/:id/content", async (r: any, reply: any) =>
    tx(r.actor, async (db) => {
      const asset = (
        await db.query("SELECT * FROM assets WHERE id=$1", [id(r)])
      ).rows[0];
      if (!asset) fail(404, "文件不存在或无访问权限");
      const inline =
        [
          "audio/ogg",
          "audio/mpeg",
          "audio/wav",
          "audio/mp4",
          "audio/webm",
          "audio/flac",
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
          "application/pdf",
          "text/plain",
        ].includes(asset.mime.split(";")[0]) && r.query.download !== "true";
      reply
        .header(
          "Content-Disposition",
          `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(asset.name.replace(/[\r\n]/g, ""))}`,
        )
        .type(asset.mime);
      reply
        .header("X-Frame-Options", "SAMEORIGIN")
        .header(
          "Content-Security-Policy",
          "default-src 'none'; frame-ancestors 'self'; base-uri 'none'",
        );
      const bytes = await loadBlob(asset);
      if (asset.mime.startsWith("audio/")) {
        reply.header("Accept-Ranges", "bytes");
        if (r.headers.range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(r.headers.range);
          let start = match?.[1] ? Number(match[1]) : 0,
            end = match?.[2] ? Number(match[2]) : bytes.length - 1;
          if (match && !match[1] && match[2]) {
            start = Math.max(0, bytes.length - Number(match[2]));
            end = bytes.length - 1;
          }
          end = Math.min(end, bytes.length - 1);
          if (
            !match ||
            (!match[1] && !match[2]) ||
            start > end ||
            start >= bytes.length
          )
            return reply
              .code(416)
              .header("Content-Range", `bytes */${bytes.length}`)
              .send();
          return reply
            .code(206)
            .header("Content-Range", `bytes ${start}-${end}/${bytes.length}`)
            .send(bytes.subarray(start, end + 1));
        }
      }
      return reply.send(bytes);
    }),
  );
  app.get("/api/assets/:id/text", async (r: any) => {
    admin(r.actor);
    return tx(r.actor, async (db) => {
      const a = (
        await db.query("SELECT extracted_text FROM assets WHERE id=$1", [id(r)])
      ).rows[0];
      if (!a) fail(404, "资料不存在");
      return a;
    });
  });
  app.patch("/api/assets/:id", async (r: any) => {
    admin(r.actor);
    const b = z
      .object({
        folderId: uuid.nullable().optional(),
        aiReadable: z.boolean().optional(),
        replyUsable: z.boolean().optional(),
        external: z.boolean().optional(),
        text: z.string().max(200000).optional(),
      })
      .parse(r.body);
    return tx(r.actor, async (db) => {
      const a = (
        await db.query(
          "SELECT * FROM assets WHERE id=$1 AND conversation_id IS NULL",
          [id(r)],
        )
      ).rows[0];
      if (!a) fail(404, "资料不存在");
      await db.query(
        "UPDATE assets SET folder_id=$2,ai_readable=COALESCE($3,ai_readable),reply_usable=COALESCE($4,reply_usable),external=COALESCE($5,external),extracted_text=COALESCE($6,extracted_text) WHERE id=$1",
        [
          a.id,
          b.folderId === undefined ? a.folder_id : b.folderId,
          b.aiReadable,
          b.replyUsable,
          b.external,
          b.text,
        ],
      );
      await audit(db, r.actor, "asset.update", a.id);
      return { ok: true };
    });
  });
  app.delete("/api/assets/:id", async (r: any) => {
    admin(r.actor);
    return tx(r.actor, async (db) => {
      await db.query(
        "DELETE FROM assets WHERE id=$1 AND conversation_id IS NULL AND NOT EXISTS(SELECT 1 FROM messages WHERE asset_id=$1) AND NOT EXISTS(SELECT 1 FROM outbox WHERE asset_id=$1)",
        [id(r)],
      );
      await audit(db, r.actor, "asset.delete", id(r));
      return { ok: true };
    });
  });
  app.get("/api/analytics", async (r: any) =>
    tx(r.actor, async (db) => {
      let analysisOwner = r.actor.id;
      if (r.query.owner && r.query.owner !== r.actor.id) {
        superadmin(r.actor);
        const target = (
          await db.query(
            "SELECT id FROM users WHERE id=$1 AND workspace_id=$2 AND role='member'",
            [uuid.parse(r.query.owner), r.actor.workspace_id],
          )
        ).rows[0];
        if (!target) fail(404, "成员不存在");
        analysisOwner = target.id;
        await db.query(
          "SELECT set_config('app.user_id',$1,true),set_config('app.role','member',true),set_config('app.readonly_report','1',true)",
          [analysisOwner],
        );
      }
      const period = reportPeriod(
          r.query.period || "week",
          r.query.anchor ||
            new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
        ),
        days = period.days,
        account = r.query.account ? uuid.parse(r.query.account) : null;
      const customers = (
        await db.query(
          "SELECT count(*)::int AS total,count(*) FILTER(WHERE created_at>=$1 AND created_at<$2)::int AS new,count(*) FILTER(WHERE mode='AUTO')::int AS automatic FROM conversations WHERE merged_into IS NULL AND deleted_at IS NULL AND ($3::uuid IS NULL OR account_id=$3)",
          [period.start, period.end, account],
        )
      ).rows[0];
      const trends = (
        await db.query(
          "SELECT to_char((created_at AT TIME ZONE 'Asia/Shanghai')::date,'YYYY-MM-DD') AS date,count(*)::int AS count FROM conversations WHERE merged_into IS NULL AND deleted_at IS NULL AND created_at>=$1 AND created_at<$2 AND ($3::uuid IS NULL OR account_id=$3) GROUP BY 1 ORDER BY 1",
          [period.start, period.end, account],
        )
      ).rows;
      const topics = (
        await db.query(
          `SELECT CASE WHEN text ~* '(price|quote|cost|价格|报价)' THEN '价格与报价' WHEN text ~* '(quantity|moq|数量|起订)' THEN '数量与起订量' WHEN text ~* '(spec|size|power|规格|功率|尺寸)' THEN '产品与规格' WHEN text ~* '(shipping|delivery|运费|运输|交货)' THEN '物流与交付' WHEN text ~* '(payment|付款|支付)' THEN '付款' ELSE '其他' END AS label,count(*)::int AS count FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE direction='in' AND length(trim(text))>0 AND c.deleted_at IS NULL AND c.merged_into IS NULL AND sent_at>=$1 AND sent_at<$2 AND ($3::uuid IS NULL OR m.account_id=$3) GROUP BY 1 ORDER BY 2 DESC`,
          [period.start, period.end, account],
        )
      ).rows;
      const needs = (
        await db.query(
          "SELECT c.id,c.name,i.analysis FROM conversations c JOIN customer_insights i ON i.conversation_id=c.id AND i.user_id=$2 WHERE i.analysis IS NOT NULL AND c.deleted_at IS NULL AND c.merged_into IS NULL AND ($1::uuid IS NULL OR c.account_id=$1) ORDER BY i.updated_at DESC LIMIT 30",
          [account, analysisOwner],
        )
      ).rows;
      return {
        scope:
          analysisOwner !== r.actor.id
            ? "member-readonly"
            : r.actor.role === "superadmin"
              ? "all"
              : "self",
        analysisOwner,
        days,
        period,
        customers,
        trends,
        topics,
        needs,
        generatedAt: new Date().toISOString(),
      };
    }),
  );
  app.get("/api/audit", async (r: any) => {
    admin(r.actor);
    return tx(
      r.actor,
      async (db) =>
        (
          await db.query(
            "SELECT a.*,COALESCE(u.name,a.actor_label) AS user_name FROM audit_events a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100",
          )
        ).rows,
    );
  });
}
