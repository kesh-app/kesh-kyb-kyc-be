import {
  REFERENCE_NO_MAX_LENGTH,
  buildReferenceNo,
  generateUniqueReferenceNo,
} from '../../src/common/reference-no.util';

/**
 * Unit murni — tidak menyentuh DB atau HTTP. Menutup bagian yang sulit dilihat
 * lewat e2e: bentuk & panjang referensi, dan perilaku retry saat bentrok.
 */
describe('reference-no.util', () => {
  it('RN-01: bentuknya <PREFIX>-XXXXXXXX dan tepat 12 karakter', () => {
    for (const prefix of ['CMP', 'TRF']) {
      const ref = buildReferenceNo(prefix);
      expect(ref).toHaveLength(REFERENCE_NO_MAX_LENGTH);
      expect(ref).toMatch(new RegExp(`^${prefix}-[A-HJ-NP-Z2-9]{8}$`));
    }
  });

  it('RN-02: tidak pernah memakai I, O, 0, atau 1 (mudah tertukar saat dibaca)', () => {
    const suffixes = Array.from({ length: 500 }, () => buildReferenceNo('TRF').slice(4)).join('');
    expect(suffixes).not.toMatch(/[IO01]/);
  });

  it('RN-03: praktis tidak menghasilkan duplikat pada volume wajar', () => {
    const seen = new Set(Array.from({ length: 5_000 }, () => buildReferenceNo('CMP')));
    expect(seen.size).toBe(5_000);
  });

  it('RN-04: mencoba lagi saat kandidat sudah terpakai, lalu mengembalikan yang bebas', async () => {
    let calls = 0;
    // Dua kandidat pertama dianggap bentrok, ketiga bebas.
    const exists = async () => {
      calls += 1;
      return calls <= 2;
    };

    const ref = await generateUniqueReferenceNo('CMP', exists);

    expect(calls).toBe(3);
    expect(ref).toMatch(/^CMP-[A-HJ-NP-Z2-9]{8}$/);
  });

  it('RN-05: mengembalikan null bila semua percobaan bentrok — pemanggil yang melempar error', async () => {
    let calls = 0;
    const alwaysTaken = async () => {
      calls += 1;
      return true;
    };

    const ref = await generateUniqueReferenceNo('TRF', alwaysTaken, 4);

    expect(ref).toBeNull();
    // Berhenti tepat di batas percobaan, tidak berputar tanpa akhir.
    expect(calls).toBe(4);
  });
});
