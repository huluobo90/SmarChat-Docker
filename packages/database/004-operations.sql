CREATE INDEX IF NOT EXISTS assets_preview_parent ON assets(preview_id) WHERE preview_id IS NOT NULL;
CREATE POLICY login_failure_audit ON audit_events FOR INSERT TO smarchat_api WITH CHECK(workspace_id=app_workspace() AND user_id IS NULL AND action='login.failed');
ALTER ROLE smarchat_api SET jit=off;
INSERT INTO schema_versions(version) VALUES(4);
