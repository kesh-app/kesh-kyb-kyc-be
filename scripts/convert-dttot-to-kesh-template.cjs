#!/usr/bin/env node
/**
 * Konversi file DTTOT (PPATK, sheet "Export") → format Watchlist Upload Template KESH.
 *
 *   node scripts/convert-dttot-to-kesh-template.cjs <sumber.xlsx> [output.xlsx]
 *
 * Default output: <folder sumber>/<nama sumber>_KESH_TEMPLATE.xlsx
 *
 * Header output memakai nama kolom yang benar-benar dibaca parser upload
 * (WatchlistService.mapRow) — bukan tebakan.
 *
 * Semua sel ditulis sebagai TEKS (t:"s") supaya tanggal tidak pernah bergeser
 * lewat konversi serial number Excel.
 */
const path = require("path");
const XLSX = require("xlsx");

// Kolom persis seperti yang dibaca WatchlistService.mapRow().
const HEADERS = [
  "Unique_ID",
  "Watchlist_Type",
  "Subject_Type",
  "Full_Name",
  "Entity_Name",
  "Alias_Name",
  "Date_of_Birth",
  "Raw_Date_of_Birth",
  "Place_of_Birth",
  "Nationality",
  "National_ID_Number",
  "Address",
  "Sanction_Number",
  "Description",
];

/** trim + rapatkan semua whitespace (termasuk newline) jadi satu spasi */
const flat = (v) =>
  (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();

/** daftar berbullet multi-baris → "a; b; c" */
const bullets = (v) =>
  (v == null ? "" : String(v))
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean)
    .join("; ");

/** teks bebas multi-baris: cukup normalkan CRLF */
const multiline = (v) =>
  (v == null ? "" : String(v)).replace(/\r\n?/g, "\n").trim();

// Penanda alias. `alias(?=[A-Z])` menangani kasus tanpa spasi ("aliasJUND ...").
// `;` dipakai sebagai pemisah alias sekunder — pada file DTTOT titik koma tidak
// pernah muncul sebelum penanda alias pertama, jadi aman.
const ALIAS_SPLIT =
  /\s*(?:\balias\b|alias(?=[A-Z])|\baka\b|\ba\.k\.a\.?|\bdikenal sebagai\b|;)\s*/gi;

/**
 * "MIRA ARIANI alias UMM ZAHRA" → { primary: "MIRA ARIANI", aliases: ["UMM ZAHRA"] }
 * Satu subjek = satu baris. Alias duplikat dan alias yang sama dengan nama utama dibuang.
 */
function splitNameAliases(nama) {
  const raw = flat(nama);
  const parts = raw
    .split(ALIAS_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
  const primary = parts.shift() || "";
  // Tidak yakin → kembalikan nama apa adanya, alias dikosongkan (dicatat pemanggil).
  if (!primary || primary.length < 2) return { primary: raw, aliases: [], confident: false };

  const seen = new Set([primary.toUpperCase()]);
  const aliases = [];
  for (const a of parts) {
    const k = a.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    aliases.push(a);
  }
  return { primary, aliases, confident: true };
}

/** "02/05/1982" → "1982-05-02". Selain itu null (jangan menebak tanggal). */
function toIsoDate(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(flat(text));
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = Number(d);
  const mon = Number(mo);
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  const iso = `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // Tolak tanggal yang tidak ada (mis. 31/02) alih-alih membiarkannya bergeser.
  const dt = new Date(`${iso}T00:00:00Z`);
  return dt.getUTCDate() === day && dt.getUTCMonth() + 1 === mon ? iso : null;
}

/** Ambil NIK/nomor identitas dari Deskripsi bila bentuknya memang nomor identitas. */
function extractNationalId(deskripsi) {
  const text = String(deskripsi || "");
  const re =
    /\b(?:NIK|Nomor Induk Kependudukan|nomor identitas)\b(?:\s*nomor)?\s*:?\s*([0-9A-Za-z]{10,20})\b/i;
  const m = re.exec(text);
  if (!m) return null;
  const val = m[1];
  // Nomor akta/SK ("KEP.04/YABA/1/2012") bukan NIK — syaratkan mayoritas digit.
  const digits = (val.match(/\d/g) || []).length;
  return digits >= 8 ? val.toUpperCase() : null;
}

function convert(srcPath, outPath) {
  const wb = XLSX.readFile(srcPath, { raw: false, cellDates: false });
  const sheetName = wb.SheetNames[0];
  const src = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    defval: null,
    raw: false,
  });

  const out = [];
  const unsplit = [];
  const stats = { person: 0, entity: 0, dob: 0, rawDob: 0, nik: 0, alias: 0 };

  src.forEach((r, i) => {
    const nama = flat(r["Nama"]);
    if (!nama) {
      unsplit.push({ row: i + 2, nama: "(kosong)", reason: "Nama kosong" });
      return;
    }

    const { primary, aliases, confident } = splitNameAliases(nama);
    if (!confident)
      unsplit.push({ row: i + 2, nama, reason: "Pemisahan nama/alias tidak meyakinkan" });

    const isEntity = /korporasi|perusahaan|badan/i.test(String(r["Terduga"] || ""));
    const kode = flat(r["Kode Densus"]);
    const dobText = flat(r["Tanggal Lahir"]);
    const iso = toIsoDate(dobText);
    const nik = extractNationalId(r["Deskripsi"]);

    if (isEntity) stats.entity++;
    else stats.person++;
    if (iso) stats.dob++;
    else if (dobText) stats.rawDob++;
    if (nik) stats.nik++;
    if (aliases.length) stats.alias++;

    out.push({
      Unique_ID: kode ? `DTTOT-${kode}` : "",
      Watchlist_Type: "DTTOT",
      Subject_Type: isEntity ? "ENTITY" : "PERSON",
      Full_Name: isEntity ? "" : primary,
      Entity_Name: isEntity ? primary : "",
      Alias_Name: aliases.join("; "),
      Date_of_Birth: iso || "",
      Raw_Date_of_Birth: iso ? "" : dobText,
      Place_of_Birth: bullets(r["Tempat Lahir"]),
      Nationality: bullets(r["WN/Asal Negara"]),
      National_ID_Number: nik || "",
      Address: multiline(r["Alamat"]),
      Sanction_Number: kode,
      Description: multiline(r["Deskripsi"]),
    });
  });

  // Semua sel dipaksa string: Excel tidak boleh menafsirkan "02/05/1982" atau
  // "1982-05-02" sebagai tanggal dan menggesernya lewat serial number.
  const ws = XLSX.utils.json_to_sheet(out, { header: HEADERS });
  for (const ref of Object.keys(ws)) {
    if (ref[0] === "!") continue;
    ws[ref].t = "s";
    ws[ref].v = String(ws[ref].v ?? "");
    delete ws[ref].w;
    delete ws[ref].z;
  }
  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, ws, "Watchlist");
  XLSX.writeFile(outWb, outPath);

  return { sheetName, srcCount: src.length, outCount: out.length, unsplit, stats };
}

if (require.main === module) {
  const srcPath = process.argv[2];
  if (!srcPath) {
    console.error(
      "Usage: node scripts/convert-dttot-to-kesh-template.cjs <sumber.xlsx> [output.xlsx]",
    );
    process.exit(1);
  }
  const outPath =
    process.argv[3] ||
    path.join(
      path.dirname(srcPath),
      `${path.basename(srcPath, path.extname(srcPath))}_KESH_TEMPLATE.xlsx`,
    );

  const res = convert(srcPath, outPath);
  console.log(`Sheet sumber   : ${res.sheetName}`);
  console.log(`Baris sumber   : ${res.srcCount}`);
  console.log(`Baris hasil    : ${res.outCount}`);
  console.log(
    `PERSON/ENTITY  : ${res.stats.person}/${res.stats.entity}  ` +
      `alias: ${res.stats.alias}  DOB: ${res.stats.dob}  Raw DOB: ${res.stats.rawDob}  NIK: ${res.stats.nik}`,
  );
  console.log(`Output         : ${outPath}`);
  if (res.unsplit.length) {
    console.log(`\nBaris yang tidak bisa dipisah dengan yakin (${res.unsplit.length}):`);
    for (const u of res.unsplit) console.log(`  baris ${u.row}: ${u.reason} — ${u.nama}`);
  } else {
    console.log("\nSemua baris berhasil dipisah nama/alias.");
  }
}

module.exports = { convert, splitNameAliases, toIsoDate, extractNationalId };
