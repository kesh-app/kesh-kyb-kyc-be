-- role untuk orang di entitas bisnis
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'business_party_role') THEN
    CREATE TYPE business_party_role AS ENUM ('DIRECTOR','COMMISSIONER','MANAGER','BO','AUTHORIZED_REP');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS business_parties (
  id              BIGSERIAL PRIMARY KEY,
  business_id     BIGINT NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
  person_id       BIGINT NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  role            business_party_role NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- satu orang tidak boleh terduplikasi dgn role yg sama di business yg sama
CREATE UNIQUE INDEX IF NOT EXISTS ux_business_parties_business_person_role
  ON business_parties(business_id, person_id, role);

-- bantu query
CREATE INDEX IF NOT EXISTS idx_business_parties_business ON business_parties(business_id);
CREATE INDEX IF NOT EXISTS idx_business_parties_person   ON business_parties(person_id);

-- Optional: minimal 1 authorized_rep, 1 pengurus (director OR commissioner), dan 1 BO saat SUBMIT
-- (Jika trigger CDD kamu belum cek ini, bisa tambahkan validasi di layer service juga)