import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';

export const INDUSTRY_CATEGORIES = [
  'Periklanan',
  'Pertanian',
  'Otomotif',
  'Barang Bayi, Anak-anak dan Ibu',
  'Layanan/Perawatan Kecantikan',
  'Peralatan, Perkakas Rumah dan Furnitur',
  'Hotel & Resort (Hospitality)',
  'Kontraktor (IT)',
  'Mesin',
  'Marketplace',
  'Layanan Medis',
  'OTA/Agen Travel',
  'Suplai Hewan Peliharaan',
  'Percetakan',
  'Developer Perumahan/Properti',
  'Pulsa / PPOB',
  'Bahan Baku',
  'Real Estate',
  'Jasa dan Layanan Pengiriman',
  'Buku dan Majalah',
  'Layanan Streaming dan Kabel',
  'Badan Amal dan Donasi',
  'Sekolah dan Perguruan Tinggi',
  'Konsultan',
  'Konten Digital',
  'Toko Obat dan Farmasi',
  'Layanan Pendidikan',
  'Elektronik',
  'Acara',
  'Busana',
  'Layanan Finansial - Bank (Konvensional & Digital)',
  'Layanan Finansial - Crowdfunding',
  'Layanan Finansial - Asuransi',
  'Layanan Finansial - Investasi',
  'Layanan Finansial - koperasi',
  'Layanan Finansial - Pinjaman / Lending',
  'Layanan Finansial - Penukaran Uang',
  'Layanan Finansial - Multifinance',
  'Layanan Finansial - Payment Gateway / PJP 1-2',
  'Layanan Finansial - Pengiriman Uang/Remitante PJP 3',
  'Bunga / Florist',
  'Makanan dan Minuman',
  'Permainan (game)',
  'Pemerintah',
  'Bahan Sembako',
  'Hobi, Mainan dan Kerajinan',
];

export const MONTHLY_INCOME_RANGES = [
  'Kurang dari Rp5 juta per bulan',
  'Rata-rata Rp5 juta sampai Rp10 juta per bulan',
  'Rata-rata lebih dari Rp10 juta sampai Rp20 juta per bulan',
  'Rata-rata lebih dari Rp20 juta sampai Rp50 juta per bulan',
  'Rata-rata lebih dari Rp50 juta sampai Rp100 juta per bulan',
  'Rata-rata di atas Rp100 juta per bulan',
];

// Dokumen wajib Business (KYB) — form terbaru. code = doc_type yang dipakai
// saat upload dokumen, name = label yang ditampilkan di FE.
export const BUSINESS_DOCUMENT_TYPES = [
  { code: 'BUSINESS_DEED_ESTABLISHMENT_AMENDMENT', name: 'Akta Pendirian & Perubahan' },
  { code: 'BUSINESS_LICENSE', name: 'NIB / Izin Usaha' },
  { code: 'BUSINESS_NPWP', name: 'NPWP Badan Usaha' },
  { code: 'BUSINESS_MANAGEMENT_IDENTITY', name: 'Dokumen Identitas Pengurus' },
  { code: 'BUSINESS_SHAREHOLDER_IDENTITY_25', name: 'Dokumen Identitas Pemegang Saham ≥25%' },
  { code: 'BUSINESS_BO_DOCUMENT', name: 'Dokumen BO' },
];

export const OCCUPATIONS = [
  'Karyawan Swasta',
  'Pejabat Negara',
  'Wirausaha/Wiraswasta',
  'TNI/POLRI',
  'Pegawai BUMN/BUMD',
  'Profesional',
  'Pegawai Negeri Sipil (PNS)',
  'Pensiunan',
  'Pengurus atau Pegawai LSM atau Organisasi Tidak Berbadan Hukum Lainnya',
  'Ibu Rumah Tangga',
  'Pelajar/Mahasiswa',
  'Sopir',
  'Asisten Rumah Tangga',
  'Atlet/Olahragawan',
  'Buruh',
  'Pengajar',
  'Pemuka Agama',
  'Tenaga Keamanan',
];

const NATIONALITIES = [
  { code: 'ID', name: 'Indonesia' },
  { code: 'SG', name: 'Singapura' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'US', name: 'Amerika Serikat' },
  { code: 'GB', name: 'Inggris' },
  { code: 'AU', name: 'Australia' },
  { code: 'JP', name: 'Jepang' },
  { code: 'CN', name: 'Tiongkok' },
  { code: 'KR', name: 'Korea Selatan' },
  { code: 'IN', name: 'India' },
  { code: 'SA', name: 'Arab Saudi' },
  { code: 'AE', name: 'Uni Emirat Arab' },
  { code: 'NL', name: 'Belanda' },
  { code: 'DE', name: 'Jerman' },
  { code: 'FR', name: 'Prancis' },
  { code: 'IT', name: 'Italia' },
  { code: 'CA', name: 'Kanada' },
  { code: 'NZ', name: 'Selandia Baru' },
  { code: 'PH', name: 'Filipina' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'TH', name: 'Thailand' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'ZZ', name: 'Lainnya' },
];

@Injectable()
export class ReferencesService {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async getProvinces(q?: string) {
    const params: any[] = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE lower(name) LIKE lower($1)`;
    }
    const { rows } = await this.pool.query(
      `SELECT code, name FROM ref_provinces ${where} ORDER BY name LIMIT 50`,
      params,
    );
    return { data: rows };
  }

  async getRegencies(province_code?: string, q?: string) {
    const params: any[] = [];
    const conditions: string[] = [];
    if (province_code) {
      params.push(province_code);
      conditions.push(`province_code = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`lower(name) LIKE lower($${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT code, province_code, name, type FROM ref_regencies ${where} ORDER BY name LIMIT 50`,
      params,
    );
    return { data: rows };
  }

  async getDistricts(regency_code?: string, q?: string) {
    const params: any[] = [];
    const conditions: string[] = [];
    if (regency_code) {
      params.push(regency_code);
      conditions.push(`regency_code = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`lower(name) LIKE lower($${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT code, regency_code, name FROM ref_districts ${where} ORDER BY name LIMIT 50`,
      params,
    );
    return { data: rows };
  }

  async getVillages(district_code?: string, q?: string) {
    const params: any[] = [];
    const conditions: string[] = [];
    if (district_code) {
      params.push(district_code);
      conditions.push(`district_code = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`lower(name) LIKE lower($${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT code, district_code, name, type FROM ref_villages ${where} ORDER BY name LIMIT 50`,
      params,
    );
    return { data: rows };
  }

  getNationalities(q?: string) {
    const data = q
      ? NATIONALITIES.filter((n) => n.name.toLowerCase().includes(q.toLowerCase()) || n.code.toLowerCase().includes(q.toLowerCase()))
      : NATIONALITIES;
    return { data };
  }

  getIndustryCategories() {
    return { data: INDUSTRY_CATEGORIES.map((v) => ({ code: v, name: v })) };
  }

  getMonthlyIncomeRanges() {
    return { data: MONTHLY_INCOME_RANGES.map((v) => ({ code: v, name: v })) };
  }

  getOccupations() {
    return { data: OCCUPATIONS.map((v) => ({ code: v, name: v })) };
  }

  getBusinessDocumentTypes() {
    return { data: BUSINESS_DOCUMENT_TYPES };
  }
}
