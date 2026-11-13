import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tx, service } from "../../packages/database/db";
import { loadBlob, putAsset } from "../../packages/domain/assets";
const exec = promisify(execFile);
export async function extract(job: any) {
  const a = await tx(
    service,
    async (db) =>
      (
        await db.query("SELECT * FROM assets WHERE id=$1", [
          job.payload.assetId,
        ])
      ).rows[0],
  );
  if (!a) return;
  const bytes = await loadBlob(a);
  let text = "",
    preview: Buffer | null = null;
  const dir = await mkdtemp(join(tmpdir(), "smarchat-doc-"));
  try {
    if (a.mime === "text/plain") text = bytes.toString("utf8").slice(0, 200000);
    else if (a.mime === "application/pdf") {
      await writeFile(join(dir, "input.pdf"), bytes);
      await exec(
        "pdftotext",
        [
          "-f",
          "1",
          "-l",
          "200",
          "-layout",
          join(dir, "input.pdf"),
          join(dir, "text.txt"),
        ],
        { timeout: 20000, maxBuffer: 300000 },
      );
      text = (await readFile(join(dir, "text.txt"), "utf8")).slice(0, 200000);
    } else if (a.mime.includes("openxmlformats")) {
      const exchange = `/exchange/${randomUUID()}`;
      await mkdir(exchange, { mode: 0o700 });
      try {
        await writeFile(`${exchange}/input.zip`, bytes, { mode: 0o600 });
        await writeFile(`${exchange}/ready`, "");
        let result: any;
        for (let n = 0; n < 80; n++) {
          try {
            result = JSON.parse(
              await readFile(`${exchange}/result.json`, "utf8"),
            );
            break;
          } catch {}
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!result?.ok) throw Error(result?.error || "文件预览处理超时");
        text = (await readFile(`${exchange}/text.txt`, "utf8")).slice(
          0,
          200000,
        );
        preview = await readFile(`${exchange}/preview.pdf`);
      } finally {
        await rm(exchange, { recursive: true, force: true });
      }
    }
    await tx(service, async (db) => {
      if (
        !(await db.query("SELECT 1 FROM assets WHERE id=$1 FOR UPDATE", [a.id]))
          .rowCount
      )
        return;
      if (
        a.conversation_id &&
        !(
          await db.query(
            "SELECT 1 FROM jobs WHERE id=$1 AND status='running'",
            [job.id],
          )
        ).rowCount
      )
        return;
      let previewId = null;
      if (preview) {
        const p = await putAsset(
          db,
          a.workspace_id,
          a.conversation_id,
          `${a.name} · 文本预览.pdf`,
          "application/pdf",
          preview,
          a.folder_id,
        );
        previewId = p.id;
      }
      await db.query(
        "UPDATE assets SET extracted_text=$2,extraction_status=$3,preview_id=$4 WHERE id=$1",
        [a.id, text, text ? "ready" : "needs_text", previewId],
      );
    });
    return { status: text ? "ready" : "needs_text" };
  } catch (error) {
    await tx(service, async (db) => {
      await db.query(
        "UPDATE assets SET extraction_status='needs_text' WHERE id=$1",
        [a.id],
      );
    });
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
