CREATE SEQUENCE personal_rules_revision START 100000;
CREATE TABLE personal_rules(
 user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES workspaces,
 revision int NOT NULL DEFAULT nextval('personal_rules_revision'),
 value jsonb NOT NULL
);
INSERT INTO personal_rules(user_id,workspace_id,value) SELECT u.id,u.workspace_id,s.value FROM users u JOIN settings s ON s.workspace_id=u.workspace_id;
CREATE FUNCTION seed_personal_rules() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO personal_rules(user_id,workspace_id,value) SELECT NEW.id,NEW.workspace_id,value FROM settings WHERE workspace_id=NEW.workspace_id;
 RETURN NEW;
END $$;
CREATE TRIGGER users_personal_rules AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION seed_personal_rules();
ALTER TABLE personal_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_rules_read ON personal_rules FOR SELECT TO smarchat_api USING(workspace_id=app_workspace() AND (user_id=app_user() OR app_admin()));
CREATE POLICY personal_rules_write ON personal_rules FOR UPDATE TO smarchat_api USING(workspace_id=app_workspace() AND user_id=app_user()) WITH CHECK(workspace_id=app_workspace() AND user_id=app_user());
GRANT SELECT,UPDATE ON personal_rules TO smarchat_api;
GRANT SELECT,UPDATE,DELETE ON personal_rules TO smarchat_worker;
GRANT USAGE,SELECT ON SEQUENCE personal_rules_revision TO smarchat_api,smarchat_worker;
INSERT INTO schema_versions(version) VALUES(8);
