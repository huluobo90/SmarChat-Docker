CREATE TABLE conversation_views(conversation_id uuid NOT NULL REFERENCES conversations,user_id uuid NOT NULL REFERENCES users,seen_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(conversation_id,user_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON conversation_views TO smarchat_api,smarchat_worker;
ALTER TABLE conversation_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY views_scope ON conversation_views TO smarchat_api USING(EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_views.conversation_id)) WITH CHECK(user_id=app_user() AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_views.conversation_id));
INSERT INTO schema_versions(version) VALUES(2);
