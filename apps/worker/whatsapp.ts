import { accountRules } from "../../packages/domain/rules";
import makeWASocket, {
  BufferJSON,
  initAuthCreds,
  proto,
  jidNormalizedUser,
  downloadMediaMessage,
  DisconnectReason,
  normalizeMessageContent,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import { randomUUID } from "node:crypto";
import { tx, service, audit } from "../../packages/database/db";
import {
  encryptText,
  decryptText,
  digest,
} from "../../packages/security/crypto";
import { putAsset, loadBlob } from "../../packages/domain/assets";
const logger = pino({ level: "silent" }),
  owner = randomUUID(),
  live = new Map<string, any>();
let reconciling = false;
export async function mergeIdentity(
  db: any,
  account: string,
  lid: string,
  phone: string,
) {
  if (!lid.endsWith("@lid") || !phone.endsWith("@s.whatsapp.net")) return;
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [account]);
  const rows = (
    await db.query(
      "SELECT c.* FROM conversations c LEFT JOIN identities i ON i.conversation_id=c.id WHERE c.account_id=$1 AND (c.jid=ANY($2::text[]) OR i.jid=ANY($2::text[])) AND c.merged_into IS NULL ORDER BY c.created_at",
      [account, [lid, phone]],
    )
  ).rows;
  const unique: any[] = [
    ...new Map<string, any>(rows.map((x) => [x.id, x])).values(),
  ];
  if (!unique.length) return;
  const target = unique.find((c) => c.jid === phone) || unique[0];
  for (const src of unique.filter((c) => c.id !== target.id)) {
    if (
      (
        await db.query(
          "SELECT 1 FROM outbox WHERE conversation_id=ANY($1::uuid[]) AND status='sending'",
          [[src.id, target.id]],
        )
      ).rowCount
    )
      return;
    await db.query(
      "UPDATE messages SET conversation_id=$2 WHERE conversation_id=$1",
      [src.id, target.id],
    );
    await db.query(
      "UPDATE assets SET conversation_id=$2 WHERE conversation_id=$1",
      [src.id, target.id],
    );
    await db.query(
      "UPDATE identities SET conversation_id=$2 WHERE conversation_id=$1",
      [src.id, target.id],
    );
    await db.query(
      "UPDATE jobs SET status='cancelled' WHERE conversation_id=$1 AND status IN('queued','running')",
      [src.id],
    );
    await db.query(
      "UPDATE outbox SET status='cancelled' WHERE conversation_id=$1 AND status='queued'",
      [src.id],
    );
    await db.query(
      "UPDATE conversations SET merged_into=$2,deleted_at=now(),revision=revision+1 WHERE id=$1",
      [src.id, target.id],
    );
    await db.query(
      "UPDATE conversations SET mode=CASE WHEN $2='AUTO' THEN mode ELSE $2 END,revision=revision+1 WHERE id=$1",
      [target.id, src.mode],
    );
    await audit(db, service, "identity.merge", target.id, { source: src.id });
  }
  // Keep the original JID row as an archive; routing aliases, not names, define identity.
  for (const jid of [lid, phone])
    await db.query(
      "INSERT INTO identities VALUES($1,$2,$3) ON CONFLICT(account_id,jid) DO UPDATE SET conversation_id=excluded.conversation_id",
      [account, jid, target.id],
    );
  if (
    target.jid !== phone &&
    !(
      await db.query(
        "SELECT 1 FROM conversations WHERE account_id=$1 AND jid=$2",
        [account, phone],
      )
    ).rowCount
  )
    await db.query("UPDATE conversations SET jid=$2 WHERE id=$1", [
      target.id,
      phone,
    ]);
}
async function ingest(
  account: any,
  session: any,
  message: any,
  historical: boolean,
) {
  const jid = jidNormalizedUser(message.key.remoteJid || "");
  if (!jid || !/(?:@s.whatsapp.net|@lid)$/.test(jid) || !message.key.id) return;
  const content = normalizeMessageContent(message.message),
    direction = message.key.fromMe ? "out" : "in";
  if (!content) return;
  const media: any =
    content.imageMessage || content.documentMessage || content.audioMessage;
  const text =
    content.conversation ||
    content.extendedTextMessage?.text ||
    media?.caption ||
    "";
  if (!text && !media) return;
  const alt = message.key.remoteJidAlt
    ? jidNormalizedUser(message.key.remoteJidAlt)
    : null;
  const timestamp =
    Number(
      message.messageTimestamp?.toNumber?.() ??
        message.messageTimestamp ??
        Date.now() / 1000,
    ) * 1000;
  const old =
    historical ||
    Date.now() - timestamp > 60000 ||
    timestamp < session.openedAt - 2000;
  const saved = await tx(service, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [account.id]);
    if (!(await fenced(db, account.id, session))) return null;
    if (alt) {
      const lid = jid.endsWith("@lid") ? jid : alt,
        phone = jid.endsWith("@s.whatsapp.net") ? jid : alt;
      await mergeIdentity(db, account.id, lid, phone);
    }
    let c = (
      await db.query(
        "SELECT c.* FROM conversations c JOIN identities i ON i.conversation_id=c.id WHERE i.account_id=$1 AND i.jid=$2",
        [account.id, jid],
      )
    ).rows[0];
    if (!c) {
      const ownerRow = (
        await db.query(
          "SELECT a.owner_id FROM accounts a JOIN users u ON u.id=a.owner_id JOIN account_grants g ON g.account_id=a.id AND g.user_id=u.id WHERE a.id=$1 AND u.active",
          [account.id],
        )
      ).rows[0];
      c = (
        await db.query(
          "INSERT INTO conversations(workspace_id,account_id,jid,name,assignee_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,jid) DO UPDATE SET name=CASE WHEN conversations.name=conversations.jid THEN excluded.name ELSE conversations.name END RETURNING *",
          [
            account.workspace_id,
            account.id,
            jid,
            message.pushName || jid.split("@")[0],
            ownerRow?.owner_id || null,
          ],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO identities VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [account.id, jid, c.id],
      );
    }
    if (alt)
      await mergeIdentity(
        db,
        account.id,
        jid.endsWith("@lid") ? jid : alt,
        jid.endsWith("@s.whatsapp.net") ? jid : alt,
      );
    const m = (
      await db.query(
        "INSERT INTO messages(workspace_id,account_id,conversation_id,platform_id,direction,text,kind,historical,sent_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id",
        [
          c.workspace_id,
          account.id,
          c.id,
          message.key.id,
          direction,
          text,
          media
            ? content.audioMessage
              ? "audio"
              : content.imageMessage
                ? "image"
                : "document"
            : "text",
          old,
          new Date(timestamp),
        ],
      )
    ).rows[0];
    if (!m) return null;
    if (c.deleted_at) return { c, m, media };
    await db.query(
      "UPDATE conversations SET last_text=CASE WHEN $3>=updated_at THEN $2 ELSE last_text END,updated_at=GREATEST(updated_at,$3),revision=revision+CASE WHEN $4 THEN 0 ELSE 1 END WHERE id=$1",
      [
        c.id,
        text || (content.audioMessage ? "[语音]" : "[附件]"),
        new Date(timestamp),
        old,
      ],
    );
    if (!old && direction === "out") {
      await db.query(
        "UPDATE conversations SET mode='HUMAN' WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM outbox WHERE conversation_id=$1 AND (platform_id=$2 OR status='sending'))",
        [c.id, message.key.id],
      );
    }
    if (!old && direction === "in") {
      const current = (
          await db.query(
            "SELECT revision,mode FROM conversations WHERE id=$1",
            [c.id],
          )
        ).rows[0],
        s = await accountRules(db, c.account_id),
        a = (await db.query("SELECT * FROM accounts WHERE id=$1", [account.id]))
          .rows[0];
      await db.query(
        "UPDATE jobs SET status='cancelled' WHERE conversation_id=$1 AND kind='auto' AND status IN('queued','running')",
        [c.id],
      );
      await db.query(
        "UPDATE outbox SET status='cancelled' WHERE conversation_id=$1 AND automatic AND status='queued'",
        [c.id],
      );
      if (
        text &&
        a.auto_reply &&
        s.value.globalAuto &&
        s.value.cloudConsent &&
        s.value.riskConsent &&
        current.mode === "AUTO"
      )
        await db.query(
          "INSERT INTO jobs(workspace_id,conversation_id,kind,revision,settings_revision) VALUES($1,$2,'auto',$3,$4)",
          [c.workspace_id, c.id, current.revision, s.revision],
        );
    }
    return { c, m, media };
  });
  if (
    saved?.media &&
    Number(
      saved.media.fileLength?.toNumber?.() ?? saved.media.fileLength ?? 0,
    ) <=
      20 * 1024 * 1024
  ) {
    try {
      const stream = await downloadMediaMessage(
          message,
          "stream",
          {},
          { logger, reuploadRequest: session.socket.updateMediaMessage },
        ),
        chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) {
          stream.destroy();
          throw Error("Media too large");
        }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      await tx(service, async (db) => {
        if (!(await fenced(db, account.id, session))) return;
        const a = await putAsset(
          db,
          account.workspace_id,
          saved.c.id,
          saved.media.fileName ||
            (content.audioMessage ? "voice.ogg" : "image.jpg"),
          saved.media.mimetype ||
            (content.audioMessage ? "audio/ogg" : "application/octet-stream"),
          bytes,
        );
        await db.query("UPDATE messages SET asset_id=$2 WHERE id=$1", [
          saved.m.id,
          a.id,
        ]);
        if (
          a.mime === "application/pdf" ||
          a.mime === "text/plain" ||
          a.mime.includes("openxmlformats")
        ) {
          await db.query(
            "INSERT INTO jobs(workspace_id,conversation_id,kind,payload) VALUES($1,$2,'extract',$3)",
            [
              account.workspace_id,
              saved.c.id,
              JSON.stringify({ assetId: a.id }),
            ],
          );
        }
      });
    } catch {
      /* Text is durable even if platform no longer retains media. */
    }
  }
  if (!old && saved) void profile(account, session, jid, saved.c.id);
}
async function profile(account: any, s: any, jid: string, cid: string) {
  if (s.profileAt?.get(jid) > Date.now() - 300000) return;
  s.profileAt.set(jid, Date.now());
  try {
    await s.socket.presenceSubscribe(jid);
    const url = await s.socket.profilePictureUrl(jid, "preview", 5000);
    if (!url) return;
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      !/(^|\.)(whatsapp\.net|whatsapp\.com)$/.test(u.hostname)
    )
      return;
    const res = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok || !res.headers.get("content-type")?.startsWith("image/"))
      return;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const b of res.body as any) {
      size += b.length;
      if (size > 2 * 1024 * 1024) throw Error("Avatar too large");
      chunks.push(Buffer.from(b));
    }
    await tx(service, async (db) => {
      if (!(await fenced(db, account.id, s))) return;
      const asset = await putAsset(
        db,
        account.workspace_id,
        cid,
        "avatar.jpg",
        "image/jpeg",
        Buffer.concat(chunks),
      );
      await db.query("UPDATE conversations SET avatar_id=$2 WHERE id=$1", [
        cid,
        asset.id,
      ]);
    });
  } catch {}
}
async function fenced(db: any, id: string, s: any) {
  return !!(
    await db.query(
      "SELECT 1 FROM accounts WHERE id=$1 AND lease_owner=$2 AND generation=$3 AND lease_until>now() AND enabled AND EXISTS(SELECT 1 FROM users u WHERE u.id=accounts.owner_id AND u.active)",
      [id, owner, s.generation],
    )
  ).rowCount;
}
async function open(account: any) {
  const s: any = {
    generation: account.generation,
    openedAt: Date.now(),
    profileAt: new Map(),
    closing: false,
  };
  live.set(account.id, s);
  const authRows = await tx(
    service,
    async (db) =>
      (
        await db.query("SELECT key,value FROM wa_auth WHERE account_id=$1", [
          account.id,
        ])
      ).rows,
  );
  const saved = new Map(authRows.map((x) => [x.key, x.value]));
  const creds = saved.has("creds")
    ? JSON.parse(decryptText(saved.get("creds")), BufferJSON.reviver)
    : initAuthCreds();
  const auth: any = {
    creds,
    keys: {
      get: async (type: string, ids: string[]) =>
        tx(service, async (db) => {
          if (!(await fenced(db, account.id, s))) throw Error("Lease lost");
          const out: any = {};
          const rows = (
            await db.query(
              "SELECT key,value FROM wa_auth WHERE account_id=$1 AND key=ANY($2::text[])",
              [account.id, ids.map((id) => `${type}:${id}`)],
            )
          ).rows;
          for (const r of rows) {
            let v = JSON.parse(decryptText(r.value), BufferJSON.reviver);
            if (type === "app-state-sync-key")
              v = proto.Message.AppStateSyncKeyData.fromObject(v);
            out[r.key.slice(type.length + 1)] = v;
          }
          return out;
        }),
      set: async (data: any) =>
        tx(service, async (db) => {
          if (!(await fenced(db, account.id, s))) throw Error("Lease lost");
          for (const [type, values] of Object.entries(data))
            for (const [id, value] of Object.entries(values || {})) {
              if (value == null)
                await db.query(
                  "DELETE FROM wa_auth WHERE account_id=$1 AND key=$2",
                  [account.id, `${type}:${id}`],
                );
              else
                await db.query(
                  "INSERT INTO wa_auth VALUES($1,$2,$3) ON CONFLICT(account_id,key) DO UPDATE SET value=excluded.value",
                  [
                    account.id,
                    `${type}:${id}`,
                    encryptText(JSON.stringify(value, BufferJSON.replacer)),
                  ],
                );
            }
        }),
    },
  };
  const socket = makeWASocket({
    auth,
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 30000,
    getMessage: async () => undefined,
  });
  s.socket = socket;
  const safe = (fn: () => Promise<any>) =>
    void fn().catch(() => {
      s.closing = true;
      socket.end(undefined);
    });
  socket.ev.on("creds.update", () =>
    safe(() =>
      tx(service, async (db) => {
        if (!(await fenced(db, account.id, s))) return;
        await db.query(
          "INSERT INTO wa_auth VALUES($1,'creds',$2) ON CONFLICT(account_id,key) DO UPDATE SET value=excluded.value",
          [account.id, encryptText(JSON.stringify(creds, BufferJSON.replacer))],
        );
      }),
    ),
  );
  socket.ev.on("connection.update", (update) =>
    safe(async () => {
      const qr = update.qr
        ? await QRCode.toDataURL(update.qr, { width: 280 })
        : null;
      await tx(service, async (db) => {
        if (!(await fenced(db, account.id, s))) return;
        if (qr)
          await db.query("UPDATE accounts SET status='qr',qr=$2 WHERE id=$1", [
            account.id,
            qr,
          ]);
        if (update.connection === "open") {
          const phone = jidNormalizedUser(socket.user?.id || "");
          if (account.phone && account.phone !== phone) {
            await db.query(
              "UPDATE accounts SET enabled=false,status='wrong_account',qr=NULL WHERE id=$1",
              [account.id],
            );
            s.closing = true;
            socket.end(undefined);
            return;
          }
          s.openedAt = Date.now();
          await db.query(
            "UPDATE accounts SET status='connected',phone=$2,qr=NULL WHERE id=$1",
            [account.id, phone],
          );
          await audit(db, service, "whatsapp.connected", account.id);
        }
        if (update.connection === "close") {
          const loggedOut =
            (update.lastDisconnect?.error as any)?.output?.statusCode ===
            DisconnectReason.loggedOut;
          await db.query(
            "UPDATE accounts SET status=$2,qr=NULL,enabled=CASE WHEN $3 THEN false ELSE enabled END,lease_until=now() WHERE id=$1",
            [account.id, loggedOut ? "logged_out" : "disconnected", loggedOut],
          );
          if (loggedOut)
            await db.query("DELETE FROM wa_auth WHERE account_id=$1", [
              account.id,
            ]);
          s.closing = true;
          live.delete(account.id);
        }
      });
    }),
  );
  // Serialize ingestion per socket; exceptions never crash the worker or discard a whole history batch.
  s.tail = Promise.resolve();
  const enqueue = (messages: any[], old: boolean) => {
    s.tail = s.tail.then(async () => {
      for (const m of messages) {
        if (s.closing) break;
        try {
          await ingest(account, s, m, old);
        } catch {
          await tx(service, (db) =>
            audit(db, service, "whatsapp.ingest_failed", account.id),
          ).catch(() => {});
        }
      }
    });
  };
  socket.ev.on("messages.upsert", (e) =>
    enqueue(e.messages, e.type !== "notify"),
  );
  socket.ev.on("messaging-history.set", (e) => enqueue(e.messages, true));
  socket.ev.on("presence.update", (e) =>
    safe(() =>
      tx(service, async (db) => {
        if (!(await fenced(db, account.id, s))) return;
        const p: any = Object.values(e.presences)[0];
        if (!p) return;
        await db.query(
          "UPDATE conversations SET presence=$3,presence_at=now() WHERE id IN(SELECT conversation_id FROM identities WHERE account_id=$1 AND jid=$2)",
          [account.id, e.id, p.lastKnownPresence || "unknown"],
        );
      }),
    ),
  );
  const contactsChanged = (contacts: any[]) =>
    safe(() =>
      tx(service, async (db) => {
        if (!(await fenced(db, account.id, s))) return;
        for (const c of contacts) {
          const ids = [c.id, c.lid, c.phoneNumber]
              .filter(Boolean)
              .map(jidNormalizedUser),
            lid = ids.find((x) => x.endsWith("@lid")),
            phone = ids.find((x) => x.endsWith("@s.whatsapp.net"));
          if (lid && phone) await mergeIdentity(db, account.id, lid, phone);
          if (c.id && c.name)
            await db.query(
              "UPDATE conversations SET name=$3 WHERE id IN(SELECT conversation_id FROM identities WHERE account_id=$1 AND jid=$2)",
              [account.id, c.id, c.name],
            );
          if (c.imgUrl === null || c.imgUrl === "removed")
            await db.query(
              "UPDATE conversations SET avatar_id=NULL WHERE id IN(SELECT conversation_id FROM identities WHERE account_id=$1 AND jid=ANY($2::text[]))",
              [account.id, ids],
            );
          else if (c.imgUrl !== undefined) {
            for (const jid of ids) {
              s.profileAt.delete(jid);
              const row = (
                await db.query(
                  "SELECT conversation_id FROM identities WHERE account_id=$1 AND jid=$2",
                  [account.id, jid],
                )
              ).rows[0];
              if (row) void profile(account, s, jid, row.conversation_id);
            }
          }
        }
      }),
    );
  socket.ev.on("contacts.update", contactsChanged);
  socket.ev.on("contacts.upsert", contactsChanged);
  socket.ev.on("lid-mapping.update", ({ lid, pn }) =>
    contactsChanged([{ id: pn, lid }]),
  );
  socket.ev.on("messaging-history.set", ({ contacts }) =>
    contactsChanged(contacts || []),
  );
}
export async function reconcile() {
  if (reconciling) return;
  reconciling = true;
  try {
    const accounts = await tx(
      service,
      async (db) =>
        (await db.query("SELECT * FROM accounts ORDER BY created_at")).rows,
    );
    const existing = new Set(accounts.map((a) => a.id));
    for (const [id, s] of live)
      if (!existing.has(id)) {
        s.closing = true;
        s.socket?.end(undefined);
        live.delete(id);
      }
    for (const a of accounts) {
      const current = live.get(a.id);
      if (current) {
        const ok = await tx(service, async (db) => {
          if (
            (await db.query("SELECT active FROM maintenance WHERE id=1"))
              .rows[0].active
          )
            return false;
          return !!(
            await db.query(
              "UPDATE accounts SET lease_until=now()+interval '30 seconds' WHERE id=$1 AND lease_owner=$2 AND generation=$3 AND enabled AND lease_until>now() RETURNING id",
              [a.id, owner, current.generation],
            )
          ).rowCount;
        });
        if (!ok) {
          current.closing = true;
          current.socket?.end(undefined);
          live.delete(a.id);
        }
        continue;
      }
      if (!a.enabled) continue;
      const claimed = await tx(service, async (db) => {
        if (
          (await db.query("SELECT active FROM maintenance WHERE id=1")).rows[0]
            .active
        )
          return null;
        return (
          await db.query(
            "UPDATE accounts SET lease_owner=$2,lease_until=now()+interval '30 seconds',generation=generation+1,status='connecting',qr=NULL WHERE id=$1 AND enabled AND (lease_until IS NULL OR lease_until<now()) RETURNING *",
            [a.id, owner],
          )
        ).rows[0];
      });
      if (claimed)
        try {
          await open(claimed);
        } catch {
          live.delete(a.id);
        }
    }
  } finally {
    reconciling = false;
  }
}
let sending = false;
export async function drainOutbox() {
  if (sending) return;
  sending = true;
  try {
    for (const [aid, s] of live) {
      if (s.closing) continue;
      const item = await tx(service, async (db) => {
        if (
          !(await fenced(db, aid, s)) ||
          (await db.query("SELECT active FROM maintenance WHERE id=1")).rows[0]
            .active
        )
          return null;
        const o = (
          await db.query(
            "SELECT * FROM outbox WHERE account_id=$1 AND status='queued' ORDER BY created_at LIMIT 1",
            [aid],
          )
        ).rows[0];
        if (!o) return null;
        const c = (
            await db.query(
              "SELECT * FROM conversations WHERE id=$1 FOR UPDATE",
              [o.conversation_id],
            )
          ).rows[0],
          a = (await db.query("SELECT * FROM accounts WHERE id=$1", [aid]))
            .rows[0],
          settings = await accountRules(db, aid);
        if (
          !(
            await db.query(
              "SELECT 1 FROM outbox WHERE id=$1 AND status='queued' FOR UPDATE",
              [o.id],
            )
          ).rowCount
        )
          return null;
        let allowed =
          !c.deleted_at &&
          !c.merged_into &&
          c.revision === o.revision &&
          a.enabled &&
          !!(
            await db.query("SELECT 1 FROM users WHERE id=$1 AND active", [
              a.owner_id,
            ])
          ).rowCount &&
          a.status === "connected";
        if (o.automatic)
          allowed &&=
            c.mode === "AUTO" &&
            a.auto_reply &&
            settings.value.globalAuto &&
            settings.value.cloudConsent &&
            settings.value.riskConsent &&
            settings.revision === o.settings_revision;
        else {
          const u = (
            await db.query("SELECT * FROM users WHERE id=$1 AND active", [
              o.user_id,
            ])
          ).rows[0];
          allowed &&=
            !!u &&
            (u.role !== "member" ||
              (c.assignee_id === u.id &&
                !!(
                  await db.query(
                    "SELECT 1 FROM account_grants WHERE account_id=$1 AND user_id=$2",
                    [aid, u.id],
                  )
                ).rowCount));
        }
        let asset = null;
        if (o.asset_id) {
          asset = (
            await db.query("SELECT * FROM assets WHERE id=$1", [o.asset_id])
          ).rows[0];
          allowed &&=
            !!asset &&
            (asset.conversation_id === c.id ||
              (!asset.conversation_id && asset.external));
        }
        if (!allowed) {
          await db.query(
            "UPDATE outbox SET status='cancelled',error='权限或会话状态已变更',updated_at=now() WHERE id=$1",
            [o.id],
          );
          return null;
        }
        const count = Number(
          (
            await db.query(
              "SELECT count(*) FROM outbox WHERE account_id=$1 AND status IN('sent','sending','unknown') AND updated_at>now()-interval '1 hour'",
              [aid],
            )
          ).rows[0].count,
        );
        if (o.automatic && count >= settings.value.maxRepliesPerHour)
          return null;
        await db.query(
          "UPDATE outbox SET status='sending',updated_at=now() WHERE id=$1",
          [o.id],
        );
        return { o, c, asset };
      });
      if (!item) continue;
      const { o, c, asset } = item;
      let status = "unknown",
        platformId = null;
      try {
        const bytes = asset ? await loadBlob(asset) : null;
        const payload = asset
          ? asset.mime.startsWith("image/")
            ? { image: bytes, caption: o.text }
            : {
                document: bytes,
                mimetype: asset.mime,
                fileName: asset.name,
                caption: o.text,
              }
          : { text: o.text };
        const result = await s.socket.sendMessage(c.jid, payload);
        if (result?.key?.id) {
          status = "sent";
          platformId = result.key.id;
        }
      } catch {}
      await tx(service, async (db) => {
        await db.query(
          "UPDATE outbox SET status=$2,platform_id=$3,updated_at=now() WHERE id=$1 AND status='sending'",
          [o.id, status, platformId],
        );
        if (platformId) {
          await db.query(
            "INSERT INTO messages(workspace_id,account_id,conversation_id,platform_id,direction,text,kind,asset_id,status) VALUES($1,$2,$3,$4,'out',$5,$6,$7,'sent') ON CONFLICT DO NOTHING",
            [
              o.workspace_id,
              aid,
              c.id,
              platformId,
              o.text,
              asset
                ? asset.mime.startsWith("image/")
                  ? "image"
                  : "document"
                : "text",
              asset?.id || null,
            ],
          );
          await db.query(
            "UPDATE conversations SET last_text=$2,updated_at=now() WHERE id=$1",
            [c.id, o.text || "[附件]"],
          );
        }
        await audit(db, service, `message.${status}`, o.id);
      });
    }
  } finally {
    sending = false;
  }
}
export async function stopSockets() {
  for (const s of live.values()) {
    s.closing = true;
    s.socket?.end(undefined);
  }
  live.clear();
  await tx(service, async (db) => {
    await db.query(
      "UPDATE accounts SET lease_until=now() WHERE lease_owner=$1",
      [owner],
    );
  });
}
