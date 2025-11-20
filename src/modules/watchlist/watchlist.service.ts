import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { createHash } from 'crypto';

type IngestRow = {
  list_type: 'PEP'|'DTTOT'|'PPPSPM';
  list_source: string;
  unique_id?: string | null;
  full_name?: string | null;
  alias_name?: string[] | null;
  gender?: string | null;
  date_of_birth?: string | null; // YYYY-MM-DD
  place_of_birth?: string | null;
  nationality?: string | null;
  national_id_number?: string | null;
  tax_identification_number?: string | null;
  position_title?: string | null;
  institution_name?: string | null;
  pep_type?: string | null;
  status?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  entity_name?: string | null;
  registration_number?: string | null;
  legal_form?: string | null;
  country_of_registration?: string | null;
  associated_individuals?: string[] | null;
  associated_entities?: string[] | null;
  relationship_type?: string | null;
  sanction_number?: string | null;
  inclusion_date?: string | null;
  removal_date?: string | null;
  list_updated_date?: string | null;
  source_url?: string | null;
  remarks?: string | null;
};

@Injectable()
export class WatchlistService {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  /** Normalize (upper + trim + collapse spaces) */
  norm(v?: string | null) {
    if (!v) return null;
    return v.normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  buildNaturalKey(r: IngestRow) {
    const key = [
      r.list_type || '',
      this.norm(r.list_source) || '',
      this.norm(r.full_name) || this.norm(r.entity_name) || '',
      r.date_of_birth || '',
    ].join('|');
    return createHash('sha1').update(key).digest('hex'); // 40-char
  }

  parseAliases(v?: string | null): string[] | null {
    if (!v) return null;
    const arr = v.split(/[;,|]/).map(s => s.trim()).filter(Boolean);
    return arr.length ? arr : null;
  }

  parseAssociated(v?: string | null): string[] | null {
    return this.parseAliases(v);
  }

  /** Map satu row XLSX ke IngestRow sesuai header template */
  mapRow(raw: any, list_type: IngestRow['list_type'], list_source: string): IngestRow {
    // header dari dokumen kamu:
    // PEP: Full_Name, Alias_Name, Gender, Date_of_Birth, Place_of_Birth, Nationality, National_ID_Number, Tax_Identification_Number, Position_Title, Institution_Name, PEP_Type, Status, Address, City, Country, Source_of_List, List_Updated_Date, Unique_ID, Remarks
    // DTTOT/PPPSPM: Full_Name, Alias_Name, Gender, Date_of_Birth, Place_of_Birth, Nationality, Passport_Number, National_ID_Number, Tax_Identification_Number, Entity_Name, Registration_Number, Legal_Form, Country_of_Registration, Associated_Individuals, Associated_Entities, Relationship_Type, List_Type, List_Source, Sanction_Number, Inclusion_Date, Removal_Date, Status, Address, City, Country, Source_URL, List_Updated_Date, Remarks

    const r: IngestRow = {
      list_type,
      list_source,
      unique_id: raw.Unique_ID || raw.UniqueId || raw.UNIQUE_ID || null,
      full_name: raw.Full_Name || null,
      alias_name: this.parseAliases(raw.Alias_Name || null),
      gender: raw.Gender || null,
      date_of_birth: raw.Date_of_Birth || null,
      place_of_birth: raw.Place_of_Birth || null,
      nationality: raw.Nationality || null,
      national_id_number: raw.National_ID_Number || null,
      tax_identification_number: raw.Tax_Identification_Number || null,
      position_title: raw.Position_Title || null,
      institution_name: raw.Institution_Name || null,
      pep_type: raw.PEP_Type || null,
      status: raw.Status || null,
      address: raw.Address || null,
      city: raw.City || null,
      country: raw.Country || null,
      entity_name: raw.Entity_Name || null,
      registration_number: raw.Registration_Number || null,
      legal_form: raw.Legal_Form || null,
      country_of_registration: raw.Country_of_Registration || null,
      associated_individuals: this.parseAssociated(raw.Associated_Individuals || null),
      associated_entities: this.parseAssociated(raw.Associated_Entities || null),
      relationship_type: raw.Relationship_Type || null,
      sanction_number: raw.Sanction_Number || null,
      inclusion_date: raw.Inclusion_Date || null,
      removal_date: raw.Removal_Date || null,
      list_updated_date: raw.List_Updated_Date || null,
      source_url: raw.Source_URL || null,
      remarks: raw.Remarks || raw.Notes || null,
    };
    return r;
  }

  /** Parse Excel/CSV buffer → rows */
  parseWorkbook(buf: Buffer, list_type: IngestRow['list_type'], list_source: string) {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, raw: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    return (rows as any[]).map(r => this.mapRow(r, list_type, list_source));
  }

  /** Upsert satu row ke DB */
  async upsertRow(r: IngestRow) {
    // normalisasi
    const name_norm = this.norm(r.full_name || r.entity_name || '');
    const aliases = r.alias_name || null;
    const aliases_concat = aliases ? aliases.join(' ') : null;
    const natural_key = this.buildNaturalKey(r);

    // jika overwrite 'replace' & ada unique_id, optional: tandai existing row (bisa ditambahkan nanti)
    // upsert by unique_id (jika ada), else by natural_key
    const text = `
      INSERT INTO watchlist_entries
      (list_type, list_source, unique_id, natural_key,
       name, name_norm, aliases, aliases_concat, gender, date_of_birth, place_of_birth, nationality,
       national_id_number, tax_identification_number, position_title, institution_name, pep_type, status,
       address, city, country, entity_name, registration_number, legal_form, country_of_registration,
       associated_individuals, associated_entities, relationship_type, sanction_number, inclusion_date,
       removal_date, list_updated_date, source_url, remarks, updated_at)
      VALUES
      ($1,$2,$3,$4,
       $5,$6,$7,$8,$9,$10,$11,$12,
       $13,$14,$15,$16,$17,$18,
       $19,$20,$21,$22,$23,$24,$25,
       $26,$27,$28,$29,$30,
       $31,$32,$33,$34, now())
      ON CONFLICT (unique_id) WHERE $3 IS NOT NULL DO UPDATE SET
        list_type = EXCLUDED.list_type,
        list_source = EXCLUDED.list_source,
        name = EXCLUDED.name,
        name_norm = EXCLUDED.name_norm,
        aliases = EXCLUDED.aliases,
        aliases_concat = EXCLUDED.aliases_concat,
        gender = EXCLUDED.gender,
        date_of_birth = EXCLUDED.date_of_birth,
        place_of_birth = EXCLUDED.place_of_birth,
        nationality = EXCLUDED.nationality,
        national_id_number = EXCLUDED.national_id_number,
        tax_identification_number = EXCLUDED.tax_identification_number,
        position_title = EXCLUDED.position_title,
        institution_name = EXCLUDED.institution_name,
        pep_type = EXCLUDED.pep_type,
        status = EXCLUDED.status,
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        country = EXCLUDED.country,
        entity_name = EXCLUDED.entity_name,
        registration_number = EXCLUDED.registration_number,
        legal_form = EXCLUDED.legal_form,
        country_of_registration = EXCLUDED.country_of_registration,
        associated_individuals = EXCLUDED.associated_individuals,
        associated_entities = EXCLUDED.associated_entities,
        relationship_type = EXCLUDED.relationship_type,
        sanction_number = EXCLUDED.sanction_number,
        inclusion_date = EXCLUDED.inclusion_date,
        removal_date = EXCLUDED.removal_date,
        list_updated_date = EXCLUDED.list_updated_date,
        source_url = EXCLUDED.source_url,
        remarks = EXCLUDED.remarks,
        updated_at = now()
      RETURNING id;
    `;

    const values = [
      r.list_type, r.list_source, r.unique_id || null, natural_key,
      r.full_name || r.entity_name || null, name_norm, aliases, aliases_concat, r.gender, r.date_of_birth, r.place_of_birth, r.nationality,
      r.national_id_number, r.tax_identification_number, r.position_title, r.institution_name, r.pep_type, r.status,
      r.address, r.city, r.country, r.entity_name, r.registration_number, r.legal_form, r.country_of_registration,
      r.associated_individuals, r.associated_entities, r.relationship_type, r.sanction_number, r.inclusion_date,
      r.removal_date, r.list_updated_date, r.source_url, r.remarks,
    ];

    // coba by unique_id dulu
    try {
      await this.pool.query(text, values);
      return;
    } catch (e: any) {
      // jika unique_id null → conflict clause tak aktif; lakukan upsert by natural_key:
      const text2 = `
        INSERT INTO watchlist_entries
        (list_type, list_source, unique_id, natural_key,
         name, name_norm, aliases, aliases_concat, gender, date_of_birth, place_of_birth, nationality,
         national_id_number, tax_identification_number, position_title, institution_name, pep_type, status,
         address, city, country, entity_name, registration_number, legal_form, country_of_registration,
         associated_individuals, associated_entities, relationship_type, sanction_number, inclusion_date,
         removal_date, list_updated_date, source_url, remarks, updated_at)
        VALUES
        ($1,$2,$3,$4,
         $5,$6,$7,$8,$9,$10,$11,$12,
         $13,$14,$15,$16,$17,$18,
         $19,$20,$21,$22,$23,$24,$25,
         $26,$27,$28,$29,$30,
         $31,$32,$33,$34, now())
        ON CONFLICT (natural_key) DO UPDATE SET
          list_type = EXCLUDED.list_type,
          list_source = EXCLUDED.list_source,
          name = EXCLUDED.name,
          name_norm = EXCLUDED.name_norm,
          aliases = EXCLUDED.aliases,
          aliases_concat = EXCLUDED.aliases_concat,
          gender = EXCLUDED.gender,
          date_of_birth = EXCLUDED.date_of_birth,
          place_of_birth = EXCLUDED.place_of_birth,
          nationality = EXCLUDED.nationality,
          national_id_number = EXCLUDED.national_id_number,
          tax_identification_number = EXCLUDED.tax_identification_number,
          position_title = EXCLUDED.position_title,
          institution_name = EXCLUDED.institution_name,
          pep_type = EXCLUDED.pep_type,
          status = EXCLUDED.status,
          address = EXCLUDED.address,
          city = EXCLUDED.city,
          country = EXCLUDED.country,
          entity_name = EXCLUDED.entity_name,
          registration_number = EXCLUDED.registration_number,
          legal_form = EXCLUDED.legal_form,
          country_of_registration = EXCLUDED.country_of_registration,
          associated_individuals = EXCLUDED.associated_individuals,
          associated_entities = EXCLUDED.associated_entities,
          relationship_type = EXCLUDED.relationship_type,
          sanction_number = EXCLUDED.sanction_number,
          inclusion_date = EXCLUDED.inclusion_date,
          removal_date = EXCLUDED.removal_date,
          list_updated_date = EXCLUDED.list_updated_date,
          source_url = EXCLUDED.source_url,
          remarks = EXCLUDED.remarks,
          updated_at = now()
        RETURNING id;
      `;
      await this.pool.query(text2, values);
      return;
    }
  }

  async ingestBuffer(buf: Buffer, list_type: IngestRow['list_type'], list_source: string) {
    const rows = this.parseWorkbook(buf, list_type, list_source);
    if (!rows.length) throw new BadRequestException('File kosong / sheet pertama tanpa data');

    // buat unique index natural_key jika belum ada
    await this.pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'ux_watchlist_natural_key'
        ) THEN
          EXECUTE 'CREATE UNIQUE INDEX ux_watchlist_natural_key ON watchlist_entries(natural_key)';
        END IF;
      END$$;
    `);

    for (const r of rows) {
      await this.upsertRow(r);
    }
    return { ok: true, count: rows.length };
  }

  /** Screening candidates by name + optional DOB, Nationality */
  async screenPerson(q: { name: string; dob?: string | null; nationality?: string | null; limit?: number }) {
    const name_norm = this.norm(q.name || '');
    const limit = Math.min(Math.max(q.limit ?? 10, 1), 50);

    const sql = `
      SELECT id, list_type, list_source, name, name_norm, aliases, date_of_birth, nationality,
             position_title, institution_name, pep_type, status,
             similarity(name_norm, $1) AS score
      FROM watchlist_entries
      WHERE name_norm % $1
        AND ($2::date IS NULL OR date_of_birth = $2::date)
        AND ($3::text IS NULL OR upper(nationality) = upper($3))
      ORDER BY score DESC
      LIMIT $4
    `;
    const { rows } = await this.pool.query(sql, [name_norm, q.dob || null, q.nationality || null, limit]);
    return rows;
  }
}
