-- 0031_monitoring_alert_info.sql
-- Add alert information columns to monitoring_case_triggers for AML alert matrix.

ALTER TABLE monitoring_case_triggers
  ADD COLUMN IF NOT EXISTS alert_code        VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS alert_name        VARCHAR(200) NULL,
  ADD COLUMN IF NOT EXISTS alert_information JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_monitoring_case_triggers_alert_code
  ON monitoring_case_triggers(alert_code);
