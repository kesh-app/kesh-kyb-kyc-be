-- 0069_qlola_smbc_ambiguous.sql
--
-- QA pemetaan BIC sebelum upload live pertama ke BRI Qlola.
--
-- Katalog KESH punya entri 'SMBC' ("Bank SMBC Indonesia") yang sebelumnya
-- dipetakan ke BIC SUNIIDJA. Pemetaan itu dicabut karena AMBIGU: sheet
-- "Bank Code" BRI memuat DUA entitas grup SMBC —
--
--   kode 45  SUNIIDJ1  PT. BANK SUMITOMO MITSUI INDONESIA
--   kode 213 SUNIIDJA  PT Bank SMBC Indonesia Tbk
--
-- — dan kode 213 adalah kode bank BTPN yang berganti nama. Katalog KESH
-- memuat 'BTPN' dan 'SMBC' sebagai dua entri terpisah, sehingga tidak bisa
-- dipastikan dari nama saja apakah 'SMBC' berarti entitas eks-BTPN (213) atau
-- Bank Sumitomo Mitsui Indonesia (45).
--
-- BIC yang salah = dana diarahkan ke bank yang keliru dan tidak bisa ditarik
-- kembali; export yang terblokir hanya perlu satu konfirmasi. Jadi entri ini
-- dibiarkan UNMAPPED sampai product/BRI memastikannya — export akan menolak
-- transfer ke bank ini dengan pesan yang jelas, bukan menebak.
--
-- Setelah dikonfirmasi, aktifkan kembali dengan satu baris:
--   UPDATE ref_banks SET kesh_bank_code='SMBC' WHERE bic_code='<BIC yang benar>';

UPDATE ref_banks
   SET kesh_bank_code = NULL
 WHERE kesh_bank_code = 'SMBC';
