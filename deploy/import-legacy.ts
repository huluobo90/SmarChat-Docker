import { createRequire } from "node:module";
import { readFile, writeFile, mkdtemp, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDecipheriv, createHash } from "node:crypto";
import { z } from "zod";
import { readArchive } from "../packages/domain/legacy-backup";
import { makePool, pool, workspace } from "../packages/database/db";
import { digest, encryptText } from "../packages/security/crypto";
import { saveBlob } from "../packages/domain/assets";
const args = process.argv.slice(2),
  value = (key: string) => args[args.indexOf(key) + 1],
  apply = args.includes("--apply"),
  source = value("--source");
if (!args.includes("--source"))
  throw Error(
    "Usage: --source /imports/backup.smarchat --password-file /imports/password.txt [--account-id UUID --assignee UUID --apply]",
  );
const password = (
    await readFile(
      args.includes("--password-file")
        ? value("--password-file")
        : "/imports/password.txt",
      "utf8",
    )
  ).replace(/\r?\n$/, ""),
  stage = await mkdtemp(join(tmpdir(), "smarchat-import-")),
  owner = makePool("postgres");
let sqlite: any;
const stable = (account: string, type: string, id: string) => {
  const h = createHash("sha256")
    .update(`${account}:${type}:${id}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  h[12] = "4";
  h[16] = "8";
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};
try {
  if ((await stat(source)).size > 1024 ** 3)
    throw Error("本版导入器限制为 1 GB 备份包");
  const manifest = await readArchive(source, stage, password),
    require = createRequire("/import-deps/package.json"),
    Database = require("better-sqlite3-multiple-ciphers");
  sqlite = new Database(join(stage, "SmarChat.db"), {
    readonly: true,
    fileMustExist: true,
  });
  sqlite.pragma(`key="${manifest.masterKey}"`);
  if (
    sqlite.pragma("integrity_check", { simple: true }) !== "ok" ||
    sqlite.pragma("foreign_key_check").length
  )
    throw Error("旧版数据库校验失败");
  const version = sqlite.pragma("user_version", { simple: true });
  if (version !== 3)
    throw Error("导入器仅支持数据库 v3，请先使用旧版升级后重新备份");
  const kv = new Map<string, any>(
      sqlite
        .prepare("SELECT * FROM kv")
        .all()
        .map((r: any) => [r.key, JSON.parse(r.value)]),
    ),
    chats: any[] = sqlite.prepare("SELECT * FROM chats").all(),
    assets: any[] = sqlite
      .prepare("SELECT value FROM assets")
      .all()
      .map((r: any) => JSON.parse(r.value)),
    messages: any[] = sqlite
      .prepare("SELECT * FROM messages ORDER BY timestamp,id")
      .all(),
    folders: any[] = sqlite.prepare("SELECT * FROM library_folders").all(),
    providers: any[] = sqlite
      .prepare("SELECT value FROM providers")
      .all()
      .map((r: any) => JSON.parse(r.value));
  const counts = {
    chats: chats.length,
    messages: messages.length,
    assets: assets.length,
    activeCustomers: chats.filter(
      (c) => !kv.has("identity:" + c.id) && !kv.has("trash:" + c.id),
    ).length,
    archivedIdentities: chats.filter((c) => kv.has("identity:" + c.id)).length,
    duplicateMessages: messages.filter((m) => kv.has("duplicate:" + m.id))
      .length,
    folders: folders.length,
    providers: providers.length,
  };
  if (
    counts.chats !== manifest.counts.chats ||
    counts.messages !== manifest.counts.messages ||
    counts.assets !== manifest.counts.assets
  )
    throw Error("旧版记录数与清单不一致");
  // Authenticate every blob before opening a mutation transaction.
  const oldKey = Buffer.from(manifest.masterKey, "hex"),
    readLegacyBlob = async (a: any) => {
      if (!/^[a-f0-9-]{36}$/.test(a.id)) throw Error("旧文件标识无效");
      const b = await readFile(join(stage, "blobs", a.id)),
        d = createDecipheriv("aes-256-gcm", oldKey, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      const plain = Buffer.concat([d.update(b.subarray(28)), d.final()]);
      if (digest(plain) !== a.hash || plain.length !== a.bytes)
        throw Error("旧附件校验失败");
      return plain;
    };
  for (const a of assets) await readLegacyBlob(a);
  const hasher = createHash("sha256");
  for await (const chunk of createReadStream(source)) hasher.update(chunk);
  const sourceHash = hasher.digest("hex"),
    report = {
      sourceHash,
      version,
      counts,
      mode: apply ? "apply" : "preview",
      accountPhone: kv.get("owner") || null,
      notes: [
        "原始行加密保留在 legacy_records",
        "重复消息保留归档，不重复出现在收件箱",
        "接入及自动接待保持关闭；AI 接口需要重新测试",
        "不会启用旧的发送队列",
      ],
    };
  await writeFile(
    "/imports/import-report.json",
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      mode: report.mode,
      counts,
      report: "/imports/import-report.json",
    }),
  );
  if (apply) {
    const account = z.uuid().parse(value("--account-id"));
    let assignee = args.includes("--assignee")
        ? z.uuid().parse(value("--assignee"))
        : null,
      c = await owner.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(7811494)");
      const a = (
        await c.query(
          "SELECT * FROM accounts WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
          [account, workspace],
        )
      ).rows[0];
      if (!a || a.enabled) throw Error("请选择已创建且断开的原生接入账号");
      assignee = assignee || a.owner_id;
      if (!assignee || assignee !== a.owner_id)
        throw Error("先分配接入负责人，导入负责人必须与接入一致");
      if (a.phone && kv.get("owner") && a.phone !== kv.get("owner"))
        throw Error("旧版与目标接入的 WhatsApp 身份不同");
      if (
        (
          await c.query("SELECT 1 FROM legacy_imports WHERE source_hash=$1", [
            sourceHash,
          ])
        ).rowCount
      ) {
        console.log("Already imported; no records changed");
        await c.query("ROLLBACK");
      } else {
        if (
          assignee &&
          !(
            await c.query(
              "SELECT 1 FROM accounts a JOIN users u ON u.id=a.owner_id WHERE a.id=$1 AND a.owner_id=$2 AND u.active",
              [account, assignee],
            )
          ).rowCount
        )
          throw Error("负责人需要拥有目标接入权限");
        await c.query(
          "INSERT INTO legacy_imports(source_hash,account_id,counts) VALUES($1,$2,$3)",
          [sourceHash, account, JSON.stringify(counts)],
        );
        for (const table of [
          "kv",
          "chats",
          "messages",
          "assets",
          "providers",
          "auth",
          "outbox",
          "audits",
          "contacts",
          "library_folders",
        ])
          for (const r of sqlite.prepare(`SELECT * FROM ${table}`).iterate())
            await c.query("INSERT INTO legacy_records VALUES($1,$2,$3,$4)", [
              sourceHash,
              table,
              String(r.id ?? r.key),
              encryptText(JSON.stringify(r)),
            ]);
        const existingChats = new Map<string, string>(
          (
            await c.query(
              "SELECT id,jid FROM conversations WHERE account_id=$1",
              [account],
            )
          ).rows.map((r) => [r.jid, r.id]),
        );
        const canonical = (id: string) => kv.get("identity:" + id) || id,
          cid = (id: string) =>
            existingChats.get(id) || stable(account, "chat", id),
          aid = (id: string) => stable(account, "asset", id),
          fid = (id: string) => stable(account, "folder", id),
          pid = (id: string) => stable(account, "provider", id);
        const mid = (m: any) =>
            stable(
              account,
              "message",
              `${m.id.includes(":") ? m.id.slice(m.id.indexOf(":") + 1) : m.id}:${m.direction}`,
            ),
          messageIds = new Map(messages.map((m) => [m.id, mid(m)]));
        for (const f of folders)
          await c.query(
            "INSERT INTO folders(id,workspace_id,name) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
            [fid(f.id), workspace, `${f.name} · ${account.slice(0, 6)}`],
          );
        for (const row of chats) {
          const trash = kv.get("trash:" + row.id);
          await c.query(
            "INSERT INTO conversations(id,workspace_id,account_id,jid,name,assignee_id,mode,country,deleted_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'PAUSED',$7,$8,$9,$9) ON CONFLICT(account_id,jid) DO NOTHING",
            [
              cid(row.id),
              workspace,
              account,
              row.id,
              row.name,
              assignee,
              kv.get("location:" + row.id)?.country || "",
              trash ? new Date(trash.deletedAt) : null,
              new Date(row.updated_at),
            ],
          );
        }
        for (const row of chats) {
          const target = canonical(row.id);
          if (target !== row.id)
            await c.query(
              "UPDATE conversations SET merged_into=$2,deleted_at=COALESCE(deleted_at,now()),mode='PAUSED' WHERE id=$1",
              [cid(row.id), cid(target)],
            );
          await c.query(
            "INSERT INTO identities VALUES($1,$2,$3) ON CONFLICT(account_id,jid) DO UPDATE SET conversation_id=excluded.conversation_id",
            [account, row.id, cid(target)],
          );
        }
        for (const asset of assets) {
          const plain = await readLegacyBlob(asset),
            assetId = aid(asset.id);
          await saveBlob(assetId, plain);
          await c.query(
            "INSERT INTO assets(id,workspace_id,conversation_id,folder_id,name,mime,bytes,hash,extracted_text,ai_readable,reply_usable,external,extraction_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING",
            [
              assetId,
              workspace,
              asset.origin === "library" ? null : cid(canonical(asset.chatId)),
              asset.folderId ? fid(asset.folderId) : null,
              asset.name,
              asset.mime,
              plain.length,
              digest(plain),
              asset.text || "",
              !!asset.aiReadable,
              !!asset.replyUsable,
              !!asset.external,
              asset.text ? "ready" : "needs_text",
            ],
          );
        }
        for (const m of messages) {
          if (kv.has("duplicate:" + m.id)) continue;
          const target = canonical(m.chat_id),
            platform = m.id.includes(":")
              ? m.id.slice(m.id.indexOf(":") + 1)
              : m.id;
          await c.query(
            "INSERT INTO messages(id,workspace_id,account_id,conversation_id,platform_id,direction,text,kind,asset_id,historical,translation,sent_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,$12) ON CONFLICT(account_id,platform_id,direction) DO NOTHING",
            [
              mid(m),
              workspace,
              account,
              cid(target),
              platform,
              m.direction,
              m.text,
              m.kind,
              m.asset_id ? aid(m.asset_id) : null,
              m.translation,
              new Date(m.timestamp),
              m.status,
            ],
          );
        }
        for (const row of chats) {
          if (canonical(row.id) !== row.id) continue;
          let analysis = null;
          try {
            analysis = JSON.parse(row.analysis);
            if (analysis) {
              for (const f of Object.values(analysis.facts || {}) as any[])
                f.evidence.messageId =
                  messageIds.get(
                    kv.get("duplicate:" + f.evidence.messageId) ||
                      f.evidence.messageId,
                  ) || f.evidence.messageId;
              for (const s of analysis.signals || [])
                s.messageId =
                  messageIds.get(
                    kv.get("duplicate:" + s.messageId) || s.messageId,
                  ) || s.messageId;
            }
          } catch {}
          await c.query(
            "UPDATE conversations SET analysis=NULL,last_text=COALESCE((SELECT text FROM messages WHERE conversation_id=$1 ORDER BY sent_at DESC LIMIT 1),''),revision=revision+1,mode='PAUSED' WHERE id=$1",
            [cid(row.id)],
          );
          if (analysis && assignee)
            await c.query(
              "INSERT INTO customer_insights(workspace_id,conversation_id,user_id,analysis) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
              [workspace, cid(row.id), assignee, JSON.stringify(analysis)],
            );
          if (assignee && row.draft)
            await c.query(
              "INSERT INTO drafts(conversation_id,user_id,text) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
              [cid(row.id), assignee, row.draft],
            );
        }
        for (const p of providers)
          await c.query(
            "INSERT INTO providers(id,workspace_id,name,base_url,model,key_cipher,tested) VALUES($1,$2,$3,$4,$5,$6,false) ON CONFLICT(id) DO NOTHING",
            [
              pid(p.id),
              workspace,
              p.name,
              p.baseUrl,
              p.model,
              encryptText(p.apiKey || ""),
            ],
          );
        for (const r of sqlite.prepare("SELECT * FROM auth").iterate())
          await c.query(
            "INSERT INTO wa_auth VALUES($1,$2,$3) ON CONFLICT(account_id,key) DO NOTHING",
            [account, r.id, encryptText(r.value)],
          );
        const s = kv.get("settings") || {};
        await c.query(
          "UPDATE accounts SET phone=COALESCE(phone,$2),enabled=false,auto_reply=false,status='disconnected',settings=$3 WHERE id=$1",
          [
            account,
            kv.get("owner") || null,
            JSON.stringify({
              providerId: s.providerId ? pid(s.providerId) : "",
              tone: s.tone || "",
              language: s.language || "",
              boundaries: s.boundaries || "",
            }),
          ],
        );
        await c.query(
          "INSERT INTO audit_events(workspace_id,action,resource,details) VALUES($1,'legacy.import',$2,$3)",
          [workspace, account, JSON.stringify({ sourceHash, counts })],
        );
        await c.query("COMMIT");
        console.log("LEGACY_IMPORT_OK; reception remains disabled");
      }
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
} finally {
  sqlite?.close();
  await rm(stage, { recursive: true, force: true });
  await owner.end();
  await pool.end();
}
