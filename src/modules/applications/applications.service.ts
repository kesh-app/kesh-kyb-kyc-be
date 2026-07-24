import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { Pool } from "pg";
import { computeRbaV01, INDUSTRY_MAP, type RbaInput } from "./rba-v01.engine";

// ─── Internal Preliminary Risk Scoring — RBA v2 ────────────────────────────
// Bukan formula resmi BI. Dipakai sebagai dasar review compliance internal.

const SIMILARITY_THRESHOLD = 0.35;

// Bobot per faktor (satuan poin, cap total 100)
const W = {
  DTTOT_CONFIRMED: 100,
  PPPSPM_CONFIRMED: 100,
  PEP_CONFIRMED: 40,
  PEP_CANDIDATE: 20,
  DTTOT_CANDIDATE: 50,
  PPPSPM_CANDIDATE: 50,
  DOC_MISSING: 10,
  DOC_REJECTED: 15,
  HIGH_RISK_OCCUPATION: 15,
  PEP_SELF_DECLARED: 40,
  HIGH_RISK_ACTIVITY: 20,
  HIGH_RISK_LEGAL_FORM: 10,
  BO_MISSING: 30,
  GEOGRAPHY: 15,
  RBA_OCC_HIGH: 20,
  RBA_OCC_MEDIUM: 10,
  RBA_GEO_HIGH: 15,
  RBA_GEO_MEDIUM: 7,
};

// Kata kunci pekerjaan berisiko tinggi (individual)
const HIGH_RISK_OCCUPATIONS = [
  "money changer",
  "remittance",
  "crypto",
  "casino",
  "gambling",
  "precious metal",
  "arms",
  "nonprofit",
  "charity",
  "politician",
  "public official",
  "pejabat",
  "politisi",
  "kasino",
  "judi",
  "logam mulia",
  "senjata",
  "tukar valas",
];

// Kata kunci kegiatan usaha berisiko tinggi (bisnis)
const HIGH_RISK_ACTIVITIES = [
  "money changer",
  "remittance",
  "crypto",
  "virtual asset",
  "casino",
  "gambling",
  "precious metal",
  "arms",
  "weapon",
  "nonprofit",
  "charity",
  "foundation",
  "yayasan",
  "donation",
  "cash intensive",
  "judi",
  "kasino",
  "logam mulia",
  "senjata",
  "donasi",
  "amal",
  "tukar valas",
];

// Bentuk hukum berisiko tinggi
const HIGH_RISK_LEGAL_FORMS = [
  "YAYASAN",
  "FOUNDATION",
  "NONPROFIT",
  "KOPERASI",
];

// Placeholder daftar negara berisiko tinggi — dipelihara oleh compliance (FATF/BI)
const HIGH_RISK_COUNTRIES: string[] = [];

// ── RBA Occupation/Geography temporarily disabled ────────────────────────────
// Set true to re-enable once compliance confirms the scoring parameters.
const RBA_OCCUPATION_GEOGRAPHY_ENABLED = false;

// ── RBA Occupation mapping — profil pekerjaan (RBA internal)
const RBA_OCCUPATION_MAP = (
  [
    // HIGH (+20)
    { name: "pejabat lembaga legislatif dan pemerintah", risk: "HIGH" },
    { name: "legislative and government officials", risk: "HIGH" },
    { name: "government officials", risk: "HIGH" },
    { name: "pegawai negeri sipil", risk: "HIGH" },
    { name: "pejabat pemerintah", risk: "HIGH" },
    { name: "civil servant", risk: "HIGH" },
    { name: "private employees", risk: "HIGH" },
    { name: "private employee", risk: "HIGH" },
    { name: "self-employed", risk: "HIGH" },
    { name: "self employed", risk: "HIGH" },
    { name: "pegawai swasta", risk: "HIGH" },
    { name: "wiraswasta", risk: "HIGH" },
    { name: "pns", risk: "HIGH" },
    // MEDIUM (+10)
    { name: "political party administrators", risk: "MEDIUM" },
    { name: "political party administrator", risk: "MEDIUM" },
    { name: "pegawai bumn/bumd", risk: "MEDIUM" },
    { name: "pengurus parpol", risk: "MEDIUM" },
    { name: "pegawai bumn", risk: "MEDIUM" },
    { name: "pegawai bumd", risk: "MEDIUM" },
    { name: "bumn", risk: "MEDIUM" },
    { name: "bumd", risk: "MEDIUM" },
    // LOW (+0, info)
    { name: "profesional dan konsultan", risk: "LOW" },
    { name: "bank employees", risk: "LOW" },
    { name: "bank employee", risk: "LOW" },
    { name: "pegawai bank", risk: "LOW" },
    { name: "profesional", risk: "LOW" },
    { name: "professional", risk: "LOW" },
    { name: "konsultan", risk: "LOW" },
    { name: "consultant", risk: "LOW" },
    { name: "polri", risk: "LOW" },
    { name: "police", risk: "LOW" },
    { name: "army", risk: "LOW" },
    { name: "tni", risk: "LOW" },
  ] as { name: string; risk: "HIGH" | "MEDIUM" | "LOW" }[]
).sort((a, b) => b.name.length - a.name.length);

// ── RBA Geography mapping — area domisili individu (RBA internal)
// Sorted longest-first untuk cegah false positive substring match (Kepulauan Riau vs Riau).
const RBA_GEOGRAPHY_MAP = (
  [
    // HIGH (+15)
    { name: "dki jakarta", risk: "HIGH" },
    { name: "sumatera utara", risk: "HIGH" },
    { name: "north sumatra", risk: "HIGH" },
    { name: "jawa timur", risk: "HIGH" },
    { name: "jawa barat", risk: "HIGH" },
    { name: "jawa tengah", risk: "HIGH" },
    { name: "central java", risk: "HIGH" },
    { name: "east java", risk: "HIGH" },
    { name: "west java", risk: "HIGH" },
    { name: "jakarta", risk: "HIGH" },
    { name: "banten", risk: "HIGH" },
    // MEDIUM (+7)
    { name: "sulawesi selatan", risk: "MEDIUM" },
    { name: "south sulawesi", risk: "MEDIUM" },
    { name: "kepulauan riau", risk: "MEDIUM" },
    { name: "riau islands", risk: "MEDIUM" },
    { name: "kalimantan timur", risk: "MEDIUM" },
    { name: "east kalimantan", risk: "MEDIUM" },
    { name: "sumatera selatan", risk: "MEDIUM" },
    { name: "south sumatra", risk: "MEDIUM" },
    { name: "daerah istimewa yogyakarta", risk: "MEDIUM" },
    { name: "di yogyakarta", risk: "MEDIUM" },
    { name: "yogyakarta", risk: "MEDIUM" },
    { name: "bengkulu", risk: "MEDIUM" },
    { name: "lampung", risk: "MEDIUM" },
    { name: "bali", risk: "MEDIUM" },
    { name: "riau", risk: "MEDIUM" },
    { name: "diy", risk: "MEDIUM" },
    // LOW (+0, info)
    { name: "nanggroe aceh darussalam", risk: "LOW" },
    { name: "kalimantan tengah", risk: "LOW" },
    { name: "central kalimantan", risk: "LOW" },
    { name: "kalimantan barat", risk: "LOW" },
    { name: "west kalimantan", risk: "LOW" },
    { name: "nusa tenggara timur", risk: "LOW" },
    { name: "east nusa tenggara", risk: "LOW" },
    { name: "nusa tenggara barat", risk: "LOW" },
    { name: "west nusa tenggara", risk: "LOW" },
    { name: "kalimantan selatan", risk: "LOW" },
    { name: "south kalimantan", risk: "LOW" },
    { name: "sulawesi utara", risk: "LOW" },
    { name: "north sulawesi", risk: "LOW" },
    { name: "sulawesi tengah", risk: "LOW" },
    { name: "central sulawesi", risk: "LOW" },
    { name: "sulawesi tenggara", risk: "LOW" },
    { name: "southeast sulawesi", risk: "LOW" },
    { name: "maluku utara", risk: "LOW" },
    { name: "north maluku", risk: "LOW" },
    { name: "bangka belitung", risk: "LOW" },
    { name: "gorontalo", risk: "LOW" },
    { name: "papua", risk: "LOW" },
    { name: "aceh", risk: "LOW" },
    { name: "ntt", risk: "LOW" },
    { name: "ntb", risk: "LOW" },
  ] as { name: string; risk: "HIGH" | "MEDIUM" | "LOW" }[]
).sort((a, b) => b.name.length - a.name.length);

/** Ubah angka 0..100 ke level (threshold dipertahankan dari v1) */
function levelOf(score: number) {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

export interface RiskFactor {
  code: string;
  label: string;
  score: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  source: string;
  details?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(@Inject("PG_POOL") private readonly pool: Pool) {}

  // ── "Lainnya" manual free-text helpers ───────────────────────────────────────
  // RBA V01 rule: *_other NEVER replaces the dropdown value. The dropdown value
  // (e.g. source_of_funds = "Lainnya") is preserved for strict RBA scoring; the
  // typed description lives separately in the matching *_other column.

  /** True only when the dropdown value is exactly "Lainnya" (case-insensitive). */
  private isLainnya(v: unknown): boolean {
    return typeof v === "string" && v.trim().toLowerCase() === "lainnya";
  }

  private cleanText(v: unknown): string | null {
    return typeof v === "string" && v.trim() === "" ? null : ((v as any) ?? null);
  }

  /**
   * CREATE-time resolution of *_other columns for a fixed set of (main, other)
   * pairs. When the main dropdown value is "Lainnya" the matching *_other must be
   * present (clear 400 otherwise); when it is anything else the *_other is nulled.
   */
  private resolveOtherFieldsCreate(
    dto: any,
    pairs: Array<{ main: string; other: string; label: string }>,
  ): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const { main, other, label } of pairs) {
      if (this.isLainnya(dto[main])) {
        const v = this.cleanText(dto[other]);
        if (v === null) {
          throw new BadRequestException(
            `Keterangan lainnya wajib diisi untuk ${label}.`,
          );
        }
        out[other] = v;
      } else {
        out[other] = null;
      }
    }
    return out;
  }

  /**
   * PATCH-time reconciliation of *_other columns on a persons row.
   *   - main = "Lainnya" + other key present  → write other (empty string → null)
   *   - main = "Lainnya" + other key omitted   → preserve existing other
   *   - main != "Lainnya"                       → clear other to null
   * For `mainConditional` pairs (WIC), when the main key is omitted both main and
   * other are left untouched (preserve), matching the WIC minimum-CDD PATCH rule.
   */
  private async applyOtherFieldsPatch(
    personId: number,
    dto: any,
    pairs: Array<{ main: string; other: string; mainConditional?: boolean }>,
  ) {
    const hasKey = (k: string) =>
      Object.prototype.hasOwnProperty.call(dto, k);
    for (const { main, other, mainConditional } of pairs) {
      if (mainConditional && !hasKey(main)) continue; // preserve both
      if (this.isLainnya(this.cleanText(dto[main]))) {
        if (hasKey(other)) {
          await this.pool.query(
            `UPDATE persons SET ${other} = $1 WHERE id = $2`,
            [this.cleanText(dto[other]), personId],
          );
        }
        // omitted → preserve existing value
      } else {
        await this.pool.query(
          `UPDATE persons SET ${other} = NULL WHERE id = $1`,
          [personId],
        );
      }
    }
  }

  // ── Business "Alamat Kedudukan" province/city dropdown helper ─────────────────
  // Validates business_province_code / business_city_code against ref tables and
  // resolves their display names. Mirrors the Individual CDD region behaviour.
  private async validateAndResolveBusinessRegion(dto: any): Promise<{
    business_province_code: string | null;
    business_province_name: string | null;
    business_city_code: string | null;
    business_city_name: string | null;
  }> {
    const out = {
      business_province_code: dto.business_province_code || null,
      business_province_name: null as string | null,
      business_city_code: dto.business_city_code || null,
      business_city_name: null as string | null,
    };

    if (dto.business_province_code) {
      const { rows } = await this.pool.query(
        `SELECT name FROM ref_provinces WHERE code=$1`,
        [dto.business_province_code],
      );
      if (!rows[0])
        throw new BadRequestException(
          `business_province_code '${dto.business_province_code}' tidak ditemukan`,
        );
      out.business_province_name = rows[0].name;
    }

    if (dto.business_city_code) {
      const { rows } = await this.pool.query(
        `SELECT name, province_code FROM ref_regencies WHERE code=$1`,
        [dto.business_city_code],
      );
      if (!rows[0])
        throw new BadRequestException(
          `business_city_code '${dto.business_city_code}' tidak ditemukan`,
        );
      if (
        dto.business_province_code &&
        rows[0].province_code !== dto.business_province_code
      ) {
        throw new BadRequestException(
          `business_city_code '${dto.business_city_code}' bukan bagian dari business_province_code '${dto.business_province_code}'`,
        );
      }
      out.business_city_name = rows[0].name;
    }

    return out;
  }

  // ── CIF helpers ──────────────────────────────────────────────────────────────

  private extractLast6Digits(value: string | null | undefined): string {
    const digits = (value ?? "").replace(/\D/g, "");
    if (!digits) return "000000";
    return digits.slice(-6).padStart(6, "0");
  }

  private async generateIndividualCif(
    identityNumber: string | null | undefined,
  ): Promise<string> {
    const last6 = this.extractLast6Digits(identityNumber);
    const { rows } = await this.pool.query(
      `SELECT nextval('cif_individual_seq') AS seq`,
    );
    const seq = String(rows[0].seq).padStart(5, "0");
    return `KSHI${last6}${seq}`;
  }

  private async generateBusinessCif(
    nib: string | null | undefined,
    npwp: string | null | undefined,
  ): Promise<string> {
    const last6 = this.extractLast6Digits(nib || npwp);
    const { rows } = await this.pool.query(
      `SELECT nextval('cif_business_seq') AS seq`,
    );
    const seq = String(rows[0].seq).padStart(5, "0");
    return `KSHB${last6}${seq}`;
  }

  private normalizeCifRelationshipType(value: unknown): "OUR_CUSTOMER" | "WIC" {
    return value === "WIC" ? "WIC" : "OUR_CUSTOMER";
  }

  // Look up an existing CIF assigned to any person or BO party with the same
  // digit-normalized identity number. Prevents duplicate CIF for the same person
  // across OUR_CUSTOMER and BO contexts.
  private async resolveCifForIdentity(
    rawIdentityNumber: string | null | undefined,
  ): Promise<string | null> {
    const norm = (rawIdentityNumber ?? "").replace(/\D/g, "");
    if (!norm) return null;

    const { rows: pr } = await this.pool.query(
      `SELECT cif_no FROM persons
       WHERE regexp_replace(COALESCE(identity_number,''), '[^0-9]', '', 'g') = $1
         AND cif_no IS NOT NULL
       LIMIT 1`,
      [norm],
    );
    if (pr[0]?.cif_no) return pr[0].cif_no;

    const { rows: bp } = await this.pool.query(
      `SELECT bp.cif_no
       FROM business_parties bp
       JOIN persons p ON p.id = bp.person_id
       WHERE regexp_replace(COALESCE(p.identity_number,''), '[^0-9]', '', 'g') = $1
         AND bp.cif_no IS NOT NULL
       LIMIT 1`,
      [norm],
    );
    return bp[0]?.cif_no ?? null;
  }

  // ─────────────────────────────────────────────────────────────────────────────

  // di src/modules/applications/applications.service.ts (dalam class ApplicationsService)

  private async recomputeAutoBump(appId: number, reviewerId?: number) {
    // cek apakah ada CONFIRMED DTTOT/PPPSPM
    const { rows: hits } = await this.pool.query(
      `SELECT list_type
     FROM screening_results
     WHERE application_id = $1
       AND review_status = 'CONFIRMED'
       AND list_type IN ('DTTOT','PPPSPM')
     LIMIT 1`,
      [appId],
    );

    if (hits.length) {
      const lt = hits[0].list_type as "DTTOT" | "PPPSPM";
      const reason = `AUTO_BUMP: CONFIRMED ${lt} hit`;

      // set/overwrite override hanya jika sebelumnya kosong atau juga AUTO_BUMP
      await this.pool.query(
        `INSERT INTO application_risk (application_id, risk_score, risk_level, factors,
                                     override_level, override_reason, override_by, override_at, created_at)
       VALUES ($1, 100, 'HIGH', COALESCE((SELECT factors FROM application_risk ar WHERE ar.application_id=$1),'{}'::jsonb),
               'HIGH', $2, $3, now(), now())
       ON CONFLICT (application_id) DO UPDATE SET
         override_level = CASE
           WHEN application_risk.override_reason IS NULL OR application_risk.override_reason LIKE 'AUTO_BUMP:%'
           THEN 'HIGH' ELSE application_risk.override_level END,
         override_reason = CASE
           WHEN application_risk.override_reason IS NULL OR application_risk.override_reason LIKE 'AUTO_BUMP:%'
           THEN EXCLUDED.override_reason ELSE application_risk.override_reason END,
         override_by = CASE
           WHEN application_risk.override_reason IS NULL OR application_risk.override_reason LIKE 'AUTO_BUMP:%'
           THEN EXCLUDED.override_by ELSE application_risk.override_by END,
         override_at = CASE
           WHEN application_risk.override_reason IS NULL OR application_risk.override_reason LIKE 'AUTO_BUMP:%'
           THEN now() ELSE application_risk.override_at END`,
        [appId, reason, reviewerId || null],
      );
      return;
    }

    // tidak ada CONFIRMED DTTOT/PPPSPM → bersihkan override kalau itu AUTO_BUMP
    await this.pool.query(
      `UPDATE application_risk
     SET override_level = NULL,
         override_reason = NULL,
         override_by = NULL,
         override_at = NULL
     WHERE application_id=$1
       AND override_reason LIKE 'AUTO_BUMP:%'`,
      [appId],
    );
  }

  // ── Region validation helpers ─────────────────────────────────────────────

  private async validateRegionHierarchy(dto: any) {
    const { province_code, city_code, district_code, village_code } = dto;

    if (province_code) {
      const { rows } = await this.pool.query(
        `SELECT code FROM ref_provinces WHERE code=$1`,
        [province_code],
      );
      if (!rows[0])
        throw new BadRequestException(
          `province_code '${province_code}' tidak ditemukan`,
        );
    }

    if (city_code) {
      const q: any[] = [city_code];
      let sql = `SELECT code, province_code FROM ref_regencies WHERE code=$1`;
      const { rows } = await this.pool.query(sql, q);
      if (!rows[0])
        throw new BadRequestException(
          `city_code '${city_code}' tidak ditemukan`,
        );
      if (province_code && rows[0].province_code !== province_code) {
        throw new BadRequestException(
          `city_code '${city_code}' bukan bagian dari province_code '${province_code}'`,
        );
      }
    }

    if (district_code) {
      const { rows } = await this.pool.query(
        `SELECT code, regency_code FROM ref_districts WHERE code=$1`,
        [district_code],
      );
      if (!rows[0])
        throw new BadRequestException(
          `district_code '${district_code}' tidak ditemukan`,
        );
      if (city_code && rows[0].regency_code !== city_code) {
        throw new BadRequestException(
          `district_code '${district_code}' bukan bagian dari city_code '${city_code}'`,
        );
      }
    }

    if (village_code) {
      const { rows } = await this.pool.query(
        `SELECT code, district_code FROM ref_villages WHERE code=$1`,
        [village_code],
      );
      if (!rows[0])
        throw new BadRequestException(
          `village_code '${village_code}' tidak ditemukan`,
        );
      if (district_code && rows[0].district_code !== district_code) {
        throw new BadRequestException(
          `village_code '${village_code}' bukan bagian dari district_code '${district_code}'`,
        );
      }
    }
  }

  private async resolveRegionNames(dto: any) {
    const names: Record<string, string | null> = {
      province_name: null,
      city_name: null,
      district_name: null,
      village_name: null,
    };
    if (dto.province_code) {
      const { rows } = await this.pool.query(
        `SELECT name FROM ref_provinces WHERE code=$1`,
        [dto.province_code],
      );
      names.province_name = rows[0]?.name ?? null;
    }
    if (dto.city_code) {
      const { rows } = await this.pool.query(
        `SELECT name FROM ref_regencies WHERE code=$1`,
        [dto.city_code],
      );
      names.city_name = rows[0]?.name ?? null;
    }
    if (dto.district_code) {
      const { rows } = await this.pool.query(
        `SELECT name FROM ref_districts WHERE code=$1`,
        [dto.district_code],
      );
      names.district_name = rows[0]?.name ?? null;
    }
    if (dto.village_code) {
      const { rows } = await this.pool.query(
        `SELECT name FROM ref_villages WHERE code=$1`,
        [dto.village_code],
      );
      names.village_name = rows[0]?.name ?? null;
    }
    return names;
  }

  // applications.service.ts
  async createIndividual(dto: any, userId: number, branchId?: number) {
    const norm = (s: string) => (s || "").replace(/\D+/g, "").trim(); // buang non-digit untuk KTP
    if (dto.identity_type === "KTP")
      dto.identity_number = norm(dto.identity_number);

    // Validate region hierarchy if any region codes are provided
    await this.validateRegionHierarchy(dto);

    // Validate industry_category if provided.
    // Accepts: old INDUSTRY_CATEGORIES values (legacy) OR exact RBA V01 industry names from INDUSTRY_MAP.
    if (dto.industry_category) {
      const { INDUSTRY_CATEGORIES } =
        await import("../references/references.service");
      const validOld = INDUSTRY_CATEGORIES.includes(dto.industry_category);
      const validRba = INDUSTRY_MAP.some(
        (e) => e.industry === dto.industry_category,
      );
      if (!validOld && !validRba) {
        throw new BadRequestException(
          `industry_category tidak valid: ${dto.industry_category}`,
        );
      }
    }

    // Validate monthly_income_range if provided
    if (dto.monthly_income_range) {
      const { MONTHLY_INCOME_RANGES } =
        await import("../references/references.service");
      if (!MONTHLY_INCOME_RANGES.includes(dto.monthly_income_range)) {
        throw new BadRequestException(
          `monthly_income_range tidak valid: ${dto.monthly_income_range}`,
        );
      }
    }

    // "Lainnya" companions — validate + resolve (never overrides dropdown value).
    const indivOther = this.resolveOtherFieldsCreate(dto, [
      { main: "occupation", other: "occupation_other", label: "Pekerjaan" },
      {
        main: "source_of_funds",
        other: "source_of_funds_other",
        label: "Sumber Dana",
      },
      {
        main: "business_relationship_purpose",
        other: "business_relationship_purpose_other",
        label: "Tujuan Hubungan Usaha",
      },
      {
        main: "industry_category",
        other: "industry_category_other",
        label: "Bidang Industri",
      },
      {
        main: "wic_transaction_purpose",
        other: "wic_transaction_purpose_other",
        label: "Tujuan Transaksi",
      },
      {
        main: "wic_recipient_relationship",
        other: "wic_recipient_relationship_other",
        label: "Hubungan dengan Penerima",
      },
    ]);

    // Resolve region names from codes
    const regionNames = await this.resolveRegionNames(dto);

    // Derive address_identity from structured fields if not explicitly provided
    const effectiveAddressIdentity: string | null =
      dto.address_identity ||
      [
        dto.street_address,
        dto.house_number ? `No. ${dto.house_number}` : null,
        dto.rt_rw ? `RT/RW ${dto.rt_rw}` : null,
        dto.apartment_block,
        regionNames.village_name,
        regionNames.district_name,
        regionNames.city_name,
        regionNames.province_name,
        dto.address_landmark ? `Patokan: ${dto.address_landmark}` : null,
      ]
        .filter(Boolean)
        .join(", ") ||
      null;

    const relType = this.normalizeCifRelationshipType(
      dto.cif_relationship_type,
    );

    // WIC (Walk-In Customer) minimum person fields. When an existing person is
    // reused (same identity_type + identity_number) the INSERT above is skipped,
    // so these must be applied on the reuse path too — otherwise a WIC created on
    // an existing identity would lack Tujuan Transaksi / Hubungan Penerima and
    // fail submit. COALESCE preserves current values when the payload omits them
    // (never wipes). cif_no is forced NULL because WIC must not carry a CIF.
    const wicPersonUpdateSql = `UPDATE persons SET
          cif_no = NULL,
          cif_relationship_type = 'WIC',
          wic_transaction_purpose = COALESCE($2, wic_transaction_purpose),
          wic_recipient_relationship = COALESCE($3, wic_recipient_relationship),
          address_identity = COALESCE($4, address_identity),
          pob = COALESCE($5, pob),
          dob = COALESCE($6::date, dob)
        WHERE id = $1`;
    const wicPersonUpdateParams = (pid: number) => [
      pid,
      dto.wic_transaction_purpose || null,
      dto.wic_recipient_relationship || null,
      effectiveAddressIdentity,
      dto.pob || null,
      dto.dob || null,
    ];

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1) coba cari person existing (khususnya utk KTP)
      let personId: number | null = null;
      let personHasCif = false;
      const { rows: found } = await client.query(
        `SELECT id, cif_no, cif_relationship_type FROM persons WHERE identity_type = $1 AND identity_number = $2 LIMIT 1`,
        [dto.identity_type, dto.identity_number],
      );
      if (found[0]) {
        personId = found[0].id;
        personHasCif = !!found[0].cif_no;
      }

      // 2) kalau belum ada, insert person baru
      if (!personId) {
        const ins = await client.query(
          `INSERT INTO persons (
            full_name, alias, identity_type, identity_number,
            ktp_number, sim_number, passport_number,
            address_identity, address_residential,
            province_code, province_name, city_code, city_name,
            district_code, district_name, village_code, village_name,
            street_address, house_number, rt_rw, apartment_block, address_landmark,
            pob, dob, nationality, phone, occupation,
            industry_category, company_name, company_address, monthly_income_range,
            gender, email, signature_uri,
            source_of_funds, business_relationship_purpose, distribution_channel,
            wic_transaction_purpose, wic_recipient_relationship,
            occupation_other, industry_category_other, source_of_funds_other,
            business_relationship_purpose_other,
            wic_transaction_purpose_other, wic_recipient_relationship_other
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
            $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,
            $35,$36,$37,$38,$39,
            $40,$41,$42,$43,$44,$45
          ) RETURNING id`,
          [
            dto.full_name,
            dto.alias || null,
            dto.identity_type,
            dto.identity_number,
            dto.ktp_number || null,
            dto.sim_number || null,
            dto.passport_number || null,
            effectiveAddressIdentity,
            dto.address_residential || null,
            dto.province_code || null,
            regionNames.province_name || null,
            dto.city_code || null,
            regionNames.city_name || null,
            dto.district_code || null,
            regionNames.district_name || null,
            dto.village_code || null,
            regionNames.village_name || null,
            dto.street_address || null,
            dto.house_number || null,
            dto.rt_rw || null,
            dto.apartment_block || null,
            dto.address_landmark || null,
            dto.pob,
            dto.dob,
            dto.nationality,
            dto.phone,
            dto.occupation,
            dto.industry_category || null,
            dto.company_name || null,
            dto.company_address || null,
            dto.monthly_income_range || null,
            dto.gender,
            dto.email || null,
            dto.signature_uri || null,
            dto.source_of_funds || null,
            dto.business_relationship_purpose || null,
            dto.distribution_channel || null,
            dto.wic_transaction_purpose || null,
            dto.wic_recipient_relationship || null,
            indivOther.occupation_other,
            indivOther.industry_category_other,
            indivOther.source_of_funds_other,
            indivOther.business_relationship_purpose_other,
            indivOther.wic_transaction_purpose_other,
            indivOther.wic_recipient_relationship_other,
          ],
        );
        personId = ins.rows[0].id;
      }

      // 3) CIF relationship handling.
      //    OUR_CUSTOMER gets a CIF. WIC (Walk-In Customer) must NOT get a CIF.
      //    If the same identity already has CIF, do not allow it to be downgraded
      //    into WIC because CIF is person-level data and may be used by other apps.
      if (relType === "WIC") {
        if (personHasCif) {
          throw new BadRequestException(
            "Identitas ini sudah memiliki CIF dan tidak dapat didaftarkan sebagai Walk-In Customer (WIC).",
          );
        }
        await client.query(wicPersonUpdateSql, wicPersonUpdateParams(personId!));
      } else if (!personHasCif) {
        const existingCif = await this.resolveCifForIdentity(
          dto.identity_number,
        );
        const cif =
          existingCif ??
          (await this.generateIndividualCif(dto.identity_number));
        await client.query(
          `UPDATE persons SET cif_no = $1, cif_relationship_type = 'OUR_CUSTOMER' WHERE id = $2 AND cif_no IS NULL`,
          [cif, personId],
        );
      } else {
        await client.query(
          `UPDATE persons SET cif_relationship_type = COALESCE(cif_relationship_type, 'OUR_CUSTOMER') WHERE id = $1`,
          [personId],
        );
      }

      // 3) buat application dengan status DRAFT
      const appRes = await client.query(
        `INSERT INTO applications (type, status, branch_id, created_by, person_id)
       VALUES ('INDIVIDUAL','DRAFT',$1,$2,$3)
       RETURNING id, status`,
        [branchId || null, userId, personId],
      );

      const app = appRes.rows[0];

      await client.query("COMMIT");
      return app;
    } catch (e: any) {
      await client.query("ROLLBACK");

      // race condition fallback: jika bentrok unik, ambil person existing lalu lanjut bikin app
      if (e?.code === "23505") {
        const { rows } = await this.pool.query(
          `SELECT id FROM persons WHERE identity_type=$1 AND identity_number=$2 LIMIT 1`,
          [dto.identity_type, dto.identity_number],
        );
        const personId = rows[0]?.id;
        if (personId) {
          const { rows: pRows } = await this.pool.query(
            `SELECT cif_no FROM persons WHERE id=$1`,
            [personId],
          );
          if (relType === "WIC") {
            if (pRows[0]?.cif_no) {
              throw new BadRequestException(
                "Identitas ini sudah memiliki CIF dan tidak dapat didaftarkan sebagai Walk-In Customer (WIC).",
              );
            }
            await this.pool.query(
              wicPersonUpdateSql,
              wicPersonUpdateParams(personId),
            );
          } else if (!pRows[0]?.cif_no) {
            const existingCif = await this.resolveCifForIdentity(
              dto.identity_number,
            );
            const cif =
              existingCif ??
              (await this.generateIndividualCif(dto.identity_number));
            await this.pool.query(
              `UPDATE persons SET cif_no=$1, cif_relationship_type='OUR_CUSTOMER' WHERE id=$2 AND cif_no IS NULL`,
              [cif, personId],
            );
          }

          const appRes = await this.pool.query(
            `INSERT INTO applications (type, status, branch_id, created_by, person_id)
           VALUES ('INDIVIDUAL','DRAFT',$1,$2,$3)
           RETURNING id, status`,
            [branchId || null, userId, personId],
          );

          return appRes.rows[0];
        }
      }

      throw e;
    } finally {
      client.release();
    }
  }

  async isOnWatchlist(
    fullName: string,
    aliases: string[],
    identityNumber: string,
  ) {
    const nameNorm = fullName.trim().toUpperCase();
    const aliasNorms = (aliases || []).map((a) => a.trim().toUpperCase());

    const q = await this.pool.query(
      `SELECT id FROM watchlist_entries
     WHERE name_norm = $1
        OR $2::text[] && aliases
        OR national_id_number = $3
     LIMIT 1`,
      [nameNorm, aliasNorms, identityNumber],
    );

    return (q.rowCount ?? 0) > 0; // true kalau ada di watchlist
  }

  async updateIndividualCdd(appId: number, dto: any, userId: number) {
    void userId;
    const { rows: apps } = await this.pool.query(
      `SELECT id, type, status, person_id FROM applications WHERE id=$1`,
      [appId],
    );
    const app = apps[0];
    if (!app) throw new NotFoundException("Application not found");
    if (app.type !== "INDIVIDUAL" || !app.person_id) {
      throw new BadRequestException(
        "Update CDD hanya berlaku untuk aplikasi Individual",
      );
    }
    if (!["DRAFT", "REVISION_REQUIRED"].includes(app.status)) {
      throw new BadRequestException(
        "Data CDD hanya dapat diubah saat status DRAFT atau REVISION_REQUIRED",
      );
    }

    const clean = (v: any) =>
      typeof v === "string" && v.trim() === "" ? null : (v ?? null);
    const normKtp = (v: any) =>
      typeof v === "string" ? v.replace(/\D+/g, "").trim() : v;

    if (dto.ktp_number) {
      dto.ktp_number = normKtp(dto.ktp_number);
      if (!/^\d{15,16}$/.test(dto.ktp_number)) {
        throw new BadRequestException("ktp_number harus 15-16 digit angka");
      }
    }
    if (dto.sim_number && String(dto.sim_number).length > 20) {
      throw new BadRequestException("sim_number maksimal 20 karakter");
    }
    if (dto.passport_number && String(dto.passport_number).length > 20) {
      throw new BadRequestException("passport_number maksimal 20 karakter");
    }

    await this.validateRegionHierarchy(dto);

    if (dto.industry_category) {
      const { INDUSTRY_CATEGORIES } =
        await import("../references/references.service");
      const validOld = INDUSTRY_CATEGORIES.includes(dto.industry_category);
      const validRba = INDUSTRY_MAP.some(
        (e) => e.industry === dto.industry_category,
      );
      if (!validOld && !validRba) {
        throw new BadRequestException(
          `industry_category tidak valid: ${dto.industry_category}`,
        );
      }
    }

    if (dto.monthly_income_range) {
      const { MONTHLY_INCOME_RANGES } =
        await import("../references/references.service");
      if (!MONTHLY_INCOME_RANGES.includes(dto.monthly_income_range)) {
        throw new BadRequestException(
          `monthly_income_range tidak valid: ${dto.monthly_income_range}`,
        );
      }
    }

    const validDistributions = [
      "Aplikasi Digital",
      "Agen Pihak Ketiga",
      "Outlet Fisik",
    ];
    if (
      dto.distribution_channel &&
      !validDistributions.includes(dto.distribution_channel)
    ) {
      throw new BadRequestException(
        `distribution_channel tidak valid: ${dto.distribution_channel}`,
      );
    }

    const relType = this.normalizeCifRelationshipType(
      dto.cif_relationship_type,
    );

    const regionNames = await this.resolveRegionNames(dto);
    const effectiveAddressIdentity: string | null =
      dto.address_identity ||
      [
        dto.street_address,
        dto.house_number ? `No. ${dto.house_number}` : null,
        dto.rt_rw ? `RT/RW ${dto.rt_rw}` : null,
        dto.apartment_block,
        regionNames.village_name,
        regionNames.district_name,
        regionNames.city_name,
        regionNames.province_name,
        dto.address_landmark ? `Patokan: ${dto.address_landmark}` : null,
      ]
        .filter(Boolean)
        .join(", ") ||
      null;

    await this.pool.query(
      `UPDATE persons SET
          alias = $1,
          ktp_number = $2,
          identity_number = COALESCE($3, identity_number),
          sim_number = $4,
          passport_number = $5,
          province_code = $6,
          province_name = $7,
          city_code = $8,
          city_name = $9,
          district_code = $10,
          district_name = $11,
          village_code = $12,
          village_name = $13,
          street_address = $14,
          house_number = $15,
          rt_rw = $16,
          apartment_block = $17,
          address_landmark = $18,
          address_identity = $19,
          nationality = $20,
          occupation = $21,
          industry_category = $22,
          company_name = $23,
          company_address = $24,
          monthly_income_range = $25,
          source_of_funds = $26,
          business_relationship_purpose = $27,
          distribution_channel = $28
       WHERE id = $29`,
      [
        clean(dto.alias),
        clean(dto.ktp_number),
        clean(dto.ktp_number),
        clean(dto.sim_number),
        clean(dto.passport_number),
        clean(dto.province_code),
        regionNames.province_name,
        clean(dto.city_code),
        regionNames.city_name,
        clean(dto.district_code),
        regionNames.district_name,
        clean(dto.village_code),
        regionNames.village_name,
        clean(dto.street_address),
        clean(dto.house_number),
        clean(dto.rt_rw),
        clean(dto.apartment_block),
        clean(dto.address_landmark),
        effectiveAddressIdentity,
        clean(dto.nationality),
        clean(dto.occupation),
        clean(dto.industry_category),
        clean(dto.company_name),
        clean(dto.company_address),
        clean(dto.monthly_income_range),
        clean(dto.source_of_funds),
        clean(dto.business_relationship_purpose),
        clean(dto.distribution_channel),
        app.person_id,
      ],
    );

    // WIC minimum CDD fields (Tujuan Transaksi & Hubungan dengan Penerima) are
    // only touched when the PATCH body actually carries the key. Omitting them
    // must PRESERVE the values saved at create time — otherwise an unrelated
    // edit on the detail page would wipe them and block WIC submit. An explicit
    // value (including empty → null) is still honoured when sent.
    const hasKey = (k: string) =>
      Object.prototype.hasOwnProperty.call(dto, k);
    if (hasKey("wic_transaction_purpose")) {
      await this.pool.query(
        `UPDATE persons SET wic_transaction_purpose = $1 WHERE id = $2`,
        [clean(dto.wic_transaction_purpose), app.person_id],
      );
    }
    if (hasKey("wic_recipient_relationship")) {
      await this.pool.query(
        `UPDATE persons SET wic_recipient_relationship = $1 WHERE id = $2`,
        [clean(dto.wic_recipient_relationship), app.person_id],
      );
    }

    // "Lainnya" companions. occupation/source_of_funds/business purpose/industry
    // follow the same full-replace semantics as their main columns above; the WIC
    // pairs are conditional (preserve when the main key is omitted).
    await this.applyOtherFieldsPatch(app.person_id, dto, [
      { main: "occupation", other: "occupation_other" },
      { main: "source_of_funds", other: "source_of_funds_other" },
      {
        main: "business_relationship_purpose",
        other: "business_relationship_purpose_other",
      },
      { main: "industry_category", other: "industry_category_other" },
      {
        main: "wic_transaction_purpose",
        other: "wic_transaction_purpose_other",
        mainConditional: true,
      },
      {
        main: "wic_recipient_relationship",
        other: "wic_recipient_relationship_other",
        mainConditional: true,
      },
    ]);

    if (relType === "WIC") {
      await this.pool.query(
        `UPDATE persons SET cif_no = NULL, cif_relationship_type = 'WIC' WHERE id = $1`,
        [app.person_id],
      );
    } else {
      const { rows: personRows } = await this.pool.query(
        `SELECT identity_number, cif_no FROM persons WHERE id = $1`,
        [app.person_id],
      );
      if (!personRows[0]?.cif_no) {
        const existingCif = await this.resolveCifForIdentity(
          personRows[0]?.identity_number,
        );
        const cif =
          existingCif ??
          (await this.generateIndividualCif(personRows[0]?.identity_number));
        await this.pool.query(
          `UPDATE persons SET cif_no = $1, cif_relationship_type = 'OUR_CUSTOMER' WHERE id = $2 AND cif_no IS NULL`,
          [cif, app.person_id],
        );
      } else {
        await this.pool.query(
          `UPDATE persons SET cif_relationship_type = 'OUR_CUSTOMER' WHERE id = $1`,
          [app.person_id],
        );
      }
    }

    return this.getDetail(appId);
  }

  // Optional share ownership percentage (Director/Commissioner). Returns null when
  // not provided; validates 0..100 when provided. Accepts numeric or numeric-string.
  private normalizeSharePercentage(
    value: unknown,
    label: string,
  ): number | null {
    if (value === undefined || value === null || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) {
      throw new BadRequestException(`${label} harus berupa angka.`);
    }
    if (n < 0 || n > 100) {
      throw new BadRequestException(`${label} harus di antara 0 dan 100.`);
    }
    return n;
  }

  async createBusiness(dto: any, userId: number, branchId?: number) {
    // ── B.5 NPWP Badan Usaha: wajib tepat 15 digit angka (digits only) ─────────
    const npwpRaw = typeof dto.npwp === "string" ? dto.npwp.trim() : "";
    if (!/^\d{15}$/.test(npwpRaw)) {
      throw new BadRequestException("NPWP Badan Usaha wajib 15 digit angka.");
    }

    // ── B.1 Nomor Akta Pendirian wajib bila bentuk badan usaha = PT ────────────
    const legalFormNorm = String(dto.legal_form ?? "")
      .trim()
      .replace(/\.$/, "")
      .toUpperCase();
    const deedProvided =
      typeof dto.deed_number === "string" && dto.deed_number.trim().length > 0;
    if (legalFormNorm === "PT" && !deedProvided) {
      throw new BadRequestException(
        "Nomor Akta Pendirian wajib diisi untuk badan usaha PT.",
      );
    }

    // ── B.2 Nomor Identitas Pengurus Utama (PIC): maksimal 16 karakter ─────────
    if (
      dto.pic_identity_number &&
      String(dto.pic_identity_number).length > 16
    ) {
      throw new BadRequestException("Nomor Identitas maksimal 16 karakter.");
    }

    // ── Pengurus dan Pemegang Saham — porsi kepemilikan saham (opsional) ───────
    // Direktur Utama / Komisaris. Bila diisi wajib 0–100 (boleh desimal).
    const directorShare = this.normalizeSharePercentage(
      dto.director_share_percentage,
      "Porsi kepemilikan saham Direktur Utama",
    );
    const commissionerShare = this.normalizeSharePercentage(
      dto.commissioner_share_percentage,
      "Porsi kepemilikan saham Komisaris",
    );

    // ── B.3 Alamat Kedudukan — validasi & resolusi dropdown provinsi/kota ──────
    const bizRegion = await this.validateAndResolveBusinessRegion(dto);

    // ── A. "Lainnya" companions — validate + resolve (preserve dropdown value) ─
    const bizOther = this.resolveOtherFieldsCreate(dto, [
      { main: "legal_form", other: "legal_form_other", label: "Bentuk Badan Usaha" },
      {
        main: "business_activity",
        other: "business_activity_other",
        label: "Bidang Usaha",
      },
      {
        main: "source_of_funds",
        other: "source_of_funds_other",
        label: "Sumber Dana",
      },
      {
        main: "business_relationship_purpose",
        other: "business_relationship_purpose_other",
        label: "Tujuan Hubungan Usaha",
      },
    ]);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const q = await client.query(
        `INSERT INTO business_entities (legal_name, legal_form, incorporation_place, incorporation_date,
          business_license_number, nib, npwp, address_line, city, province, postal_code, business_activity, industry_code, phone,
          deed_number, company_email,
          pic_name, pic_position, pic_identity_number, pic_identity_type,
          representative_signature_name, verification_officer, supervisor,
          source_of_funds, business_relationship_purpose, distribution_channel,
          legal_form_other, business_activity_other, source_of_funds_other, business_relationship_purpose_other,
          business_province_code, business_province_name, business_city_code, business_city_name,
          director_share_percentage, commissioner_share_percentage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
          $27,$28,$29,$30,$31,$32,$33,$34,$35,$36)
         RETURNING id`,
        [
          dto.legal_name,
          dto.legal_form,
          dto.incorporation_place,
          dto.incorporation_date,
          dto.business_license_number ?? null,
          dto.nib ?? null,
          dto.npwp,
          dto.address_line,
          dto.city,
          dto.province,
          dto.postal_code,
          dto.business_activity,
          dto.industry_code || null,
          dto.phone,
          dto.deed_number ?? dto.business_license_number ?? null,
          dto.company_email ?? null,
          dto.pic_name ?? null,
          dto.pic_position ?? null,
          dto.pic_identity_number ?? null,
          dto.pic_identity_type ?? null,
          dto.representative_signature_name ?? null,
          dto.verification_officer ?? null,
          dto.supervisor ?? null,
          dto.source_of_funds ?? null,
          dto.business_relationship_purpose ?? null,
          dto.distribution_channel ?? null,
          bizOther.legal_form_other,
          bizOther.business_activity_other,
          bizOther.source_of_funds_other,
          bizOther.business_relationship_purpose_other,
          bizRegion.business_province_code,
          bizRegion.business_province_name,
          bizRegion.business_city_code,
          bizRegion.business_city_name,
          directorShare,
          commissionerShare,
        ],
      );
      const businessId = q.rows[0].id;

      // Generate CIF — sequence is non-transactional, safe to call outside transaction
      const cif = await this.generateBusinessCif(dto.nib, dto.npwp);
      await client.query(
        `UPDATE business_entities SET cif_no = $1 WHERE id = $2`,
        [cif, businessId],
      );

      const appRes = await client.query(
        `INSERT INTO applications (type, status, branch_id, created_by, business_id)
         VALUES ('BUSINESS','DRAFT',$1,$2,$3)
         RETURNING id, status`,
        [branchId || null, userId, businessId],
      );

      await client.query("COMMIT");
      return appRes.rows[0];
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async addDocument(
    appId: number,
    dto: { doc_type: string; file_uri: string; extracted_json?: any },
  ) {
    const { rows: apps } = await this.pool.query(
      `SELECT id FROM applications WHERE id=$1`,
      [appId],
    );
    if (!apps[0]) throw new NotFoundException("Application not found");

    // Dokumen tidak punya workflow review — record hanya dibuat setelah file
    // berhasil di-upload ke storage, jadi status langsung UPLOADED (sukses).
    const res = await this.pool.query(
      `INSERT INTO documents (application_id, doc_type, file_uri, status, extracted_json)
       VALUES ($1,$2,$3,'UPLOADED',$4)
       RETURNING id, application_id, doc_type, file_uri, status, extracted_json, created_at`,
      [appId, dto.doc_type, dto.file_uri, dto.extracted_json || null],
    );
    return res.rows[0];
  }

  /**
   * Ringkasan status watchlist Business per kategori: perusahaan, pengurus,
   * pemegang saham. Murni baca dari screening_results yang sudah ada (tidak
   * mengubah perhitungan risk). Default CLEAR bila belum ada screening.
   *   MATCH      → ada hit CONFIRMED
   *   NEAR_MATCH → ada hit yang belum di-clear (bukan FALSE_POSITIVE/DISMISSED)
   *   CLEAR      → tidak ada hit relevan
   */
  private async getBusinessWatchlistStatuses(appId: number) {
    const result = {
      company_watchlist_status: "CLEAR",
      management_watchlist_status: "CLEAR",
      shareholder_watchlist_status: "CLEAR",
    };

    const { rows } = await this.pool.query(
      `SELECT sr.subject_type,
              COALESCE(sr.review_status::text, 'UNREVIEWED') AS review_status,
              bp.role
         FROM screening_results sr
         LEFT JOIN business_parties bp
           ON sr.subject_type = 'PARTY' AND bp.id = sr.subject_ref
        WHERE sr.application_id = $1`,
      [appId],
    );

    const rank: Record<string, number> = { CLEAR: 0, NEAR_MATCH: 1, MATCH: 2 };
    const classify = (review_status: string) => {
      if (["FALSE_POSITIVE", "DISMISSED"].includes(review_status))
        return "CLEAR";
      return review_status === "CONFIRMED" ? "MATCH" : "NEAR_MATCH";
    };
    const bump = (key: keyof typeof result, status: string) => {
      if (rank[status] > rank[result[key]]) result[key] = status;
    };

    const MGMT = ["DIRECTOR", "COMMISSIONER", "MANAGER", "AUTHORIZED_REP"];
    const SHAREHOLDERS = ["SHAREHOLDER", "BO"];

    for (const r of rows) {
      const status = classify(r.review_status);
      if (status === "CLEAR") continue;
      if (r.subject_type === "BUSINESS") {
        bump("company_watchlist_status", status);
      } else if (r.subject_type === "PARTY") {
        if (MGMT.includes(r.role)) bump("management_watchlist_status", status);
        else if (SHAREHOLDERS.includes(r.role))
          bump("shareholder_watchlist_status", status);
        else bump("management_watchlist_status", status);
      }
    }

    return result;
  }

  async getDetail(appId: number) {
    const { rows: apps } = await this.pool.query(
      `SELECT * FROM applications WHERE id=$1`,
      [appId],
    );
    const app = apps[0];
    if (!app) throw new NotFoundException("Application not found");

    // person — semua field yang dibutuhkan FE
    let person: any = null;
    if (app.person_id) {
      const { rows: pr } = await this.pool.query(
        `SELECT id, full_name, alias, identity_type, identity_number,
                ktp_number, sim_number, passport_number,
                pob, dob, nationality, phone, email, gender,
                occupation, occupation_other,
                industry_category, industry_category_other,
                company_name, company_address, monthly_income_range,
                source_of_funds, source_of_funds_other,
                business_relationship_purpose, business_relationship_purpose_other,
                distribution_channel,
                wic_transaction_purpose, wic_transaction_purpose_other,
                wic_recipient_relationship, wic_recipient_relationship_other,
                address_identity, address_residential,
                province_code, province_name, city_code, city_name,
                district_code, district_name, village_code, village_name,
                street_address, house_number, rt_rw, apartment_block, address_landmark,
                signature_uri, pep_self_declared, cif_no, cif_relationship_type
         FROM persons WHERE id=$1`,
        [app.person_id],
      );
      person = pr[0] ?? null;
    }

    // business — semua field yang dibutuhkan FE
    // Catatan: trade_name (Nama Dagang) sengaja tidak diekspos lagi pada CDD form terbaru.
    let business: any = null;
    if (app.business_id) {
      const { rows: biz } = await this.pool.query(
        `SELECT id, legal_name, legal_form, legal_form_other,
                incorporation_place, incorporation_date,
                deed_number, business_license_number, company_email,
                nib, npwp, address_line, city, province, postal_code,
                business_province_code, business_province_name,
                business_city_code, business_city_name,
                phone, industry_code, business_activity, business_activity_other, cif_no,
                source_of_funds, source_of_funds_other,
                business_relationship_purpose, business_relationship_purpose_other,
                distribution_channel,
                pic_name, pic_position, pic_identity_number, pic_identity_type,
                director_share_percentage, commissioner_share_percentage,
                representative_signature_name, verification_officer, supervisor
         FROM business_entities WHERE id=$1`,
        [app.business_id],
      );
      business = biz[0] ?? null;
      if (business) {
        // Alias label form terbaru (tanpa menduplikasi kolom fisik).
        business.business_form = business.legal_form;
        business.business_form_other = business.legal_form_other;
        // pg mengembalikan NUMERIC sebagai string — kembalikan sebagai number|null.
        business.director_share_percentage =
          business.director_share_percentage === null
            ? null
            : Number(business.director_share_percentage);
        business.commissioner_share_percentage =
          business.commissioner_share_percentage === null
            ? null
            : Number(business.commissioner_share_percentage);
        // Ringkasan status watchlist per kategori (opsional; default CLEAR).
        const wl = await this.getBusinessWatchlistStatuses(appId);
        business.company_watchlist_status = wl.company_watchlist_status;
        business.management_watchlist_status = wl.management_watchlist_status;
        business.shareholder_watchlist_status = wl.shareholder_watchlist_status;
      }
    }

    // documents
    const { rows: docs } = await this.pool.query(
      `SELECT id, application_id, doc_type, file_uri, status, extracted_json, created_at
       FROM documents WHERE application_id=$1 ORDER BY created_at DESC`,
      [appId],
    );

    // parties (BUSINESS only)
    let parties: any[] = [];
    if (app.business_id) {
      const { rows } = await this.pool.query(
        `SELECT bp.id, bp.role, bp.is_active, bp.created_at,
                bp.cif_no, bp.cif_relationship_type,
                bp.ownership_percentage, bp.address,
                bp.identity_document_type,
                bp.source_of_funds, bp.source_of_funds_other,
                bp.source_of_wealth, bp.source_of_wealth_other,
                p.id as person_id, p.full_name, p.identity_type, p.identity_number
         FROM business_parties bp
         JOIN persons p ON p.id = bp.person_id
         WHERE bp.business_id = $1
         ORDER BY bp.created_at DESC`,
        [app.business_id],
      );
      parties = rows;
    }

    // risk (null kalau belum di-submit)
    const { rows: riskRows } = await this.pool.query(
      `SELECT application_id, risk_score::float AS risk_score, risk_level,
              factors, risk_factors,
              override_level, override_reason, override_by, override_at, created_at,
              rba_version, rba_score_v01::float AS rba_score_v01, rba_calculation_status,
              rba_unmapped_parameters, rba_components
       FROM application_risk WHERE application_id=$1`,
      [appId],
    );
    const risk = riskRows[0] ?? null;

    // edd summary — selalu ada key edd_required & edd_completed
    const { rows: eddRows } = await this.pool.query(
      `SELECT edd_required, edd_completed FROM application_edd WHERE application_id=$1`,
      [appId],
    );
    const edd = eddRows[0]
      ? {
          edd_required: eddRows[0].edd_required,
          edd_completed: eddRows[0].edd_completed,
        }
      : { edd_required: false, edd_completed: false };

    return {
      application: app,
      person,
      business,
      documents: docs,
      parties,
      risk,
      edd,
    };
  }

  async validateBeforeSubmit(appId: number) {
    const { rows } = await this.pool.query(
      `SELECT id, type, person_id, business_id FROM applications WHERE id=$1`,
      [appId],
    );
    const app = rows[0];
    if (!app) throw new NotFoundException("Application not found");

    // ambil dokumen — dokumen wajib dianggap valid jika record ada & file
    // sukses ter-upload (status <> 'FAILED'). Tidak ada review/approval dokumen.
    const { rows: docs } = await this.pool.query(
      `SELECT doc_type FROM documents WHERE application_id=$1 AND status <> 'FAILED'`,
      [appId],
    );
    const docSet = new Set(docs.map((d) => d.doc_type));

    if (app.type === "INDIVIDUAL") {
      const missing: string[] = [];

      const { rows: relRows } = await this.pool.query(
        `SELECT COALESCE(cif_relationship_type, 'OUR_CUSTOMER') AS cif_relationship_type,
                full_name, identity_type, identity_number, address_identity,
                pob, dob, wic_transaction_purpose, wic_recipient_relationship
           FROM persons WHERE id=$1`,
        [app.person_id],
      );
      const person = relRows[0] ?? {};
      const isWic = person.cif_relationship_type === "WIC";

      if (isWic) {
        // WIC follows the minimum CDD from the walk-in customer form: identity +
        // place/date of birth + transaction purpose + recipient relationship, plus
        // the two WIC documents. It must NOT be blocked by full KYC fields (phone,
        // nationality, occupation, gender) or the selfie / selfie-with-ID photos.
        const blank = (v: unknown) =>
          v === null || v === undefined || String(v).trim().length === 0;

        if (blank(person.full_name)) missing.push("Nama Lengkap");
        if (blank(person.identity_type) || blank(person.identity_number))
          missing.push("Nomor Identitas (KTP/SIM/Paspor)");
        if (blank(person.address_identity))
          missing.push("Alamat sesuai identitas");
        if (blank(person.pob) || blank(person.dob))
          missing.push("Tempat & Tanggal Lahir");
        if (blank(person.wic_transaction_purpose))
          missing.push("Tujuan Transaksi");
        if (blank(person.wic_recipient_relationship))
          missing.push("Hubungan dengan Penerima");

        const hasIdentityDoc =
          docSet.has("WIC_IDENTITY_DOCUMENT") ||
          docSet.has("INDIVIDUAL_KTP_PHOTO") ||
          docSet.has("KTP") ||
          docSet.has("SIM") ||
          docSet.has("PASPOR");
        const hasSignatureOrBiometric =
          docSet.has("WIC_SIGNATURE_BIOMETRIC") ||
          docSet.has("WIC_SIGNATURE") ||
          docSet.has("SIGNATURE") ||
          docSet.has("BIOMETRIC");

        if (!hasIdentityDoc) missing.push("Dokumen Identitas WIC");
        if (!hasSignatureOrBiometric)
          missing.push("Tanda Tangan / Biometrik WIC");
      } else {
        const hasPhotoKtp =
          docSet.has("INDIVIDUAL_KTP_PHOTO") ||
          docSet.has("KTP") ||
          docSet.has("SIM") ||
          docSet.has("PASPOR");
        if (!hasPhotoKtp) missing.push("dokumen foto KTP (INDIVIDUAL_KTP_PHOTO)");
        if (!docSet.has("INDIVIDUAL_FACE_PHOTO"))
          missing.push("dokumen foto wajah (INDIVIDUAL_FACE_PHOTO)");
        if (!docSet.has("INDIVIDUAL_FACE_WITH_KTP_PHOTO"))
          missing.push(
            "dokumen foto wajah dengan KTP (INDIVIDUAL_FACE_WITH_KTP_PHOTO)",
          );
      }

      if (missing.length) {
        throw new BadRequestException({
          message: isWic
            ? `WIC CDD minimum belum lengkap: ${missing.join(", ")}`
            : "INDIVIDUAL belum lengkap untuk submit",
          missing,
        });
      }
      return { ok: true };
    }

    if (app.type === "BUSINESS") {
      // Dokumen wajib Business. Terima nama baru (BUSINESS_*) maupun legacy.
      // Legacy alias hanya ada untuk 3 core doc; management/shareholder/BO adalah
      // tipe dokumen baru sehingga tidak punya alias lama.
      const hasAny = (aliases: string[]) => aliases.some((a) => docSet.has(a));
      const hasDeed = hasAny([
        "AKTA_PENDIRIAN",
        "BUSINESS_DEED_ESTABLISHMENT_AMENDMENT",
      ]);
      const hasLicense = hasAny(["NIB_SIUP", "BUSINESS_LICENSE"]);
      const hasNpwp = hasAny(["NPWP_BADAN", "BUSINESS_NPWP"]);
      const hasManagement = hasAny(["BUSINESS_MANAGEMENT_IDENTITY"]);
      const hasShareholderDoc = hasAny(["BUSINESS_SHAREHOLDER_IDENTITY_25"]);
      const hasBoDoc = hasAny(["BUSINESS_BO_DOCUMENT"]);

      // parties — untuk cek keberadaan pengurus & kondisi dokumen kondisional
      const { rows: parties } = await this.pool.query(
        `SELECT role, ownership_percentage FROM business_parties WHERE business_id=$1 AND is_active = TRUE`,
        [app.business_id],
      );
      const roles = new Set(parties.map((p) => p.role));
      const hasPengurus = roles.has("DIRECTOR") || roles.has("COMMISSIONER");
      const hasBO = roles.has("BO") || roles.has("BENEFICIAL_OWNER");
      const hasAuthRep = roles.has("AUTHORIZED_REP");
      const hasAnyRequiredParty = hasPengurus || hasBO || hasAuthRep;

      // Dokumen kondisional:
      //  - Identitas Pemegang Saham ≥25% wajib bila ada SHAREHOLDER dgn ownership ≥25
      //  - Dokumen BO wajib bila ada party BO
      const needsShareholderDoc = parties.some(
        (p) =>
          p.role === "SHAREHOLDER" && Number(p.ownership_percentage ?? 0) >= 25,
      );
      const needsBoDoc = hasBO;

      // Susun daftar dokumen wajib yang belum lengkap (label yang jelas).
      const missingDocs: string[] = [];
      if (!hasDeed) missingDocs.push("Akta Pendirian & Perubahan");
      if (!hasLicense) missingDocs.push("NIB / Izin Usaha");
      if (!hasNpwp) missingDocs.push("NPWP Badan Usaha");
      if (!hasManagement) missingDocs.push("Dokumen Identitas Pengurus");
      if (needsShareholderDoc && !hasShareholderDoc)
        missingDocs.push("Dokumen Identitas Pemegang Saham ≥25%");
      if (needsBoDoc && !hasBoDoc) missingDocs.push("Dokumen BO");

      const docMessage =
        missingDocs.length > 0
          ? `Dokumen wajib belum lengkap: ${missingDocs.join(", ")}`
          : null;

      // Nomor Izin Usaha (NIB/OSS/SIUP/dll): cukup salah satu dari
      // business_license_number ATAU nib yang terisi — tidak wajib keduanya.
      const { rows: bizRows } = await this.pool.query(
        `SELECT business_license_number, nib FROM business_entities WHERE id=$1`,
        [app.business_id],
      );
      const biz = bizRows[0] ?? {};
      const notEmpty = (v: unknown) =>
        v !== null && v !== undefined && String(v).trim().length > 0;
      const hasLicenseOrNib =
        notEmpty(biz.business_license_number) || notEmpty(biz.nib);
      const licenseMessage = hasLicenseOrNib
        ? null
        : "Nomor Izin Usaha (NIB/OSS/SIUP/dll) wajib diisi.";

      const missing: string[] = [];
      if (docMessage) missing.push(docMessage);
      if (licenseMessage) missing.push(licenseMessage);
      if (!hasAnyRequiredParty)
        missing.push(
          "minimal 1 party: (DIRECTOR/COMMISSIONER) atau BO atau AUTHORIZED_REP",
        );

      if (missing.length) {
        throw new BadRequestException({
          message:
            docMessage ??
            licenseMessage ??
            "BUSINESS belum lengkap untuk submit",
          missing,
        });
      }
      return { ok: true };
    }

    // fallback
    return { ok: true };
  }

  /**
   * Internal Preliminary Risk Scoring — RBA v2.
   * Bukan formula resmi BI. Digunakan sebagai dasar review compliance internal.
   */
  async screenAndComputeRisk(appId: number) {
    // ── 1. Ambil aplikasi ──
    const { rows: apps } = await this.pool.query(
      `SELECT id, type, person_id, business_id FROM applications WHERE id=$1`,
      [appId],
    );
    const app = apps[0];
    if (!app) throw new NotFoundException("Application not found");

    // ── 2. Bangun daftar subjek untuk di-screen ──
    type Subject = {
      subject_type: "INDIVIDUAL" | "BUSINESS" | "PARTY";
      name: string;
      dob?: string | null;
      nationality?: string | null;
      ref?: number | null;
    };
    const subjects: Subject[] = [];

    if (app.type === "INDIVIDUAL") {
      const { rows: p } = await this.pool.query(
        `SELECT id, full_name AS name, dob::text AS dob, nationality FROM persons WHERE id=$1`,
        [app.person_id],
      );
      if (p[0])
        subjects.push({
          subject_type: "INDIVIDUAL",
          name: p[0].name,
          dob: p[0].dob,
          nationality: p[0].nationality,
          ref: p[0].id,
        });
    } else if (app.type === "BUSINESS") {
      const { rows: b } = await this.pool.query(
        `SELECT id, legal_name AS name, country AS nationality FROM business_entities WHERE id=$1`,
        [app.business_id],
      );
      if (b[0])
        subjects.push({
          subject_type: "BUSINESS",
          name: b[0].name,
          nationality: b[0].nationality || null,
          ref: b[0].id,
        });

      const { rows: parties } = await this.pool.query(
        `SELECT bp.id as party_id, p.full_name as name, p.dob::text as dob, p.nationality
         FROM business_parties bp
         JOIN persons p ON p.id = bp.person_id
         WHERE bp.business_id=$1 AND bp.is_active = TRUE`,
        [app.business_id],
      );
      for (const r of parties)
        subjects.push({
          subject_type: "PARTY",
          name: r.name,
          dob: r.dob,
          nationality: r.nationality,
          ref: r.party_id,
        });
    }

    // ── 3. Bersihkan screening lama & jalankan screening baru ──
    await this.pool.query(
      `DELETE FROM screening_results WHERE application_id=$1`,
      [appId],
    );

    for (const s of subjects) {
      const expr = `upper(regexp_replace($1, '\\s+', ' ', 'g'))`;
      const { rows: candidates } = await this.pool.query(
        `SELECT id, list_type, name, date_of_birth, nationality,
                similarity(name_norm, ${expr}) AS score
         FROM watchlist_entries
         WHERE name_norm % ${expr}
            OR (aliases_concat IS NOT NULL AND aliases_concat % ${expr})
         ORDER BY score DESC LIMIT 30`,
        [s.name],
      );
      for (const c of candidates) {
        if (Number(c.score) < SIMILARITY_THRESHOLD) continue;
        // entity_ref CHECK constraint: 'PERSON' | 'BUSINESS' | 'BO'
        const entityRef = s.subject_type === "BUSINESS" ? "BUSINESS" : "PERSON";

        await this.pool.query(
          `INSERT INTO screening_results
             (application_id, subject_type, entity_ref, subject_ref, ref_id,
              list_type, watchlist_id,
              matched_name, matched_dob, matched_nationality, score)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            appId,
            s.subject_type,
            entityRef,
            s.ref || null,
            s.ref,
            c.list_type,
            c.id,
            c.name,
            c.date_of_birth || null,
            c.nationality || null,
            c.score,
          ],
        );
      }
    }

    // ── 4. Baca kembali hasil screening dikelompokkan ──
    const { rows: hitRows } = await this.pool.query(
      `SELECT list_type,
              COALESCE(review_status::text, 'UNREVIEWED') AS review_status,
              COUNT(*)::int                               AS cnt,
              MAX(score::float)                           AS top_score,
              MAX(matched_name)                           AS top_name
       FROM screening_results
       WHERE application_id=$1
       GROUP BY list_type, COALESCE(review_status::text, 'UNREVIEWED')`,
      [appId],
    );

    // Derive overall screening status for RBA V01 Name Screening parameter.
    // Rank: MATCH > NEAR_MATCH > CLEAR. Ignored statuses (FALSE_POSITIVE/DISMISSED) count as CLEAR.
    const _nsRank: Record<string, number> = {
      CLEAR: 0,
      NEAR_MATCH: 1,
      MATCH: 2,
    };
    let rbaNameScreeningResult = "CLEAR";
    for (const h of hitRows) {
      if (["FALSE_POSITIVE", "DISMISSED"].includes(h.review_status)) continue;
      const s = h.review_status === "CONFIRMED" ? "MATCH" : "NEAR_MATCH";
      if (_nsRank[s] > _nsRank[rbaNameScreeningResult])
        rbaNameScreeningResult = s;
    }

    // ── 5. Faktor: watchlist / sanctions ──
    const riskFactors: RiskFactor[] = [];
    let score = 0;

    for (const h of hitRows) {
      if (["FALSE_POSITIVE", "DISMISSED"].includes(h.review_status)) continue;
      const confirmed = h.review_status === "CONFIRMED";
      const topPct = `${((h.top_score ?? 0) * 100).toFixed(0)}%`;

      if (h.list_type === "DTTOT") {
        const pts = confirmed ? W.DTTOT_CONFIRMED : W.DTTOT_CANDIDATE;
        score += pts;
        riskFactors.push({
          code: confirmed
            ? "WATCHLIST_DTTOT_CONFIRMED"
            : "WATCHLIST_DTTOT_CANDIDATE",
          label: confirmed
            ? "DTTOT confirmed match"
            : "DTTOT candidate match (belum direview)",
          score: pts,
          severity: confirmed ? "CRITICAL" : "HIGH",
          source: "screening",
          details: `${h.cnt} match, similarity tertinggi ${topPct}, nama: ${h.top_name}`,
        });
      } else if (h.list_type === "PPPSPM") {
        const pts = confirmed ? W.PPPSPM_CONFIRMED : W.PPPSPM_CANDIDATE;
        score += pts;
        riskFactors.push({
          code: confirmed
            ? "WATCHLIST_PPPSPM_CONFIRMED"
            : "WATCHLIST_PPPSPM_CANDIDATE",
          label: confirmed
            ? "PPPSPM confirmed match"
            : "PPPSPM candidate match (belum direview)",
          score: pts,
          severity: confirmed ? "CRITICAL" : "HIGH",
          source: "screening",
          details: `${h.cnt} match, similarity tertinggi ${topPct}, nama: ${h.top_name}`,
        });
      } else if (h.list_type === "PEP") {
        const pts = confirmed ? W.PEP_CONFIRMED : W.PEP_CANDIDATE;
        score += pts;
        riskFactors.push({
          code: confirmed
            ? "WATCHLIST_PEP_CONFIRMED"
            : "WATCHLIST_PEP_CANDIDATE",
          label: confirmed
            ? "PEP confirmed match"
            : "PEP candidate match (belum direview)",
          score: pts,
          severity: confirmed ? "HIGH" : "MEDIUM",
          source: "screening",
          details: `${h.cnt} match, similarity tertinggi ${topPct}, nama: ${h.top_name}`,
        });
      }
    }

    // ── 6. Faktor: profil individu ──
    if (app.type === "INDIVIDUAL") {
      const { rows: pr } = await this.pool.query(
        `SELECT occupation, pep_self_declared, nationality, address_identity, address_residential FROM persons WHERE id=$1`,
        [app.person_id],
      );
      const p = pr[0] ?? {};

      if (p.pep_self_declared) {
        score += W.PEP_SELF_DECLARED;
        riskFactors.push({
          code: "INDIVIDUAL_PEP_SELF_DECLARED",
          label: "PEP self-declared oleh pemohon",
          score: W.PEP_SELF_DECLARED,
          severity: "HIGH",
          source: "profile",
        });
      }

      const occ = (p.occupation || "").toLowerCase();
      const matchedOcc = HIGH_RISK_OCCUPATIONS.find((k) => occ.includes(k));
      if (matchedOcc) {
        score += W.HIGH_RISK_OCCUPATION;
        riskFactors.push({
          code: "INDIVIDUAL_HIGH_RISK_OCCUPATION",
          label: "Pekerjaan berisiko tinggi",
          score: W.HIGH_RISK_OCCUPATION,
          severity: "MEDIUM",
          source: "profile",
          details: `Pekerjaan: ${p.occupation}`,
        });
      }

      if (RBA_OCCUPATION_GEOGRAPHY_ENABLED) {
        // ── RBA: profil pekerjaan (occupation risk) ──
        const occNorm = (p.occupation || "").trim().toLowerCase();
        const rbaOcc = RBA_OCCUPATION_MAP.find((e) => occNorm.includes(e.name));
        if (rbaOcc) {
          const pts =
            rbaOcc.risk === "HIGH"
              ? W.RBA_OCC_HIGH
              : rbaOcc.risk === "MEDIUM"
                ? W.RBA_OCC_MEDIUM
                : 0;
          score += pts;
          riskFactors.push({
            code: `INDIVIDUAL_OCCUPATION_${rbaOcc.risk}_RBA`,
            label: `Profil pekerjaan ${rbaOcc.risk.toLowerCase()} risk (RBA)`,
            score: pts,
            severity:
              rbaOcc.risk === "HIGH"
                ? "HIGH"
                : rbaOcc.risk === "MEDIUM"
                  ? "MEDIUM"
                  : "LOW",
            source: "rba_occupation",
            metadata: { matched: rbaOcc.name, source: "occupation" },
          });
        }

        // ── RBA: area geografis domisili (address risk) ──
        const addrIdent = (p.address_identity || "").trim().toLowerCase();
        const addrResi = (p.address_residential || "").trim().toLowerCase();
        const addrText = `${addrIdent} ${addrResi}`.trim();
        const rbaGeo = RBA_GEOGRAPHY_MAP.find((e) => addrText.includes(e.name));
        if (rbaGeo) {
          const pts =
            rbaGeo.risk === "HIGH"
              ? W.RBA_GEO_HIGH
              : rbaGeo.risk === "MEDIUM"
                ? W.RBA_GEO_MEDIUM
                : 0;
          score += pts;
          const geoSource = addrIdent.includes(rbaGeo.name)
            ? "address_identity"
            : addrResi.includes(rbaGeo.name)
              ? "address_residential"
              : "address";
          riskFactors.push({
            code: `GEOGRAPHY_${rbaGeo.risk}_RBA`,
            label: `Area geografis ${rbaGeo.risk.toLowerCase()} risk berdasarkan RBA`,
            score: pts,
            severity:
              rbaGeo.risk === "HIGH"
                ? "HIGH"
                : rbaGeo.risk === "MEDIUM"
                  ? "MEDIUM"
                  : "LOW",
            source: "rba_geography",
            metadata: { matched: rbaGeo.name, source: geoSource },
          });
        }
      }

      const nat = (p.nationality || "").toUpperCase();
      if (HIGH_RISK_COUNTRIES.length && HIGH_RISK_COUNTRIES.includes(nat)) {
        score += W.GEOGRAPHY;
        riskFactors.push({
          code: "GEOGRAPHY_HIGH_RISK_NATIONALITY",
          label: "Kewarganegaraan negara berisiko tinggi",
          score: W.GEOGRAPHY,
          severity: "MEDIUM",
          source: "geography",
          details: `Nationality: ${nat}`,
        });
      }
    }

    // ── 7. Faktor: profil bisnis ──
    if (app.type === "BUSINESS") {
      const { rows: bizRows } = await this.pool.query(
        `SELECT business_activity, legal_form, country FROM business_entities WHERE id=$1`,
        [app.business_id],
      );
      const biz = bizRows[0] ?? {};

      const activity = (biz.business_activity || "").toLowerCase();
      const matchedAct = HIGH_RISK_ACTIVITIES.find((k) => activity.includes(k));
      if (matchedAct) {
        score += W.HIGH_RISK_ACTIVITY;
        riskFactors.push({
          code: "BUSINESS_HIGH_RISK_ACTIVITY",
          label: "Kegiatan usaha berisiko tinggi",
          score: W.HIGH_RISK_ACTIVITY,
          severity: "MEDIUM",
          source: "profile",
          details: `Kegiatan: ${biz.business_activity}`,
        });
      }

      const lf = (biz.legal_form || "").toUpperCase();
      if (HIGH_RISK_LEGAL_FORMS.some((f) => lf.includes(f))) {
        score += W.HIGH_RISK_LEGAL_FORM;
        riskFactors.push({
          code: "BUSINESS_HIGH_RISK_LEGAL_FORM",
          label: "Bentuk hukum berisiko tinggi",
          score: W.HIGH_RISK_LEGAL_FORM,
          severity: "LOW",
          source: "profile",
          details: `Bentuk hukum: ${biz.legal_form}`,
        });
      }

      const { rows: boRows } = await this.pool.query(
        `SELECT 1 FROM business_parties WHERE business_id=$1 AND role='BO' AND is_active=TRUE LIMIT 1`,
        [app.business_id],
      );
      if (!boRows.length) {
        score += W.BO_MISSING;
        riskFactors.push({
          code: "BUSINESS_BO_MISSING",
          label: "Beneficial Owner (BO) belum terdaftar",
          score: W.BO_MISSING,
          severity: "HIGH",
          source: "profile",
        });
      }

      const country = (biz.country || "").toUpperCase();
      if (HIGH_RISK_COUNTRIES.length && HIGH_RISK_COUNTRIES.includes(country)) {
        score += W.GEOGRAPHY;
        riskFactors.push({
          code: "GEOGRAPHY_HIGH_RISK_COUNTRY",
          label: "Negara asal/domisili bisnis berisiko tinggi",
          score: W.GEOGRAPHY,
          severity: "MEDIUM",
          source: "geography",
          details: `Country: ${country}`,
        });
      }
    }

    // ── 8. Faktor: dokumen ──
    const { rows: docRows } = await this.pool.query(
      `SELECT doc_type, status FROM documents WHERE application_id=$1`,
      [appId],
    );
    const docTypes = new Set(docRows.map((d: any) => d.doc_type as string));

    if (app.type === "INDIVIDUAL") {
      if (
        !["INDIVIDUAL_KTP_PHOTO", "KTP", "SIM", "PASPOR"].some((d) =>
          docTypes.has(d),
        )
      ) {
        score += W.DOC_MISSING;
        riskFactors.push({
          code: "DOC_IDENTITY_MISSING",
          label: "Dokumen identitas belum diunggah",
          score: W.DOC_MISSING,
          severity: "MEDIUM",
          source: "document",
        });
      }
    } else {
      for (const req of ["AKTA_PENDIRIAN", "NIB_SIUP", "NPWP_BADAN"]) {
        if (!docTypes.has(req)) {
          score += W.DOC_MISSING;
          riskFactors.push({
            code: `DOC_${req}_MISSING`,
            label: `Dokumen wajib belum ada: ${req}`,
            score: W.DOC_MISSING,
            severity: "MEDIUM",
            source: "document",
          });
        }
      }
    }

    for (const doc of docRows.filter((d: any) => d.status === "REJECTED")) {
      score += W.DOC_REJECTED;
      riskFactors.push({
        code: "DOC_REJECTED",
        label: "Dokumen ditolak",
        score: W.DOC_REJECTED,
        severity: "MEDIUM",
        source: "document",
        details: `Tipe: ${doc.doc_type}`,
      });
    }

    // ── 9. Faktor netral: channel onboarding ──
    riskFactors.push({
      code: "ONBOARDING_OFFLINE_DIRECT",
      label: "Channel onboarding: offline/tatap muka (default)",
      score: 0,
      severity: "INFO",
      source: "channel",
      details:
        "Diasumsikan offline direct; kolom onboarding_channel belum ada di schema",
    });

    // ── 10. Cap 0..100, tentukan level ──
    score = Math.max(0, Math.min(100, score));

    // PEP detection forces risk_level HIGH regardless of computed score.
    // Score is also raised to minimum 70 for consistency with HIGH threshold.
    const PEP_RISK_CODES = [
      "WATCHLIST_PEP_CONFIRMED",
      "WATCHLIST_PEP_CANDIDATE",
      "INDIVIDUAL_PEP_SELF_DECLARED",
    ];
    const hasPep = riskFactors.some((f) => PEP_RISK_CODES.includes(f.code));
    if (hasPep) score = Math.max(score, 70);
    const risk_level = hasPep ? "HIGH" : levelOf(score);

    // ── 11. Legacy factors (backward compat untuk kolom factors) ──
    const hitSummary = hitRows
      .filter(
        (h: any) => !["FALSE_POSITIVE", "DISMISSED"].includes(h.review_status),
      )
      .reduce(
        (acc: any, h: any) => {
          if (h.list_type === "PEP") acc.pep += h.cnt;
          if (h.list_type === "DTTOT") acc.dttot += h.cnt;
          if (h.list_type === "PPPSPM") acc.pppspm += h.cnt;
          return acc;
        },
        { pep: 0, dttot: 0, pppspm: 0 },
      );

    const factors = {
      version: "rba_v2",
      hits: hitSummary,
      score_breakdown: riskFactors
        .filter((f) => f.score > 0)
        .map((f) => ({ code: f.code, score: f.score })),
      threshold: SIMILARITY_THRESHOLD,
    };

    // ── 12. RBA V01 strict calculation ───────────────────────────────────────
    let rbaResult: ReturnType<typeof computeRbaV01> | null = null;
    try {
      let rbaInput: RbaInput;
      if (app.type === "INDIVIDUAL") {
        const { rows: rbaP } = await this.pool.query(
          `SELECT occupation, source_of_funds, industry_category,
                  business_relationship_purpose, province_name, distribution_channel
           FROM persons WHERE id=$1`,
          [app.person_id],
        );
        const rp = rbaP[0] ?? {};
        rbaInput = {
          type: "INDIVIDUAL",
          occupation: rp.occupation ?? null,
          source_of_funds: rp.source_of_funds ?? null,
          industry_category: rp.industry_category ?? null,
          business_relationship_purpose:
            rp.business_relationship_purpose ?? null,
          province_name: rp.province_name ?? null,
          distribution_channel: rp.distribution_channel ?? null,
          name_screening_result: rbaNameScreeningResult,
        };
      } else {
        const { rows: rbaB } = await this.pool.query(
          `SELECT legal_form, source_of_funds, business_activity AS industry_category,
                  business_relationship_purpose, province, distribution_channel
           FROM business_entities WHERE id=$1`,
          [app.business_id],
        );
        const rb = rbaB[0] ?? {};
        rbaInput = {
          type: "BUSINESS",
          legal_form: rb.legal_form ?? null,
          source_of_funds: rb.source_of_funds ?? null,
          industry_category: rb.industry_category ?? null,
          business_relationship_purpose:
            rb.business_relationship_purpose ?? null,
          province: rb.province ?? null,
          distribution_channel: rb.distribution_channel ?? null,
          name_screening_result: rbaNameScreeningResult,
        };
      }
      rbaResult = computeRbaV01(rbaInput);
    } catch (e: any) {
      this.logger.warn(
        `RBA V01 compute failed for app ${appId}: ${e?.message}`,
      );
    }

    // ── 13. Simpan ke DB ──────────────────────────────────────────────────────
    const finalRiskScore =
      rbaResult?.rba_calculation_status === "COMPLETE" &&
      rbaResult.rba_score_v01 !== null
        ? Math.round((rbaResult.rba_score_v01 / 3) * 100)
        : score;
    const finalRiskLevel =
      rbaResult?.rba_calculation_status === "COMPLETE" && rbaResult.risk_level
        ? rbaResult.risk_level
        : risk_level;

    await this.pool.query(
      `INSERT INTO application_risk
         (application_id, risk_score, risk_level, factors, risk_factors,
          rba_version, rba_score_v01, rba_calculation_status,
          rba_unmapped_parameters, rba_components, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       ON CONFLICT (application_id) DO UPDATE SET
         risk_score                = EXCLUDED.risk_score,
         risk_level                = EXCLUDED.risk_level,
         factors                   = EXCLUDED.factors,
         risk_factors              = EXCLUDED.risk_factors,
         rba_version               = EXCLUDED.rba_version,
         rba_score_v01             = EXCLUDED.rba_score_v01,
         rba_calculation_status    = EXCLUDED.rba_calculation_status,
         rba_unmapped_parameters   = EXCLUDED.rba_unmapped_parameters,
         rba_components            = EXCLUDED.rba_components,
         created_at                = now()`,
      [
        appId,
        finalRiskScore,
        finalRiskLevel,
        JSON.stringify(factors),
        JSON.stringify(riskFactors),
        rbaResult?.rba_version ?? "RBA_V01",
        rbaResult?.rba_score_v01 ?? null,
        rbaResult?.rba_calculation_status ?? "INCOMPLETE",
        JSON.stringify(rbaResult?.rba_unmapped_parameters ?? []),
        JSON.stringify(rbaResult?.rba_components ?? {}),
      ],
    );

    return {
      risk_score: finalRiskScore,
      risk_level: finalRiskLevel,
      factors,
      risk_factors: riskFactors,
      rba_version: rbaResult?.rba_version ?? "RBA_V01",
      rba_score_v01: rbaResult?.rba_score_v01 ?? null,
      rba_calculation_status: rbaResult?.rba_calculation_status ?? "INCOMPLETE",
      rba_unmapped_parameters: rbaResult?.rba_unmapped_parameters ?? [],
      rba_components: rbaResult?.rba_components ?? {},
    };
  }

  // List parties for a BUSINESS application
  async listParties(appId: number) {
    // pastikan application-nya BUSINESS
    const { rows: appRows } = await this.pool.query(
      `SELECT id, business_id, type FROM applications WHERE id=$1`,
      [appId],
    );
    const app = appRows[0];
    if (!app) throw new NotFoundException("Application not found");
    if (app.type !== "BUSINESS" || !app.business_id)
      throw new BadRequestException(
        "Parties only apply to BUSINESS applications",
      );

    const { rows } = await this.pool.query(
      `SELECT bp.id, bp.role, bp.is_active, bp.created_at,
              bp.cif_no, bp.cif_relationship_type,
              p.id AS person_id, p.full_name, p.identity_type, p.identity_number, p.dob, p.nationality
       FROM business_parties bp
       JOIN persons p ON p.id = bp.person_id
       WHERE bp.business_id = $1
       ORDER BY bp.created_at DESC`,
      [app.business_id],
    );
    return rows;
  }

  // Create / upsert person, then attach into business_parties
  async addParty(appId: number, dto: any) {
    const { rows: appRows } = await this.pool.query(
      `SELECT id, business_id, type FROM applications WHERE id=$1`,
      [appId],
    );
    const app = appRows[0];
    if (!app) throw new NotFoundException("Application not found");
    if (app.type !== "BUSINESS" || !app.business_id)
      throw new BadRequestException(
        "Parties only apply to BUSINESS applications",
      );

    // Normalise KTP number (strip non-digits) consistent with createIndividual
    if (dto.identity_type === "KTP")
      dto.identity_number = (dto.identity_number || "")
        .replace(/\D+/g, "")
        .trim();

    // B.2 Nomor Identitas Pengurus/BO/Pemegang Saham: maksimal 16 karakter.
    if (dto.identity_number && String(dto.identity_number).length > 16) {
      throw new BadRequestException("Nomor Identitas maksimal 16 karakter.");
    }

    // A. "Lainnya" companions untuk party (tidak menggantikan nilai dropdown).
    const partyOther = this.resolveOtherFieldsCreate(dto, [
      {
        main: "source_of_funds",
        other: "source_of_funds_other",
        label: "Sumber Dana",
      },
      {
        main: "source_of_wealth",
        other: "source_of_wealth_other",
        label: "Sumber Kekayaan",
      },
    ]);

    // cari existing person by (identity_type, identity_number)
    const { rows: existing } = await this.pool.query(
      `SELECT id FROM persons WHERE identity_type=$1 AND identity_number=$2 LIMIT 1`,
      [dto.identity_type, dto.identity_number],
    );

    let personId: number;
    if (existing[0]) {
      personId = existing[0].id;
      // optional: update data dasar
      await this.pool.query(
        `UPDATE persons
       SET full_name=COALESCE($1, full_name),
           dob=COALESCE($2::date, dob),
           nationality=COALESCE($3, nationality),
           phone=COALESCE($4, phone),
           email=COALESCE($5, email)
       WHERE id=$6`,
        [
          dto.full_name || null,
          dto.dob || null,
          dto.nationality || null,
          dto.phone || null,
          dto.email || null,
          personId,
        ],
      );
    } else {
      const ins = await this.pool.query(
        `INSERT INTO persons (full_name, identity_type, identity_number, dob, nationality, phone, email)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          dto.full_name,
          dto.identity_type,
          dto.identity_number,
          dto.dob || null,
          dto.nationality || null,
          dto.phone || null,
          dto.email || null,
        ],
      );
      personId = ins.rows[0].id;
    }

    // CIF resolution for BO parties (and sync to persons so OUR_CUSTOMER apps reuse it)
    let partyCif: string | null = null;
    if (dto.role === "BO") {
      partyCif = await this.resolveCifForIdentity(dto.identity_number);
      if (!partyCif) {
        partyCif = await this.generateIndividualCif(dto.identity_number);
      }
      // Sync CIF to persons so a future individual application for same NIK reuses it
      await this.pool.query(
        `UPDATE persons SET cif_no = COALESCE(cif_no, $1) WHERE id = $2`,
        [partyCif, personId],
      );
    }

    // insert ke business_parties (unique per business/person/role)
    const party = await this.pool.query(
      `INSERT INTO business_parties (
         business_id, person_id, role, is_active, cif_no, cif_relationship_type,
         ownership_percentage, address, identity_document_type,
         source_of_funds, source_of_wealth, source_of_funds_other, source_of_wealth_other
       )
     VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (business_id, person_id, role) DO UPDATE
       SET is_active = TRUE,
           cif_no = COALESCE(business_parties.cif_no, EXCLUDED.cif_no),
           ownership_percentage = COALESCE(EXCLUDED.ownership_percentage, business_parties.ownership_percentage),
           address = COALESCE(EXCLUDED.address, business_parties.address),
           identity_document_type = COALESCE(EXCLUDED.identity_document_type, business_parties.identity_document_type),
           source_of_funds = COALESCE(EXCLUDED.source_of_funds, business_parties.source_of_funds),
           source_of_wealth = COALESCE(EXCLUDED.source_of_wealth, business_parties.source_of_wealth),
           source_of_funds_other = EXCLUDED.source_of_funds_other,
           source_of_wealth_other = EXCLUDED.source_of_wealth_other
     RETURNING id, business_id, person_id, role, is_active, created_at, cif_no, cif_relationship_type,
               ownership_percentage, address, identity_document_type,
               source_of_funds, source_of_wealth, source_of_funds_other, source_of_wealth_other`,
      [
        app.business_id,
        personId,
        dto.role,
        partyCif,
        dto.role === "BO" ? "BO" : null,
        dto.ownership_percentage ?? null,
        dto.address ?? null,
        dto.identity_document_type ?? null,
        dto.source_of_funds ?? null,
        dto.source_of_wealth ?? null,
        partyOther.source_of_funds_other,
        partyOther.source_of_wealth_other,
      ],
    );

    return party.rows[0];
  }

  async deleteParty(appId: number, partyId: number) {
    const { rows: appRows } = await this.pool.query(
      `SELECT id, business_id, type FROM applications WHERE id=$1`,
      [appId],
    );
    const app = appRows[0];
    if (!app) throw new NotFoundException("Application not found");
    if (app.type !== "BUSINESS" || !app.business_id)
      throw new BadRequestException(
        "Parties only apply to BUSINESS applications",
      );

    const { rows } = await this.pool.query(
      `DELETE FROM business_parties WHERE id=$1 AND business_id=$2 RETURNING id`,
      [partyId, app.business_id],
    );
    if (!rows[0]) throw new NotFoundException("Party not found");
    return { ok: true };
  }

  async submit(appId: number, reviewerId: number) {
    const { rows: statusRows } = await this.pool.query(
      `SELECT status FROM applications WHERE id=$1`,
      [appId],
    );
    if (!statusRows[0]) throw new NotFoundException("Application not found");
    const currentStatus = statusRows[0].status;
    if (!["DRAFT", "REVISION_REQUIRED"].includes(currentStatus)) {
      throw new BadRequestException(
        `Tidak dapat submit dari status ${currentStatus}. Hanya bisa dari DRAFT atau REVISION_REQUIRED.`,
      );
    }

    await this.validateBeforeSubmit(appId);

    const res = await this.pool.query(
      `UPDATE applications
     SET status='SUBMITTED', submitted_at=now(),
         first_submitted_at=COALESCE(first_submitted_at, now()), reviewer_id=$2
     WHERE id=$1
     RETURNING id`,
      [appId, reviewerId],
    );
    if (!res.rows[0]) throw new NotFoundException("Application not found");

    // <<< SCREEN & RISK otomatis setelah submit >>>
    const risk = await this.screenAndComputeRisk(appId);

    // HIGH RISK → set IN_REVIEW + wajibkan EDD
    if (risk.risk_level === "HIGH") {
      await this.pool.query(
        `UPDATE applications SET status='IN_REVIEW', updated_at=now() WHERE id=$1`,
        [appId],
      );
      await this.initEddForHighRisk(appId, reviewerId);
      return { id: appId, status: "IN_REVIEW", risk };
    }

    return { id: appId, status: "SUBMITTED", risk };
  }

  private async initEddForHighRisk(appId: number, reviewerId: number) {
    const { rows: apps } = await this.pool.query(
      `SELECT type, person_id, business_id FROM applications WHERE id=$1`,
      [appId],
    );
    const app = apps[0];
    if (!app) return;

    let snapshot: Record<string, any> = { cdd_reference_no: String(appId) };

    if (app.type === "INDIVIDUAL" && app.person_id) {
      const { rows: p } = await this.pool.query(
        `SELECT full_name, identity_number, identity_type, address_identity, occupation, phone
         FROM persons WHERE id=$1`,
        [app.person_id],
      );
      if (p[0]) {
        snapshot = {
          ...snapshot,
          full_name: p[0].full_name,
          identity_number: p[0].identity_number,
          identity_type: p[0].identity_type,
          domicile_address: p[0].address_identity,
          occupation_or_business_type: p[0].occupation,
          phone_number: p[0].phone,
          customer_category: "INDIVIDUAL",
        };
      }
    } else if (app.type === "BUSINESS" && app.business_id) {
      const { rows: b } = await this.pool.query(
        `SELECT legal_name, npwp, address_line, business_activity, phone
         FROM business_entities WHERE id=$1`,
        [app.business_id],
      );
      if (b[0]) {
        snapshot = {
          ...snapshot,
          full_name: b[0].legal_name,
          identity_number: b[0].npwp,
          identity_type: "NPWP_BADAN",
          domicile_address: b[0].address_line,
          occupation_or_business_type: b[0].business_activity,
          phone_number: b[0].phone,
          customer_category: "BUSINESS",
        };
      }
    }

    await this.pool.query(
      `INSERT INTO application_edd
         (application_id, edd_required, edd_completed, applicant_snapshot,
          created_by, updated_by, created_at, updated_at)
       VALUES ($1, true, false, $2, $3, $3, now(), now())
       ON CONFLICT (application_id) DO UPDATE SET
         edd_required  = true,
         applicant_snapshot = EXCLUDED.applicant_snapshot,
         updated_by    = $3,
         updated_at    = now()`,
      [appId, JSON.stringify(snapshot), reviewerId],
    );
  }

  async list(
    query: {
      q?: string;
      cif?: string;
      date_from?: string;
      date_to?: string;
      application_type?: "INDIVIDUAL" | "BUSINESS";
      status?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const {
      q,
      cif,
      date_from,
      date_to,
      application_type,
      status,
      page = 1,
      limit = 20,
    } = query;

    const offset = (page - 1) * limit;
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (status) {
      params.push(status);
      conditions.push(`a.status = $${params.length}`);
    }

    if (application_type) {
      params.push(application_type);
      conditions.push(`a.type = $${params.length}`);
    }

    if (date_from) {
      params.push(date_from);
      conditions.push(`a.created_at >= $${params.length}::date`);
    }

    if (date_to) {
      params.push(date_to);
      conditions.push(
        `a.created_at < ($${params.length}::date + interval '1 day')`,
      );
    }

    if (cif) {
      const normalizedCif = cif.replace(/-/g, "").toUpperCase();
      params.push(normalizedCif);
      const idx = params.length;
      conditions.push(
        `(UPPER(REPLACE(COALESCE(p.cif_no, ''), '-', '')) = $${idx} OR UPPER(REPLACE(COALESCE(b.cif_no, ''), '-', '')) = $${idx})`,
      );
    }

    if (q) {
      const pattern = `%${q}%`;
      const cifPattern = `%${q.replace(/-/g, "")}%`;
      params.push(pattern);
      const pi = params.length;
      params.push(cifPattern);
      const ci = params.length;
      conditions.push(`(
        p.full_name ILIKE $${pi}
        OR b.legal_name ILIKE $${pi}
        OR p.email ILIKE $${pi}
        OR p.identity_number ILIKE $${pi}
        OR b.nib ILIKE $${pi}
        OR b.npwp ILIKE $${pi}
        OR REPLACE(COALESCE(p.cif_no, ''), '-', '') ILIKE $${ci}
        OR REPLACE(COALESCE(b.cif_no, ''), '-', '') ILIKE $${ci}
      )`);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const baseJoin = `
      FROM applications a
      LEFT JOIN persons p ON p.id = a.person_id
      LEFT JOIN business_entities b ON b.id = a.business_id
      LEFT JOIN application_risk ar ON ar.application_id = a.id
      ${where}
    `;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      this.pool.query(
        `SELECT
          a.id,
          a.type AS application_type,
          a.status,
          a.created_at,
          a.updated_at,
          a.revision_reason,
          a.revision_requested_by,
          a.revision_requested_at,
          COALESCE(ar.override_level, ar.risk_level) AS risk_level,
          ar.risk_score::float AS risk_score,
          ar.rba_score_v01::float AS rba_score_v01,
          CASE WHEN a.type = 'INDIVIDUAL' AND p.cif_relationship_type = 'WIC' THEN NULL WHEN a.type = 'INDIVIDUAL' THEN p.cif_no ELSE b.cif_no END AS cif_no,
          CASE WHEN a.type = 'INDIVIDUAL' THEN p.cif_relationship_type ELSE 'OUR_CUSTOMER' END AS cif_relationship_type,
          CASE WHEN a.type = 'INDIVIDUAL' THEN p.full_name ELSE b.legal_name END AS display_name,
          CASE WHEN a.type = 'INDIVIDUAL' THEN 'Individual' ELSE 'Badan Usaha' END AS display_type
        ${baseJoin}
        ORDER BY a.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      this.pool.query(`SELECT COUNT(*) AS total ${baseJoin}`, params),
    ]);

    return {
      data: rows,
      total: Number(countRows[0].total),
      page,
      limit,
    };
  }

  async listDocuments(appId: number) {
    const { rows: apps } = await this.pool.query(
      `SELECT id FROM applications WHERE id=$1`,
      [appId],
    );
    if (!apps[0]) throw new NotFoundException("Application not found");

    const { rows } = await this.pool.query(
      `SELECT id, application_id, doc_type, file_uri, status, extracted_json, created_at
       FROM documents
       WHERE application_id=$1
       ORDER BY created_at DESC`,
      [appId],
    );
    return rows;
  }

  async getScreening(appId: number) {
    const { rows: results } = await this.pool.query(
      `SELECT id, subject_type, subject_ref, list_type, watchlist_id, matched_name, matched_dob,
            matched_nationality, score, review_status, review_notes, reviewed_by, reviewed_at, created_at
     FROM screening_results
     WHERE application_id=$1
     ORDER BY score DESC, created_at DESC`,
      [appId],
    );
    const { rows: risk } = await this.pool.query(
      `SELECT application_id, risk_score, risk_level, factors,
            override_level, override_reason, override_by, override_at, created_at
     FROM application_risk WHERE application_id=$1`,
      [appId],
    );
    return { results, risk: risk[0] || null };
  }

  async reviewScreeningResult(
    appId: number,
    resultId: number,
    status: "CONFIRMED" | "FALSE_POSITIVE" | "DISMISSED",
    notes: string | null,
    reviewerId: number,
  ) {
    const { rows } = await this.pool.query(
      `UPDATE screening_results
     SET review_status=$1, review_notes=$2, reviewed_by=$3, reviewed_at=now()
     WHERE id=$4 AND application_id=$5
     RETURNING id`,
      [status, notes || null, reviewerId, resultId, appId],
    );
    if (!rows[0]) throw new NotFoundException("Screening result not found");

    // ⬇️ cek & terapkan auto-bump (atau bersihkan bila tak perlu)
    await this.recomputeAutoBump(appId, reviewerId);

    return { ok: true };
  }

  async overrideRisk(
    appId: number,
    level: "LOW" | "MEDIUM" | "HIGH",
    reason: string,
    reviewerId: number,
  ) {
    const { rows } = await this.pool.query(
      `UPDATE application_risk
     SET override_level=$2, override_reason=$3, override_by=$4, override_at=now()
     WHERE application_id=$1
     RETURNING application_id`,
      [appId, level, reason, reviewerId],
    );
    if (!rows[0]) {
      // kalau belum ada row risk (harusnya ada setelah submit), buat baru minimal
      await this.pool.query(
        `INSERT INTO application_risk (application_id, risk_score, risk_level, factors,
                                     override_level, override_reason, override_by, override_at, created_at)
       VALUES ($1, 0, 'LOW', '{}', $2, $3, $4, now(), now())`,
        [appId, level, reason, reviewerId],
      );
    }
    return { ok: true };
  }

  async listWithRisk(limit = 20, offset = 0) {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.type, a.status, a.created_at, a.submitted_at,
            COALESCE(ar.override_level, ar.risk_level) AS risk_level,
            ar.risk_score,
            CASE WHEN ar.override_level IS NOT NULL THEN true ELSE false END AS risk_overridden
     FROM applications a
     LEFT JOIN application_risk ar ON ar.application_id = a.id
     ORDER BY a.created_at DESC
     LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  async getDocument(appId: number, docId: number) {
    const { rows } = await this.pool.query(
      `SELECT id, application_id, doc_type, file_uri, status, extracted_json, created_at
       FROM documents
       WHERE id=$1`,
      [docId],
    );
    const doc = rows[0];
    if (!doc) throw new NotFoundException("Document not found");
    // NOTE: pg returns BIGINT columns as JS strings, while appId comes from
    // ParseIntPipe as a number. Compare as strings to avoid a spurious
    // "does not belong" mismatch (e.g. "5" !== 5).
    if (String(doc.application_id) !== String(appId)) {
      this.logger.warn(
        `Document ownership mismatch: docId=${docId} requested appId=${appId} but document.application_id=${doc.application_id}`,
      );
      throw new ForbiddenException(
        "Document does not belong to this application",
      );
    }
    return doc;
  }

  async deleteDocument(appId: number, docId: number) {
    const doc = await this.getDocument(appId, docId);
    await this.pool.query(`DELETE FROM documents WHERE id=$1`, [docId]);
    return doc;
  }

  async getApplicationType(appId: number): Promise<string> {
    const { rows } = await this.pool.query(
      `SELECT type FROM applications WHERE id=$1`,
      [appId],
    );
    if (!rows[0]) throw new NotFoundException("Application not found");
    return rows[0].type as string;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // EDD — Enhanced Due Diligence (Lampiran 2 Formulir EDD APU PPT PPPSPM)
  // ──────────────────────────────────────────────────────────────────────────

  async getEdd(appId: number) {
    const { rows: apps } = await this.pool.query(
      `SELECT id FROM applications WHERE id=$1`,
      [appId],
    );
    if (!apps[0]) throw new NotFoundException("Application not found");

    const { rows } = await this.pool.query(
      `SELECT * FROM application_edd WHERE application_id=$1`,
      [appId],
    );
    if (!rows[0]) {
      return {
        application_id: appId,
        edd_required: false,
        edd_completed: false,
        applicant_snapshot: {},
        high_risk_reasons: {},
        additional_information: {},
        beneficial_owner: {},
        officer_analysis: {},
        compliance_decision: {},
        director_decision: {},
        internal_checklist: {},
        completed_by: null,
        completed_at: null,
        created_by: null,
        updated_by: null,
        created_at: null,
        updated_at: null,
      };
    }
    return rows[0];
  }

  async saveEdd(
    appId: number,
    body: any,
    user: { sub?: number | string; id?: number | string; role: string },
  ) {
    const { complete = false } = body;
    const userId = Number(user.sub ?? (user as any).id);
    const role = user.role;

    // Section-based RBAC:
    //   FrontDesk / Frontline  → sections I–IV
    //     (applicant_snapshot, high_risk_reasons, additional_information, beneficial_owner)
    //   ComplianceLead         → sections V–VII
    //     (officer_analysis, compliance_decision, internal_checklist)
    // director_decision (Director final approval) has been retired — it is neither
    // editable nor validated; any legacy value is preserved read-only (see below).
    const FULL_ACCESS = ["SystemAdmin", "Director"];
    const SECTIONS_I_IV = [
      "applicant_snapshot",
      "high_risk_reasons",
      "additional_information",
      "beneficial_owner",
    ];
    const SECTIONS_V_VII = [
      "officer_analysis",
      "compliance_decision",
      "internal_checklist",
    ];
    if (!FULL_ACCESS.includes(role)) {
      const hasKey = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
      if (role === "FrontDesk") {
        if (SECTIONS_V_VII.some(hasKey)) {
          throw new ForbiddenException("Frontline hanya dapat mengisi EDD bagian I sampai IV.");
        }
      } else if (role === "ComplianceLead") {
        if (SECTIONS_I_IV.some(hasKey)) {
          throw new ForbiddenException("Lead Compliance hanya dapat mengisi EDD bagian V sampai VII.");
        }
      }
    }

    const { rows: apps } = await this.pool.query(
      `SELECT id FROM applications WHERE id=$1`,
      [appId],
    );
    if (!apps[0]) throw new NotFoundException("Application not found");

    // Baca state saat ini untuk merge
    const { rows: existing } = await this.pool.query(
      `SELECT * FROM application_edd WHERE application_id=$1`,
      [appId],
    );
    const curr = existing[0];

    const { rows: riskRowsForEdd } = await this.pool.query(
      `SELECT COALESCE(override_level, risk_level) AS effective_level
       FROM application_risk WHERE application_id=$1`,
      [appId],
    );
    const eddRequired =
      Boolean(curr?.edd_required) ||
      riskRowsForEdd[0]?.effective_level === "HIGH";

    const merged = {
      applicant_snapshot:
        body.applicant_snapshot ?? curr?.applicant_snapshot ?? {},
      high_risk_reasons:
        body.high_risk_reasons ?? curr?.high_risk_reasons ?? {},
      additional_information:
        body.additional_information ?? curr?.additional_information ?? {},
      beneficial_owner: body.beneficial_owner ?? curr?.beneficial_owner ?? {},
      officer_analysis: body.officer_analysis ?? curr?.officer_analysis ?? {},
      compliance_decision:
        body.compliance_decision ?? curr?.compliance_decision ?? {},
      // director_decision is deprecated: never taken from the request body, only
      // the legacy stored value is preserved for backward compatibility.
      director_decision: curr?.director_decision ?? {},
      internal_checklist:
        body.internal_checklist ?? curr?.internal_checklist ?? {},
    };

    // Approval timestamps are backend-generated. When the compliance decision is
    // being (re)submitted, stamp compliance_decision.date with the server clock and
    // ignore any client-provided date. Applies whenever this PATCH carries the
    // compliance_decision section with an actual decision value.
    if (
      Object.prototype.hasOwnProperty.call(body, "compliance_decision") &&
      merged.compliance_decision &&
      typeof merged.compliance_decision === "object" &&
      merged.compliance_decision.decision
    ) {
      merged.compliance_decision = {
        ...merged.compliance_decision,
        date: new Date().toISOString(),
      };
    }

    // Dropdown companion validation for additional_information
    const addInfoMerged = merged.additional_information ?? {};
    const sofStr = typeof addInfoMerged.source_of_funds === "string" ? addInfoMerged.source_of_funds : null;
    if (sofStr === "Pendapatan lain/Lainnya") {
      const sofOther = String(addInfoMerged.source_of_funds_other ?? "").trim();
      if (!sofOther) {
        throw new BadRequestException(
          "additional_information.source_of_funds_other wajib diisi untuk Pendapatan lain/Lainnya.",
        );
      }
    }
    const brpStr = typeof addInfoMerged.business_relationship_purpose === "string" ? addInfoMerged.business_relationship_purpose : null;
    if (brpStr === "Lainnya") {
      const brpOther = String(addInfoMerged.business_relationship_purpose_other ?? "").trim();
      if (!brpOther) {
        throw new BadRequestException(
          "additional_information.business_relationship_purpose_other wajib diisi jika Tujuan Hubungan Usaha = Lainnya.",
        );
      }
    }

    if (complete) this.validateEddCompletion(merged);

    await this.pool.query(
      `INSERT INTO application_edd
         (application_id, edd_required, edd_completed,
          applicant_snapshot, high_risk_reasons, additional_information,
          beneficial_owner, officer_analysis, compliance_decision,
          director_decision, internal_checklist,
          completed_by, completed_at, created_by, updated_by, created_at, updated_at)
       VALUES ($1, $14, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, $13, now(), now())
       ON CONFLICT (application_id) DO UPDATE SET
         edd_completed          = CASE WHEN $2 THEN true ELSE application_edd.edd_completed END,
         applicant_snapshot     = $3,
         high_risk_reasons      = $4,
         additional_information = $5,
         beneficial_owner       = $6,
         officer_analysis       = $7,
         compliance_decision    = $8,
         director_decision      = $9,
         internal_checklist     = $10,
         completed_by           = CASE WHEN $2 THEN $11 ELSE application_edd.completed_by END,
         completed_at           = CASE WHEN $2 THEN $12 ELSE application_edd.completed_at END,
         updated_by             = $13,
         updated_at             = now()`,
      [
        appId,
        complete,
        JSON.stringify(merged.applicant_snapshot),
        JSON.stringify(merged.high_risk_reasons),
        JSON.stringify(merged.additional_information),
        JSON.stringify(merged.beneficial_owner),
        JSON.stringify(merged.officer_analysis),
        JSON.stringify(merged.compliance_decision),
        JSON.stringify(merged.director_decision),
        JSON.stringify(merged.internal_checklist),
        complete ? userId : null,
        complete ? new Date().toISOString() : null,
        userId,
        eddRequired,
      ],
    );

    return this.getEdd(appId);
  }

  private validateEddCompletion(merged: any) {
    const errors: string[] = [];
    const snapshot = merged.applicant_snapshot ?? {};
    const hr = merged.high_risk_reasons ?? {};
    const addInfo = merged.additional_information ?? {};
    const officer = merged.officer_analysis ?? {};
    const compliance = merged.compliance_decision ?? {};
    const checklist = merged.internal_checklist ?? {};

    if (!snapshot.full_name && !snapshot.cdd_reference_no)
      errors.push(
        "applicant_snapshot: full_name atau cdd_reference_no wajib diisi",
      );

    const hrCats = [
      "customer_characteristics",
      "transaction_patterns",
      "screening_results",
      "clarification_requests",
    ];
    if (!hrCats.some((c) => Array.isArray(hr[c]) && hr[c].length > 0))
      errors.push(
        "high_risk_reasons: minimal 1 kategori dengan minimal 1 alasan",
      );

    if (!officer.overall_risk_summary)
      errors.push("officer_analysis.overall_risk_summary wajib diisi");

    if (
      !Array.isArray(officer.follow_up_recommendations) ||
      officer.follow_up_recommendations.length === 0
    )
      errors.push("officer_analysis.follow_up_recommendations minimal 1 item");

    if (!compliance.decision)
      errors.push("compliance_decision.decision wajib diisi");

    if (!checklist.edd_form_completed)
      errors.push("internal_checklist.edd_form_completed harus true");

    if (
      officer.cdd_edd_consistency === "NOT_CONSISTENT" &&
      !officer.consistency_notes
    )
      errors.push(
        "officer_analysis.consistency_notes wajib diisi jika cdd_edd_consistency = NOT_CONSISTENT",
      );

    if (
      officer.transaction_profile_reasonableness === "NOT_REASONABLE" &&
      !officer.transaction_notes
    )
      errors.push(
        "officer_analysis.transaction_notes wajib diisi jika transaction_profile_reasonableness = NOT_REASONABLE",
      );

    if (
      officer.occupation_source_funds_wealth_assessment === "NOT_ADEQUATE" &&
      !officer.source_funds_wealth_notes
    )
      errors.push(
        "officer_analysis.source_funds_wealth_notes wajib diisi jika occupation_source_funds_wealth_assessment = NOT_ADEQUATE",
      );

    const relPurpose = addInfo.relationship_or_transaction_purpose;
    if (
      Array.isArray(relPurpose) &&
      relPurpose.includes("OTHER") &&
      !addInfo.relationship_or_transaction_purpose_other
    )
      errors.push(
        "additional_information.relationship_or_transaction_purpose_other wajib diisi jika OTHER dipilih",
      );

    const srcFunds = addInfo.source_of_funds;
    if (
      Array.isArray(srcFunds) &&
      srcFunds.includes("OTHER") &&
      !addInfo.source_of_funds_other
    )
      errors.push(
        "additional_information.source_of_funds_other wajib diisi jika OTHER dipilih",
      );

    const wealth = addInfo.wealth_information;
    if (
      Array.isArray(wealth) &&
      wealth.includes("OTHER") &&
      !addInfo.wealth_information_other
    )
      errors.push(
        "additional_information.wealth_information_other wajib diisi jika OTHER dipilih",
      );

    // New required dropdown fields (single-value string format)
    const eddSof = addInfo.source_of_funds;
    if (!eddSof || (typeof eddSof === "string" && !eddSof.trim()))
      errors.push("additional_information.source_of_funds wajib diisi");
    if (typeof eddSof === "string" && eddSof === "Pendapatan lain/Lainnya" && !addInfo.source_of_funds_other)
      errors.push("additional_information.source_of_funds_other wajib diisi jika Pendapatan lain/Lainnya");

    const eddBrp = addInfo.business_relationship_purpose;
    if (!eddBrp || (typeof eddBrp === "string" && !eddBrp.trim()))
      errors.push("additional_information.business_relationship_purpose wajib diisi");
    if (typeof eddBrp === "string" && eddBrp === "Lainnya" && !addInfo.business_relationship_purpose_other)
      errors.push("additional_information.business_relationship_purpose_other wajib diisi jika Lainnya");

    if (errors.length)
      throw new BadRequestException({
        message: "EDD belum memenuhi syarat untuk diselesaikan",
        errors,
      });
  }

  // ──────────────────────────────────────────────────────────────────────────

  async decide(
    appId: number,
    decision: "APPROVED" | "REJECTED" | "RETURN_FOR_REVISION",
    reason: string | null,
    user: { sub?: number | string; id?: number | string; role: string },
  ) {
    const reviewerId = user.sub ?? (user as any).id;

    const { rows } = await this.pool.query(
      `SELECT id, status FROM applications WHERE id=$1`,
      [appId],
    );
    const app = rows[0];
    if (!app) throw new NotFoundException("Application not found");

    if (!["SUBMITTED", "IN_REVIEW"].includes(app.status)) {
      throw new BadRequestException(
        `Tidak bisa membuat keputusan untuk status ${app.status}. Harus SUBMITTED atau IN_REVIEW.`,
      );
    }

    // Approval matrix berdasarkan hasil profiling risk:
    // LOW/MEDIUM  → hanya Operation Supervisor.
    // HIGH        → EDD diisi Frontline, approval hanya Lead Compliance.
    // SystemAdmin/Director tetap full-access via guard bypass.
    const fullAccessRoles = ["SystemAdmin", "Director"];
    let { rows: riskRows } = await this.pool.query(
      `SELECT COALESCE(override_level, risk_level) AS effective_level
       FROM application_risk WHERE application_id=$1`,
      [appId],
    );

    if (!riskRows[0]?.effective_level) {
      await this.screenAndComputeRisk(appId);
      ({ rows: riskRows } = await this.pool.query(
        `SELECT COALESCE(override_level, risk_level) AS effective_level
         FROM application_risk WHERE application_id=$1`,
        [appId],
      ));
    }

    const effectiveLevel = riskRows[0]?.effective_level as
      "LOW" | "MEDIUM" | "HIGH" | undefined;
    const isFullAccessRole = fullAccessRoles.includes(user.role);

    if (!effectiveLevel) {
      throw new BadRequestException(
        "Risk profiling belum lengkap. Jalankan pra-pemeriksaan atau submit ulang aplikasi terlebih dahulu.",
      );
    }

    if (!isFullAccessRole) {
      if (
        user.role === "OperationSupervisor" &&
        !["LOW", "MEDIUM"].includes(effectiveLevel)
      ) {
        throw new ForbiddenException(
          "KYC/KYB high risk hanya dapat diputuskan oleh Lead Compliance.",
        );
      }

      if (user.role === "ComplianceLead" && effectiveLevel !== "HIGH") {
        throw new ForbiddenException(
          "KYC/KYB low/medium risk hanya dapat diputuskan oleh Operation Supervisor.",
        );
      }
    }

    if (decision === "APPROVED") {
      // HIGH RISK wajib memiliki EDD lengkap sebelum approval Lead Compliance.
      const { rows: eddRows } = await this.pool.query(
        `SELECT edd_required, edd_completed FROM application_edd WHERE application_id=$1`,
        [appId],
      );
      if (effectiveLevel === "HIGH" && !eddRows[0]?.edd_completed) {
        throw new BadRequestException(
          "Application HIGH RISK wajib memiliki EDD lengkap sebelum disetujui.",
        );
      }

      // Blokir jika ada CONFIRMED DTTOT/PPPSPM
      const { rows: blockers } = await this.pool.query(
        `SELECT id, list_type FROM screening_results
         WHERE application_id = $1
           AND review_status = 'CONFIRMED'
           AND list_type IN ('DTTOT','PPPSPM')
         LIMIT 1`,
        [appId],
      );
      if (blockers.length) {
        throw new BadRequestException(
          `Tidak dapat approve: terdapat CONFIRMED ${blockers[0].list_type} hit. Lakukan review manual terlebih dahulu.`,
        );
      }

      // Pastikan risk sudah pernah dihitung; kalau belum, hitung sekarang
      const { rows: riskRows } = await this.pool.query(
        `SELECT application_id FROM application_risk WHERE application_id=$1`,
        [appId],
      );
      if (!riskRows.length) {
        await this.screenAndComputeRisk(appId);
      }

      const res = await this.pool.query(
        `UPDATE applications
         SET status='APPROVED', decision_by=$2, decision_reason=$3, decision_at=now(), updated_at=now()
         WHERE id=$1
         RETURNING id, status, decision_reason, decision_at`,
        [appId, reviewerId, reason || null],
      );
      return res.rows[0];
    } else {
      // REJECTED or RETURN_FOR_REVISION → kembalikan ke Frontline untuk perbaikan data.
      // Status menjadi REVISION_REQUIRED; alasan perbaikan wajib diisi.
      if (!reason?.trim()) {
        throw new BadRequestException("Alasan perbaikan wajib diisi.");
      }

      const res = await this.pool.query(
        `UPDATE applications
         SET status='REVISION_REQUIRED',
             revision_reason=$2,
             revision_requested_by=$3,
             revision_requested_at=now(),
             updated_at=now()
         WHERE id=$1
         RETURNING id, status, revision_reason, revision_requested_by, revision_requested_at`,
        [appId, reason, reviewerId],
      );
      return res.rows[0];
    }
  }
}
