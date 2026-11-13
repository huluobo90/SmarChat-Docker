-- Two-tier, fixed team. Shared documents stay workspace-scoped.
CREATE TABLE team_state(workspace_id uuid PRIMARY KEY REFERENCES workspaces,initialized boolean NOT NULL DEFAULT false);
CREATE TABLE customer_insights(workspace_id uuid NOT NULL REFERENCES workspaces,conversation_id uuid NOT NULL REFERENCES conversations ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,analysis jsonb,summary jsonb,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(conversation_id,user_id));
CREATE INDEX insights_user ON customer_insights(user_id,updated_at DESC);
GRANT SELECT,INSERT,UPDATE,DELETE ON customer_insights TO smarchat_api,smarchat_worker;
ALTER TABLE customer_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY insights_private ON customer_insights TO smarchat_api USING(workspace_id=app_workspace() AND user_id=app_user() AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id)) WITH CHECK(workspace_id=app_workspace() AND user_id=app_user() AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id));
-- Legacy analyses have no reliable author; retain privately in an admin-only archive.
CREATE TABLE legacy_insights_archive(conversation_id uuid PRIMARY KEY REFERENCES conversations ON DELETE CASCADE,analysis jsonb,summary jsonb);
INSERT INTO legacy_insights_archive SELECT id,analysis,summary FROM conversations WHERE analysis IS NOT NULL OR summary IS NOT NULL;
GRANT SELECT,DELETE ON legacy_insights_archive TO smarchat_worker;
UPDATE conversations SET analysis=NULL,summary=NULL;
CREATE OR REPLACE FUNCTION app_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('app.role',true)='superadmin' $$;
DROP POLICY conversations_scope ON conversations;
CREATE POLICY conversations_scope ON conversations TO smarchat_api USING(workspace_id=app_workspace() AND (app_admin() OR (assignee_id=app_user() AND EXISTS(SELECT 1 FROM accounts a JOIN users u ON u.id=a.owner_id WHERE a.id=conversations.account_id AND a.owner_id=app_user() AND u.active))));
DROP POLICY jobs_scope ON jobs;
CREATE POLICY jobs_scope ON jobs TO smarchat_api USING(workspace_id=app_workspace() AND user_id=app_user() AND (conversation_id IS NULL OR EXISTS(SELECT 1 FROM conversations c WHERE c.id=jobs.conversation_id)));
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounts_scope ON accounts TO smarchat_api USING(workspace_id=app_workspace() AND (app_admin() OR owner_id=app_user())) WITH CHECK(workspace_id=app_workspace() AND app_admin());
CREATE TABLE blob_deletions(asset_id uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,UPDATE,DELETE ON blob_deletions TO smarchat_api,smarchat_worker;
ALTER TABLE blob_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY deletions_admin ON blob_deletions TO smarchat_api USING(app_admin());
ALTER TABLE audit_events ADD COLUMN actor_label text;
UPDATE audit_events e SET actor_label=u.username FROM users u WHERE u.id=e.user_id;
-- Cascade only from exclusive owner/conversation relationships, never shared-library ownership.
DO $$ DECLARE r record; action text; BEGIN
 FOR r IN SELECT c.conname,c.conrelid::regclass AS tbl,pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.contype='f' AND c.confrelid IN ('users'::regclass,'accounts'::regclass,'conversations'::regclass,'legacy_imports'::regclass,'assets'::regclass) LOOP
  action:=CASE WHEN r.tbl::text='audit_events' OR (r.tbl::text='conversations' AND r.def LIKE 'FOREIGN KEY (merged_into)%') OR r.def LIKE '%REFERENCES assets%' THEN 'SET NULL' ELSE 'CASCADE' END;
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',r.tbl,r.conname);
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s ON DELETE %s',r.tbl,r.conname,regexp_replace(r.def,' ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION|SET DEFAULT)',''),action);
 END LOOP;
END $$;
CREATE FUNCTION purge_member(target uuid,confirmation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE victim users; actor users; aids uuid[]; cids uuid[]; files uuid[]; refs text[]; result jsonb;
BEGIN
 SELECT * INTO actor FROM users WHERE id=app_user() AND active AND role='superadmin' AND username='Bison01';
 IF actor.id IS NULL THEN RAISE EXCEPTION '需要超级管理员权限' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(7811494);
 SELECT * INTO victim FROM users WHERE id=target AND workspace_id=actor.workspace_id FOR UPDATE;
 IF victim.id IS NULL THEN RAISE EXCEPTION '成员不存在' USING ERRCODE='P0002'; END IF;
 IF victim.role<>'member' OR victim.username !~ '^Bison0[2-7]$' OR victim.id=actor.id THEN RAISE EXCEPTION '不能删除超级管理员' USING ERRCODE='42501'; END IF;
 IF confirmation IS DISTINCT FROM victim.username THEN RAISE EXCEPTION '请输入完整成员账号确认删除' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(array_agg(id),'{}') INTO aids FROM accounts WHERE owner_id=target;
 SELECT COALESCE(array_agg(id),'{}') INTO cids FROM conversations WHERE assignee_id=target OR account_id=ANY(aids);
 IF EXISTS(SELECT 1 FROM outbox WHERE status='sending' AND (account_id=ANY(aids) OR conversation_id=ANY(cids) OR user_id=target)) THEN RAISE EXCEPTION '存在正在发送的消息，请稍后重试删除' USING ERRCODE='55006'; END IF;
 SELECT COALESCE(array_agg(id),'{}') INTO files FROM assets WHERE conversation_id=ANY(cids);
 SELECT COALESCE(array_agg(id::text),'{}') INTO refs FROM (SELECT unnest(aids) id UNION SELECT unnest(cids) UNION SELECT unnest(files) UNION SELECT id FROM jobs WHERE user_id=target OR conversation_id=ANY(cids) UNION SELECT id FROM outbox WHERE user_id=target OR conversation_id=ANY(cids)) allrefs;
 result:=jsonb_build_object('username',victim.username,'accounts',cardinality(aids),'customers',cardinality(cids),'files',cardinality(files),'messages',(SELECT count(*) FROM messages WHERE conversation_id=ANY(cids)));
 INSERT INTO blob_deletions SELECT unnest(files),now() ON CONFLICT DO NOTHING;
 DELETE FROM audit_events WHERE user_id=target OR resource=ANY(refs) OR details->>'conversation'=ANY(cids::text[]);
 DELETE FROM users WHERE id=target;
 INSERT INTO audit_events(workspace_id,user_id,actor_label,action,resource,details) VALUES(actor.workspace_id,actor.id,actor.username,'user.delete',victim.username,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION purge_member(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_member(uuid,text) TO smarchat_api;
REVOKE DELETE ON users FROM smarchat_api;
CREATE FUNCTION cancel_team_work(target uuid,by_account boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE w uuid;
BEGIN
 SELECT workspace_id INTO w FROM users WHERE id=app_user() AND role='superadmin' AND username='Bison01' AND active;
 IF w IS NULL THEN RAISE EXCEPTION '需要超级管理员权限' USING ERRCODE='42501'; END IF;
 UPDATE jobs SET status='cancelled',updated_at=now() WHERE workspace_id=w AND status IN('queued','running') AND
 ((NOT by_account AND user_id=target) OR conversation_id IN(SELECT c.id FROM conversations c JOIN accounts a ON a.id=c.account_id WHERE (by_account AND a.id=target) OR (NOT by_account AND (a.owner_id=target OR c.assignee_id=target))));
 UPDATE outbox SET status='cancelled',updated_at=now() WHERE workspace_id=w AND status='queued' AND
 ((NOT by_account AND user_id=target) OR account_id IN(SELECT id FROM accounts WHERE (by_account AND id=target) OR (NOT by_account AND owner_id=target)));
END $$;
REVOKE ALL ON FUNCTION cancel_team_work(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_team_work(uuid,boolean) TO smarchat_api;
INSERT INTO schema_versions(version) VALUES(6);
