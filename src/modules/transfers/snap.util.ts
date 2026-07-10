/**
 * SNAP mapping helpers for Transfer Recording v2.
 *
 * PURE functions only — NO external API calls. Tujuannya hanya memetakan data
 * transfer internal ke bentuk yang mudah dipakai untuk SNAP BI/ASPI request
 * (Transfer Credit / Transfer to Bank) saat integрasi nanti.
 */

import { randomBytes } from 'crypto';

/**
 * Format angka amount menjadi string 2 desimal (SNAP amount.value),
 * mis. 1000000 -> "1000000.00".
 */
export function formatAmountValue(amount: unknown): string {
  const n = typeof amount === 'string' ? Number(amount) : (amount as number);
  if (n === undefined || n === null || Number.isNaN(Number(n))) return '0.00';
  return Number(n).toFixed(2);
}

/**
 * Normalisasi currency menjadi 3 huruf kapital, default IDR.
 */
export function normalizeCurrency(currency?: string | null): string {
  const c = (currency ?? '').trim().toUpperCase();
  return c.length === 3 ? c : 'IDR';
}

/**
 * Generate partner_reference_no internal yang aman & unik.
 * Format: KESH-TRF-YYYYMMDD-<16 hex char> (total <= 64 char).
 * Tidak ada PII; entropy 64-bit cukup untuk menghindari tabrakan.
 * Tetap divalidasi unik di DB lewat unique index + retry.
 */
export function generatePartnerReferenceNo(now: Date = new Date()): string {
  const yyyy = now.getFullYear().toString().padStart(4, '0');
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const dd = now.getDate().toString().padStart(2, '0');
  const rand = randomBytes(8).toString('hex').toUpperCase(); // 16 hex chars
  return `KESH-TRF-${yyyy}${mm}${dd}-${rand}`;
}

/**
 * buildSnapTransferPayload — map a stored transfer row ke bentuk SNAP-style
 * transfer request. Hanya membaca data tersimpan, tidak memanggil API apapun.
 */
export function buildSnapTransferPayload(t: any): Record<string, any> {
  const amountValue =
    t?.amount_value && String(t.amount_value).length > 0
      ? String(t.amount_value)
      : formatAmountValue(t?.amount);
  const amountCurrency = normalizeCurrency(t?.amount_currency ?? t?.currency);

  return {
    partnerReferenceNo: t?.partner_reference_no ?? null,
    amount: {
      value: amountValue,
      currency: amountCurrency,
    },
    beneficiaryAccountName: t?.beneficiary_account_name ?? null,
    beneficiaryAccountNo: t?.beneficiary_account_number ?? null,
    beneficiaryBankCode: t?.beneficiary_bank_code ?? null,
    beneficiaryBankName: t?.beneficiary_bank_name ?? null,
    beneficiaryAddress: t?.beneficiary_address ?? null,
    beneficiaryEmail: t?.beneficiary_email ?? null,
    beneficiaryCustomerResidence: t?.beneficiary_customer_residence ?? null,
    beneficiaryCustomerType: t?.beneficiary_customer_type ?? null,
    sourceAccountNo: t?.source_account_no ?? null,
    transactionDate: t?.transaction_date ?? null,
    remark: t?.description ?? null,
    additionalInfo: {
      ...(t?.additional_info ?? {}),
      ...(t?.source_of_funds     ? { sourceOfFunds:       t.source_of_funds }     : {}),
      ...(t?.transaction_purpose ? { transactionPurpose: t.transaction_purpose } : {}),
    },
  };
}
