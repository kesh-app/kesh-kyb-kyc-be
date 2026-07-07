import { Inject, Injectable, BadRequestException } from "@nestjs/common";
import { Pool } from "pg";
import * as XLSX from "xlsx";
import { createHash } from "crypto";

type IngestRow = {
  list_type: "PEP" | "DTTOT" | "PPPSPM";
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
  // Watchlist Template v3 (opsional — audit/traceability, belum dipakai matching)
  watchlist_type?: string | null;
  subject_type?: string | null;
  raw_date_of_birth?: string | null;
  description?: string | null;
};

@Injectable()
export class WatchlistService {
  constructor(@Inject("PG_POOL") private readonly pool: Pool) {}

  /** Normalize string */
  norm(v?: string | null) {
    if (!v) return null;
    return v
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  buildNaturalKey(r: IngestRow) {
    const key = [
      r.list_type || "",
      this.norm(r.list_source) || "",
      this.norm(r.full_name) || this.norm(r.entity_name) || "",
      r.date_of_birth || "",
    ].join("|");
    return createHash("sha1").update(key).digest("hex");
  }

  /**
   * Generate deterministic unique_id ketika kolom Unique_ID kosong pada file upload.
   * Deterministik (bukan random) agar upload ulang baris yang sama tidak membuat duplikat.
   * Normalisasi tiap field: trim + uppercase + string kosong bila null, digabung "|".
   * Format: KESH-WL-AUTO-<16 hex uppercase>  (contoh: KESH-WL-AUTO-8F3A91C2D4B7E102)
   */
  generateWatchlistUniqueId(r: IngestRow): string {
    const normalizeForId = (v?: string | null) =>
      (v ?? "").toString().trim().toUpperCase();
    const source = [
      r.full_name, // Full_Name
      r.entity_name, // Entity_Name
      r.date_of_birth, // Date_of_Birth
      r.nationality, // Nationality
      r.national_id_number, // National_ID_Number
      r.sanction_number, // Sanction_Number
      r.source_url, // Source_URL
    ]
      .map(normalizeForId)
      .join("|");
    const hash = createHash("sha256").update(source).digest("hex");
    return `KESH-WL-AUTO-${hash.slice(0, 16).toUpperCase()}`;
  }

  /**
   * Normalisasi Subject_Type → PERSON / ENTITY.
   * Menerima input Indonesia: Orang→PERSON; Korporasi/Perusahaan/Badan→ENTITY.
   * Kosong / tak dikenal → null (kolom audit opsional, tidak dipaksa).
   */
  normalizeSubjectType(v?: string | null): string | null {
    const up = (v ?? "").toString().trim().toUpperCase();
    if (!up) return null;
    if (["PERSON", "ORANG"].includes(up)) return "PERSON";
    if (["ENTITY", "KORPORASI", "PERUSAHAAN", "BADAN"].includes(up))
      return "ENTITY";
    return null;
  }

  /**
   * Normalisasi Watchlist_Type → {DTTOT, PEP, PPPSPM, OTHER} (uppercase).
   * - Diisi & valid → dipakai apa adanya.
   * - Diisi tapi tak dikenal → OTHER.
   * - Kosong → infer dari list_type (form) → fallback scan list_source → OTHER.
   */
  normalizeWatchlistType(
    v: string | null | undefined,
    list_type: string,
    list_source: string,
  ): string {
    const allowed = ["DTTOT", "PEP", "PPPSPM", "OTHER"];
    const up = (v ?? "").toString().trim().toUpperCase();
    if (allowed.includes(up)) return up;
    if (up) return "OTHER";
    if (["DTTOT", "PEP", "PPPSPM"].includes(list_type)) return list_type;
    const src = (list_source ?? "").toUpperCase();
    if (src.includes("DTTOT")) return "DTTOT";
    if (src.includes("PPPSPM")) return "PPPSPM";
    if (src.includes("PEP")) return "PEP";
    return "OTHER";
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

  mapRow(
    raw: any,
    list_type: IngestRow["list_type"],
    list_source: string,
  ): IngestRow {
    // Header dinormalisasi supaya case/spasi/underscore-insensitive:
    // "Watchlist_Type", "Watchlist Type", "watchlist type" → sama.
    const normHeader = (h: string) =>
      String(h)
        .replace(/\uFEFF/g, "") // buang BOM/zero-width no-break space bila menempel di header
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, " ")
        .trim();
    const index: Record<string, any> = {};
    for (const k of Object.keys(raw ?? {})) index[normHeader(k)] = raw[k];

    // Ambil value pertama yang tidak kosong dari daftar alias header.
    // Mengembalikan value asli (mis. Date object dari XLSX) agar perilaku
    // kolom lama tidak berubah.
    const pick = (...aliases: string[]): any => {
      for (const a of aliases) {
        const v = index[normHeader(a)];
        if (v !== undefined && v !== null && String(v).trim() !== "") return v;
      }
      return null;
    };

    const r: IngestRow = {
      list_type,
      list_source,
      // ── Kolom existing (v2) — tetap didukung ──
      unique_id: pick("Unique_ID"),
      full_name: pick("Full_Name"),
      alias_name: this.parseAliases(pick("Alias_Name")),
      gender: pick("Gender"),
      date_of_birth: pick("Date_of_Birth"),
      nationality: pick("Nationality"),
      national_id_number: pick("National_ID_Number"),
      tax_identification_number: pick("Tax_Identification_Number"),
      pep_type: pick("PEP_Type"),
      status: pick("Status"),
      city: pick("City"),
      country: pick("Country"),
      entity_name: pick("Entity_Name"),
      registration_number: pick("Registration_Number"),
      legal_form: pick("Legal_Form"),
      country_of_registration: pick("Country_of_Registration"),
      associated_individuals: this.parseAssociated(
        pick("Associated_Individuals"),
      ),
      associated_entities: this.parseAssociated(pick("Associated_Entities")),
      relationship_type: pick("Relationship_Type"),
      sanction_number: pick("Sanction_Number"),
      inclusion_date: pick("Inclusion_Date"),
      removal_date: pick("Removal_Date"),
      list_updated_date: pick("List_Updated_Date"),
      source_url: pick("Source_URL"),
      remarks: pick("Remarks"),
      // ── Kolom dengan alias friendly/Indonesia (v3) ──
      place_of_birth: pick("Place_of_Birth", "Tempat Lahir"),
      position_title: pick("Position_Title", "Jabatan"),
      institution_name: pick("Institution_Name", "Instansi"),
      address: pick("Address", "Alamat"),
      // ── Kolom baru v3 ──
      raw_date_of_birth: pick("Raw_Date_of_Birth", "Tanggal Lahir Mentah"),
      description: pick("Description", "Deskripsi"),
      subject_type: this.normalizeSubjectType(
        pick("Subject_Type", "Terduga", "Jenis Subjek"),
      ),
      watchlist_type: this.normalizeWatchlistType(
        pick("Watchlist_Type", "Jenis Watchlist"),
        list_type,
        list_source,
      ),
    };
    return r;
  }

  parseWorkbook(
    buf: Buffer,
    list_type: IngestRow["list_type"],
    list_source: string,
  ) {
    // Buang UTF-8 BOM (EF BB BF) di awal buffer bila ada, supaya header pertama
    // tidak terbaca sebagai "﻿Unique_ID" pada file UTF-8-SIG.
    if (
      buf &&
      buf.length >= 3 &&
      buf[0] === 0xef &&
      buf[1] === 0xbb &&
      buf[2] === 0xbf
    ) {
      buf = buf.subarray(3);
    }
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true, raw: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    return (rows as any[]).map((r) => this.mapRow(r, list_type, list_source));
  }

  async upsertRow(r: IngestRow) {
    // Identity name wajib: baris tanpa Full_Name maupun Entity_Name ditolak.
    // Baris tanpa nama tidak berguna untuk screening dan membuat auto-generate
    // unique_id kehilangan makna (semua baris kosong akan collapse jadi satu).
    const hasName =
      !!(r.full_name && r.full_name.trim()) ||
      !!(r.entity_name && r.entity_name.trim());
    if (!hasName) {
      throw new BadRequestException(
        "Baris tanpa Full_Name/Entity_Name ditolak (identity name wajib)",
      );
    }

    const name_norm = this.norm(r.full_name || r.entity_name || "");
    const aliases = r.alias_name || null;
    const aliases_concat = aliases ? aliases.join(" ") : null;
    const natural_key = this.buildNaturalKey(r);

    // Unique_ID opsional:
    // - providedUid: value dari file (menang bila diisi)
    // - uid: value yang dipakai untuk INSERT / lookup (provided, atau di-generate bila kosong)
    const providedUid = r.unique_id?.trim() || null;
    const uid = providedUid || this.generateWatchlistUniqueId(r);

    // Kolom values (38 params), dipakai bersama untuk INSERT dan UPDATE
    const vals: any[] = [
      r.list_type,          // $1
      r.list_source,        // $2
      uid,                  // $3
      natural_key,          // $4
      r.full_name || r.entity_name || null, // $5
      name_norm,            // $6
      aliases,              // $7
      aliases_concat,       // $8
      r.gender,             // $9
      r.date_of_birth,      // $10
      r.place_of_birth,     // $11
      r.nationality,        // $12
      r.national_id_number, // $13
      r.tax_identification_number, // $14
      r.position_title,     // $15
      r.institution_name,   // $16
      r.pep_type,           // $17
      r.status,             // $18
      r.address,            // $19
      r.city,               // $20
      r.country,            // $21
      r.entity_name,        // $22
      r.registration_number,// $23
      r.legal_form,         // $24
      r.country_of_registration, // $25
      r.associated_individuals,  // $26
      r.associated_entities,     // $27
      r.relationship_type,  // $28
      r.sanction_number,    // $29
      r.inclusion_date,     // $30
      r.removal_date,       // $31
      r.list_updated_date,  // $32
      r.source_url,         // $33
      r.remarks,            // $34
      r.watchlist_type,     // $35
      r.subject_type,       // $36
      r.raw_date_of_birth,  // $37
      r.description,        // $38
    ];

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Cari existing: coba via upper(unique_id) dulu, fallback ke natural_key
      let existingId: number | null = null;
      if (uid) {
        const { rows } = await client.query(
          `SELECT id FROM watchlist_entries WHERE upper(unique_id) = upper($1) LIMIT 1`,
          [uid],
        );
        if (rows[0]) existingId = rows[0].id;
      }
      if (!existingId) {
        const { rows } = await client.query(
          `SELECT id FROM watchlist_entries WHERE natural_key = $1 LIMIT 1`,
          [natural_key],
        );
        if (rows[0]) existingId = rows[0].id;
      }

      if (existingId) {
        await client.query(
          `UPDATE watchlist_entries SET
            list_type=$1, list_source=$2,
            -- Prioritas: value dari file ($40) > unique_id existing > value INSERT/generated ($3).
            -- Ini menjaga unique_id eksplisit lama tidak tertimpa oleh id auto-generate.
            unique_id=COALESCE($40, unique_id, $3), natural_key=$4,
            -- full_name (kolom legacy NOT NULL) di-mirror dari display name ($5)
            full_name=$5, name=$5, name_norm=$6, aliases=$7, aliases_concat=$8,
            gender=$9, date_of_birth=$10, place_of_birth=$11, nationality=$12,
            national_id_number=$13, tax_identification_number=$14,
            position_title=$15, institution_name=$16, pep_type=$17, status=$18,
            address=$19, city=$20, country=$21, entity_name=$22,
            registration_number=$23, legal_form=$24, country_of_registration=$25,
            associated_individuals=$26, associated_entities=$27,
            relationship_type=$28, sanction_number=$29, inclusion_date=$30,
            removal_date=$31, list_updated_date=$32, source_url=$33, remarks=$34,
            -- Watchlist Template v3
            watchlist_type=$35, subject_type=$36, raw_date_of_birth=$37, description=$38,
            updated_at=now()
           WHERE id=$39`,
          [...vals, existingId, providedUid],
        );
      } else {
        await client.query(
          `INSERT INTO watchlist_entries
            (list_type, list_source, unique_id, natural_key,
             full_name, name, name_norm, aliases, aliases_concat, gender, date_of_birth, place_of_birth, nationality,
             national_id_number, tax_identification_number, position_title, institution_name, pep_type, status,
             address, city, country, entity_name, registration_number, legal_form, country_of_registration,
             associated_individuals, associated_entities, relationship_type, sanction_number, inclusion_date,
             removal_date, list_updated_date, source_url, remarks,
             watchlist_type, subject_type, raw_date_of_birth, description, updated_at)
           VALUES
            ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,
             $35,$36,$37,$38, now())`,
          vals,
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async ingestBuffer(
    buf: Buffer,
    list_type: IngestRow["list_type"],
    list_source: string,
    userId: number,
    originalFilename: string,
  ) {
    const rows = this.parseWorkbook(buf, list_type, list_source);
    if (!rows.length)
      throw new BadRequestException(
        "File kosong / sheet pertama tanpa data yang valid",
      );

    let successRows = 0;
    const rowErrors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const fileLine = i + 2; // baris 1 = header, data mulai baris 2

      try {
        // Policy: Watchlist_Type per-baris harus cocok dengan Jenis List (list_type)
        // yang dipilih saat upload. Baris blank sudah di-infer ke list_type (cocok).
        // Mismatch = error baris yang JELAS — bukan silent skip / silent relabel.
        if (r.watchlist_type && r.watchlist_type !== list_type) {
          throw new BadRequestException(
            `Watchlist_Type (${r.watchlist_type}) tidak cocok dengan Jenis List yang dipilih (${list_type}).`,
          );
        }
        await this.upsertRow(r);
        successRows++;
      } catch (err: any) {
        rowErrors.push({ row: fileLine, message: err.message });
      }
    }

    // String gabungan untuk kolom log & kompatibilitas field `errors` lama.
    const errorMessage =
      rowErrors.length > 0
        ? rowErrors.map((e) => `Baris ${e.row}: ${e.message}`).join("; ")
        : null;

    // insert ke log
    const logRes = await this.pool.query(
      `INSERT INTO watchlist_ingest_logs(actor_id, list_type, list_source, original_filename, total_rows, success_rows, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING actor_id AS uploaded_by`,
      [
        userId,
        list_type,
        list_source,
        originalFilename,
        rows.length,
        successRows,
        errorMessage,
      ],
    );

    // Status non-misleading:
    //  - FAILED : tidak ada baris sukses (success = 0)
    //  - PARTIAL: sebagian sukses, sebagian error
    //  - SUCCESS: semua baris sukses
    const status =
      successRows === 0
        ? "FAILED"
        : rowErrors.length > 0
          ? "PARTIAL"
          : "SUCCESS";

    return {
      ok: successRows > 0, // jangan tampilkan sukses bila 0 baris diproses
      status,
      total: rows.length,
      success: successRows,
      error_count: rowErrors.length,
      errors: errorMessage, // string gabungan (backward-compat), null bila tak ada
      row_errors: rowErrors, // detail per-baris: [{ row, message }]
      log: { uploaded_by: logRes.rows[0]?.uploaded_by ?? null },
    };
  }

  /**
   * Riwayat upload watchlist dengan pagination + filter.
   * Filter: list_type, source_list, status (SUCCESS/PARTIAL/FAILED).
   * `status` dihitung di SQL agar count & pagination konsisten dengan filter.
   * Field FE untuk kolom "Jumlah": total/success/error_count/status.
   */
  async listIngestHistory(opts: {
    page?: number;
    limit?: number;
    list_type?: string;
    source_list?: string;
    status?: string;
  }) {
    const page = Math.max(1, Number(opts.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(opts.limit) || 20));
    const offset = (page - 1) * limit;

    // Ekspresi status konsisten dengan mapping lama:
    //  FAILED  : total=0 atau success=0
    //  PARTIAL : success < total (dan success>0)
    //  SUCCESS : success = total (dan total>0)
    const statusExpr = `CASE
        WHEN COALESCE(l.total_rows,0) = 0 OR COALESCE(l.success_rows,0) = 0 THEN 'FAILED'
        WHEN COALESCE(l.success_rows,0) < COALESCE(l.total_rows,0) THEN 'PARTIAL'
        ELSE 'SUCCESS'
      END`;

    const wh: string[] = [];
    const params: any[] = [];
    if (opts.list_type)
      wh.push(`l.list_type = $${params.push(opts.list_type)}`);
    if (opts.source_list)
      wh.push(`l.list_source = $${params.push(opts.source_list)}`);
    if (opts.status)
      wh.push(`${statusExpr} = $${params.push(opts.status.toUpperCase())}`);
    const whereSql = wh.length ? `WHERE ${wh.join(" AND ")}` : "";

    const sql = `
      SELECT l.id, l.created_at, l.list_type, l.list_source, l.original_filename,
             l.total_rows, l.success_rows, l.error_message,
             u.name AS uploaded_by,
             ${statusExpr} AS status,
             COUNT(*) OVER()::int AS total_count
      FROM watchlist_ingest_logs l
      LEFT JOIN users u ON u.id = l.actor_id
      ${whereSql}
      ORDER BY l.created_at DESC
      LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}
    `;

    const { rows } = await this.pool.query(sql, params);
    const total = rows[0]?.total_count ?? 0;

    return {
      data: rows.map((r: any) => {
        const rowTotal = Number(r.total_rows ?? 0);
        const rowSuccess = Number(r.success_rows ?? 0);
        return {
          id: r.id,
          list_type: r.list_type,
          source_list: r.list_source,
          original_filename: r.original_filename,
          uploaded_at: r.created_at,
          uploaded_by: r.uploaded_by,
          total: rowTotal,
          success: rowSuccess,
          error_count: Math.max(0, rowTotal - rowSuccess),
          status: r.status,
          error_message: r.error_message,
        };
      }),
      page,
      limit,
      total,
    };
  }

  /**
   * List watchlist entries yang sudah tersimpan (untuk FE menampilkan data, bukan hanya riwayat upload).
   * Filter: list_type, source_list, watchlist_type, subject_type, dan search `q`.
   * Pagination: page (default 1) + limit (default 20, max 100), plus total.
   */
  async listEntries(opts: {
    page?: number;
    limit?: number;
    list_type?: string;
    source_list?: string;
    watchlist_type?: string;
    subject_type?: string;
    q?: string;
  }) {
    const page = Math.max(1, Number(opts.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(opts.limit) || 20));
    const offset = (page - 1) * limit;

    const wh: string[] = [];
    const params: any[] = [];

    if (opts.list_type)
      wh.push(`list_type = $${params.push(opts.list_type)}`);
    if (opts.source_list)
      wh.push(`list_source = $${params.push(opts.source_list)}`);
    if (opts.watchlist_type)
      wh.push(`watchlist_type = $${params.push(opts.watchlist_type)}`);
    if (opts.subject_type)
      wh.push(`subject_type = $${params.push(opts.subject_type)}`);
    if (opts.q) {
      const p = params.push(`%${opts.q}%`);
      wh.push(`(
        COALESCE(unique_id,'') ILIKE $${p} OR
        COALESCE(full_name,'') ILIKE $${p} OR
        COALESCE(name,'') ILIKE $${p} OR
        COALESCE(entity_name,'') ILIKE $${p} OR
        COALESCE(aliases_concat,'') ILIKE $${p} OR
        COALESCE(national_id_number,'') ILIKE $${p} OR
        COALESCE(sanction_number,'') ILIKE $${p} OR
        COALESCE(position_title,'') ILIKE $${p} OR
        COALESCE(institution_name,'') ILIKE $${p}
      )`);
    }

    const whereSql = wh.length ? `WHERE ${wh.join(" AND ")}` : "";

    const sql = `
      SELECT id, unique_id, list_type, list_source, watchlist_type, subject_type,
             full_name, aliases_concat AS alias_name, entity_name,
             date_of_birth, raw_date_of_birth, place_of_birth, nationality,
             national_id_number, position_title, institution_name, address,
             sanction_number, source_url, description, remarks,
             created_at, updated_at,
             COUNT(*) OVER()::int AS total_count
      FROM watchlist_entries
      ${whereSql}
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}
    `;

    const { rows } = await this.pool.query(sql, params);
    const total = rows[0]?.total_count ?? 0;

    return {
      data: rows.map((r: any) => ({
        id: r.id,
        unique_id: r.unique_id,
        list_type: r.list_type,
        source_list: r.list_source,
        watchlist_type: r.watchlist_type,
        subject_type: r.subject_type,
        full_name: r.full_name,
        alias_name: r.alias_name,
        entity_name: r.entity_name,
        date_of_birth: r.date_of_birth,
        raw_date_of_birth: r.raw_date_of_birth,
        place_of_birth: r.place_of_birth,
        nationality: r.nationality,
        national_id_number: r.national_id_number,
        position_title: r.position_title,
        institution_name: r.institution_name,
        address: r.address,
        sanction_number: r.sanction_number,
        source_url: r.source_url,
        description: r.description,
        remarks: r.remarks,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      page,
      limit,
      total,
    };
  }
}
