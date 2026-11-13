import { phoneCountries } from "./phone-country";
import { fail } from "../database/db";
export async function privateConversation(db: any, actor: any, c: any) {
  const insight = (
    await db.query(
      "SELECT analysis,summary FROM customer_insights WHERE conversation_id=$1 AND user_id=$2",
      [c.id, actor.id],
    )
  ).rows[0];
  return {
    ...(await phoneCountries(db, [c]))[0],
    analysis: insight?.analysis || null,
    summary: insight?.summary || null,
  };
}
export async function saveInsight(
  db: any,
  job: any,
  c: any,
  field: "analysis" | "summary",
  value: any,
) {
  const valid = await db.query(
    "SELECT 1 FROM jobs j JOIN users u ON u.id=j.user_id JOIN conversations c ON c.id=j.conversation_id JOIN accounts a ON a.id=c.account_id WHERE j.id=$1 AND j.status='running' AND u.active AND c.deleted_at IS NULL AND c.revision=j.revision AND (u.role='superadmin' OR (c.assignee_id=u.id AND a.owner_id=u.id)) FOR UPDATE OF j,c",
    [job.id],
  );
  if (!valid.rowCount) fail(409, "任务已取消或客户权限已变更");
  await db.query(
    `INSERT INTO customer_insights(workspace_id,conversation_id,user_id,${field}) VALUES($1,$2,$3,$4) ON CONFLICT(conversation_id,user_id) DO UPDATE SET ${field}=excluded.${field},updated_at=now()`,
    [c.workspace_id, c.id, job.user_id, JSON.stringify(value)],
  );
}
