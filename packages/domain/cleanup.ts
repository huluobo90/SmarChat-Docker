import { unlink } from "node:fs/promises";
import { dataDir } from "./assets";
import { tx, service } from "../database/db";
export async function cleanupDeletedBlobs(actor: any = service) {
  return tx(actor, async (db) => {
    const rows = (
      await db.query(
        "SELECT asset_id FROM blob_deletions ORDER BY created_at LIMIT 500 FOR UPDATE SKIP LOCKED",
      )
    ).rows;
    for (const row of rows) {
      if (
        (await db.query("SELECT 1 FROM assets WHERE id=$1", [row.asset_id]))
          .rowCount
      )
        continue;
      try {
        await unlink(`${dataDir}/blobs/${row.asset_id}`);
      } catch (e: any) {
        if (e.code !== "ENOENT") continue;
      }
      await db.query("DELETE FROM blob_deletions WHERE asset_id=$1", [
        row.asset_id,
      ]);
    }
    return Number(
      (await db.query("SELECT count(*) FROM blob_deletions")).rows[0].count,
    );
  });
}
