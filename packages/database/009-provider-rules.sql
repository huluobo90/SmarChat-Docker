-- Provider credentials are company-managed; changes invalidate dependent personal replies.
CREATE FUNCTION invalidate_provider_rules() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.key_cipher IS DISTINCT FROM OLD.key_cipher OR NEW.model IS DISTINCT FROM OLD.model OR NEW.base_url IS DISTINCT FROM OLD.base_url THEN
  UPDATE personal_rules SET revision=nextval('personal_rules_revision') WHERE workspace_id=NEW.workspace_id AND value->>'providerId'=NEW.id::text;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provider_rules_changed AFTER UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION invalidate_provider_rules();
INSERT INTO schema_versions(version) VALUES(9);
