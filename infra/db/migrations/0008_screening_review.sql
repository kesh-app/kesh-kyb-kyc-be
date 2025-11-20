-- 0008_screening_review.sql

-- 1) Status review untuk screening_results
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'screen_review_status') THEN
    CREATE TYPE screen_review_status AS ENUM ('OPEN','CONFIRMED','FALSE_POSITIVE','DISMISSED');
  END IF;
END$$;

ALTER TABLE screening_results
  ADD COLUMN IF NOT EXISTS review_status screen_review_status DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS review_notes TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by BIGINT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_screening_results_review
  ON screening_results (application_id, review_status);

-- 2) Override risk di application_risk
ALTER TABLE application_risk
  ADD COLUMN IF NOT EXISTS override_level TEXT,   -- LOW / MEDIUM / HIGH
  ADD COLUMN IF NOT EXISTS override_reason TEXT,
  ADD COLUMN IF NOT EXISTS override_by BIGINT,
  ADD COLUMN IF NOT EXISTS override_at TIMESTAMPTZ;
