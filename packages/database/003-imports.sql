CREATE TABLE legacy_imports(source_hash text PRIMARY KEY,account_id uuid NOT NULL REFERENCES accounts,created_at timestamptz NOT NULL DEFAULT now(),counts jsonb NOT NULL);
CREATE TABLE legacy_records(source_hash text NOT NULL REFERENCES legacy_imports,type text NOT NULL,legacy_id text NOT NULL,payload_cipher text NOT NULL,PRIMARY KEY(source_hash,type,legacy_id));
GRANT SELECT,INSERT,UPDATE ON legacy_imports,legacy_records TO smarchat_worker;
INSERT INTO schema_versions(version) VALUES(3);
