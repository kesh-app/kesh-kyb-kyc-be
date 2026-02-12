import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { createHash } from 'crypto';

type IngestRow = {
  list_type: 'PEP' | 'DTTOT' | 'PPPSPM';
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

  /** Normalize (upper + trim + collapse spaces, strip accents) */
  norm(v?: string | null) {
    if (!v) return null;
    return v
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
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
    const arr = v
      .split(/[;,|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return arr.length ? arr : null;
  }

  parseAssociated(v?: string | null): string[] | null {
    return this.parseAliases(v);
  }

    /** Helper ambil string dari beberapa kemungkinan header */
  private pick(raw: any, keys: string[]): string | null {
    for (const k of keys) {
      if (raw == null) continue;
      const v = raw[k];
      if (v === undefined || v === null) continue;

      // Jika Excel memberi Date object → format ke YYYY-MM-DD
      if (v instanceof Date) {
        const year = v.getFullYear();
        const month = String(v.getMonth() + 1).padStart(2, '0');
        const day = String(v.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }

      const s = String(v).trim();
      if (s !== '') return s;
    }
    return null;
  }


  /** Map satu row XLSX/CSV ke IngestRow sesuai header template */
  mapRow(
    raw: any,
    list_type: IngestRow['list_type'],
    list_source: string,
  ): IngestRow {
    // Dukungan header:
    // - Versi resmi kamu: Full_Name, Alias_Name, Date_of_Birth, ...
    // - Versi template kita: full_name, aliases, dob, date_of_birth, ...

    const full_name = this.pick(raw, ['Full_Name', 'full_name', 'FULL_NAME']);
    const entity_name = this.pick(raw, [
      'Entity_Name',
      'entity_name',
      'ENTITY_NAME',
      'organization',
      'Organization',
    ]);
    const aliasRaw = this.pick(raw, ['Alias_Name', 'aliases', 'Aliases']);
    const gender = this.pick(raw, ['Gender', 'gender']);
    const date_of_birth =
      this.pick(raw, ['Date_of_Birth', 'date_of_birth']) ||
      this.pick(raw, ['dob']); // fallback ke "dob"
    const place_of_birth = this.pick(raw, [
      'Place_of_Birth',
      'place_of_birth',
      'pob',
    ]);
    const nationality = this.pick(raw, ['Nationality', 'nationality']);
    const national_id_number = this.pick(raw, [
      'National_ID_Number',
      'national_id_number',
    ]);
    const tax_identification_number = this.pick(raw, [
      'Tax_Identification_Number',
      'tax_identification_number',
    ]);
    const position_title = this.pick(raw, [
      'Position_Title',
      'position_title',
      'position',
      'Position',
    ]);
    const institution_name = this.pick(raw, [
      'Institution_Name',
      'institution_name',
    ]);
    const pep_type = this.pick(raw, ['PEP_Type', 'pep_type']);
    const status = this.pick(raw, ['Status', 'status']);
    const address = this.pick(raw, ['Address', 'address']);
    const city = this.pick(raw, ['City', 'city']);
    const country = this.pick(raw, ['Country', 'country']);
    const registration_number = this.pick(raw, [
      'Registration_Number',
      'registration_number',
    ]);
    const legal_form = this.pick(raw, ['Legal_Form', 'legal_form']);
    const country_of_registration = this.pick(raw, [
      'Country_of_Registration',
      'country_of_registration',
    ]);
    const associated_individuals_raw = this.pick(raw, [
      'Associated_Individuals',
      'associated_individuals',
    ]);
    const associated_entities_raw = this.pick(raw, [
      'Associated_Entities',
      'associated_entities',
    ]);
    const relationship_type = this.pick(raw, [
      'Relationship_Type',
      'relationship_type',
    ]);
    const sanction_number = this.pick(raw, [
      'Sanction_Number',
      'sanction_number',
    ]);
    const inclusion_date = this.pick(raw, [
      'Inclusion_Date',
      'inclusion_date',
    ]);
    const removal_date = this.pick(raw, ['Removal_Date', 'removal_date']);
    const list_updated_date = this.pick(raw, [
      'List_Updated_Date',
      'list_updated_date',
    ]);
    const source_url = this.pick(raw, ['Source_URL', 'source_url']);
    const remarks =
      this.pick(raw, ['Remarks', 'remarks']) ||
      this.pick(raw, ['Notes', 'notes']);
    const unique_id =
      this.pick(raw, ['Unique_ID', 'UNIQUE_ID', 'unique_id', 'reference_id']) ??
      null;

    const r: IngestRow = {
      list_type,
      list_source,
      unique_id,
      full_name,
      alias_name: this.parseAliases(aliasRaw),
      gender,
      date_of_birth,
      place_of_birth,
      nationality,
      national_id_number,
      tax_identification_number,
      position_title,
      institution_name,
      pep_type,
      status,
      address,
      city,
      country,
      entity_name,
      registration_number,
      legal_form,
      country_of_registration,
      associated_individuals: this.parseAssociated(associated_individuals_raw),
      associated_entities: this.parseAssociated(associated_entities_raw),
      relationship_type,
      sanction_number,
      inclusion_date,
      removal_date,
      list_updated_date,
      source_url,
      remarks,
    };
    return r;
  }

  /** Parse Excel/CSV buffer → rows */
  parseWorkbook(
    buf: Buffer,
    list_type: IngestRow['list_type'],
    list_source: string,
  ) {
    const wb = XLSX.read(buf, {
      type: 'buffer',
      cellDates: true,
      raw: false,
    });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    return (rows as any[])
      .map((r) => this.mapRow(r, list_type, list_source))
      .filter((r) => {
        // skip baris kosong total
        const hasAny =
          Object.values(r).filter(
            (v) => v !== null && v !== undefined && String(v).trim() !== '',
          ).length > 0;
        return hasAny;
      });
  }

  /** Upsert satu row ke DB */
  async upsertRow(r: IngestRow) {
    // Tentukan nama utama (untuk individu atau entitas).
    const primaryName = r.full_name || r.entity_name || null;

    // Kalau tidak ada nama sama sekali → SKIP baris, jangan insert.
    if (!primaryName) {
      return;
    }

    const name_norm = this.norm(primaryName) || '';
    const aliases = r.alias_name || null;
    const aliases_concat = aliases ? aliases.join(' ') : null;
    const natural_key = this.buildNaturalKey(r);

    const values = [
      r.list_type,
      r.list_source,
      r.unique_id || null,
      natural_key,
      primaryName, // full_name
      primaryName, // name
      name_norm,
      aliases,
      aliases_concat,
      r.gender,
      r.date_of_birth,
      r.place_of_birth,
      r.nationality,
      r.national_id_number,
      r.tax_identification_number,
      r.position_title,
      r.institution_name,
      r.pep_type,
      r.status,
      r.address,
      r.city,
      r.country,
      r.entity_name,
      r.registration_number,
      r.legal_form,
      r.country_of_registration,
      r.associated_individuals,
      r.associated_entities,
      r.relationship_type,
      r.sanction_number,
      r.inclusion_date,
      r.removal_date,
      r.list_updated_date,
      r.source_url,
      r.remarks,
    ];

    const insertBase = `
      INSERT INTO watchlist_entries
      (list_type, list_source, unique_id, natural_key,
       full_name, name, name_norm, aliases, aliases_concat, gender, date_of_birth, place_of_birth, nationality,
       national_id_number, tax_identification_number, position_title, institution_name, pep_type, status,
       address, city, country, entity_name, registration_number, legal_form, country_of_registration,
       associated_individuals, associated_entities, relationship_type, sanction_number, inclusion_date,
       removal_date, list_updated_date, source_url, remarks, updated_at)
      VALUES
      ($1,$2,$3,$4,
       $5,$6,$7,$8,$9,$10,$11,$12,$13,
       $14,$15,$16,$17,$18,$19,
       $20,$21,$22,$23,$24,$25,$26,
       $27,$28,$29,$30,$31,
       $32,$33,$34,$35, now())
    `;

    const conflictUpdate = `
        list_type = EXCLUDED.list_type,
        list_source = EXCLUDED.list_source,
        full_name = EXCLUDED.full_name,
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
    `;

    // coba by unique_id dulu
    const text = `
      ${insertBase}
      ON CONFLICT (unique_id) WHERE $3 IS NOT NULL DO UPDATE SET
        ${conflictUpdate}
      RETURNING id;
    `;

    try {
      await this.pool.query(text, values);
      return;
    } catch (e: any) {
      // jika unique_id null → conflict clause tak aktif; lakukan upsert by natural_key:
      const text2 = `
        ${insertBase}
        ON CONFLICT (natural_key) DO UPDATE SET
          ${conflictUpdate}
        RETURNING id;
      `;
      await this.pool.query(text2, values);
      return;
    }
  }

  async ingestBuffer(
    buf: Buffer,
    list_type: IngestRow['list_type'],
    list_source: string,
  ) {
    const rows = this.parseWorkbook(buf, list_type, list_source);
    if (!rows.length)
      throw new BadRequestException(
        'File kosong / sheet pertama tanpa data yang valid',
      );

    // pastikan unique index natural_key ada
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

    let count = 0;
    for (const r of rows) {
      await this.upsertRow(r);
      count++;
    }
    return { ok: true, count };
  }

  /** Screening candidates by name + optional DOB, Nationality */
  async screenPerson(q: {
    name: string;
    dob?: string | null;
    nationality?: string | null;
    limit?: number;
  }) {
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
    const { rows } = await this.pool.query(sql, [
      name_norm,
      q.dob || null,
      q.nationality || null,
      limit,
    ]);
    return rows;
  }
}
