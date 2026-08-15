import * as XLSX from "xlsx";

/**
 * Export batch bulk transfer ke format BRI Qlola Mass Transfer.
 *
 * Struktur sheet "Transaction Records" direproduksi persis dari workbook BRI
 * `13-08-2026_Mass Transfer.xlsx`:
 *
 *   baris 1-6  legenda kategori mandatory (label di kolom B)
 *   baris 7    kosong
 *   baris 8    header 36 kolom (A:AJ)
 *   baris 9+   data
 *   lalu       "Total Records" dan "Total Amount" (label kolom A, nilai kolom C)
 *
 * Profil yang didukung: BI-Fast (InstructionCode "BIF"). Field kategori
 * RTGS/LLG/SWIFT sengaja dibiarkan kosong.
 */

/** Nama sheet — harus persis, Qlola mencocokkan berdasarkan nama. */
export const QLOLA_SHEET_NAME = "Transaction Records";

/** Header kolom A:AJ, urutan asli workbook. Jangan diurut ulang/diganti nama. */
export const QLOLA_COLUMNS = [
  "No",
  "CustRefNo",
  "InstructionCode",
  "ValueDate",
  "Debit Account",
  "Sender Name",
  "BenBankIdentifier",
  "Credit Account",
  "Beneficiary Name",
  "Beneficiary Address",
  "Amount",
  "Currency",
  "TrxRemark",
  "Notification",
  "Charge Type",
  "FxCode",
  "Rate Voucher Code",
  "Sender Address",
  "Ben Mobile Number",
  "Sender Country Code",
  "Beneficiary Country Code",
  "BenBankName",
  "BenBankAddress",
  "BenBankCountryCode",
  "InterBankIdentifier",
  "InterBankName",
  "InterBankAddress",
  "InterBankCountryCode",
  "Beneficiary Category",
  "Beneficiary Relation",
  "BI Transaction Code",
  "Simodis Info",
  "Enrichment Details 1",
  "Enrichment Details 2",
  "Enrichment Details 3",
  "Enrichment Details 4",
] as const;

/** Legenda baris 1-6, label ada di kolom B (kolom A hanya kotak warna). */
const QLOLA_LEGEND = [
  "Mandatory For All Transaction",
  "Mandatory Field for BRI to BRI Valas",
  "Mandatory Field for Kliring & RTGS & SWIFT",
  "Mandatory Field for BI-Fast",
  "Mandatory Field for SWIFT",
  "Optional",
];

const HEADER_ROW_INDEX = 7; // baris 8 (0-indexed)
const DATA_START_INDEX = 8; // baris 9 (0-indexed)

/** Nilai tetap untuk profil BI-Fast Qlola. */
export const QLOLA_INSTRUCTION_CODE = "BIF";
export const QLOLA_CHARGE_TYPE = "OUR";
export const QLOLA_CURRENCY = "IDR";

/** Batas panjang dari sheet "Deskripsi File" workbook BRI. */
const MAX = {
  debitAccount: 30,
  minDebitAccount: 10,
  senderName: 60,
  creditAccount: 34,
  beneficiaryName: 60,
  amount: 15,
};

/** Satu transfer anak yang sudah lolos filter kelayakan. */
export type QlolaSourceRow = {
  id: number | string;
  partner_reference_no: string | null;
  amount: string | number | null;
  currency: string | null;
  beneficiary_account_number: string | null;
  beneficiary_account_name: string | null;
  beneficiary_address: string | null;
  beneficiary_mobile_number: string | null;
  beneficiary_bank_code: string | null;
  beneficiary_bank_name: string | null;
  transaction_purpose: string | null;
  description: string | null;
  requested_execution_date: Date | string | null;
  /** BIC hasil join ref_banks — null kalau bank tujuan tidak punya pemetaan. */
  bic_code: string | null;
};

export type QlolaBatchConfig = {
  batch_no: string;
  qlola_debit_account: string | null;
  qlola_sender_name: string | null;
};

export type QlolaRowError = {
  reference: string;
  /** Bank tujuan — ikut dilaporkan karena BIC-lah penyebab tersering. */
  bank: string | null;
  missing: string[];
};

/**
 * ValueDate: YYYYMMDDhhmm dalam waktu lokal server.
 *
 * Sumber satu-satunya adalah `requested_execution_date` (jadwal eksekusi yang
 * diminta user / metadata SNAP). `transaction_date` TIDAK dipakai — itu stempel
 * waktu persetujuan internal KESH, bukan jadwal eksekusi.
 *
 * Kosong itu sah: sheet "Deskripsi File" menandai field ini M/O — "(Mandatory)
 * Transaction Running with Schedule Time, (Optional) If Immediate Transaction".
 * Baris contoh IFT di workbook juga mengosongkannya. Jadi transfer tanpa jadwal
 * = transaksi immediate, dan kolomnya dibiarkan kosong — bukan dikarang.
 */
export function formatValueDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}`
  );
}

/**
 * TrxRemark = "Payment Description" menurut workbook. Sumber utama adalah
 * `transaction_purpose` (tujuan transaksi yang diisi operator); `description`
 * dipakai hanya kalau tujuan kosong. Catatan compliance/review internal TIDAK
 * pernah ikut — itu bukan keterangan pembayaran dan tidak boleh sampai ke bank.
 */
function resolveTrxRemark(row: QlolaSourceRow): string {
  return (row.transaction_purpose ?? row.description ?? "").trim();
}

/** Pesan baku saat bank tujuan tidak punya BIC di referensi ref_banks. */
export const MISSING_BIC_MESSAGE =
  "BenBankIdentifier tidak tersedia pada referensi BRI Qlola";

/**
 * Validasi field wajib untuk satu baris. `No` tidak divalidasi karena dibuat
 * saat export. Return daftar keterangan field yang menghalangi export.
 *
 * Cakupan = 12 field pilihan product ("Mandatory For All Transaction" +
 * "Mandatory Field for BI-Fast") DITAMBAH BenBankIdentifier. BenBankIdentifier
 * ikut wajib karena sheet "Deskripsi File" baris 18 menyebut BIF sebagai
 * pemakai BIC ("use BIC CODE (RTG, LLG, BIF)") sementara satu-satunya
 * pengecualian yang tertulis adalah "Optional if Field Charge Type Transaction
 * filled by IFT" — BIF tidak pernah disebut boleh kosong. Baris contoh BIF di
 * workbook juga mengisinya (BMRIIDJA). Karena itu kolom G tidak boleh kosong:
 * lebih baik export ditolak daripada BRI menerima file yang tidak sah.
 */
export function validateQlolaRow(
  row: QlolaSourceRow,
  batch: QlolaBatchConfig,
): string[] {
  const missing: string[] = [];

  if (!row.partner_reference_no) missing.push("CustRefNo belum tersedia");

  // InstructionCode & Charge Type konstan, jadi tidak mungkin kosong.

  const debit = (batch.qlola_debit_account ?? "").trim();
  if (!debit) missing.push("Debit Account (Rekening Debit BRI) belum diisi pada batch");
  else if (debit.length < MAX.minDebitAccount || debit.length > MAX.debitAccount) {
    missing.push(
      `Debit Account harus ${MAX.minDebitAccount}-${MAX.debitAccount} karakter`,
    );
  }

  const sender = (batch.qlola_sender_name ?? "").trim();
  if (!sender) missing.push("Sender Name (Nama Pengirim) belum diisi pada batch");
  else if (sender.length > MAX.senderName) {
    missing.push(`Sender Name maksimal ${MAX.senderName} karakter`);
  }

  // Bank tujuan tanpa BIC: jangan diekspor dengan kolom G kosong.
  if (!(row.bic_code ?? "").trim()) missing.push(MISSING_BIC_MESSAGE);

  const credit = (row.beneficiary_account_number ?? "").trim();
  if (!credit) missing.push("Credit Account (nomor rekening penerima) belum diisi");
  else if (credit.length > MAX.creditAccount) {
    missing.push(`Credit Account maksimal ${MAX.creditAccount} karakter`);
  }

  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) missing.push("Amount tidak valid");

  // BI-Fast hanya IDR. Baris mata uang lain ditolak — jangan dikonversi diam-diam.
  const currency = (row.currency ?? "").trim().toUpperCase();
  if (!currency) missing.push("Currency belum diisi");
  else if (currency !== QLOLA_CURRENCY) {
    missing.push(
      `Currency ${currency} tidak didukung BI-Fast (hanya ${QLOLA_CURRENCY})`,
    );
  }

  if (!resolveTrxRemark(row)) missing.push("TrxRemark (tujuan transaksi) belum diisi");

  if (!(row.beneficiary_mobile_number ?? "").trim()) {
    missing.push("Ben Mobile Number (No. Handphone Penerima) belum diisi");
  }

  return missing;
}

/** Satu baris data, urutan sesuai QLOLA_COLUMNS. */
function buildDataRow(
  row: QlolaSourceRow,
  batch: QlolaBatchConfig,
  no: number,
): (string | number)[] {
  const cells: (string | number)[] = new Array(QLOLA_COLUMNS.length).fill("");
  cells[0] = no; // No — nomor urut export, bukan id internal
  cells[1] = row.partner_reference_no ?? ""; // CustRefNo — referensi user-facing
  cells[2] = QLOLA_INSTRUCTION_CODE;
  cells[3] = formatValueDate(row.requested_execution_date);
  cells[4] = (batch.qlola_debit_account ?? "").trim();
  cells[5] = (batch.qlola_sender_name ?? "").trim();
  // BenBankIdentifier: hanya dari ref_banks. Bank tanpa pemetaan → kosong.
  cells[6] = row.bic_code ?? "";
  cells[7] = (row.beneficiary_account_number ?? "").trim();
  cells[8] = (row.beneficiary_account_name ?? "").trim();
  cells[9] = (row.beneficiary_address ?? "").trim();
  cells[10] = Number(row.amount);
  cells[11] = QLOLA_CURRENCY;
  cells[12] = resolveTrxRemark(row);
  cells[14] = QLOLA_CHARGE_TYPE;
  cells[18] = (row.beneficiary_mobile_number ?? "").trim();
  return cells;
}

/**
 * Rakit workbook Qlola. Pemanggil wajib memvalidasi baris lebih dulu
 * (validateQlolaRow) — fungsi ini tidak boleh menghasilkan file setengah valid.
 */
export function buildQlolaWorkbook(
  rows: QlolaSourceRow[],
  batch: QlolaBatchConfig,
): Buffer {
  const aoa: any[][] = [];

  QLOLA_LEGEND.forEach((label, i) => {
    aoa[i] = ["", label];
  });
  aoa[6] = []; // baris 7 kosong
  aoa[HEADER_ROW_INDEX] = [...QLOLA_COLUMNS];

  rows.forEach((row, i) => {
    aoa[DATA_START_INDEX + i] = buildDataRow(row, batch, i + 1);
  });

  // Footer rekap, sama seperti workbook asli: label di kolom A, nilai di kolom C.
  const totalIndex = DATA_START_INDEX + rows.length;
  const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  aoa[totalIndex] = ["Total Records", "", rows.length];
  aoa[totalIndex + 1] = ["Total Amount", "", totalAmount];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, QLOLA_SHEET_NAME);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/**
 * Dua tujuan export, dua populasi baris yang TIDAK boleh dicampur dalam satu
 * file (lihat exportBriQlola):
 *   FINAL  — transaksi yang sudah disetujui final, siap dieksekusi di Qlola
 *   REVIEW — transaksi yang menunggu review Finance Staff; dipakai untuk
 *            mengecek data rekening/bank penerima SEBELUM approval
 */
export const QLOLA_PURPOSES = ["FINAL", "REVIEW"] as const;
export type QlolaPurpose = (typeof QLOLA_PURPOSES)[number];

/**
 * BRI_QLOLA_BIF_<batch_no>_<YYYYMMDDHHmm>.xlsx untuk FINAL,
 * BRI_QLOLA_REVIEW_<batch_no>_<YYYYMMDDHHmm>.xlsx untuk REVIEW.
 *
 * Penanda tujuan sengaja ada di nama file: file review TIDAK boleh sampai
 * terunggah ke Qlola sebagai instruksi bayar, jadi harus bisa dibedakan
 * sebelum dibuka. Timestamp = waktu unduh.
 */
export function buildQlolaFileName(
  batchNo: string,
  purpose: QlolaPurpose = "FINAL",
  now = new Date(),
): string {
  const safeBatch = String(batchNo ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  const tag = purpose === "REVIEW" ? "REVIEW" : "BIF";
  return `BRI_QLOLA_${tag}_${safeBatch}_${formatValueDate(now)}.xlsx`;
}
