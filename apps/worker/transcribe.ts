import { request } from "node:https";
import { lookup } from "node:dns/promises";
import { randomUUID } from "node:crypto";
import { publicAddress } from "./ai";
import { tx, service } from "../../packages/database/db";
import { accountRules } from "../../packages/domain/rules";
import { loadBlob } from "../../packages/domain/assets";
import { decryptText } from "../../packages/security/crypto";

export async function requestTranscription(
  p: any,
  model: string,
  asset: any,
  bytes: Buffer,
  signal: AbortSignal,
) {
  const url = new URL(p.base_url.replace(/\/$/, "") + "/audio/transcriptions");
  if (url.protocol !== "https:" || url.username || url.password)
    throw Error("语音接口地址不允许");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw Error("语音接口不能连接私有网络");
  const boundary = "SmarChat" + randomUUID(),
    mime = asset.mime.split(";")[0];
  const ext = (
    {
      "audio/ogg": "ogg",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/webm": "webm",
      "audio/flac": "flac",
    } as any
  )[mime];
  if (!ext) throw Error("该音频格式暂不支持转写");
  if (bytes.length > 20 * 1024 * 1024) throw Error("语音文件超过 20 MB");
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return new Promise<string>((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        signal,
        lookup: ((_h: any, _o: any, cb: any) =>
          cb(null, addresses[0].address, addresses[0].family)) as any,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          Authorization: `Bearer ${decryptText(p.key_cipher)}`,
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            Error(
              `语音转写失败（HTTP ${res.statusCode}），请确认接口及模型支持语音转写`,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1000000) {
            req.destroy();
            reject(Error("转写结果过大"));
          } else chunks.push(chunk);
        });
        res.on("error", () => reject(Error("转写响应中断")));
        res.on("end", () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString());
            if (
              typeof result.text !== "string" ||
              !result.text.trim() ||
              result.text.length > 100000
            )
              throw Error();
            resolve(result.text.trim());
          } catch {
            reject(Error("未识别到有效文字"));
          }
        });
      },
    );
    req.setTimeout(90000, () => req.destroy());
    req.on("error", () =>
      reject(
        Error(signal.aborted ? "转写已取消或超时" : "无法连接语音转写接口"),
      ),
    );
    req.end(body);
  });
}
export async function transcribe(
  job: any,
  signal: AbortSignal,
  recognize = requestTranscription,
) {
  const ctx = await tx(service, async (db) => {
    const row = (
      await db.query(
        "SELECT m.*,c.deleted_at,c.assignee_id,a.owner_id FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN accounts a ON a.id=c.account_id WHERE m.id=$1 AND m.conversation_id=$2",
        [job.payload.messageId, job.conversation_id],
      )
    ).rows[0];
    if (!row || row.deleted_at || row.kind !== "audio" || !row.asset_id)
      throw Error("语音消息不可用");
    const u = (
      await db.query("SELECT role,active FROM users WHERE id=$1", [job.user_id])
    ).rows[0];
    if (
      !u?.active ||
      (u.role !== "superadmin" &&
        (row.owner_id !== job.user_id || row.assignee_id !== job.user_id))
    )
      throw Error("客户访问权限已变更");
    const rule = await accountRules(db, row.account_id);
    if (!rule.value.cloudConsent)
      throw Error("请先在对话规则中允许云端数据处理");
    const providerId =
      rule.value.transcriptionProviderId || rule.value.providerId;
    const p = (
      await db.query(
        "SELECT * FROM providers WHERE id=$1 AND workspace_id=$2",
        [providerId || null, row.workspace_id],
      )
    ).rows[0];
    if (!p?.key_cipher) throw Error("请先选择已配置密钥的语音转写接口");
    const asset = (
      await db.query(
        "SELECT * FROM assets WHERE id=$1 AND conversation_id=$2",
        [row.asset_id, row.conversation_id],
      )
    ).rows[0];
    if (!asset) throw Error("语音文件不存在");
    return { row, rule, p, asset };
  });
  const text = await recognize(
    ctx.p,
    ctx.rule.value.transcriptionModel || "whisper-1",
    ctx.asset,
    await loadBlob(ctx.asset),
    signal,
  );
  return tx(service, async (db) => {
    const c = (
      await db.query(
        "SELECT c.*,a.owner_id FROM conversations c JOIN accounts a ON a.id=c.account_id WHERE c.id=$1 FOR UPDATE OF c",
        [job.conversation_id],
      )
    ).rows[0];
    const u = (
      await db.query("SELECT role,active FROM users WHERE id=$1", [job.user_id])
    ).rows[0];
    const j = (
      await db.query("SELECT status FROM jobs WHERE id=$1 FOR UPDATE", [job.id])
    ).rows[0];
    const rule = await accountRules(db, ctx.row.account_id);
    if (
      signal.aborted ||
      !c ||
      c.deleted_at ||
      !u?.active ||
      j?.status !== "running" ||
      rule.revision !== ctx.rule.revision ||
      (u.role !== "superadmin" &&
        (c.owner_id !== job.user_id || c.assignee_id !== job.user_id))
    )
      throw Error("任务或客户权限已变更，未保存转写");
    if (
      !(
        await db.query(
          "UPDATE messages SET text=$2,translation=NULL WHERE id=$1 AND asset_id=$3 AND text=$4",
          [ctx.row.id, text, ctx.asset.id, ctx.row.text],
        )
      ).rowCount
    )
      throw Error("语音内容已更新");
    await db.query(
      "UPDATE conversations SET revision=revision+1,last_text=CASE WHEN $2=(SELECT id FROM messages WHERE conversation_id=$1 ORDER BY sent_at DESC,id DESC LIMIT 1) THEN $3 ELSE last_text END WHERE id=$1",
      [c.id, ctx.row.id, text.slice(0, 500)],
    );
    return { messageId: ctx.row.id, text };
  });
}
