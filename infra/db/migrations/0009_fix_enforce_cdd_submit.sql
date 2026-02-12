CREATE OR REPLACE FUNCTION enforce_cdd_minimum_before_submit() RETURNS trigger AS $$
DECLARE
  cnt INT;
BEGIN
  IF NEW.status = 'SUBMITTED' AND OLD.status <> 'SUBMITTED' THEN

    IF NEW.type = 'BUSINESS' THEN
      -- ✅ cukup salah satu role di business_parties
      IF NOT EXISTS (
        SELECT 1
        FROM business_parties
        WHERE business_id = NEW.business_id
          AND is_active = TRUE
          AND role IN ('DIRECTOR','COMMISSIONER','BO','AUTHORIZED_REP')
      ) THEN
        RAISE EXCEPTION 'Minimal isi salah satu: Pengurus (DIRECTOR/COMMISSIONER) atau BO atau Kuasa Bertindak';
      END IF;

      -- (lanjutkan validasi dokumen2 kamu di bawah ini seperti sebelumnya)
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
