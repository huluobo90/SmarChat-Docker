-- Password-only authentication, explicitly requested for every team role.
-- Keep legacy columns so older backups can still be restored and upgraded.
UPDATE users SET mfa_enabled=false,mfa_secret=NULL,mfa_pending=NULL,mfa_step=-1,recovery_hashes='[]';
INSERT INTO audit_events(workspace_id,action,details)
SELECT id,'auth.password_only','{"schema":5}'::jsonb FROM workspaces;
INSERT INTO schema_versions(version) VALUES(5);
