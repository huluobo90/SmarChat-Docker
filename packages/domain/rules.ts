/** All reply paths use the current account owner's private rules. */
export async function accountRules(db: any, accountId: string) {
  const row = (
    await db.query(
      "SELECT r.* FROM personal_rules r JOIN accounts a ON a.owner_id=r.user_id AND a.workspace_id=r.workspace_id WHERE a.id=$1",
      [accountId],
    )
  ).rows[0];
  if (!row) throw Error("接入尚未分配负责人或负责人规则不存在");
  return row;
}
