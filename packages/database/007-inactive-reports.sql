-- Only the authorized superadmin report route sets this transaction-local flag.
-- A disabled member cannot authenticate; their retained data remains readable to the superadmin.
DROP POLICY conversations_scope ON conversations;
CREATE POLICY conversations_scope ON conversations TO smarchat_api USING(
 workspace_id=app_workspace() AND (app_admin() OR (
  assignee_id=app_user() AND EXISTS(
   SELECT 1 FROM accounts a JOIN users u ON u.id=a.owner_id
   WHERE a.id=conversations.account_id AND a.owner_id=app_user()
     AND (u.active OR current_setting('app.readonly_report',true)='1')
  )
 ))
);
INSERT INTO schema_versions(version) VALUES(7);
