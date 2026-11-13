import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, readFile, readdir } from "node:fs/promises";
import { tx, superadmin, fail, audit } from "../../packages/database/db";
import {
  verifyPassword,
  encryptText,
  decryptText,
} from "../../packages/security/crypto";
const opsDir = process.env.OPS_DIR || "/ops";
export async function backupRoutes(app: any) {
  const verify = async (r: any, b: any) =>
    tx(r.actor, async (db) => {
      superadmin(r.actor);
      const u = (
        await db.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
          r.actor.id,
        ])
      ).rows[0];
      if (!(await verifyPassword(b.currentPassword, u.password_hash)))
        fail(401, "当前密码不正确");
      await audit(db, r.actor, "backup.authorize", undefined, { kind: b.kind });
    });
  const enqueue = async (b: any) => {
    const id = randomUUID();
    await mkdir(opsDir, { recursive: true });
    await writeFile(
      `${opsDir}/${id}.tmp`,
      encryptText(JSON.stringify({ ...b, id })),
      { mode: 0o600 },
    );
    await rename(`${opsDir}/${id}.tmp`, `${opsDir}/${id}.request`);
    return {
      id,
      message:
        b.kind === "restore"
          ? "恢复任务已提交，完成后请重新登录。"
          : "备份任务已提交，可在下方查看结果并下载。",
    };
  };
  const schema = z.object({
    password: z.string().min(12).max(256),
    currentPassword: z.string().max(256),
  });
  app.post("/api/backup", async (r: any) => {
    const b = schema.parse(r.body);
    await verify(r, { ...b, kind: "backup" });
    return enqueue({
      kind: "backup",
      password: b.password,
      userId: r.actor.id,
    });
  });
  app.post("/api/restore", async (r: any) => {
    superadmin(r.actor);
    const fields: any = {},
      parts = r.parts({ limits: { fileSize: 1024 * 1024 * 1024, files: 1 } });
    let input: string | null = null;
    for await (const part of parts) {
      if (part.type === "file") {
        if (!fields.password || !fields.currentPassword)
          fail(400, "恢复参数不完整");
        const b = schema.parse(fields);
        await verify(r, { ...b, kind: "restore" });
        const { pipeline } = await import("node:stream/promises"),
          { createWriteStream } = await import("node:fs");
        input = `${randomUUID()}.upload`;
        await pipeline(
          part.file,
          createWriteStream(`${opsDir}/${input}`, { mode: 0o600 }),
        );
        if (part.file.truncated) fail(413, "备份文件超过 1 GB");
      } else fields[part.fieldname] = part.value;
    }
    if (!input) fail(400, "请选择备份文件");
    const b = schema.parse(fields);
    return enqueue({
      kind: "restore",
      password: b.password,
      input,
      userId: r.actor.id,
    });
  });
  app.get("/api/backups", async (r: any) => {
    superadmin(r.actor);
    const files = (await readdir(opsDir))
      .filter((x) => x.endsWith(".result"))
      .sort()
      .slice(-30);
    const results = [];
    for (const f of files)
      try {
        results.push(JSON.parse(await readFile(`${opsDir}/${f}`, "utf8")));
      } catch {}
    return results.sort((a, b) => b.at.localeCompare(a.at));
  });
  app.get("/api/backups/:id/download", async (r: any, reply: any) => {
    superadmin(r.actor);
    const id = z.uuid().parse(r.params.id);
    const result = JSON.parse(await readFile(`${opsDir}/${id}.result`, "utf8"));
    if (result.status !== "done" || result.kind !== "backup")
      fail(404, "备份不存在");
    const { createReadStream } = await import("node:fs");
    reply
      .type("application/octet-stream")
      .header(
        "Content-Disposition",
        `attachment; filename="SmarChat-${id}.scbackup"`,
      );
    return reply.send(createReadStream(`/backups/${id}.scbackup`));
  });
}
