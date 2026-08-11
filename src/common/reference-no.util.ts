import { randomInt } from 'crypto';

/**
 * Nomor referensi pendek untuk dokumen yang dipegang nasabah (resi 80mm, SMS,
 * dibacakan lewat telepon). Format: <PREFIX>-XXXXXXXX, tepat 12 karakter.
 *
 * Referensi lama yang panjang (KESH-TRF-YYYYMMDD-<16 hex>, KESH-CMP-...) TIDAK
 * disentuh: kolomnya tetap varchar(64)/varchar(50) dan semua pencarian memakai
 * kecocokan persis pada nilai tersimpan, jadi format lama dan baru sama-sama
 * bisa dicari. Yang dibatasi hanya panjang saat generate baris baru.
 */
export const REFERENCE_NO_MAX_LENGTH = 12;

/** 8 karakter acak + tanda hubung + prefix 3 huruf = 12. */
const RANDOM_LENGTH = 8;

/**
 * Huruf besar dan angka. I, O, 0, dan 1 sengaja dibuang: nomor ini dibacakan
 * lewat telepon dan disalin dari kertas termal, di mana pasangan itu paling
 * sering tertukar. Sisa 32 simbol → 32^8 ≈ 1,1e12 kemungkinan, dan pembagi
 * 256/32 bulat sehingga randomInt tidak bias.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Bangun satu kandidat referensi. Keunikan TIDAK dijamin di sini — pemanggil
 * wajib mengecek ke DB dan mencoba lagi (lihat generateUniqueReferenceNo).
 */
export function buildReferenceNo(prefix: string): string {
  let out = '';
  for (let i = 0; i < RANDOM_LENGTH; i++) {
    // randomInt = CSPRNG dan bebas modulo-bias, beda dari Math.random().
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${prefix}-${out}`;
}

/**
 * Bangun referensi unik: coba kandidat baru sampai `exists` bilang belum
 * terpakai. Tabrakan pada 32^8 sangat jarang, jadi beberapa percobaan sudah
 * lebih dari cukup. Mengembalikan null bila semua percobaan bentrok — pemanggil
 * yang memutuskan error apa yang dilempar, karena pesannya beda per domain.
 */
export async function generateUniqueReferenceNo(
  prefix: string,
  exists: (candidate: string) => Promise<boolean>,
  attempts = 5,
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const candidate = buildReferenceNo(prefix);
    if (!(await exists(candidate))) return candidate;
  }
  return null;
}
