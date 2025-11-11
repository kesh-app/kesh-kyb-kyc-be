CREATE TABLE IF NOT EXISTS persons (
  id BIGSERIAL PRIMARY KEY,
  nik TEXT,
  full_name TEXT NOT NULL,
  name_norm TEXT,
  dob DATE,
  pob TEXT,
  gender TEXT CHECK (gender IN ('M','F','O')),
  nationality TEXT,
  phone TEXT,
  email TEXT,
  address_line TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  pep_self_declared BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_entities (
  id BIGSERIAL PRIMARY KEY,
  nib TEXT,
  npwp TEXT,
  legal_name TEXT NOT NULL,
  trade_name TEXT,
  name_norm TEXT,
  industry_code TEXT,
  incorporation_date DATE,
  country TEXT,
  address_line TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_roles (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT REFERENCES business_entities(id) ON DELETE CASCADE,
  person_id BIGINT REFERENCES persons(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('BO','DIRECTOR','COMMISSIONER')) NOT NULL,
  ownership_pct NUMERIC(5,2)
);
CREATE INDEX IF NOT EXISTS idx_business_roles_business ON business_roles(business_id);

CREATE TABLE IF NOT EXISTS applications (
  id BIGSERIAL PRIMARY KEY,
  type TEXT CHECK (type IN ('INDIVIDUAL','BUSINESS')) NOT NULL,
  status TEXT CHECK (status IN ('DRAFT','SUBMITTED','IN_REVIEW','ESCALATED','APPROVED','REJECTED')) NOT NULL DEFAULT 'DRAFT',
  branch_id BIGINT REFERENCES branches(id),
  created_by BIGINT REFERENCES users(id),
  reviewer_id BIGINT REFERENCES users(id),
  decision_by BIGINT REFERENCES users(id),
  person_id BIGINT REFERENCES persons(id),
  business_id BIGINT REFERENCES business_entities(id),
  decision_reason TEXT,
  submitted_at TIMESTAMPTZ,
  decision_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_branch ON applications(branch_id);

CREATE TABLE IF NOT EXISTS documents (
  id BIGSERIAL PRIMARY KEY,
  application_id BIGINT REFERENCES applications(id) ON DELETE CASCADE,
  doc_type TEXT,
  file_uri TEXT NOT NULL,
  status TEXT CHECK (status IN ('PENDING','VERIFIED','REJECTED')) DEFAULT 'PENDING',
  extracted_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_app ON documents(application_id);

CREATE TABLE IF NOT EXISTS watchlist_sources (
  id BIGSERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  list_type TEXT CHECK (list_type IN ('PEP','DTTOT','MIXED')) NOT NULL,
  version_date DATE NOT NULL,
  file_name TEXT,
  checksum TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist_entries (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT REFERENCES watchlist_sources(id) ON DELETE CASCADE,
  list_type TEXT CHECK (list_type IN ('PEP','DTTOT')) NOT NULL,
  full_name TEXT NOT NULL,
  name_norm TEXT,
  aliases TEXT[],
  dob DATE,
  nationality TEXT,
  position TEXT,
  organization TEXT,
  identifiers JSONB,
  status TEXT DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT now()
);


ALTER TABLE watchlist_entries
  ADD COLUMN IF NOT EXISTS aliases_concat TEXT;


UPDATE watchlist_entries
SET aliases_concat = array_to_string(aliases, ' ')
WHERE aliases_concat IS NULL;


CREATE OR REPLACE FUNCTION set_aliases_concat() RETURNS trigger AS $$
BEGIN
  NEW.aliases_concat = array_to_string(NEW.aliases, ' ');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


DROP TRIGGER IF EXISTS trg_set_aliases_concat ON watchlist_entries;
CREATE TRIGGER trg_set_aliases_concat
BEFORE INSERT OR UPDATE OF aliases ON watchlist_entries
FOR EACH ROW
EXECUTE FUNCTION set_aliases_concat();


CREATE INDEX IF NOT EXISTS idx_watchlist_aliases_trgm
  ON watchlist_entries USING gin (aliases_concat gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_watchlist_name_trgm ON watchlist_entries USING gin (name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_watchlist_type ON watchlist_entries(list_type);

CREATE TABLE IF NOT EXISTS screening_results (
  id BIGSERIAL PRIMARY KEY,
  application_id BIGINT REFERENCES applications(id) ON DELETE CASCADE,
  entity_ref TEXT CHECK (entity_ref IN ('PERSON','BUSINESS','BO')) NOT NULL,
  ref_id BIGINT NOT NULL,
  list_type TEXT CHECK (list_type IN ('PEP','DTTOT')) NOT NULL,
  match_method TEXT CHECK (match_method IN ('EXACT','TRIGRAM','TOKEN')),
  match_score NUMERIC(5,2),
  hit_entry_id BIGINT REFERENCES watchlist_entries(id),
  decision TEXT CHECK (decision IN ('CONFIRMED','NO_HIT','UNSURE')) DEFAULT 'UNSURE',
  decided_by BIGINT REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_screening_app ON screening_results(application_id);

CREATE TABLE IF NOT EXISTS risk_profiles (
  id BIGSERIAL PRIMARY KEY,
  application_id BIGINT UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
  score_total NUMERIC(5,2) DEFAULT 0,
  risk_level TEXT CHECK (risk_level IN ('LOW','MEDIUM','HIGH','PROHIBITED')) DEFAULT 'LOW',
  factors JSONB,
  version TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  job_type TEXT CHECK (job_type IN ('WATCHLIST_IMPORT','APPLICATION_SCREEN','RESCREEN')) NOT NULL,
  status TEXT CHECK (status IN ('QUEUED','RUNNING','DONE','FAILED')) DEFAULT 'QUEUED',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  summary_json JSONB
);
