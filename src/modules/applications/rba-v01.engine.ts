/**
 * RBA V01 — Strict implementation based on Risk Profile (RBA) - V01.xlsx
 *
 * STRICT RULES:
 * - All scores, weights, and thresholds come exclusively from the Excel workbook.
 * - If a value cannot be mapped to an Excel entry, it is marked INCOMPLETE.
 * - No fallbacks, invented scores, or default levels are applied.
 * - Name Screening / Watchlist: uses weight 0.01 from Rules sheet.
 *   Score mapped via RBA_V01_NAME_SCREENING_MAPPING (must follow SOP approval).
 */

export const RBA_VERSION = 'RBA_V01';

// ── Main component weights — from Rules sheet ─────────────────────────────────
export const COMPONENT_WEIGHTS = {
  customer:     0.55,
  product:      0.20,
  geography:    0.15,
  distribution: 0.10,
} as const;

// ── Customer sub-parameter weights — from Rules sheet ─────────────────────────
export const CUSTOMER_WEIGHTS_INDIVIDUAL = {
  occupation:        0.30,
  source_of_funds:   0.08,
  industry:          0.20,
  business_purpose:  0.01,
  name_screening:    0.01,
} as const;

export const CUSTOMER_WEIGHTS_BUSINESS = {
  business_form:     0.20,
  source_of_funds:   0.08,
  industry:          0.10,
  business_purpose:  0.01,
  name_screening:    0.01,
} as const;

// Mapping must follow SOP approval.
export const RBA_V01_NAME_SCREENING_MAPPING: Record<string, number> = {
  'CLEAR':            1,
  'NO_MATCH':         1,
  'NEAR_MATCH':       2,
  'MATCH':            3,
  'CONFIRMED_MATCH':  3,
};

// ── Risk level thresholds — from Rules sheet ──────────────────────────────────
// 0.00–1.50 = LOW, >1.50–2.50 = MEDIUM, >2.50–3.00 = HIGH
export function getRbaLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (score <= 1.50) return 'LOW';
  if (score <= 2.50) return 'MEDIUM';
  return 'HIGH';
}

// ── Sheet 1: Individual Occupation (Profil Pekerja) ───────────────────────────
export const OCCUPATION_SCORES_EXPORT: Record<string, number> = {
  'Pegawai Negeri Sipil (PNS)': 3,
  'Karyawan Swasta': 3,
  'Wirausaha/Wiraswasta': 3,
  'Pejabat Negara': 3,
  'Tidak Bekerja': 3,
  'Ibu Rumah Tangga': 2,
  'Pegawai BUMN/BUMD': 3,
  'Pengurus atau Pegawai LSM atau Organisasi Tidak Berbadan Hukum Lainnya': 2,
  'Lainnya': 2,
  'Profesional': 1,
  'Pegawai Bank/ Bank Employees': 1,
  'TNI/Polri': 3,
  'Pensiunan': 1,
  'Pemuka Agama': 1,
  'Tenaga Keamanan': 1,
  'Sopir': 2,
  'Asisten Rumah Tangga': 2,
  'Atlet/Olahragawan': 1,
  'Buruh': 1,
  'Pengajar': 1,
  'Pelajar/Mahasiswa': 2,
};

// ── Sheet 1: Business Form (Bentuk Badan Usaha/Badan Hukum) ──────────────────
export const BUSINESS_FORM_SCORES_EXPORT: Record<string, number> = {
  'PT': 3,
  'CV': 3,
  'Firma': 3,
  'Koperasi': 3,
  'Yayasan': 2,
  'Perkumpulan': 2,
  'BUMN/BUMD': 2,
  'Lainnya': 2,
};

// ── Sheet 1: Source of Funds (Sumber Dana) ────────────────────────────────────
export const SOURCE_OF_FUNDS_SCORES_EXPORT: Record<string, number> = {
  'Pendapatan lain/Lainnya': 3,
  'Investasi': 3,
  'Hibah': 2,
  'Lainnya': 2,
  'Hasil usaha': 2,
  'Gaji': 1,
  'Warisan': 1,
};

// ── Sheet 1: Business Relationship Purpose (Tujuan Hubungan Usaha) ────────────
export const BUSINESS_PURPOSE_SCORES_EXPORT: Record<string, number> = {
  'Penyaluran Dana Melalui Pihak Ketiga': 3,
  'Kegiatan usaha atau transaksi bisnis': 2,
  'Lainnya': 2,
  'Kebutuhan pribadi, pembayaran rutin, atau transfer keluarga': 1,
};

// ── Sheet 1.a: Industry (Bidang Industri) — with sub-industry keyword matching
// Source: sheet 1.a Customer Profile - Industry.
// Keywords are sub-industry text that maps an existing system category
// to the parent industry row in the Excel.
export const INDUSTRY_MAP: Array<{ industry: string; score: number; keywords: string[] }> = [
  {
    industry: 'Aktivitas Keuangan dan Asuransi',
    score: 3,
    keywords: [
      'layanan finansial', 'keuangan', 'asuransi', 'perbankan', 'bank',
      'remitansi', 'remitante', 'pinjaman', 'lending', 'investasi',
      'multifinance', 'payment gateway', 'pjp', 'crowdfunding',
      'penukaran uang', 'money changer', 'koperasi',
    ],
  },
  {
    industry: 'Perdagangan Besar dan Eceran, Reparasi, dan Perawatan Mobil dan Sepeda Motor',
    score: 3,
    keywords: [
      'otomotif', 'mobil', 'sepeda motor', 'marketplace', 'elektronik',
      'busana', 'sembako', 'bahan baku', 'hobi', 'mainan', 'kerajinan',
      'buku', 'majalah', 'pulsa', 'ppob', 'perdagangan',
    ],
  },
  {
    industry: 'Real Estat',
    score: 3,
    keywords: ['real estate', 'real estat', 'properti', 'perumahan', 'developer perumahan'],
  },
  {
    industry: 'Administrasi Pemerintahan, Pertahanan, dan Jaminan Sosial Wajib',
    score: 3,
    keywords: ['pemerintah', 'pertahanan', 'jaminan sosial'],
  },
  {
    industry: 'Penyediaan Akomodasi dan Penyediaan Makan Minum',
    score: 2,
    keywords: ['makanan dan minuman', 'hotel', 'resort', 'hospitality', 'akomodasi', 'restoran', 'kafe'],
  },
  {
    industry: 'Pengangkutan dan Pergudangan',
    score: 2,
    keywords: ['pengiriman', 'transportasi', 'pergudangan', 'pengangkutan', 'logistik', 'jasa pengiriman'],
  },
  {
    industry: 'Informasi dan Komunikasi',
    score: 2,
    keywords: [
      'informasi dan komunikasi', 'konten digital', 'streaming', 'kabel',
      'kontraktor (it)', ' it)', 'teknologi informasi', 'internet', 'telekomunikasi',
    ],
  },
  {
    industry: 'Industri Pengolahan',
    score: 2,
    keywords: ['percetakan', 'mesin', 'manufaktur', 'pabrik', 'industri pengolahan'],
  },
  {
    industry: 'Aktivitas Jasa Lainnya',
    score: 2,
    keywords: ['kecantikan', 'perawatan kecantikan', 'acara', 'jasa lainnya', 'periklanan'],
  },
  {
    industry: 'Aktivitas Kesehatan Manusia dan Aktivitas Sosial',
    score: 1,
    keywords: [
      'medis', 'layanan medis', 'kesehatan', 'farmasi', 'obat',
      'badan amal', 'donasi', 'sosial',
    ],
  },
  {
    industry: 'Aktivitas Profesional, Ilmiah, dan Teknis',
    score: 1,
    keywords: ['konsultan', 'profesional', 'ilmiah', 'teknis'],
  },
  {
    industry: 'Aktivitas Penyewaan dan Sewa Guna Usaha Tanpa Hak Opsi, Ketenagakerjaan, Agen Perjalanan, dan Penunjang Usaha Lainnya',
    score: 1,
    keywords: ['agen travel', 'agen perjalanan', 'ota/', 'ota,', 'travel agent', 'sewa guna'],
  },
  {
    industry: 'Pendidikan',
    score: 1,
    keywords: ['pendidikan', 'sekolah', 'perguruan tinggi', 'universitas', 'pelajar', 'mahasiswa'],
  },
  {
    industry: 'Pertanian, Kehutanan, dan Perikanan',
    score: 1,
    keywords: ['pertanian', 'kehutanan', 'perikanan', 'agrikultur', 'nelayan'],
  },
];

// ── Sheet 3: Area Geografis ───────────────────────────────────────────────────
// Province → score mapping.
// Aliases: exact alternate spellings used in system fields.
// Note: scores derived from internal RBA compliance document; pending formal
// confirmation against Excel sheet 3 "Area Geografis."
export const GEOGRAPHY_MAP: Array<{ name: string; aliases: string[]; score: number }> = [
  // HIGH risk = score 3
  { name: 'DKI Jakarta',     aliases: ['jakarta', 'dki jakarta', 'dki'],           score: 3 },
  { name: 'Sumatera Utara',  aliases: ['sumut', 'north sumatra', 'sumatera utara'], score: 3 },
  { name: 'Jawa Barat',      aliases: ['jabar', 'west java', 'jawa barat'],         score: 3 },
  { name: 'Jawa Tengah',     aliases: ['jateng', 'central java', 'jawa tengah'],    score: 3 },
  { name: 'Jawa Timur',      aliases: ['jatim', 'east java', 'jawa timur'],         score: 3 },
  { name: 'Banten',          aliases: [],                                            score: 3 },
  // MEDIUM risk = score 2
  { name: 'DI Yogyakarta',   aliases: ['di. yogyakarta', 'diy', 'yogyakarta', 'daerah istimewa yogyakarta', 'd.i. yogyakarta'], score: 2 },
  { name: 'Bali',            aliases: [],                                            score: 2 },
  { name: 'Riau',            aliases: [],                                            score: 2 },
  { name: 'Kepulauan Riau',  aliases: ['kepri', 'riau islands', 'kep. riau'],        score: 2 },
  { name: 'Sumatera Selatan',aliases: ['sumsel', 'south sumatra'],                   score: 2 },
  { name: 'Kalimantan Timur',aliases: ['kaltim', 'east kalimantan'],                 score: 2 },
  { name: 'Sulawesi Selatan',aliases: ['sulsel', 'south sulawesi'],                  score: 2 },
  { name: 'Lampung',         aliases: [],                                            score: 2 },
  { name: 'Bengkulu',        aliases: [],                                            score: 2 },
  // LOW risk = score 1
  { name: 'Aceh',                    aliases: ['nanggroe aceh darussalam', 'nad', 'daerah istimewa aceh'], score: 1 },
  { name: 'Sumatera Barat',          aliases: ['sumbar', 'west sumatra'],                                  score: 1 },
  { name: 'Jambi',                   aliases: [],                                                           score: 1 },
  { name: 'Kepulauan Bangka Belitung', aliases: ['babel', 'bangka belitung', 'kep. babel', 'kep babel'],   score: 1 },
  { name: 'Kalimantan Barat',        aliases: ['kalbar', 'west kalimantan'],                               score: 1 },
  { name: 'Kalimantan Tengah',       aliases: ['kalteng', 'central kalimantan'],                           score: 1 },
  { name: 'Kalimantan Selatan',      aliases: ['kalsel', 'south kalimantan'],                              score: 1 },
  { name: 'Kalimantan Utara',        aliases: ['kaltara', 'north kalimantan'],                             score: 1 },
  { name: 'Sulawesi Utara',          aliases: ['sulut', 'north sulawesi'],                                 score: 1 },
  { name: 'Sulawesi Tengah',         aliases: ['sulteng', 'central sulawesi'],                             score: 1 },
  { name: 'Sulawesi Tenggara',       aliases: ['sultra', 'southeast sulawesi'],                            score: 1 },
  { name: 'Sulawesi Barat',          aliases: ['sulbar', 'west sulawesi'],                                 score: 1 },
  { name: 'Gorontalo',               aliases: [],                                                           score: 1 },
  { name: 'Maluku',                  aliases: [],                                                           score: 1 },
  { name: 'Maluku Utara',            aliases: ['north maluku'],                                             score: 1 },
  { name: 'Nusa Tenggara Barat',     aliases: ['ntb', 'west nusa tenggara', 'nusa tenggara barat'],        score: 1 },
  { name: 'Nusa Tenggara Timur',     aliases: ['ntt', 'east nusa tenggara', 'nusa tenggara timur'],        score: 1 },
  { name: 'Papua',                   aliases: [],                                                           score: 1 },
  { name: 'Papua Barat',             aliases: ['west papua', 'irian jaya barat'],                          score: 1 },
];

// ── Sheet 4: Distribution ─────────────────────────────────────────────────────
export const DISTRIBUTION_SCORES_EXPORT: Record<string, number> = {
  'Aplikasi Digital':   3,
  'Agen Pihak Ketiga':  3,
  'Outlet Fisik':       2,
};

// ── Sheet 2: Product ──────────────────────────────────────────────────────────
export const PRODUCT_NAME = 'Produk Remitansi';
export const PRODUCT_SCORE = 3;

// ── Lookup functions (strict — no invented defaults) ──────────────────────────

function lookupOccupation(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  if (v in OCCUPATION_SCORES_EXPORT) return OCCUPATION_SCORES_EXPORT[v];
  // Case-insensitive
  const lower = v.toLowerCase();
  for (const [k, s] of Object.entries(OCCUPATION_SCORES_EXPORT)) {
    if (k.toLowerCase() === lower) return s;
  }
  // "TNI/POLRI" stored as "TNI/Polri"
  if (lower === 'tni/polri') return OCCUPATION_SCORES_EXPORT['TNI/Polri'];
  // "Pegawai Bank/ Bank Employees" — handle spacing variants
  if (lower.includes('pegawai bank') || lower.includes('bank employee')) {
    return OCCUPATION_SCORES_EXPORT['Pegawai Bank/ Bank Employees'];
  }
  return null;
}

function lookupBusinessForm(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  if (v in BUSINESS_FORM_SCORES_EXPORT) return BUSINESS_FORM_SCORES_EXPORT[v];
  const upper = v.toUpperCase();
  for (const [k, s] of Object.entries(BUSINESS_FORM_SCORES_EXPORT)) {
    if (k.toUpperCase() === upper) return s;
  }
  // Handle stored variants like "PT." → "PT", "CV." → "CV"
  const stripped = upper.replace(/\.$/, '');
  if (stripped in BUSINESS_FORM_SCORES_EXPORT) return BUSINESS_FORM_SCORES_EXPORT[stripped];
  return null;
}

function lookupSourceOfFunds(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  if (v in SOURCE_OF_FUNDS_SCORES_EXPORT) return SOURCE_OF_FUNDS_SCORES_EXPORT[v];
  const lower = v.toLowerCase();
  for (const [k, s] of Object.entries(SOURCE_OF_FUNDS_SCORES_EXPORT)) {
    if (k.toLowerCase() === lower) return s;
  }
  return null;
}

function lookupBusinessPurpose(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  if (v in BUSINESS_PURPOSE_SCORES_EXPORT) return BUSINESS_PURPOSE_SCORES_EXPORT[v];
  const lower = v.toLowerCase();
  for (const [k, s] of Object.entries(BUSINESS_PURPOSE_SCORES_EXPORT)) {
    if (k.toLowerCase() === lower) return s;
  }
  return null;
}

function lookupIndustry(value: string | null | undefined): { industry: string; score: number } | null {
  if (!value) return null;
  const lower = value.toLowerCase().trim();
  // 1. Exact match against Excel industry names
  for (const entry of INDUSTRY_MAP) {
    if (entry.industry.toLowerCase() === lower) return entry;
  }
  // 2. Sub-industry keyword matching per sheet 1.a
  for (const entry of INDUSTRY_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw.toLowerCase())) return entry;
    }
  }
  return null;
}

export function lookupGeography(value: string | null | undefined): { name: string; score: number } | null {
  if (!value) return null;
  const lower = value.toLowerCase().trim();
  // Exact match by canonical name
  for (const entry of GEOGRAPHY_MAP) {
    if (entry.name.toLowerCase() === lower) return entry;
  }
  // Exact match by alias
  for (const entry of GEOGRAPHY_MAP) {
    for (const alias of entry.aliases) {
      if (alias.toLowerCase() === lower) return entry;
    }
  }
  // Substring: value contains exact alias or alias contains value (cautious)
  // Longer entries first (array is ordered longest name first by score group)
  for (const entry of GEOGRAPHY_MAP) {
    const nameLower = entry.name.toLowerCase();
    if (lower.includes(nameLower) || nameLower.includes(lower)) {
      return entry;
    }
    for (const alias of entry.aliases) {
      const aliasLower = alias.toLowerCase();
      if (lower === aliasLower || lower.includes(aliasLower)) return entry;
    }
  }
  return null;
}

function lookupDistribution(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  if (v in DISTRIBUTION_SCORES_EXPORT) return DISTRIBUTION_SCORES_EXPORT[v];
  const lower = v.toLowerCase();
  for (const [k, s] of Object.entries(DISTRIBUTION_SCORES_EXPORT)) {
    if (k.toLowerCase() === lower) return s;
  }
  return null;
}

function lookupNameScreening(value: string | null | undefined): number | null {
  if (value == null) return null;
  const upper = value.trim().toUpperCase();
  for (const [k, s] of Object.entries(RBA_V01_NAME_SCREENING_MAPPING)) {
    if (k.toUpperCase() === upper) return s;
  }
  return null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RbaInputIndividual {
  type: 'INDIVIDUAL';
  occupation?: string | null;
  source_of_funds?: string | null;
  industry_category?: string | null;
  business_relationship_purpose?: string | null;
  province_name?: string | null;  // resolved province name from province_code lookup
  distribution_channel?: string | null;
  name_screening_result?: string | null; // CLEAR | NO_MATCH | NEAR_MATCH | MATCH | CONFIRMED_MATCH
}

export interface RbaInputBusiness {
  type: 'BUSINESS';
  legal_form?: string | null;       // Bentuk Badan Usaha
  source_of_funds?: string | null;
  industry_category?: string | null;
  business_relationship_purpose?: string | null;
  province?: string | null;         // registered province (free text)
  distribution_channel?: string | null;
  name_screening_result?: string | null; // CLEAR | NO_MATCH | NEAR_MATCH | MATCH | CONFIRMED_MATCH
}

export type RbaInput = RbaInputIndividual | RbaInputBusiness;

export interface RbaUnmappedParameter {
  parameter: string;
  value?: string | null;
  reason: string;
}

export interface RbaComponentDetail {
  name: string;
  value: string | null;
  score: number;
  weight: number;
  source_sheet: string;
  mapped_to?: string;  // Excel industry/geography name actually matched
}

export interface RbaComponents {
  customer: {
    weight: number;
    score: number | null;
    contribution: number | null;
    parameters: RbaComponentDetail[];
  };
  product: {
    weight: number;
    value: string;
    score: number;
    contribution: number;
    source_sheet: string;
  };
  geography: {
    weight: number;
    value: string | null;
    score: number | null;
    contribution: number | null;
    mapped_to: string | null;
    source_sheet: string;
  };
  distribution: {
    weight: number;
    value: string | null;
    score: number | null;
    contribution: number | null;
    source_sheet: string;
  };
}

export interface RbaResult {
  rba_version: string;
  rba_calculation_status: 'COMPLETE' | 'INCOMPLETE';
  rba_score_v01: number | null;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  rba_components: RbaComponents;
  rba_unmapped_parameters: RbaUnmappedParameter[];
}

// ── Main compute function ─────────────────────────────────────────────────────

export function computeRbaV01(input: RbaInput): RbaResult {
  const unmapped: RbaUnmappedParameter[] = [];

  // ── Product (always Produk Remitansi for this system) ──────────────────────
  const productContribution = PRODUCT_SCORE * COMPONENT_WEIGHTS.product;

  // ── Geography ──────────────────────────────────────────────────────────────
  const provinceValue = input.type === 'INDIVIDUAL'
    ? (input as RbaInputIndividual).province_name
    : (input as RbaInputBusiness).province;

  const geoMatch = lookupGeography(provinceValue);
  let geoScore: number | null = null;
  let geoContribution: number | null = null;
  let geoMappedTo: string | null = null;

  if (geoMatch) {
    geoScore = geoMatch.score;
    geoContribution = geoScore * COMPONENT_WEIGHTS.geography;
    geoMappedTo = geoMatch.name;
  } else {
    unmapped.push({
      parameter: 'Area Geografis',
      value: provinceValue ?? null,
      reason: provinceValue
        ? `Province "${provinceValue}" not found in sheet 3 (Area Geografis).`
        : 'Province not provided.',
    });
  }

  // ── Distribution ───────────────────────────────────────────────────────────
  const distScore = lookupDistribution(input.distribution_channel);
  let distContribution: number | null = null;

  if (distScore !== null) {
    distContribution = distScore * COMPONENT_WEIGHTS.distribution;
  } else {
    unmapped.push({
      parameter: 'Distribution',
      value: input.distribution_channel ?? null,
      reason: input.distribution_channel
        ? `Distribution channel "${input.distribution_channel}" not found in sheet 4 (Distribution).`
        : 'distribution_channel not provided. Must be one of: Aplikasi Digital, Agen Pihak Ketiga, Outlet Fisik.',
    });
  }

  // ── Customer Risk ─────────────────────────────────────────────────────────
  const customerParams: RbaComponentDetail[] = [];
  let customerWeightSum = 0;
  let customerScoreWeightedSum = 0;
  let customerIncomplete = false;

  if (input.type === 'INDIVIDUAL') {
    const ind = input as RbaInputIndividual;
    const weights = CUSTOMER_WEIGHTS_INDIVIDUAL;

    // Profil Pekerja (Occupation)
    const occScore = lookupOccupation(ind.occupation);
    if (occScore !== null) {
      customerParams.push({ name: 'Profil Pekerja', value: ind.occupation ?? null, score: occScore, weight: weights.occupation, source_sheet: '1. Customer Profile', mapped_to: ind.occupation ?? undefined });
      customerWeightSum += weights.occupation;
      customerScoreWeightedSum += occScore * weights.occupation;
    } else {
      customerIncomplete = true;
      unmapped.push({ parameter: 'Profil Pekerja', value: ind.occupation ?? null, reason: ind.occupation ? `Occupation "${ind.occupation}" not found in sheet 1 (Customer Profile).` : 'Occupation not provided.' });
    }

    // Sumber Dana
    const sofScore = lookupSourceOfFunds(ind.source_of_funds);
    if (sofScore !== null) {
      customerParams.push({ name: 'Sumber Dana', value: ind.source_of_funds ?? null, score: sofScore, weight: weights.source_of_funds, source_sheet: '1. Customer Profile' });
      customerWeightSum += weights.source_of_funds;
      customerScoreWeightedSum += sofScore * weights.source_of_funds;
    } else {
      customerIncomplete = true;
      unmapped.push({ parameter: 'Sumber Dana', value: ind.source_of_funds ?? null, reason: ind.source_of_funds ? `Source of funds "${ind.source_of_funds}" not found in sheet 1 (Customer Profile).` : 'source_of_funds not provided.' });
    }

    // Bidang Industri
    const industryMatch = lookupIndustry(ind.industry_category);
    if (industryMatch) {
      customerParams.push({ name: 'Bidang Industri', value: ind.industry_category ?? null, score: industryMatch.score, weight: weights.industry, source_sheet: '1.a Customer Profile - Industry', mapped_to: industryMatch.industry });
      customerWeightSum += weights.industry;
      customerScoreWeightedSum += industryMatch.score * weights.industry;
    } else {
      customerIncomplete = true;
      unmapped.push({ parameter: 'Bidang Industri', value: ind.industry_category ?? null, reason: ind.industry_category ? `Industry "${ind.industry_category}" not found in sheet 1.a sub-industry text.` : 'industry_category not provided.' });
    }

    // Tujuan Hubungan Usaha
    const purposeScore = lookupBusinessPurpose(ind.business_relationship_purpose);
    if (purposeScore !== null) {
      customerParams.push({ name: 'Tujuan Hubungan Usaha', value: ind.business_relationship_purpose ?? null, score: purposeScore, weight: weights.business_purpose, source_sheet: '1. Customer Profile' });
      customerWeightSum += weights.business_purpose;
      customerScoreWeightedSum += purposeScore * weights.business_purpose;
    } else {
      customerIncomplete = true;
      unmapped.push({ parameter: 'Tujuan Hubungan Usaha', value: ind.business_relationship_purpose ?? null, reason: ind.business_relationship_purpose ? `Business purpose "${ind.business_relationship_purpose}" not found in sheet 1.` : 'business_relationship_purpose not provided.' });
    }

    // Name Screening / Watchlist — weight 0.01, mapped via RBA_V01_NAME_SCREENING_MAPPING
    const nsScoreInd = lookupNameScreening(ind.name_screening_result);
    if (nsScoreInd !== null) {
      customerParams.push({ name: 'Name Screening / Watchlist', value: ind.name_screening_result ?? null, score: nsScoreInd, weight: weights.name_screening, source_sheet: '1. Customer Profile (Rules)' });
      customerWeightSum += weights.name_screening;
      customerScoreWeightedSum += nsScoreInd * weights.name_screening;
    } else {
      customerIncomplete = true;
      unmapped.push({
        parameter: 'Name Screening / Watchlist',
        value: ind.name_screening_result ?? null,
        reason: ind.name_screening_result
          ? `Watchlist screening result "${ind.name_screening_result}" is not mapped in RBA V01 Name Screening mapping.`
          : 'Watchlist screening result not provided.',
      });
    }

  } else {
    const biz = input as RbaInputBusiness;
    const weights = CUSTOMER_WEIGHTS_BUSINESS;

    // Bentuk Badan Usaha
    const formScore = lookupBusinessForm(biz.legal_form);
    if (formScore !== null) {
      customerParams.push({ name: 'Bentuk Badan Usaha/Badan Hukum', value: biz.legal_form ?? null, score: formScore, weight: weights.business_form, source_sheet: '1. Customer Profile' });
      customerWeightSum += weights.business_form;
      customerScoreWeightedSum += formScore * weights.business_form;
    } else {
      customerIncomplete = true;
      unmapped.push({ parameter: 'Bentuk Badan Usaha/Badan Hukum', value: biz.legal_form ?? null, reason: biz.legal_form ? `Business form "${biz.legal_form}" not found in sheet 1.` : 'legal_form not provided.' });
    }

    // Sumber Dana
    const sofScore = lookupSourceOfFunds(biz.source_of_funds);
    if (sofScore !== null) {
      customerParams.push({ name: 'Sumber Dana', value: biz.source_of_funds ?? null, score: sofScore, weight: weights.source_of_funds, source_sheet: '1. Customer Profile' });
      customerWeightSum += weights.source_of_funds;
      customerScoreWeightedSum += sofScore * weights.source_of_funds;
    } else {
      customerIncomplete = true;
      unmapped.push({ parameter: 'Sumber Dana', value: biz.source_of_funds ?? null, reason: biz.source_of_funds ? `Source of funds "${biz.source_of_funds}" not found in sheet 1.` : 'source_of_funds not provided.' });
    }

    // Bidang Industri
    const industryMatch = lookupIndustry(biz.industry_category);
    if (industryMatch) {
      customerParams.push({ name: 'Bidang Industri', value: biz.industry_category ?? null, score: industryMatch.score, weight: weights.industry, source_sheet: '1.a Customer Profile - Industry', mapped_to: industryMatch.industry });
      customerWeightSum += weights.industry;
      customerScoreWeightedSum += industryMatch.score * weights.industry;
    } else {
      customerIncomplete = true;
      unmapped.push({ parameter: 'Bidang Industri', value: biz.industry_category ?? null, reason: biz.industry_category ? `Industry "${biz.industry_category}" not found in sheet 1.a sub-industry text.` : 'industry_category not provided.' });
    }

    // Tujuan Hubungan Usaha
    const purposeScore = lookupBusinessPurpose(biz.business_relationship_purpose);
    if (purposeScore !== null) {
      customerParams.push({ name: 'Tujuan Hubungan Usaha', value: biz.business_relationship_purpose ?? null, score: purposeScore, weight: weights.business_purpose, source_sheet: '1. Customer Profile' });
      customerWeightSum += weights.business_purpose;
      customerScoreWeightedSum += purposeScore * weights.business_purpose;
    } else {
      customerIncomplete = true;
      unmapped.push({ parameter: 'Tujuan Hubungan Usaha', value: biz.business_relationship_purpose ?? null, reason: biz.business_relationship_purpose ? `Business purpose "${biz.business_relationship_purpose}" not found in sheet 1.` : 'business_relationship_purpose not provided.' });
    }

    // Name Screening / Watchlist — weight 0.01, mapped via RBA_V01_NAME_SCREENING_MAPPING
    const nsScoreBiz = lookupNameScreening(biz.name_screening_result);
    if (nsScoreBiz !== null) {
      customerParams.push({ name: 'Name Screening / Watchlist', value: biz.name_screening_result ?? null, score: nsScoreBiz, weight: weights.name_screening, source_sheet: '1. Customer Profile (Rules)' });
      customerWeightSum += weights.name_screening;
      customerScoreWeightedSum += nsScoreBiz * weights.name_screening;
    } else {
      customerIncomplete = true;
      unmapped.push({
        parameter: 'Name Screening / Watchlist',
        value: biz.name_screening_result ?? null,
        reason: biz.name_screening_result
          ? `Watchlist screening result "${biz.name_screening_result}" is not mapped in RBA V01 Name Screening mapping.`
          : 'Watchlist screening result not provided.',
      });
    }
  }

  // Customer weighted average (denominator = sum of weights for MAPPED params only)
  let customerScore: number | null = null;
  let customerContribution: number | null = null;
  if (!customerIncomplete && customerWeightSum > 0) {
    customerScore = customerScoreWeightedSum / customerWeightSum;
    customerContribution = customerScore * COMPONENT_WEIGHTS.customer;
  }

  // ── Assemble components ────────────────────────────────────────────────────
  const components: RbaComponents = {
    customer: {
      weight: COMPONENT_WEIGHTS.customer,
      score: customerScore !== null ? parseFloat(customerScore.toFixed(4)) : null,
      contribution: customerContribution !== null ? parseFloat(customerContribution.toFixed(4)) : null,
      parameters: customerParams,
    },
    product: {
      weight: COMPONENT_WEIGHTS.product,
      value: PRODUCT_NAME,
      score: PRODUCT_SCORE,
      contribution: parseFloat(productContribution.toFixed(4)),
      source_sheet: '2. Product',
    },
    geography: {
      weight: COMPONENT_WEIGHTS.geography,
      value: provinceValue ?? null,
      score: geoScore,
      contribution: geoContribution !== null ? parseFloat(geoContribution.toFixed(4)) : null,
      mapped_to: geoMappedTo,
      source_sheet: '3. Area Geografis',
    },
    distribution: {
      weight: COMPONENT_WEIGHTS.distribution,
      value: input.distribution_channel ?? null,
      score: distScore,
      contribution: distContribution !== null ? parseFloat(distContribution.toFixed(4)) : null,
      source_sheet: '4. Distribution',
    },
  };

  // ── Final status & score ───────────────────────────────────────────────────
  const isIncomplete = customerIncomplete || geoScore === null || distScore === null;

  let rbaScore: number | null = null;
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null = null;

  if (!isIncomplete) {
    const raw = customerContribution! + productContribution + geoContribution! + distContribution!;
    rbaScore = parseFloat(raw.toFixed(2));
    riskLevel = getRbaLevel(rbaScore);
  }

  return {
    rba_version: RBA_VERSION,
    rba_calculation_status: isIncomplete ? 'INCOMPLETE' : 'COMPLETE',
    rba_score_v01: rbaScore,
    risk_level: riskLevel,
    rba_components: components,
    rba_unmapped_parameters: unmapped,
  };
}
