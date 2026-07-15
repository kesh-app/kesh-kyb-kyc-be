-- 0048_application_revision_required_status.sql
-- Add REVISION_REQUIRED status to KYC/KYB application flow.
--
-- When OperationSupervisor (LOW/MEDIUM) or ComplianceLead (HIGH) decides NOT to
-- approve, the application is returned to FrontDesk for data correction.
-- Status becomes REVISION_REQUIRED instead of REJECTED.
-- FrontDesk can then edit CDD data, update documents, and resubmit.
-- Resubmit transitions status back to SUBMITTED (or IN_REVIEW for HIGH risk).
--
-- REJECTED remains valid in the constraint for historical data; it is no longer
-- set by the decision endpoint (which now maps REJECTED action → REVISION_REQUIRED).
--
-- Changes:
--   1. Expand applications.status CHECK constraint to include REVISION_REQUIRED.
--   2. Add revision tracking columns: revision_reason, revision_requested_by,
--      revision_requested_at — populated when status = REVISION_REQUIRED.

-- 1. Replace the status CHECK constraint (drop-and-recreate is the safe path
--    because PostgreSQL does not support ALTER CONSTRAINT for check constraints).
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE applications ADD CONSTRAINT applications_status_check
  CHECK (status IN (
    'DRAFT',
    'SUBMITTED',
    'IN_REVIEW',
    'ESCALATED',
    'APPROVED',
    'REJECTED',
    'REVISION_REQUIRED'
  ));

-- 2. Revision tracking columns (nullable; only set when status = REVISION_REQUIRED).
ALTER TABLE applications ADD COLUMN IF NOT EXISTS revision_reason       TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS revision_requested_by BIGINT REFERENCES users(id);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS revision_requested_at TIMESTAMPTZ;
