import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  copyFile,
  rename,
  rm,
  mkdtemp,
  stat,
  open,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as tar from "tar";
import { makePool, workspace, pool } from "../packages/database/db";
import {
  incrementalMigrations,
  latestSchema,
} from "../packages/database/migrations";
import {
  secret,
  masterKey,
  backupKey,
  digest,
  decryptText,
  encryptText,
  seal,
  unseal,
} from "../packages/security/crypto";
const exec = promisify(execFile),
  owner = makePool("postgres"),
  ops = process.env.OPS_DIR || "/ops",
  data = process.env.DATA_DIR || "/data",
  backups = "/backups";
await mkdir(ops, { recursive: true });
await mkdir(backups, { recursive: true });
const pgEnv = {
  ...process.env,
  PGHOST: process.env.PGHOST || "db",
  PGDATABASE: process.env.PGDATABASE || "smarchat",
  PGUSER: "postgres",
  PGPASSWORD: secret("db_password"),
};
async function encryptArchive(input: string, output: string, password: string) {
  const salt = randomBytes(16),
    iv = randomBytes(12),
    key = await backupKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  await writeFile(output, Buffer.concat([Buffer.from("SCBACK02"), salt, iv]), {
    mode: 0o600,
  });
  await pipeline(
    createReadStream(input),
    cipher,
    createWriteStream(output, { flags: "a" }),
  );
  const file = await open(output, "a");
  try {
    await file.write(cipher.getAuthTag());
  } finally {
    await file.close();
  }
}
async function decryptArchive(input: string, output: string, password: string) {
  const handle = await open(input, "r");
  try {
    const size = (await handle.stat()).size;
    if (size < 52 || size > 1024 ** 3) throw Error("备份文件大小无效");
    const head = Buffer.alloc(36),
      tag = Buffer.alloc(16);
    await handle.read(head, 0, 36, 0);
    await handle.read(tag, 0, 16, size - 16);
    if (head.subarray(0, 8).toString() !== "SCBACK02")
      throw Error("备份格式不支持");
    const key = await backupKey(password, head.subarray(8, 24)),
      dec = createDecipheriv("aes-256-gcm", key, head.subarray(24, 36));
    dec.setAuthTag(tag);
    await pipeline(
      createReadStream(input, { start: 36, end: size - 17 }),
      dec,
      createWriteStream(output, { mode: 0o600 }),
    );
  } finally {
    await handle.close();
  }
}
async function snapshot(dir: string) {
  await mkdir(`${dir}/blobs`, { recursive: true });
  await exec("pg_dump", ["-Fc", "-f", `${dir}/database.dump`], {
    env: pgEnv,
    timeout: 120000,
    maxBuffer: 1000000,
  });
  const blobs = (
    await owner.query("SELECT id,hash,bytes FROM assets ORDER BY id")
  ).rows;
  for (const a of blobs)
    await copyFile(`${data}/blobs/${a.id}`, `${dir}/blobs/${a.id}`);
  const counts = {};
  for (const table of [
    "users",
    "accounts",
    "conversations",
    "messages",
    "assets",
    "account_grants",
    "providers",
    "customer_insights",
    "personal_rules",
    "legacy_insights_archive",
  ])
    counts[table] = (
      await owner.query(`SELECT count(*)::int AS count FROM ${table}`)
    ).rows[0].count;
  await writeFile(
    `${dir}/manifest.json`,
    JSON.stringify({
      format: 2,
      schema: latestSchema,
      createdAt: new Date().toISOString(),
      master: masterKey().toString("hex"),
      databaseHash: digest(await readFile(`${dir}/database.dump`)),
      blobs,
      counts,
    }),
    { mode: 0o600 },
  );
  return counts;
}
async function pack(dir: string, path: string, password: string) {
  const archive = `${dir}.tgz`;
  await tar.c({ gzip: true, cwd: dir, file: archive }, [
    "database.dump",
    "manifest.json",
    "blobs",
  ]);
  await encryptArchive(archive, path, password);
  await rm(archive);
}
async function validate(path: string, password: string, dir: string) {
  const archive = `${dir}.tgz`;
  await decryptArchive(path, archive, password);
  await mkdir(dir, { recursive: true });
  let total = 0;
  await tar.x({
    file: archive,
    cwd: dir,
    strict: true,
    filter: (path, entry) => {
      const allowed =
        /^(database\.dump|manifest\.json|blobs\/?|blobs\/[0-9a-f-]{36})$/.test(
          path,
        ) && ["File", "Directory"].includes((entry as any).type);
      total += entry.size || 0;
      if (!allowed || total > 2 * 1024 ** 3)
        throw Error("备份包路径或展开大小无效");
      return true;
    },
  });
  await rm(archive);
  const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, "utf8"));
  if (
    manifest.format !== 2 ||
    !Number.isInteger(manifest.schema) ||
    manifest.schema < 2 ||
    manifest.schema > latestSchema ||
    !/^[0-9a-f]{64}$/.test(manifest.master) ||
    manifest.databaseHash !== digest(await readFile(`${dir}/database.dump`))
  )
    throw Error("备份清单校验失败");
  if (manifest.schema < 6)
    throw Error("旧账号结构备份请在对应旧版恢复后再升级到 Bison 团队版");
  for (const a of manifest.blobs) {
    if (!/^[0-9a-f-]{36}$/.test(a.id)) throw Error("附件标识无效");
    const bytes = unseal(
      await readFile(`${dir}/blobs/${a.id}`),
      Buffer.from(manifest.master, "hex"),
    );
    if (digest(bytes) !== a.hash || bytes.length !== a.bytes)
      throw Error("附件校验失败");
  }
  return manifest;
}
async function restoreFiles(dir: string, manifest: any) {
  await incrementalMigrations(owner);
  const old = Buffer.from(manifest.master, "hex");
  await mkdir(`${data}/blobs`, { recursive: true });
  for (const a of manifest.blobs) {
    const original = unseal(await readFile(`${dir}/blobs/${a.id}`), old);
    await writeFile(`${data}/blobs/${a.id}.restore`, seal(original), {
      mode: 0o600,
    });
    await rename(`${data}/blobs/${a.id}.restore`, `${data}/blobs/${a.id}`);
  }
  for (const [table, id, column] of [
    ["providers", "id", "key_cipher"],
    ["wa_auth", null, "value"],
    ["users", "id", "mfa_secret"],
    ["users", "id", "mfa_pending"],
  ]) {
    const rows = (
      await owner.query(`SELECT * FROM ${table} WHERE ${column} IS NOT NULL`)
    ).rows;
    for (const row of rows) {
      const value = seal(
        unseal(Buffer.from(row[column], "base64"), old),
      ).toString("base64");
      if (table === "wa_auth")
        await owner.query(
          "UPDATE wa_auth SET value=$3 WHERE account_id=$1 AND key=$2",
          [row.account_id, row.key, value],
        );
      else
        await owner.query(`UPDATE ${table} SET ${column}=$2 WHERE ${id}=$1`, [
          row[id],
          value,
        ]);
    }
  }
  for (const row of (await owner.query("SELECT * FROM legacy_records")).rows) {
    const value = seal(
      unseal(Buffer.from(row.payload_cipher, "base64"), old),
    ).toString("base64");
    await owner.query(
      "UPDATE legacy_records SET payload_cipher=$4 WHERE source_hash=$1 AND type=$2 AND legacy_id=$3",
      [row.source_hash, row.type, row.legacy_id, value],
    );
  }
  await owner.query(
    "DELETE FROM sessions;DELETE FROM reset_tokens;UPDATE accounts SET enabled=false,auto_reply=false,status='disconnected',qr=NULL,lease_owner=NULL,lease_until=NULL,generation=generation+1;UPDATE conversations SET mode='PAUSED',revision=revision+1;UPDATE settings SET value=jsonb_set(value,'{globalAuto}','false'),revision=revision+1;UPDATE personal_rules SET value=jsonb_set(value,'{globalAuto}','false'),revision=nextval('personal_rules_revision');UPDATE jobs SET status='cancelled' WHERE status IN('queued','running');UPDATE outbox SET status=CASE WHEN status='sending' THEN 'unknown' ELSE 'cancelled' END WHERE status IN('queued','sending')",
  );
  for (const [table, count] of Object.entries(manifest.counts)) {
    if (
      ![
        "users",
        "accounts",
        "conversations",
        "messages",
        "assets",
        "account_grants",
        "providers",
        "customer_insights",
        "personal_rules",
        "legacy_insights_archive",
      ].includes(table)
    )
      throw Error("备份计数表无效");
    if (
      (await owner.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]
        .count !== count
    )
      throw Error("恢复记录数校验失败");
  }
}
async function processRequest(name: string) {
  const raw = JSON.parse(decryptText(await readFile(`${ops}/${name}`, "utf8"))),
    id = raw.id;
  await rename(`${ops}/${name}`, `${ops}/${id}.running`);
  await writeFile(
    `${ops}/${id}.result`,
    JSON.stringify({
      id,
      kind: raw.kind,
      status: "running",
      at: new Date().toISOString(),
    }),
  );
  const temp = await mkdtemp(join(tmpdir(), "smarchat-backup-"));
  let locked = false,
    maintenance = false,
    restoreStarted = false;
  const db = await owner.connect();
  try {
    let manifest: any;
    if (raw.kind === "restore")
      manifest = await validate(
        `${ops}/${raw.input}`,
        raw.password,
        `${temp}/incoming`,
      );
    await db.query("UPDATE maintenance SET active=true WHERE id=1");
    maintenance = true;
    // Wait for the already-admitted platform sends before acquiring the global snapshot barrier.
    for (let n = 0; n < 60; n++) {
      if (
        !(await db.query("SELECT 1 FROM outbox WHERE status='sending' LIMIT 1"))
          .rowCount
      )
        break;
      if (n === 59) throw Error("仍有发送中的消息，备份未开始，请稍后重试");
      await new Promise((r) => setTimeout(r, 1000));
    }
    await db.query("SELECT pg_advisory_lock(7811494)");
    locked = true;
    const counts = await snapshot(`${temp}/before`);
    const target =
      raw.kind === "restore"
        ? `${backups}/before-restore-${id}.scbackup`
        : `${backups}/${id}.scbackup`;
    await pack(`${temp}/before`, target, raw.password);
    if (raw.kind === "restore") {
      restoreStarted = true;
      await exec(
        "pg_restore",
        [
          "--clean",
          "--if-exists",
          "--single-transaction",
          "--exit-on-error",
          "-d",
          pgEnv.PGDATABASE,
          `${temp}/incoming/database.dump`,
        ],
        { env: pgEnv, timeout: 120000, maxBuffer: 1000000 },
      );
      await restoreFiles(`${temp}/incoming`, manifest);
    }
    await db.query(
      "INSERT INTO audit_events(workspace_id,action,resource,details) VALUES($1,$2,$3,$4)",
      [
        workspace,
        raw.kind === "restore" ? "backup.restored" : "backup.created",
        id,
        JSON.stringify({ counts }),
      ],
    );
    await writeFile(
      `${ops}/${id}.result`,
      JSON.stringify({
        id,
        kind: raw.kind,
        status: "done",
        counts,
        at: new Date().toISOString(),
      }),
    );
  } catch (error) {
    let rollback = "";
    if (restoreStarted)
      try {
        await exec(
          "pg_restore",
          [
            "--clean",
            "--if-exists",
            "--single-transaction",
            "--exit-on-error",
            "-d",
            pgEnv.PGDATABASE,
            `${temp}/before/database.dump`,
          ],
          { env: pgEnv, timeout: 120000, maxBuffer: 1000000 },
        );
        const m = JSON.parse(
          await readFile(`${temp}/before/manifest.json`, "utf8"),
        );
        await restoreFiles(`${temp}/before`, m);
        rollback = "；已恢复至操作前快照";
      } catch {
        rollback = "；自动回退失败，系统保持维护状态";
        maintenance = false;
      }
    await writeFile(
      `${ops}/${id}.result`,
      JSON.stringify({
        id,
        kind: raw.kind,
        status: "failed",
        error:
          (error instanceof Error ? error.message : "备份恢复失败").slice(
            0,
            200,
          ) + rollback,
        at: new Date().toISOString(),
      }),
    );
  } finally {
    if (maintenance)
      await db.query("UPDATE maintenance SET active=false WHERE id=1");
    if (locked) await db.query("SELECT pg_advisory_unlock(7811494)");
    db.release();
    await rm(`${ops}/${id}.running`, { force: true });
    if (raw.input) await rm(`${ops}/${raw.input}`, { force: true });
    await rm(temp, { recursive: true, force: true });
  }
}
console.log("SmarChat backup service ready");
for (const f of (await readdir(ops)).filter((x) => x.endsWith(".running"))) {
  const id = f.slice(0, -8);
  await writeFile(
    `${ops}/${id}.result`,
    JSON.stringify({
      id,
      status: "failed",
      error: "维护进程中断，请按恢复手册核对后退出维护模式",
      at: new Date().toISOString(),
    }),
  );
}
let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    for (const f of (await readdir(ops)).filter((x) => x.endsWith(".request")))
      await processRequest(f);
  } catch {
    console.error("Backup service request failed");
  } finally {
    busy = false;
  }
}, 2000);
