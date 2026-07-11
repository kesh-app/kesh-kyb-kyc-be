-- 0032_disable_rba_occupation_geography.sql
-- Remove RBA occupation/geography factors from existing application_risk records
-- and recompute risk_score/risk_level based on remaining watchlist-only factors.
-- Non-overridden rows only; manual overrides (override_level IS NOT NULL) are preserved.

WITH cleanup AS (
  SELECT
    application_risk.application_id,
    COALESCE((
      SELECT jsonb_agg(f)
      FROM jsonb_array_elements(COALESCE(application_risk.risk_factors, '[]'::jsonb)) AS f
      WHERE f->>'code' NOT IN (
        'INDIVIDUAL_OCCUPATION_HIGH_RBA',
        'INDIVIDUAL_OCCUPATION_MEDIUM_RBA',
        'INDIVIDUAL_OCCUPATION_LOW_RBA',
        'GEOGRAPHY_HIGH_RBA',
        'GEOGRAPHY_MEDIUM_RBA',
        'GEOGRAPHY_LOW_RBA'
      )
    ), '[]'::jsonb) AS clean_factors
  FROM application_risk
  WHERE application_risk.override_level IS NULL
),
scored AS (
  SELECT
    c.application_id,
    c.clean_factors,
    LEAST(100, GREATEST(0, COALESCE((
      SELECT SUM((f->>'score')::numeric)
      FROM jsonb_array_elements(c.clean_factors) AS f
      WHERE (f->>'score') IS NOT NULL
    ), 0)))::int AS new_score,
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(c.clean_factors) AS f
      WHERE f->>'code' IN (
        'WATCHLIST_PEP_CONFIRMED',
        'WATCHLIST_PEP_CANDIDATE',
        'INDIVIDUAL_PEP_SELF_DECLARED'
      )
    ) AS has_pep
  FROM cleanup c
)
UPDATE application_risk
SET
  risk_factors = s.clean_factors,
  risk_score   = s.new_score,
  risk_level   = CASE
                   WHEN s.has_pep OR s.new_score >= 70 THEN 'HIGH'
                   WHEN s.new_score >= 40               THEN 'MEDIUM'
                   ELSE                                      'LOW'
                 END
FROM scored s
WHERE application_risk.application_id = s.application_id;
