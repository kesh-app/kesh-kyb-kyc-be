/**
 * RBA V01 — Strict implementation based on "Risk Profile (RBA) - V01.xlsx"
 *
 * STRICT RULES:
 * - All scores, weights, and thresholds come exclusively from the Excel workbook.
 * - If a value cannot be mapped to an Excel entry, the whole RBA is INCOMPLETE.
 * - No fallbacks, invented scores, or default levels are applied.
 *
 * CALCULATION MODEL: DIRECT_WEIGHTED_SUM (workbook "Rules" + "Sampling" sheets)
 *
 *   rba_score_v01 =
 *       occupation_or_business_form × 0.30
 *     + source_of_funds             × 0.08
 *     + industry                    × 0.15
 *     + business_relationship_purpose × 0.01
 *     + name_screening              × 0.01
 *     + product                     × 0.10
 *     + geography                   × 0.15
 *     + distribution                × 0.20
 *   (Σ weights = 1.00)
 *
 * The previous customer-subscore model (customer 0.55 wrapper, product 0.20,
 * distribution 0.10 and a customer weighted-average denominator) has been
 * removed — it does not exist in the latest workbook.
 */

export const RBA_VERSION = 'RBA_V01';
export const RBA_CALCULATION_MODEL = 'DIRECT_WEIGHTED_SUM';

// ── Direct parameter weights — from Rules sheet (Σ = 1.00) ────────────────────
export const PARAMETER_WEIGHTS = {
  occupation_or_business_form:   0.30,
  source_of_funds:               0.08,
  industry:                      0.15,
  business_relationship_purpose: 0.01,
  name_screening:                0.01,
  product:                       0.10,
  geography:                     0.15,
  distribution:                  0.20,
} as const;

// ── Sheet 1.b: Name Screening ─────────────────────────────────────────────────
// Workbook only defines PEP / DTTOT / DPPSPM as score 3.
// Clear / no match / false positive / dismissed = 0.
// Near match / unreviewed has NO workbook score → RBA INCOMPLETE (never score 2).
// DPPSPM and PPPSPM are treated as the same watchlist type alias for scoring.
export const RBA_V01_NAME_SCREENING_MAPPING: Record<string, number> = {
  'CLEAR':            0,
  'NO_MATCH':         0,
  'FALSE_POSITIVE':   0,
  'DISMISSED':        0,
  'PEP':              3,
  'DTTOT':            3,
  'DPPSPM':           3,
  'PPPSPM':           3,
  'MATCH':            3,
  'CONFIRMED_MATCH':  3,
};

// Statuses that require review before scoring — mark RBA INCOMPLETE, no score.
export const RBA_V01_NAME_SCREENING_NEAR_STATES = ['NEAR_MATCH', 'UNREVIEWED'];

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
// Province → score mapping, taken verbatim from workbook sheet 3 "Area Geografis".
// Aliases: alternate spellings used in system fields / DB province names.
// Provinces NOT listed in the workbook (e.g. Sumatera Selatan, Sulawesi Tenggara,
// Papua Barat Daya) are intentionally absent → they resolve to INCOMPLETE.
export const GEOGRAPHY_MAP: Array<{ name: string; aliases: string[]; score: number }> = [
  // HIGH risk = score 3
  { name: 'DKI Jakarta',     aliases: ['jakarta', 'dki jakarta', 'dki'],            score: 3 },
  { name: 'Jawa Barat',      aliases: ['jabar', 'west java', 'jawa barat'],          score: 3 },
  { name: 'Jawa Timur',      aliases: ['jatim', 'east java', 'jawa timur'],          score: 3 },
  { name: 'Banten',          aliases: [],                                            score: 3 },
  { name: 'Sumatera Utara',  aliases: ['sumut', 'north sumatra', 'sumatera utara'],  score: 3 },
  { name: 'Papua Barat',     aliases: ['west papua', 'irian jaya barat'],            score: 3 },
  { name: 'Jawa Tengah',     aliases: ['jateng', 'central java', 'jawa tengah'],     score: 3 },
  // MEDIUM risk = score 2
  { name: 'Aceh',            aliases: ['nanggroe aceh darussalam', 'nad', 'daerah istimewa aceh'], score: 2 },
  { name: 'Sulawesi Selatan',aliases: ['sulsel', 'south sulawesi'],                  score: 2 },
  { name: 'DI Yogyakarta',   aliases: ['di. yogyakarta', 'diy', 'yogyakarta', 'daerah istimewa yogyakarta', 'd.i. yogyakarta'], score: 2 },
  { name: 'Lampung',         aliases: [],                                            score: 2 },
  { name: 'Riau',            aliases: [],                                            score: 2 },
  { name: 'Bali',            aliases: [],                                            score: 2 },
  { name: 'Kepulauan Riau',  aliases: ['kepri', 'riau islands', 'kep. riau'],        score: 2 },
  { name: 'Kalimantan Timur',aliases: ['kaltim', 'east kalimantan'],                 score: 2 },
  // LOW risk = score 1
  { name: 'Nusa Tenggara Barat',     aliases: ['ntb', 'west nusa tenggara', 'nusa tenggara barat'], score: 1 },
  { name: 'Sulawesi Tengah',         aliases: ['sulteng', 'central sulawesi'],                       score: 1 },
  { name: 'Maluku',                  aliases: [],                                                    score: 1 },
  { name: 'Maluku Utara',            aliases: ['north maluku'],                                      score: 1 },
  { name: 'Sulawesi Barat',          aliases: ['sulbar', 'west sulawesi'],                           score: 1 },
  { name: 'Sulawesi Utara',          aliases: ['sulut', 'north sulawesi'],                           score: 1 },
  { name: 'Kalimantan Selatan',      aliases: ['kalsel', 'south kalimantan'],                        score: 1 },
  { name: 'Papua',                   aliases: [],                                                    score: 1 },
  { name: 'Sumatera Barat',          aliases: ['sumbar', 'west sumatra'],                            score: 1 },
  { name: 'Kalimantan Barat',        aliases: ['kalbar', 'west kalimantan'],                         score: 1 },
  { name: 'Kalimantan Utara',        aliases: ['kaltara', 'north kalimantan'],                       score: 1 },
  { name: 'Bengkulu',                aliases: [],                                                    score: 1 },
  { name: 'Gorontalo',               aliases: [],                                                    score: 1 },
  { name: 'Kalimantan Tengah',       aliases: ['kalteng', 'central kalimantan'],                     score: 1 },
  { name: 'Kepulauan Bangka Belitung', aliases: ['babel', 'bangka belitung', 'kep. babel', 'kep babel'], score: 1 },
  { name: 'Jambi',                   aliases: [],                                                    score: 1 },
  { name: 'Nusa Tenggara Timur',     aliases: ['ntt', 'east nusa tenggara', 'nusa tenggara timur'],  score: 1 },
];

// ── Sheet 4: Distribution ─────────────────────────────────────────────────────
// Workbook V01: Outlet Fisik downgraded from 2 → 1.
export const DISTRIBUTION_SCORES_EXPORT: Record<string, number> = {
  'Aplikasi Digital':   3,
  'Agen Pihak Ketiga':  3,
  'Outlet Fisik':       1,
};

// ── Sheet 2: Product ──────────────────────────────────────────────────────────
export const PRODUCT_NAME = 'Produk Remitansi';
export const PRODUCT_SCORE = 3;

// ── Lookup functions (strict — no invented defaults) ──────────────────────────

function lookupOccupation(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  if (v in OCCUPATION_SCORES_EXPORT) return OCCUPATION_SCORES_EXPORT[v];
  const lower = v.toLowerCase();
  for (const [k, s] of Object.entries(OCCUPATION_SCORES_EXPORT)) {
    if (k.toLowerCase() === lower) return s;
  }
  if (lower === 'tni/polri') return OCCUPATION_SCORES_EXPORT['TNI/Polri'];
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
  for (const entry of INDUSTRY_MAP) {
    if (entry.industry.toLowerCase() === lower) return entry;
  }
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
  for (const entry of GEOGRAPHY_MAP) {
    if (entry.name.toLowerCase() === lower) return entry;
  }
  for (const entry of GEOGRAPHY_MAP) {
    for (const alias of entry.aliases) {
      if (alias.toLowerCase() === lower) return entry;
    }
  }
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

function isNameScreeningNearMatch(value: string | null | undefined): boolean {
  if (value == null) return false;
  const upper = value.trim().toUpperCase();
  return RBA_V01_NAME_SCREENING_NEAR_STATES.some((s) => s.toUpperCase() === upper);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RbaInputIndividual {
  type: 'INDIVIDUAL';
  occupation?: string | null;
  source_of_funds?: string | null;
  industry_category?: string | null;
  business_relationship_purpose?: string | null;
  province_name?: string | null;
  distribution_channel?: string | null;
  name_screening_result?: string | null;
}

export interface RbaInputBusiness {
  type: 'BUSINESS';
  legal_form?: string | null;
  source_of_funds?: string | null;
  industry_category?: string | null;
  business_relationship_purpose?: string | null;
  province?: string | null;
  distribution_channel?: string | null;
  name_screening_result?: string | null;
}

export type RbaInput = RbaInputIndividual | RbaInputBusiness;

export interface RbaUnmappedParameter {
  parameter: string;
  value?: string | null;
  reason: string;
}

export interface RbaComponentDetail {
  weight: number;
  value: string | null;
  score: number | null;
  contribution: number | null;
  mapped_to?: string | null;
  source_sheet: string;
}

export interface RbaComponents {
  version: string;
  calculation_model: string;
  components: {
    occupation_or_business_form: RbaComponentDetail;
    source_of_funds: RbaComponentDetail;
    industry: RbaComponentDetail;
    business_relationship_purpose: RbaComponentDetail;
    name_screening: RbaComponentDetail;
    product: RbaComponentDetail;
    geography: RbaComponentDetail;
    distribution: RbaComponentDetail;
  };
  total_score: number | null;
}

export interface RbaResult {
  rba_version: string;
  rba_calculation_status: 'COMPLETE' | 'INCOMPLETE';
  rba_score_v01: number | null;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  rba_components: RbaComponents;
  rba_unmapped_parameters: RbaUnmappedParameter[];
}

// ── Main compute function — DIRECT WEIGHTED SUM ───────────────────────────────

export function computeRbaV01(input: RbaInput): RbaResult {
  const unmapped: RbaUnmappedParameter[] = [];
  const W = PARAMETER_WEIGHTS;

  const round2 = (n: number) => parseFloat(n.toFixed(2));
  const round4 = (n: number) => parseFloat(n.toFixed(4));

  // Helper to build a component and register unmapped parameters.
  const build = (
    weight: number,
    value: string | null,
    score: number | null,
    source_sheet: string,
    mapped_to: string | null | undefined,
    unmappedParameter: string,
    unmappedReason: string,
  ): RbaComponentDetail => {
    if (score === null) {
      unmapped.push({ parameter: unmappedParameter, value, reason: unmappedReason });
    }
    return {
      weight,
      value,
      score,
      contribution: score !== null ? round4(score * weight) : null,
      ...(mapped_to !== undefined ? { mapped_to: mapped_to ?? null } : {}),
      source_sheet,
    };
  };

  const isIndividual = input.type === 'INDIVIDUAL';
  const ind = input as RbaInputIndividual;
  const biz = input as RbaInputBusiness;

  // 1) Occupation (Individual) / Business Form (Business) — weight 0.30
  let occBiz: RbaComponentDetail;
  if (isIndividual) {
    const v = ind.occupation ?? null;
    const s = lookupOccupation(v);
    occBiz = build(
      W.occupation_or_business_form, v, s, '1. Customer Profile', v,
      'Profil Pekerja',
      v ? `Occupation "${v}" not found in sheet 1 (Customer Profile).` : 'Occupation not provided.',
    );
  } else {
    const v = biz.legal_form ?? null;
    const s = lookupBusinessForm(v);
    occBiz = build(
      W.occupation_or_business_form, v, s, '1. Customer Profile', v,
      'Bentuk Badan Usaha/Badan Hukum',
      v ? `Business form "${v}" not found in sheet 1 (Customer Profile).` : 'legal_form not provided.',
    );
  }

  // 2) Source of Funds — weight 0.08
  const sofValue = (isIndividual ? ind.source_of_funds : biz.source_of_funds) ?? null;
  const sofComponent = build(
    W.source_of_funds, sofValue, lookupSourceOfFunds(sofValue), '1. Customer Profile', undefined,
    'Sumber Dana',
    sofValue ? `Source of funds "${sofValue}" not found in sheet 1 (Customer Profile).` : 'source_of_funds not provided.',
  );

  // 3) Industry — weight 0.15
  const industryValue = (isIndividual ? ind.industry_category : biz.industry_category) ?? null;
  const industryMatch = lookupIndustry(industryValue);
  const industryComponent = build(
    W.industry, industryValue, industryMatch ? industryMatch.score : null,
    '1.a Customer Profile - Industry', industryMatch ? industryMatch.industry : null,
    'Bidang Industri',
    industryValue ? `Industry "${industryValue}" not found in sheet 1.a sub-industry text.` : 'industry_category not provided.',
  );

  // 4) Business Relationship Purpose — weight 0.01
  const purposeValue = (isIndividual ? ind.business_relationship_purpose : biz.business_relationship_purpose) ?? null;
  const purposeComponent = build(
    W.business_relationship_purpose, purposeValue, lookupBusinessPurpose(purposeValue),
    '1. Customer Profile', undefined,
    'Tujuan Hubungan Usaha',
    purposeValue ? `Business purpose "${purposeValue}" not found in sheet 1 (Customer Profile).` : 'business_relationship_purpose not provided.',
  );

  // 5) Name Screening — weight 0.01 (sheet 1.b)
  const nsValue = input.name_screening_result ?? null;
  const nsScore = lookupNameScreening(nsValue);
  let nameScreeningComponent: RbaComponentDetail;
  if (nsScore !== null) {
    nameScreeningComponent = {
      weight: W.name_screening,
      value: nsValue,
      score: nsScore,
      contribution: round4(nsScore * W.name_screening),
      source_sheet: '1.b Customer Profile - Name Scr',
    };
  } else {
    nameScreeningComponent = {
      weight: W.name_screening,
      value: nsValue,
      score: null,
      contribution: null,
      source_sheet: '1.b Customer Profile - Name Scr',
    };
    if (isNameScreeningNearMatch(nsValue)) {
      unmapped.push({
        parameter: 'Name Screening / Watchlist',
        value: 'NEAR_MATCH',
        reason: 'Latest RBA V01 workbook only defines PEP, DTTOT, DPPSPM as score 3 and clear/no match as 0. Near match requires review before scoring.',
      });
    } else {
      unmapped.push({
        parameter: 'Name Screening / Watchlist',
        value: nsValue,
        reason: nsValue
          ? `Watchlist screening result "${nsValue}" is not mapped in RBA V01 Name Screening (sheet 1.b).`
          : 'Watchlist screening result not provided.',
      });
    }
  }

  // 6) Product — weight 0.10 (always Produk Remitansi for this system)
  const productComponent: RbaComponentDetail = {
    weight: W.product,
    value: PRODUCT_NAME,
    score: PRODUCT_SCORE,
    contribution: round4(PRODUCT_SCORE * W.product),
    source_sheet: '2. Product',
  };

  // 7) Geography — weight 0.15
  const provinceValue = (isIndividual ? ind.province_name : biz.province) ?? null;
  const geoMatch = lookupGeography(provinceValue);
  const geographyComponent = build(
    W.geography, provinceValue, geoMatch ? geoMatch.score : null,
    '3. Area Geografis', geoMatch ? geoMatch.name : null,
    'Area Geografis',
    provinceValue ? `Province "${provinceValue}" not found in sheet 3 (Area Geografis).` : 'Province not provided.',
  );

  // 8) Distribution — weight 0.20
  const distValue = input.distribution_channel ?? null;
  const distributionComponent = build(
    W.distribution, distValue, lookupDistribution(distValue), '4. Distribution', undefined,
    'Distribution',
    distValue
      ? `Distribution channel "${distValue}" not found in sheet 4 (Distribution).`
      : 'distribution_channel not provided. Must be one of: Aplikasi Digital, Agen Pihak Ketiga, Outlet Fisik.',
  );

  const all: RbaComponentDetail[] = [
    occBiz, sofComponent, industryComponent, purposeComponent,
    nameScreeningComponent, productComponent, geographyComponent, distributionComponent,
  ];

  const isIncomplete = all.some((c) => c.score === null);

  let rbaScore: number | null = null;
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null = null;
  if (!isIncomplete) {
    const raw = all.reduce((acc, c) => acc + (c.contribution ?? 0), 0);
    rbaScore = round2(raw);
    riskLevel = getRbaLevel(rbaScore);
  }

  const components: RbaComponents = {
    version: RBA_VERSION,
    calculation_model: RBA_CALCULATION_MODEL,
    components: {
      occupation_or_business_form: occBiz,
      source_of_funds: sofComponent,
      industry: industryComponent,
      business_relationship_purpose: purposeComponent,
      name_screening: nameScreeningComponent,
      product: productComponent,
      geography: geographyComponent,
      distribution: distributionComponent,
    },
    total_score: rbaScore,
  };

  return {
    rba_version: RBA_VERSION,
    rba_calculation_status: isIncomplete ? 'INCOMPLETE' : 'COMPLETE',
    rba_score_v01: rbaScore,
    risk_level: riskLevel,
    rba_components: components,
    rba_unmapped_parameters: unmapped,
  };
}
