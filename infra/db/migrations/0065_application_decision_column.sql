-- 0065_application_decision_column.sql
-- Record WHICH decision a reviewer took, separately from the resulting status.
--
-- Until now the only evidence of a decision was the resulting status plus which
-- reason column got filled. That was lossy: between migration 0048 and commit
-- 840ec94 (2026-08-10) the decision endpoint collapsed BOTH the "Tolak" and
-- "Kembalikan untuk Revisi" actions into a single branch that wrote
-- status='REVISION_REQUIRED' + revision_reason. Rejections from that window are
-- therefore indistinguishable from genuine revision requests — they show up in
-- the UI as "Perlu Perbaikan" even though Compliance rejected them, and no
-- column, audit_logs entry, or timestamp survives to tell them apart.
--
-- This column closes the gap going forward so the same ambiguity cannot recur,
-- and gives the repair in step 3 something to key on.

-- 1. The column. Nullable on purpose: rows decided before this migration have
--    no recorded action, and NULL is the honest value for "unknown", far better
--    than guessing one.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS decision TEXT;

ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_decision_check;
ALTER TABLE applications ADD CONSTRAINT applications_decision_check
  CHECK (decision IS NULL OR decision IN ('APPROVED', 'REJECTED', 'RETURN_FOR_REVISION'));

-- 2. Backfill only where the action is unambiguous from the status alone.
--    APPROVED and REJECTED statuses can only ever have come from their matching
--    action, so those are safe.
UPDATE applications SET decision = 'APPROVED'
  WHERE status = 'APPROVED' AND decision IS NULL;

UPDATE applications SET decision = 'REJECTED'
  WHERE status = 'REJECTED' AND decision IS NULL;

--    REVISION_REQUIRED is deliberately NOT backfilled. It is exactly the
--    ambiguous case: some of those rows are rejections from the 0048-era bug,
--    the rest are genuine revision requests, and nothing in the schema
--    distinguishes them. Writing 'RETURN_FOR_REVISION' across the board would
--    fabricate an audit trail; leaving NULL correctly reads as "unknown".

-- 3. Repair rows whose status contradicts the recorded decision. This is a
--    no-op today (no historical row carries decision='REJECTED' with a
--    REVISION_REQUIRED status, because the decision column did not exist when
--    those rows were written) but it is idempotent and makes the invariant
--    explicit: a REJECTED decision must leave the application REJECTED.
UPDATE applications
   SET status = 'REJECTED', updated_at = now()
 WHERE decision = 'REJECTED'
   AND status = 'REVISION_REQUIRED';

-- Rows with decision='RETURN_FOR_REVISION' are never touched.

CREATE INDEX IF NOT EXISTS idx_applications_decision ON applications(decision);
