import { mkdir, writeFile, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { seal, unseal, digest } from "../security/crypto";
export const dataDir = process.env.DATA_DIR || "/data";
export async function saveBlob(id: string, data: Buffer) {
  await mkdir(`${dataDir}/blobs`, { recursive: true });
  const tmp = `${dataDir}/blobs/${id}.${randomUUID()}.tmp`;
  await writeFile(tmp, seal(data), { mode: 0o600 });
  await rename(tmp, `${dataDir}/blobs/${id}`);
}
export async function loadBlob(asset: any) {
  const b = unseal(await readFile(`${dataDir}/blobs/${asset.id}`));
  if (digest(b) !== asset.hash) throw Error("文件校验失败");
  return b;
}
export async function putAsset(
  db: any,
  workspace: string,
  conversationId: string | null,
  name: string,
  mime: string,
  bytes: Buffer,
  folderId: string | null = null,
) {
  const id = randomUUID();
  await saveBlob(id, bytes);
  const row = (
    await db.query(
      "INSERT INTO assets(id,workspace_id,conversation_id,folder_id,name,mime,bytes,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        id,
        workspace,
        conversationId,
        folderId,
        name.slice(0, 180),
        mime,
        bytes.length,
        digest(bytes),
      ],
    )
  ).rows[0];
  return row;
}
export const mimeFor = (name: string) => {
  const ext = name.toLowerCase().split(".").pop();
  return (
    (
      {
        pdf: "application/pdf",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif",
        txt: "text/plain",
        csv: "text/plain",
        md: "text/plain",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      } as any
    )[ext || ""] || "application/octet-stream"
  );
};
