import { readFile } from "node:fs/promises";
export const latestSchema = 9;
export async function incrementalMigrations(db: any) {
  for (const [version, file] of [
    [2, "002-collaboration.sql"],
    [3, "003-imports.sql"],
    [4, "004-operations.sql"],
    [5, "005-password-only.sql"],
    [6, "006-team.sql"],
    [7, "007-inactive-reports.sql"],
    [8, "008-member-rules.sql"],
    [9, "009-provider-rules.sql"],
  ] as const) {
    if (
      !(
        await db.query("SELECT 1 FROM schema_versions WHERE version=$1", [
          version,
        ])
      ).rowCount
    )
      await db.query(await readFile(new URL(file, import.meta.url), "utf8"));
  }
}
