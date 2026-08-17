import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Pool } from "pg";
import {
  ComplianceReviewDecisionDto,
  CreateTransferDto,
  DecideTransferDto,
  SetTransferResultDto,
  SubmitComplianceReviewDto,
  UpdateTransferDto,
} from "./dto";
import { resolveUserId } from "../../common/auth.util";
import { generateUniqueReferenceNo } from "../../common/reference-no.util";
import {
  buildSnapTransferPayload,
  formatAmountValue,
  generatePartnerReferenceNo,
  normalizeCurrency,
} from "./snap.util";
import { MonitoringService } from "../monitoring/monitoring.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  QlolaPurpose,
  QlolaRowError,
  QlolaSourceRow,
  buildQlolaFileName,
  buildQlolaWorkbook,
  validateQlolaRow,
} from "./bri-qlola.exporter";
import {
  NEAR_MATCH_THRESHOLD,
  classifyScreeningHit,
  dedupWatchlistCandidates,
  watchlistAliasScoreSql,
  watchlistCandidateWhereSql,
  watchlistNameScoreSql,
} from "../applications/applications.service";

type AuthedUser = { sub?: number | string; id?: number | string; role: string };

const FULL_ACCESS_ROLES = ["SystemAdmin", "Director"];
// Status yang masih boleh diedit & (re)submit oleh FrontDesk. REVISION_REQUIRED
// = dikembalikan FinanceStaff untuk diperbaiki, bukan status final.
const EDITABLE_STATUSES = ["DRAFT", "REVISION_REQUIRED"];
const WIC_TRANSFER_MAX_AMOUNT = 100_000_000;
const WIC_LIMIT_ERROR = "Walk-In Customer (WIC) memiliki limit transaksi maksimal Rp100.000.000.";

// EDD wajib level TRANSAKSI (bukan level customer/KYC) — independen dari
// WIC_TRANSFER_MAX_AMOUNT, HIGH_VALUE_THRESHOLD (monitoring.service.ts, LTKM
// supporting-only), dan CASH_THRESHOLD (LTKT). Amount >= threshold ini
// otomatis menahan transfer di PENDING_COMPLIANCE_REVIEW (red flag
// AMOUNT_EDD_THRESHOLD, lihat submit()) sampai ComplianceLead memutuskan —
// TIDAK mengklasifikasikan LTKM dan TIDAK mengubah application_edd
// permanen milik customer.
const TRANSFER_EDD_AMOUNT_THRESHOLD = 50_000_000;

// Tanggal Transaksi & Tanggal Diminta lahir dari jam PostgreSQL saat transfer
// DISETUJUI (decide() APPROVE oleh FinanceManager) — bukan saat create, submit,
// atau review antara. Tipe kolom menentukan fungsinya: transaction_date
// TIMESTAMPTZ → now(), requested_transfer_at DATE → CURRENT_DATE.
// COALESCE menjaga approval/review berikutnya tidak menimpa tanggal asli.
// Fragment ini dipakai SEMUA jalur approval supaya tidak ada yang terlewat —
// approval path baru wajib menyisipkannya.
const APPROVAL_DATE_STAMP_SQL = `
          transaction_date      = COALESCE(transaction_date, now()),
          requested_transfer_at = COALESCE(requested_transfer_at, CURRENT_DATE),`;

@Injectable()
export class TransfersService {
  constructor(
    @Inject("PG_POOL") private readonly pool: Pool,
    private readonly monitoring: MonitoringService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Link + object identity shared by every notification this service fires. */
  private notifyTransferRole(id: number | string, role: string, title: string, body?: string) {
    return this.notifications.notifyRole(role, "ACTION_REQUIRED", {
      objectType: "transfer",
      objectId: id,
      title,
      body,
      link: `/transfers/${id}`,
    });
  }

  private notifyTransferUser(
    userId: number | string,
    type: "ACTION_REQUIRED" | "INFO",
    id: number | string,
    title: string,
    body?: string,
  ) {
    return this.notifications.notifyUser(userId, type, {
      objectType: "transfer",
      objectId: id,
      title,
      body,
      link: `/transfers/${id}`,
    });
  }

  private async audit(
    actorId: number | string,
    action: string,
    objectId: string,
    before: any,
    after: any,
    ip?: string,
  ) {
    await this.pool.query(
      `INSERT INTO audit_logs(actor_id, action, object_type, object_id, before_json, after_json, ip)
       VALUES ($1,$2,'TRANSFER',$3,$4,$5,$6)`,
      [actorId, action, objectId, before ?? null, after ?? null, ip ?? null],
    );
  }

  /**
   * Pastikan partner_reference_no unik. Jika user mengirim sendiri → validasi
   * tidak duplikat. Jika kosong → generate server-side dengan retry anti-tabrakan.
   */
  private async resolvePartnerReferenceNo(provided?: string): Promise<string> {
    if (provided && provided.trim().length > 0) {
      const ref = provided.trim();
      if (ref.length > 64) {
        throw new BadRequestException("partner_reference_no max 64 chars");
      }
      const dup = await this.pool.query(
        `SELECT 1 FROM transfers WHERE partner_reference_no = $1 LIMIT 1`,
        [ref],
      );
      if ((dup.rowCount ?? 0) > 0) {
        throw new BadRequestException("partner_reference_no already exists");
      }
      return ref;
    }

    // Generate dengan retry — entropy tinggi, tabrakan sangat jarang.
    for (let i = 0; i < 5; i++) {
      const candidate = generatePartnerReferenceNo();
      const dup = await this.pool.query(
        `SELECT 1 FROM transfers WHERE partner_reference_no = $1 LIMIT 1`,
        [candidate],
      );
      if ((dup.rowCount ?? 0) === 0) return candidate;
    }
    throw new BadRequestException(
      "Failed to generate unique partner_reference_no, please retry",
    );
  }

  /**
   * Hard guard: pengirim (sender_application_id) wajib ada dan berstatus
   * APPROVED. Dipakai saat create, update draft, dan submit agar draft lama
   * dengan pengirim non-APPROVED tidak bisa lolos ke pencatatan transfer.
   */
  private async assertSenderApproved(
    applicationId: number | string | null | undefined,
  ) {
    if (applicationId === null || applicationId === undefined) {
      throw new BadRequestException(
        "Pengguna jasa harus berstatus APPROVED untuk pencatatan transfer.",
      );
    }

    const { rows } = await this.pool.query(
      `SELECT a.id, a.person_id, a.business_id, a.status, a.type,
              p.cif_relationship_type
         FROM applications a
         LEFT JOIN persons p ON p.id = a.person_id
        WHERE a.id = $1`,
      [applicationId],
    );

    const senderApp = rows[0];
    if (!senderApp) {
      throw new BadRequestException("Sender application not found");
    }

    if (senderApp.status !== "APPROVED") {
      throw new BadRequestException(
        "Pengguna jasa harus berstatus APPROVED untuk pencatatan transfer.",
      );
    }

    return senderApp;
  }

  private async assertWicTransferLimit(
    applicationId: number | string | null | undefined,
    amount: number | string | null | undefined,
  ) {
    if (applicationId === null || applicationId === undefined) return;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) return;

    const { rows } = await this.pool.query(
      `SELECT p.cif_relationship_type
         FROM applications a
         JOIN persons p ON p.id = a.person_id
        WHERE a.id = $1 AND a.type = 'INDIVIDUAL'
        LIMIT 1`,
      [applicationId],
    );

    if (rows[0]?.cif_relationship_type === 'WIC' && numericAmount > WIC_TRANSFER_MAX_AMOUNT) {
      throw new BadRequestException(WIC_LIMIT_ERROR);
    }
  }

  /**
   * "Lainnya" pada Sumber Dana — sama persis dengan aturan KYC/KYB (0047):
   * nilai dropdown TIDAK PERNAH diganti teks bebas; keterangannya disimpan
   * terpisah di source_of_funds_other.
   *
   * `effectiveSourceOfFunds` adalah nilai yang akan tersimpan setelah operasi
   * ini — pada PATCH bisa berasal dari baris lama kalau payload tidak
   * menyentuh source_of_funds.
   */
  private static isLainnya(v: unknown): boolean {
    return typeof v === "string" && v.trim().toLowerCase() === "lainnya";
  }

  private resolveSourceOfFundsOther(
    effectiveSourceOfFunds: unknown,
    raw: unknown,
  ): string | null {
    if (!TransfersService.isLainnya(effectiveSourceOfFunds)) return null;
    const v = typeof raw === "string" ? raw.trim() : "";
    if (!v) {
      throw new BadRequestException(
        "Keterangan lainnya wajib diisi untuk Sumber Dana.",
      );
    }
    return v;
  }

  // ---------------------------------------------------------------------------
  // INSERT satu baris transfer (DRAFT). Dipakai oleh create() dan bulkCreate().
  // `db` bisa Pool atau PoolClient (transaksi). Tidak melakukan audit/monitoring.
  // ---------------------------------------------------------------------------
  private async insertTransferRow(
    db: { query: Pool["query"] },
    user: AuthedUser,
    dto: any,
    senderApplicationId: number,
    batchId: number | null = null,
  ) {
    const partnerRef = await this.resolvePartnerReferenceNo(
      dto.partner_reference_no,
    );
    const amountCurrency = normalizeCurrency(dto.currency);
    const amountValue = formatAmountValue(dto.amount);
    const transferMethod = dto.transfer_method ?? "BANK_TRANSFER";
    const transferChannel = dto.transfer_channel ?? "MANUAL";
    const additionalInfo = dto.additional_info ?? {};

    const q = await db.query(
      `INSERT INTO transfers(
        branch_id,
        amount,
        currency,
        beneficiary_bank_name,
        beneficiary_bank_code,
        beneficiary_account_number,
        beneficiary_account_name,
        beneficiary_relationship_to_sender,
        description,
        requested_transfer_at,
        created_by,
        sender_application_id,
        partner_reference_no,
        amount_value,
        amount_currency,
        source_account_no,
        source_account_name,
        source_bank_code,
        source_bank_name,
        beneficiary_address,
        beneficiary_email,
        beneficiary_customer_residence,
        beneficiary_customer_type,
        transfer_method,
        transfer_channel,
        transaction_date,
        requested_execution_date,
        additional_info,
        source_of_funds,
        source_of_funds_other,
        transaction_purpose,
        batch_id,
        beneficiary_mobile_number,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33, now()
      )
      RETURNING *`,
      [
        null, // branch belum dipakai
        dto.amount,
        amountCurrency,
        dto.beneficiaryBankName,
        dto.beneficiaryBankCode ?? null,
        dto.beneficiaryAccountNumber,
        dto.beneficiaryAccountName,
        dto.beneficiary_relationship_to_sender,
        dto.description ?? null,
        // Tanggal Diminta bukan input user dan TIDAK lahir saat draft dibuat —
        // distempel backend saat Finance Manager menyetujui (lihat decide()).
        // Berlaku sama untuk create tunggal maupun bulk (keduanya lewat helper ini).
        null,
        resolveUserId(user),
        senderApplicationId,
        partnerRef,
        amountValue,
        amountCurrency,
        dto.source_account_no ?? null,
        dto.source_account_name ?? null,
        dto.source_bank_code ?? null,
        dto.source_bank_name ?? null,
        dto.beneficiary_address ?? null,
        dto.beneficiary_email ?? null,
        dto.beneficiary_customer_residence ?? null,
        dto.beneficiary_customer_type ?? null,
        transferMethod,
        transferChannel,
        // Draft selalu lahir tanpa tanggal transaksi — diisi backend saat
        // persetujuan Finance Manager, bukan saat create maupun submit.
        null,
        dto.requested_execution_date ?? null,
        JSON.stringify(additionalInfo),
        dto.source_of_funds ?? null,
        this.resolveSourceOfFundsOther(
          dto.source_of_funds,
          dto.source_of_funds_other,
        ),
        dto.transaction_purpose ?? null,
        batchId,
        // No. HP penerima — wajib untuk BI-Fast Qlola pada bulk baru, opsional
        // pada transfer tunggal (di luar cakupan export Qlola).
        dto.beneficiary_mobile_number ?? null,
      ],
    );
    return q.rows[0];
  }

  // ---------------------------------------------------------------------------
  // CREATE DRAFT
  // ---------------------------------------------------------------------------
  async create(user: AuthedUser, dto: CreateTransferDto, ip?: string) {
    // Input transfer = FrontDesk saja. FinanceStaff hanya layer review finance.
    if (user.role !== "FrontDesk" && !FULL_ACCESS_ROLES.includes(user.role)) {
      throw new ForbiddenException("Not allowed");
    }

    // ✅ validasi sender_application_id — harus ada & KYC/KYB APPROVED
    await this.assertSenderApproved(dto.sender_application_id);
    await this.assertWicTransferLimit(dto.sender_application_id, dto.amount);

    const row = await this.insertTransferRow(
      this.pool,
      user,
      dto,
      dto.sender_application_id,
    );

    await this.audit(resolveUserId(user), "TRANSFER_CREATE", String(row.id), null, row, ip);

    // Auto monitoring evaluation — tidak boleh menggagalkan transfer.
    await this.monitoring.safeEvaluateTransfer(Number(row.id), user);

    return row;
  }

  // ---------------------------------------------------------------------------
  // BULK CREATE — mass input (bukan mass approval). Maks 20 item.
  // Setiap item menjadi transfer DRAFT normal + di-link ke transfer_batches.
  // Satu item invalid → seluruh request ditolak (validasi DTO di controller;
  // insert dibungkus transaksi agar tidak ada baris parsial bila DB error).
  // ---------------------------------------------------------------------------
  async bulkCreate(
    user: AuthedUser,
    dto: {
      sender_application_id: number;
      qlola_debit_account?: string;
      qlola_sender_name?: string;
      items: any[];
    },
    ip?: string,
  ) {
    // Input transfer = FrontDesk saja. FinanceStaff hanya layer review finance.
    if (user.role !== "FrontDesk" && !FULL_ACCESS_ROLES.includes(user.role)) {
      throw new ForbiddenException("Not allowed");
    }

    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException("items wajib diisi minimal 1");
    }
    if (dto.items.length > 20) {
      throw new BadRequestException("maksimal 20 item per bulk transfer");
    }

    // Nomor referensi bulk dibuat backend — bukan lagi input user.
    const bulkRef = await this.resolveBulkReferenceNo();

    // Sender divalidasi sekali (satu sender untuk seluruh batch).
    await this.assertSenderApproved(dto.sender_application_id);
    for (const item of dto.items) {
      await this.assertWicTransferLimit(dto.sender_application_id, item.amount);
    }

    const actorId = resolveUserId(user);
    const batchNo = await this.resolveBatchNo();

    const client = await this.pool.connect();
    let batchId: number;
    let created: any[] = [];
    try {
      await client.query("BEGIN");

      const batchRes = await client.query(
        `INSERT INTO transfer_batches
           (batch_no, bulk_reference_no, created_by, sender_application_id, total_count, total_amount, status,
            qlola_debit_account, qlola_sender_name)
         VALUES ($1,$2,$3,$4,$5,$6,'CREATED',$7,$8)
         RETURNING id`,
        [
          batchNo,
          bulkRef,
          actorId,
          dto.sender_application_id,
          dto.items.length,
          dto.items.reduce((sum, it) => sum + Number(it.amount || 0), 0),
          // Rekening debit BRI & nama pengirim Qlola: sama untuk seluruh batch,
          // jadi disimpan sekali di sini — bukan diulang di tiap baris anak.
          dto.qlola_debit_account?.trim() || null,
          dto.qlola_sender_name?.trim() || null,
        ],
      );
      batchId = Number(batchRes.rows[0].id);

      for (const item of dto.items) {
        const row = await this.insertTransferRow(
          client,
          user,
          item,
          dto.sender_application_id,
          batchId,
        );
        created.push(row);
      }

      await client.query("COMMIT");
    } catch (err: any) {
      await client.query("ROLLBACK");
      // batch_no & bulk_reference_no sama-sama dibuat sistem dan sudah dicek
      // unik sebelum insert, jadi 23505 di sini hanya bisa berarti race dengan
      // request lain di antara pengecekan dan INSERT. Bukan salah user, dan
      // jangan bocor sebagai 500 duplicate-key — minta ulangi saja.
      if (err?.code === "23505") {
        throw new ConflictException(
          "Nomor referensi bentrok dengan permintaan lain. Silakan coba lagi.",
        );
      }
      throw err;
    } finally {
      client.release();
    }

    await this.audit(
      actorId,
      "TRANSFER_BULK_CREATE",
      String(batchId),
      null,
      { batch_no: batchNo, bulk_reference_no: bulkRef, count: created.length },
      ip,
    );

    // Monitoring evaluation per row — di luar transaksi, tidak boleh menggagalkan.
    for (const row of created) {
      await this.monitoring.safeEvaluateTransfer(Number(row.id), user);
    }

    return {
      batch_id: batchId,
      batch_no: batchNo,
      bulk_reference_no: bulkRef,
      total_count: created.length,
      total_amount: created.reduce((sum, r) => sum + Number(r.amount || 0), 0),
      transfers: created,
    };
  }

  /**
   * Nomor referensi bulk baru: BLK-XXXXXXXX, tepat 12 karakter — generator dan
   * alfabet yang sama dengan TRF-XXXXXXXX dan CMP-XXXXXXXX
   * (common/reference-no.util: CSPRNG, tanpa I/O/0/1, retry saat bentrok).
   *
   * Keunikan dicek GLOBAL, bukan per pengirim. Unique index yang ada
   * (uq_transfer_batches_sender_bulk_ref) hanya menjamin unik per sender, tapi
   * nomor ini dibaca manusia sebagai identitas satu batch, jadi tidak boleh
   * kembar antar-pengirim. Index-nya sendiri tidak diubah — pengecekan ini
   * lebih ketat, bukan lebih longgar.
   *
   * Referensi lama yang panjang (mis. "BULK-REF-20260730-001", sampai 29
   * karakter di data saat ini) tetap tersimpan apa adanya di kolom
   * VARCHAR(150). Yang dibatasi hanya nilai yang dibuat mulai sekarang.
   */
  private async resolveBulkReferenceNo(): Promise<string> {
    const ref = await generateUniqueReferenceNo("BLK", async (candidate) => {
      const dup = await this.pool.query(
        `SELECT 1 FROM transfer_batches WHERE bulk_reference_no = $1 LIMIT 1`,
        [candidate],
      );
      return (dup.rowCount ?? 0) > 0;
    });
    if (!ref) {
      throw new BadRequestException(
        "Gagal membuat No. Referensi Bulk, silakan coba lagi.",
      );
    }
    return ref;
  }

  private async resolveBatchNo(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const rand = Math.random().toString(36).toUpperCase().slice(2, 7).padEnd(5, "0");
      const candidate = `KESH-TRB-${date}-${rand}`;
      const dup = await this.pool.query(
        `SELECT 1 FROM transfer_batches WHERE batch_no = $1 LIMIT 1`,
        [candidate],
      );
      if ((dup.rowCount ?? 0) === 0) return candidate;
    }
    throw new BadRequestException("Failed to generate batch_no, please retry");
  }

  // ---------------------------------------------------------------------------
  // UPDATE DRAFT
  // ---------------------------------------------------------------------------
  async updateDraft(
    id: number,
    user: AuthedUser,
    dto: UpdateTransferDto,
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
      id,
    ]);
    const rowCount = prev.rowCount ?? 0;
    if (rowCount === 0) throw new NotFoundException("Transfer not found");

    const row = prev.rows[0];
    if (!EDITABLE_STATUSES.includes(row.status)) {
      throw new BadRequestException(
        "Only DRAFT or REVISION_REQUIRED can be updated",
      );
    }

    // Hard guard: pengirim draft harus tetap APPROVED. Mencegah update draft
    // lama yang pengirimnya sudah tidak APPROVED lagi.
    await this.assertSenderApproved(row.sender_application_id);
    await this.assertWicTransferLimit(row.sender_application_id, dto.amount ?? row.amount);

    // partner_reference_no tidak pernah di-regenerate setelah create.
    const amountCurrency = normalizeCurrency(dto.currency ?? row.amount_currency);
    const amountValue = formatAmountValue(dto.amount);

    const next = await this.pool.query(
      `UPDATE transfers SET
        amount=$2,
        currency=$3,
        amount_value=$4,
        amount_currency=$5,
        beneficiary_bank_name=$6,
        beneficiary_bank_code=$7,
        beneficiary_account_number=$8,
        beneficiary_account_name=$9,
        beneficiary_relationship_to_sender=$27,
        description=$10,
        -- $11 selalu null → Tanggal Diminta tidak bisa disetel lewat edit draft.
        -- Draft baru tetap NULL sampai disetujui Finance Manager.
        requested_transfer_at=COALESCE($11, requested_transfer_at),
        source_account_no=COALESCE($12, source_account_no),
        source_account_name=COALESCE($13, source_account_name),
        source_bank_code=COALESCE($14, source_bank_code),
        source_bank_name=COALESCE($15, source_bank_name),
        beneficiary_address=COALESCE($16, beneficiary_address),
        beneficiary_email=COALESCE($17, beneficiary_email),
        beneficiary_customer_residence=COALESCE($18, beneficiary_customer_residence),
        beneficiary_customer_type=COALESCE($19, beneficiary_customer_type),
        transfer_method=COALESCE($20, transfer_method),
        transfer_channel=COALESCE($21, transfer_channel),
        transaction_date=COALESCE($22, transaction_date),
        requested_execution_date=COALESCE($23, requested_execution_date),
        additional_info=COALESCE($24, additional_info),
        source_of_funds=COALESCE($25, source_of_funds),
        -- Sengaja TANPA COALESCE: kalau sumber dana pindah dari "Lainnya" ke
        -- pilihan biasa, keterangan lamanya harus benar-benar hilang. COALESCE
        -- akan menahan nilai basi itu tetap tersimpan.
        source_of_funds_other=$28,
        transaction_purpose=COALESCE($26, transaction_purpose),
        updated_at=now()
      WHERE id=$1
      RETURNING *`,
      [
        id,
        dto.amount,
        amountCurrency,
        amountValue,
        amountCurrency,
        dto.beneficiaryBankName,
        dto.beneficiaryBankCode ?? null,
        dto.beneficiaryAccountNumber,
        dto.beneficiaryAccountName,
        dto.description ?? null,
        null,
        dto.source_account_no ?? null,
        dto.source_account_name ?? null,
        dto.source_bank_code ?? null,
        dto.source_bank_name ?? null,
        dto.beneficiary_address ?? null,
        dto.beneficiary_email ?? null,
        dto.beneficiary_customer_residence ?? null,
        dto.beneficiary_customer_type ?? null,
        dto.transfer_method ?? null,
        dto.transfer_channel ?? null,
        // null → COALESCE mempertahankan nilai yang ada. Edit draft tidak boleh
        // menyentuh tanggal transaksi; itu wewenang persetujuan Finance Manager.
        null,
        dto.requested_execution_date ?? null,
        dto.additional_info ? JSON.stringify(dto.additional_info) : null,
        dto.source_of_funds ?? null,
        dto.transaction_purpose ?? null,
        dto.beneficiary_relationship_to_sender,
        // $28 — keterangan "Lainnya". Sumber dana efektif = nilai baru kalau
        // dikirim, kalau tidak nilai lama; keterangannya pun begitu, supaya
        // PATCH parsial yang tidak menyentuh sumber dana tidak menghapusnya.
        this.resolveSourceOfFundsOther(
          dto.source_of_funds ?? row.source_of_funds,
          dto.source_of_funds_other !== undefined
            ? dto.source_of_funds_other
            : row.source_of_funds_other,
        ),
      ],
    );

    await this.audit(
      resolveUserId(user),
      "TRANSFER_UPDATE_DRAFT",
      String(id),
      row,
      next.rows[0],
      ip,
    );
    return next.rows[0];
  }

  // ---------------------------------------------------------------------------
  // WATCHLIST SCREENING — beneficiary transfer
  // ---------------------------------------------------------------------------
  /**
   * Screening nama beneficiary terhadap watchlist aktif (DTTOT/PPPSPM/PEP).
   *
   * Algoritma & ambang SENGAJA identik dengan ApplicationsService.screenAndComputeRisk():
   * trigram similarity pg_trgm terhadap `name_norm` (berisi Full_Name atau Entity_Name)
   * dan tiap alias (Alias_Name), threshold NEAR_MATCH_THRESHOLD. Kandidat di
   * bawah ambang ini adalah noise trigram (mis. "MARIA ANIRA" vs "MIRA ARIANI" =
   * 0.412) dan TIDAK disimpan sebagai transfer_watchlist_hits sama sekali — bukan
   * cuma "tidak blocking". Hanya hit yang cocok PERSIS (skor 1.000 =
   * MATCH_THRESHOLD, classifyScreeningHit === "MATCH") yang boleh memblokir /
   * mendapat flag DTTOT_HIT; skor fuzzy 0.98 sekalipun tetap NEAR_MATCH — lihat submit().
   *
   * Delete-then-insert per transfer (konvensi sama dengan screening aplikasi) →
   * submit ulang tidak pernah menduplikasi baris hit. Kandidat juga di-dedup per
   * subjek nyata (lihat dedupWatchlistCandidates) agar satu orang yang ter-upload
   * berulang dengan unique_id auto-generate berbeda tidak muncul sebagai banyak
   * baris hit terpisah untuk skor yang sama.
   */
  /**
   * Hitung kandidat hit watchlist untuk sebuah nama, TANPA efek samping DB (tidak
   * DELETE/INSERT). Dipakai oleh screenBeneficiary() (yang lalu menyimpannya) dan
   * oleh rescreenWatchlist() untuk mode read-only (preview transfer COMPLETED/
   * REJECTED tanpa force — lihat requirement "jangan sentuh transfer settled").
   */
  private async computeBeneficiaryCandidates(name?: string | null) {
    const inputName = (name ?? "").trim();
    if (!inputName) return [] as any[];

    const expr = `upper(regexp_replace($1, '\\s+', ' ', 'g'))`;
    const { rows: rawCandidates } = await this.pool.query(
      `SELECT id, list_type, name, full_name, entity_name, unique_id, subject_type,
              date_of_birth, nationality,
              ${watchlistNameScoreSql(expr)}  AS name_score,
              ${watchlistAliasScoreSql(expr)} AS alias_score
         FROM watchlist_entries
        WHERE ${watchlistCandidateWhereSql(expr)}
        ORDER BY GREATEST(${watchlistNameScoreSql(expr)},
                          ${watchlistAliasScoreSql(expr)}) DESC
        LIMIT 30`,
      [inputName],
    );
    // Kandidat trigram (ambang GUC ~0.3, hanya untuk retrieval) di-dedup dulu per
    // subjek nyata sebelum difilter ke ambang klasifikasi final.
    const candidates = dedupWatchlistCandidates(rawCandidates);

    const hits: any[] = [];
    for (const c of candidates) {
      const nameScore = Number(c.name_score) || 0;
      const aliasScore = Number(c.alias_score) || 0;
      const score = Math.max(nameScore, aliasScore);
      if (score < NEAR_MATCH_THRESHOLD) continue;

      // matched_field: alias menang hanya bila skornya lebih tinggi dari nama.
      // name_norm diisi dari full_name bila ada, selain itu dari entity_name.
      const matchedField =
        aliasScore > nameScore
          ? "ALIAS_NAME"
          : c.full_name
            ? "FULL_NAME"
            : "ENTITY_NAME";

      hits.push({
        watchlist_entry_id: c.id,
        list_type: c.list_type,
        input_name: inputName,
        matched_name: c.name ?? c.full_name ?? c.entity_name ?? null,
        matched_field: matchedField,
        match_score: score,
        unique_id: c.unique_id ?? null,
        subject_type: c.subject_type ?? null,
        name_score: nameScore,
        alias_score: aliasScore,
        date_of_birth: c.date_of_birth ?? null,
        nationality: c.nationality ?? null,
      });
    }
    return hits;
  }

  private async screenBeneficiary(transferId: number | string, name?: string | null) {
    await this.pool.query(
      `DELETE FROM transfer_watchlist_hits WHERE transfer_id=$1`,
      [transferId],
    );

    const candidates = await this.computeBeneficiaryCandidates(name);

    const hits: any[] = [];
    for (const c of candidates) {
      const { rows } = await this.pool.query(
        `INSERT INTO transfer_watchlist_hits
           (transfer_id, watchlist_entry_id, list_type, input_name, matched_name,
            matched_field, match_score, unique_id, subject_type, raw_hit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         RETURNING id, list_type, input_name, matched_name, matched_field,
                   match_score, unique_id, subject_type, created_at`,
        [
          transferId,
          c.watchlist_entry_id,
          c.list_type,
          c.input_name,
          c.matched_name,
          c.matched_field,
          c.match_score,
          c.unique_id,
          c.subject_type,
          JSON.stringify({
            watchlist_entry_id: c.watchlist_entry_id,
            name_score: c.name_score,
            alias_score: c.alias_score,
            date_of_birth: c.date_of_birth,
            nationality: c.nationality,
          }),
        ],
      );
      hits.push(rows[0]);
    }
    return hits;
  }

  /**
   * Baca hit watchlist tersimpan untuk sebuah transfer (bentuk siap response).
   * `status` dihitung dengan classifyScreeningHit yang sama dengan aplikasi
   * (tanpa review_status — transfer_watchlist_hits tidak punya alur review
   * FALSE_POSITIVE/CONFIRMED sendiri) sehingga FE bisa membedakan MATCH
   * (blocking) dari NEAR_MATCH (informational, tidak memblokir).
   */
  private async fetchWatchlistHits(transferId: number | string) {
    const { rows } = await this.pool.query(
      `SELECT list_type, input_name, matched_name, matched_field,
              match_score::float AS match_score, unique_id, subject_type, created_at
         FROM transfer_watchlist_hits
        WHERE transfer_id=$1
        ORDER BY match_score DESC, id`,
      [transferId],
    );
    return rows.map((r) => ({
      ...r,
      status: classifyScreeningHit(null, r.match_score),
    }));
  }

  /**
   * Red flag dari hasil screening. Hanya dipanggil dengan hit bertingkat MATCH
   * (lihat pemanggil) — WATCHLIST_HIT selalu ada; DTTOT_HIT ditambahkan bila ada
   * hit bertipe DTTOT. Keduanya terdaftar di TRANSFER_RED_FLAG_CODES.
   */
  private buildWatchlistRedFlags(hits: any[]): string[] {
    const flags = ["WATCHLIST_HIT"];
    if (hits.some((h) => String(h.list_type).toUpperCase() === "DTTOT")) {
      flags.push("DTTOT_HIT");
    }
    return flags;
  }

  private buildWatchlistNotes(hits: any[]): string {
    const detail = hits
      .map(
        (h) =>
          `${h.list_type} "${h.matched_name}" (${h.matched_field}, skor ${Number(h.match_score).toFixed(3)})`,
      )
      .join("; ");
    return `Screening otomatis: nama penerima cocok dengan watchlist — ${detail}.`;
  }

  // ---------------------------------------------------------------------------
  // SUBMIT (FinanceStaff)
  // ---------------------------------------------------------------------------
  async submit(id: number, user: AuthedUser, ip?: string) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
      id,
    ]);
    const rowCount = prev.rowCount ?? 0;
    if (rowCount === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (
      user.role !== "FinanceStaff" &&
      user.role !== "FrontDesk" &&
      !FULL_ACCESS_ROLES.includes(user.role)
    ) {
      throw new ForbiddenException("Only FinanceStaff or FrontDesk can submit");
    }

    // REVISION_REQUIRED = transfer yang dikembalikan FinanceStaff. Submit ulang
    // mengulang alur normal dari awal: screening beneficiary → SUBMITTED /
    // PENDING_COMPLIANCE_REVIEW → OperationSupervisor → FinanceStaff → FinanceManager.
    if (!EDITABLE_STATUSES.includes(row.status)) {
      throw new BadRequestException(
        "Only DRAFT or REVISION_REQUIRED can be submitted",
      );
    }

    // Hard guard: pengirim wajib tetap APPROVED saat submit. Mencegah draft
    // lama dengan pengirim non-APPROVED lolos ke tahap SUBMITTED.
    await this.assertSenderApproved(row.sender_application_id);
    await this.assertWicTransferLimit(row.sender_application_id, row.amount);

    // Jangan izinkan submit jika field transfer wajib belum lengkap.
    const missing: string[] = [];
    if (!row.beneficiary_account_number) missing.push("beneficiary_account_number");
    if (!row.beneficiary_account_name) missing.push("beneficiary_account_name");
    if (!row.beneficiary_bank_name) missing.push("beneficiary_bank_name");
    if (!row.beneficiary_relationship_to_sender) missing.push("beneficiary_relationship_to_sender");
    if (!(Number(row.amount) > 0)) missing.push("amount");
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot submit, missing mandatory fields: ${missing.join(", ")}`,
      );
    }

    const actorId = resolveUserId(user);

    // Resubmit dari REVISION_REQUIRED: bereskan notifikasi "perlu revisi" yang
    // tadinya dikirim ke FrontDesk pembuat, sebelum baris ini pindah ke stage
    // berikutnya (watchlist hit atau alur normal).
    await this.notifications.resolveForObject("transfer", id);

    // Screening watchlist beneficiary. Hanya hit bertingkat MATCH (cocok persis,
    // skor 1.000) yang mengalihkan transfer ke compliance review (jalur yang
    // sudah ada, migrasi 0050). Hit NEAR_MATCH tetap tersimpan di
    // transfer_watchlist_hits untuk visibilitas/manual review, tapi TIDAK
    // memblokir dan TIDAK dilabeli DTTOT_HIT — mencegah false positive trigram
    // (mis. "MARIA ANIRA" vs "MIRA ARIANI" = 0.412, sudah difilter di
    // screenBeneficiary sebelum baris ini) ikut memblokir transfer.
    const hits = await this.screenBeneficiary(id, row.beneficiary_account_name);
    const matchHits = hits.filter(
      (h) => classifyScreeningHit(null, Number(h.match_score)) === "MATCH",
    );
    // EDD wajib transaksi — nominal saja, independen dari watchlist hit.
    const amountRequiresEdd = Number(row.amount) >= TRANSFER_EDD_AMOUNT_THRESHOLD;

    if (matchHits.length > 0 || amountRequiresEdd) {
      const redFlags = matchHits.length > 0 ? this.buildWatchlistRedFlags(matchHits) : [];
      if (amountRequiresEdd) redFlags.push("AMOUNT_EDD_THRESHOLD");

      const notesParts: string[] = [];
      if (matchHits.length > 0) notesParts.push(this.buildWatchlistNotes(matchHits));
      if (amountRequiresEdd) {
        notesParts.push(
          "Wajib EDD otomatis: nominal transaksi memenuhi ambang batas Rp50.000.000.",
        );
      }

      const flagged = await this.pool.query(
        `UPDATE transfers SET
           status = 'PENDING_COMPLIANCE_REVIEW',
           submitted_by = $2,
           submitted_at = now(),
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, actorId],
      );

      await this.pool.query(
        `INSERT INTO transfer_compliance_reviews
           (transfer_id, status, red_flags, report_notes, reported_by, reported_at)
         VALUES ($1, 'OPEN', $2::jsonb, $3, $4, now())`,
        [id, JSON.stringify(redFlags), notesParts.join(" "), actorId],
      );

      await this.audit(
        actorId,
        matchHits.length > 0 ? "TRANSFER_SUBMIT_WATCHLIST_HIT" : "TRANSFER_SUBMIT_AMOUNT_EDD",
        String(id),
        row,
        { ...flagged.rows[0], watchlist_hits: hits },
        ip,
      );

      // Monitoring dievaluasi setelah hit tersimpan → rule beneficiary menyala.
      await this.monitoring.safeEvaluateTransfer(id, user);

      await this.notifyTransferRole(
        id,
        "ComplianceLead",
        matchHits.length > 0
          ? `Transfer ${flagged.rows[0].partner_reference_no ?? id} — beneficiary kena watchlist hit`
          : `Transfer ${flagged.rows[0].partner_reference_no ?? id} — wajib EDD (nominal ≥ Rp50.000.000)`,
        "Menunggu review compliance sebelum lanjut ke Operation Supervisor.",
      );

      return flagged.rows[0];
    }

    // Submit BUKAN persetujuan: tanggal transaksi & Tanggal Diminta tetap NULL
    // di sini. Keduanya baru distempel saat Finance Manager menyetujui
    // (decide() APPROVE) — lihat APPROVAL_DATE_STAMP_SQL.
    const next = await this.pool.query(
      `UPDATE transfers SET
       status = 'SUBMITTED',
       submitted_by = $2,
       submitted_at = now(),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
      [id, actorId],
    );

    await this.audit(
      actorId,
      "TRANSFER_SUBMIT",
      String(id),
      row,
      next.rows[0],
      ip,
    );

    // Auto monitoring evaluation — tidak boleh menggagalkan transfer.
    await this.monitoring.safeEvaluateTransfer(id, user);

    await this.notifyTransferRole(
      id,
      "OperationSupervisor",
      `Transfer ${next.rows[0].partner_reference_no ?? id} menunggu review Anda`,
    );

    return next.rows[0];
  }

  // ---------------------------------------------------------------------------
  // COMPLIANCE REVIEW — helpers
  // ---------------------------------------------------------------------------
  /**
   * Ambil review compliance terbaru (by id desc) untuk sebuah transfer, sudah
   * dalam bentuk siap dikirim ke response. Mengembalikan null bila belum ada.
   */
  private async fetchLatestComplianceReview(transferId: number | string) {
    const { rows } = await this.pool.query(
      `SELECT r.id, r.transfer_id, r.status, r.red_flags, r.report_notes,
              r.reported_by, r.reported_at, r.reviewed_by, r.reviewed_at,
              r.decision_notes, r.created_at, r.updated_at,
              COALESCE(u_rep.name, u_rep.email) AS reported_by_name,
              COALESCE(u_rev.name, u_rev.email) AS reviewed_by_name
         FROM transfer_compliance_reviews r
         LEFT JOIN users u_rep ON u_rep.id = r.reported_by
         LEFT JOIN users u_rev ON u_rev.id = r.reviewed_by
        WHERE r.transfer_id = $1
        ORDER BY r.id DESC
        LIMIT 1`,
      [transferId],
    );
    return rows[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // SUBMIT FOR COMPLIANCE REVIEW (Admin/Frontline) — DRAFT → PENDING_COMPLIANCE_REVIEW
  // ---------------------------------------------------------------------------
  async submitComplianceReview(
    id: number,
    user: AuthedUser,
    dto: SubmitComplianceReviewDto,
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [id]);
    if ((prev.rowCount ?? 0) === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (
      user.role !== "FrontDesk" &&
      !FULL_ACCESS_ROLES.includes(user.role)
    ) {
      throw new ForbiddenException(
        "Only FrontDesk can submit a transfer for compliance review",
      );
    }

    if (row.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya transfer berstatus DRAFT yang dapat diajukan untuk review compliance.",
      );
    }

    const redFlags = dto.red_flags ?? [];
    if (redFlags.length === 0) {
      throw new BadRequestException("red_flags wajib diisi dan tidak boleh kosong");
    }
    if (redFlags.includes("OTHER") && !dto.report_notes?.trim()) {
      throw new BadRequestException(
        "report_notes wajib diisi bila red_flags mengandung OTHER.",
      );
    }

    // Guard sender tetap APPROVED — konsisten dengan submit normal.
    await this.assertSenderApproved(row.sender_application_id);
    await this.assertWicTransferLimit(row.sender_application_id, row.amount);

    const actorId = resolveUserId(user);

    // Transfer yang di-flag manual tetap di-screen: hit harus tersimpan & red flag
    // watchlist digabung ke red flag yang dilaporkan FrontDesk. Hanya hit bertingkat
    // MATCH yang boleh menyumbang WATCHLIST_HIT/DTTOT_HIT — NEAR_MATCH tetap
    // tersimpan sebagai bukti screening tapi tidak dilabeli hit terkonfirmasi.
    const hits = await this.screenBeneficiary(id, row.beneficiary_account_name);
    const matchHits = hits.filter(
      (h) => classifyScreeningHit(null, Number(h.match_score)) === "MATCH",
    );
    const mergedFlags = [
      ...new Set([...redFlags, ...(matchHits.length ? this.buildWatchlistRedFlags(matchHits) : [])]),
    ];
    const mergedNotes = hits.length
      ? [dto.report_notes?.trim(), this.buildWatchlistNotes(hits)]
          .filter(Boolean)
          .join(" ")
      : (dto.report_notes ?? null);

    // Jalur submit ketiga (DRAFT → compliance review) juga bukan persetujuan:
    // tanggal tetap NULL sampai Finance Manager menyetujui. Tapi ini TETAP sebuah
    // pengajuan, jadi submitted_by/submitted_at wajib terisi seperti dua jalur
    // submit lainnya — monitoring dievaluasi tepat setelah ini dan memakai
    // submitted_at sebagai waktu kejadian.
    const next = await this.pool.query(
      `UPDATE transfers SET
         status='PENDING_COMPLIANCE_REVIEW',
         submitted_by=$2,
         submitted_at=now(),
         updated_at=now()
       WHERE id=$1
       RETURNING *`,
      [id, actorId],
    );

    await this.pool.query(
      `INSERT INTO transfer_compliance_reviews
         (transfer_id, status, red_flags, report_notes, reported_by, reported_at)
       VALUES ($1, 'OPEN', $2::jsonb, $3, $4, now())`,
      [id, JSON.stringify(mergedFlags), mergedNotes, actorId],
    );

    await this.audit(
      actorId,
      "TRANSFER_SUBMIT_COMPLIANCE_REVIEW",
      String(id),
      row,
      next.rows[0],
      ip,
    );

    // Auto monitoring evaluation di submit-time — LTKT ≥ 500M harus terdeteksi
    // walau transfer masuk jalur PENDING_COMPLIANCE_REVIEW. Tidak boleh gagal.
    await this.monitoring.safeEvaluateTransfer(id, user);

    await this.notifyTransferRole(
      id,
      "ComplianceLead",
      `Transfer ${next.rows[0].partner_reference_no ?? id} diajukan FrontDesk untuk review compliance`,
      mergedNotes ?? undefined,
    );

    return this.getById(id, user);
  }

  // ---------------------------------------------------------------------------
  // COMPLIANCE REVIEW DECISION — ComplianceLead
  // ---------------------------------------------------------------------------
  async complianceReview(
    id: number,
    user: AuthedUser,
    dto: ComplianceReviewDecisionDto,
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [id]);
    if ((prev.rowCount ?? 0) === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (
      user.role !== "ComplianceLead" &&
      !FULL_ACCESS_ROLES.includes(user.role)
    ) {
      throw new ForbiddenException("Only ComplianceLead can decide compliance review");
    }

    if (row.status !== "PENDING_COMPLIANCE_REVIEW") {
      throw new BadRequestException(
        "Hanya transfer berstatus PENDING_COMPLIANCE_REVIEW yang dapat direview oleh Compliance.",
      );
    }

    const review = await this.fetchLatestComplianceReview(id);
    if (!review) {
      throw new BadRequestException(
        "Tidak ada review compliance aktif untuk transfer ini.",
      );
    }

    const actorId = resolveUserId(user);
    const notes = dto.decision_notes?.trim() || null;

    // decision_notes wajib untuk semua aksi kecuali APPROVE_TO_CONTINUE.
    if (dto.action !== "APPROVE_TO_CONTINUE" && !notes) {
      throw new BadRequestException("decision_notes wajib diisi untuk aksi ini.");
    }

    // Map aksi → status baris review + status transfer berikutnya.
    const REVIEW_STATUS: Record<string, string> = {
      APPROVE_TO_CONTINUE: "APPROVED_TO_CONTINUE",
      REJECT: "REJECTED",
      REQUEST_ADDITIONAL_INFO: "REQUEST_ADDITIONAL_INFO",
      REQUEST_EDD: "REQUEST_EDD",
      MARK_LTKM_CANDIDATE: "LTKM_CANDIDATE",
    };
    const reviewStatus = REVIEW_STATUS[dto.action];

    // Update baris review (in place) dengan keputusan + timestamp backend.
    await this.pool.query(
      `UPDATE transfer_compliance_reviews SET
         status=$2,
         reviewed_by=$3,
         reviewed_at=now(),
         decision_notes=$4,
         updated_at=now()
       WHERE id=$1`,
      [review.id, reviewStatus, actorId, notes],
    );

    // Bereskan notifikasi "menunggu Compliance" untuk ketiga aksi — REQUEST_*
    // tetap PENDING_COMPLIANCE_REVIEW tapi sudah bukan item baru yang menunggu.
    await this.notifications.resolveForObject("transfer", id);

    let next;
    if (dto.action === "APPROVE_TO_CONTINUE") {
      // Lanjut ke alur normal — transfer boleh direview Operation Supervisor.
      // submitted_at di-COALESCE: ini bukan pengajuan baru, dan monitoring TIDAK
      // dievaluasi ulang di sini. Menimpanya akan menggeser bucket harian
      // transfer yang sudah terlanjur dievaluasi memakai waktu submit aslinya.
      next = await this.pool.query(
        `UPDATE transfers SET
           status='SUBMITTED',
           submitted_by=COALESCE(submitted_by, $2),
           submitted_at=COALESCE(submitted_at, now()),
           updated_at=now()
         WHERE id=$1
         RETURNING *`,
        [id, actorId],
      );
      await this.notifyTransferRole(
        id,
        "OperationSupervisor",
        `Transfer ${next.rows[0].partner_reference_no ?? id} menunggu review Anda`,
      );
    } else if (dto.action === "REJECT") {
      next = await this.pool.query(
        `UPDATE transfers SET
           status='REJECTED',
           rejected_by=$2,
           rejected_at=now(),
           reject_reason=$3,
           updated_at=now()
         WHERE id=$1
         RETURNING *`,
        [id, actorId, notes],
      );
      if (row.created_by) {
        await this.notifyTransferUser(
          row.created_by,
          "INFO",
          id,
          `Transfer ${next.rows[0].partner_reference_no ?? id} ditolak Compliance`,
          notes ?? undefined,
        );
      }
    } else {
      // REQUEST_ADDITIONAL_INFO / REQUEST_EDD / MARK_LTKM_CANDIDATE:
      // transfer tetap PENDING_COMPLIANCE_REVIEW (blocked dari Operation Supervisor)
      // sampai ComplianceLead melakukan APPROVE_TO_CONTINUE atau REJECT.
      next = await this.pool.query(
        `UPDATE transfers SET updated_at=now() WHERE id=$1 RETURNING *`,
        [id],
      );
      // Masih perlu keputusan ComplianceLead (APPROVE_TO_CONTINUE/REJECT) — item
      // "menunggu Compliance" tadi baru saja di-resolve, jadi bikin lagi.
      await this.notifyTransferRole(
        id,
        "ComplianceLead",
        `Transfer ${next.rows[0].partner_reference_no ?? id} — ${reviewStatus.replace(/_/g, " ").toLowerCase()}`,
        notes ?? undefined,
      );
    }

    // MARK_LTKM_CANDIDATE → buat/append monitoring case LTKM (BOTH bila sudah
    // ada LTKT). Hanya untuk aksi eksplisit ini, bukan setiap REJECT.
    if (dto.action === "MARK_LTKM_CANDIDATE") {
      await this.monitoring.safeMarkLtkmCandidate(
        id,
        { redFlags: review.red_flags ?? [], notes },
        user,
      );
    }

    await this.audit(
      actorId,
      `TRANSFER_COMPLIANCE_${reviewStatus}`,
      String(id),
      row,
      next.rows[0],
      ip,
    );

    return this.getById(id, user);
  }

  // ---------------------------------------------------------------------------
  // RESCREEN WATCHLIST (historical false-positive cleanup) — ComplianceLead
  // ---------------------------------------------------------------------------
  /**
   * Re-screen ulang beneficiary transfer yang SUDAH ADA memakai classifier final
   * terkini (NEAR_MATCH_THRESHOLD/MATCH_THRESHOLD) — untuk membersihkan
   * transfer_watchlist_hits & red flag lama yang tersimpan sebelum ambang
   * klasifikasi dinaikkan (mis. false positive "MARIA ANIRA" vs "MIRA ARIANI"
   * skor 0.412 yang dulu ikut memblokir sebagai DTTOT_HIT).
   *
   * - Transfer COMPLETED/REJECTED (sudah settled) hanya di-preview (read_only:
   *   true, TIDAK ada write) kecuali force=true — rescreen tidak boleh diam-diam
   *   mengubah histori transaksi final tanpa keputusan eksplisit operator.
   * - transfer_watchlist_hits selalu diganti total dengan hasil baru (delete-then-
   *   insert, sama seperti screenBeneficiary saat submit).
   * - Red flag watchlist (WATCHLIST_HIT/DTTOT_HIT/WATCHLIST_NEAR_MATCH) pada baris
   *   transfer_compliance_reviews yang MASIH OPEN di-recompute dari hasil baru;
   *   red flag manual lain (mis. RBA_HIGH, OTHER dari FrontDesk) TIDAK disentuh.
   *   Baris review yang SUDAH diputuskan (APPROVED_TO_CONTINUE/REJECTED/dst)
   *   TIDAK diubah sama sekali — itu histori keputusan ComplianceLead, bukan
   *   sesuatu yang boleh ditimpa oleh rescreen otomatis.
   * - Status transfer TIDAK PERNAH diubah otomatis oleh endpoint ini, walau hasil
   *   baru sudah bersih dari MATCH/NEAR_MATCH — transisi
   *   PENDING_COMPLIANCE_REVIEW → SUBMITTED tetap lewat keputusan eksplisit
   *   ComplianceLead (POST :id/compliance-review action=APPROVE_TO_CONTINUE).
   *   Endpoint ini hanya melaporkan `can_continue` di response supaya
   *   ComplianceLead tahu aksi itu sekarang aman untuk diambil.
   */
  async rescreenWatchlist(
    id: number,
    user: AuthedUser,
    force: boolean,
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [id]);
    if ((prev.rowCount ?? 0) === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    const oldHits = await this.fetchWatchlistHits(id);
    const oldReview = await this.fetchLatestComplianceReview(id);

    const SETTLED_STATUSES = ["COMPLETED", "REJECTED"];
    const readOnly = SETTLED_STATUSES.includes(row.status) && !force;

    if (readOnly) {
      const preview = (
        await this.computeBeneficiaryCandidates(row.beneficiary_account_name)
      ).map((c) => ({
        list_type: c.list_type,
        input_name: c.input_name,
        matched_name: c.matched_name,
        matched_field: c.matched_field,
        match_score: c.match_score,
        unique_id: c.unique_id,
        subject_type: c.subject_type,
        status: classifyScreeningHit(null, c.match_score),
      }));
      return {
        transfer_id: id,
        transfer_status: row.status,
        read_only: true,
        reason: `Transfer berstatus ${row.status} (settled) — kirim { "force": true } untuk benar-benar mengganti transfer_watchlist_hits.`,
        old_hits: oldHits,
        new_hits: preview,
        old_match_count: oldHits.filter((h) => h.status === "MATCH").length,
        new_match_count: preview.filter((h) => h.status === "MATCH").length,
      };
    }

    const actorId = resolveUserId(user);
    const newHits = await this.screenBeneficiary(id, row.beneficiary_account_name);
    const newMatchHits = newHits.filter(
      (h) => classifyScreeningHit(null, Number(h.match_score)) === "MATCH",
    );
    const newNearHits = newHits.filter(
      (h) => classifyScreeningHit(null, Number(h.match_score)) === "NEAR_MATCH",
    );

    let canContinue = false;
    if (oldReview && oldReview.status === "OPEN") {
      const WATCHLIST_FLAG_CODES = ["WATCHLIST_HIT", "DTTOT_HIT", "WATCHLIST_NEAR_MATCH"];
      const manualFlags = (oldReview.red_flags ?? []).filter(
        (f: string) => !WATCHLIST_FLAG_CODES.includes(f),
      );
      const newWatchlistFlags = newMatchHits.length
        ? this.buildWatchlistRedFlags(newMatchHits)
        : newNearHits.length
          ? ["WATCHLIST_NEAR_MATCH"]
          : [];
      const recomputedFlags = [...new Set([...manualFlags, ...newWatchlistFlags])];

      await this.pool.query(
        `UPDATE transfer_compliance_reviews SET red_flags=$2::jsonb, updated_at=now() WHERE id=$1`,
        [oldReview.id, JSON.stringify(recomputedFlags)],
      );

      // "Bisa lanjut" hanya berarti sesuatu bila transfer sedang menunggu
      // keputusan compliance MURNI karena watchlist (tidak ada red flag manual
      // lain) dan hasil baru sudah bersih dari MATCH maupun NEAR_MATCH.
      canContinue =
        row.status === "PENDING_COMPLIANCE_REVIEW" &&
        manualFlags.length === 0 &&
        recomputedFlags.length === 0;
    }

    await this.audit(
      actorId,
      "TRANSFER_RES_SCREEN_WATCHLIST",
      String(id),
      { watchlist_hits: oldHits, compliance_review: oldReview },
      {
        watchlist_hits: newHits,
        compliance_review: await this.fetchLatestComplianceReview(id),
      },
      ip,
    );

    const fresh = await this.getById(id, user);
    return {
      ...fresh,
      rescreen: {
        read_only: false,
        old_hit_count: oldHits.length,
        new_hit_count: newHits.length,
        old_match_count: oldHits.filter((h) => h.status === "MATCH").length,
        new_match_count: newMatchHits.length,
        can_continue: canContinue,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // SUPERVISOR REVIEW (layer 1) — OperationSupervisor
  // ---------------------------------------------------------------------------
  async supervisorReview(
    id: number,
    user: AuthedUser,
    dto: { action: "APPROVE" | "REJECT"; notes?: string; reject_reason?: string },
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [id]);
    if ((prev.rowCount ?? 0) === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (row.status !== "SUBMITTED") {
      throw new BadRequestException(
        "Hanya transfer berstatus SUBMITTED yang dapat direview oleh Operation Supervisor.",
      );
    }

    const actorId = resolveUserId(user);
    await this.notifications.resolveForObject("transfer", id);

    let next;
    if (dto.action === "APPROVE") {
      next = await this.pool.query(
        `UPDATE transfers SET
          status='PENDING_FINANCE_STAFF_REVIEW',
          supervisor_reviewed_by=$2,
          supervisor_reviewed_at=now(),
          supervisor_notes=$3,
          updated_at=now()
        WHERE id=$1
        RETURNING *`,
        [id, actorId, dto.notes ?? null],
      );
      await this.notifyTransferRole(
        id,
        "FinanceStaff",
        `Transfer ${next.rows[0].partner_reference_no ?? id} menunggu review Anda`,
      );
    } else {
      next = await this.pool.query(
        `UPDATE transfers SET
          status='REJECTED',
          rejected_by=$2,
          rejected_at=now(),
          reject_reason=$3,
          supervisor_reviewed_by=$2,
          supervisor_reviewed_at=now(),
          supervisor_notes=$4,
          updated_at=now()
        WHERE id=$1
        RETURNING *`,
        [id, actorId, dto.reject_reason ?? null, dto.notes ?? null],
      );
      if (row.created_by) {
        await this.notifyTransferUser(
          row.created_by,
          "INFO",
          id,
          `Transfer ${next.rows[0].partner_reference_no ?? id} ditolak Operation Supervisor`,
          dto.reject_reason ?? undefined,
        );
      }
    }

    await this.audit(actorId, "TRANSFER_SUPERVISOR_REVIEW", String(id), row, next.rows[0], ip);
    return next.rows[0];
  }

  // ---------------------------------------------------------------------------
  // FINANCE STAFF REVIEW (layer 2) — FinanceStaff
  // ---------------------------------------------------------------------------
  async financeReview(
    id: number,
    user: AuthedUser,
    dto: {
      action: "APPROVE" | "REJECT" | "RETURN";
      notes?: string;
      reject_reason?: string;
    },
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [id]);
    if ((prev.rowCount ?? 0) === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (row.status !== "PENDING_FINANCE_STAFF_REVIEW") {
      throw new BadRequestException(
        "Hanya transfer berstatus PENDING_FINANCE_STAFF_REVIEW yang dapat direview oleh Finance Staff.",
      );
    }

    const actorId = resolveUserId(user);
    const notes = (dto.notes ?? "").trim() || null;
    await this.notifications.resolveForObject("transfer", id);

    let next;
    let action: string;
    if (dto.action === "APPROVE") {
      action = "TRANSFER_FINANCE_REVIEW";
      next = await this.pool.query(
        `UPDATE transfers SET
          status='PENDING_FINANCE_MANAGER_APPROVAL',
          finance_reviewed_by=$2,
          finance_reviewed_at=now(),
          finance_notes=$3,
          updated_at=now()
        WHERE id=$1
        RETURNING *`,
        [id, actorId, notes],
      );
      await this.notifyTransferRole(
        id,
        "FinanceManager",
        `Transfer ${next.rows[0].partner_reference_no ?? id} menunggu persetujuan Anda`,
      );
    } else if (dto.action === "RETURN") {
      // Dikembalikan untuk diperbaiki — BUKAN final. Alasan wajib supaya
      // FrontDesk tahu apa yang harus dikoreksi.
      if (!notes) {
        throw new BadRequestException(
          "notes wajib diisi sebagai alasan pengembalian transaksi.",
        );
      }
      action = "TRANSFER_FINANCE_RETURN";
      next = await this.pool.query(
        `UPDATE transfers SET
          status='REVISION_REQUIRED',
          finance_reviewed_by=$2,
          finance_reviewed_at=now(),
          finance_notes=$3,
          updated_at=now()
        WHERE id=$1
        RETURNING *`,
        [id, actorId, notes],
      );
      if (row.created_by) {
        await this.notifyTransferUser(
          row.created_by,
          "ACTION_REQUIRED",
          id,
          `Transfer ${next.rows[0].partner_reference_no ?? id} dikembalikan, perlu diperbaiki`,
          notes ?? undefined,
        );
      }
    } else {
      action = "TRANSFER_FINANCE_REVIEW";
      next = await this.pool.query(
        `UPDATE transfers SET
          status='REJECTED',
          rejected_by=$2,
          rejected_at=now(),
          reject_reason=$3,
          finance_reviewed_by=$2,
          finance_reviewed_at=now(),
          finance_notes=$4,
          updated_at=now()
        WHERE id=$1
        RETURNING *`,
        [id, actorId, dto.reject_reason ?? null, notes],
      );
      if (row.created_by) {
        await this.notifyTransferUser(
          row.created_by,
          "INFO",
          id,
          `Transfer ${next.rows[0].partner_reference_no ?? id} ditolak Finance Staff`,
          dto.reject_reason ?? undefined,
        );
      }
    }

    await this.audit(actorId, action, String(id), row, next.rows[0], ip);
    return next.rows[0];
  }

  // ---------------------------------------------------------------------------
  // DECIDE (APPROVE / REJECT) – FinanceManager
  // ---------------------------------------------------------------------------
  async decide(
    id: number,
    user: AuthedUser,
    dto: DecideTransferDto,
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
      id,
    ]);
    const rowCount = prev.rowCount ?? 0;
    if (rowCount === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (user.role !== "FinanceManager" && !FULL_ACCESS_ROLES.includes(user.role)) {
      throw new ForbiddenException("Only FinanceManager can approve/reject");
    }

    if (FULL_ACCESS_ROLES.includes(user.role)) {
      if (!["SUBMITTED", "PENDING_FINANCE_MANAGER_APPROVAL"].includes(row.status)) {
        throw new BadRequestException(
          "Hanya transfer berstatus SUBMITTED atau PENDING_FINANCE_MANAGER_APPROVAL yang dapat diputuskan.",
        );
      }
    } else {
      // FinanceManager strict ordering — must go through OperationSupervisor + FinanceStaff first.
      if (row.status !== "PENDING_FINANCE_MANAGER_APPROVAL") {
        throw new BadRequestException(
          "Transfer harus melalui review OperationSupervisor dan FinanceStaff terlebih dahulu sebelum dapat diputuskan.",
        );
      }
    }

    const decisionNotes = dto.decision_notes ?? dto.note ?? null;
    const actorId = resolveUserId(user);
    await this.notifications.resolveForObject("transfer", id);

    let next;
    if (dto.decision === "APPROVE") {
      // FinanceManager final approval directly completes the transfer as SUCCESS.
      // Ini satu-satunya titik "draft disetujui": tanggal transaksi & Tanggal
      // Diminta distempel di sini, dalam UPDATE yang sama dengan perubahan status.
      next = await this.pool.query(
        `UPDATE transfers SET
          status='COMPLETED',
          result='SUCCESS',
          approved_by=$2,
          approved_at=now(),
          completed_at=now(),${APPROVAL_DATE_STAMP_SQL}
          decision_notes=$3,
          updated_at=now()
        WHERE id=$1
        RETURNING *`,
        [id, actorId, decisionNotes],
      );
      if (row.created_by) {
        await this.notifyTransferUser(
          row.created_by,
          "INFO",
          id,
          `Transfer ${next.rows[0].partner_reference_no ?? id} selesai`,
        );
      }
    } else if (dto.decision === "REJECT") {
      next = await this.pool.query(
        `UPDATE transfers SET
          status='REJECTED',
          rejected_by=$2,
          rejected_at=now(),
          reject_reason=$3,
          decision_notes=$4,
          updated_at=now()
        WHERE id=$1
        RETURNING *`,
        [id, actorId, dto.reject_reason ?? null, decisionNotes],
      );
      if (row.created_by) {
        await this.notifyTransferUser(
          row.created_by,
          "INFO",
          id,
          `Transfer ${next.rows[0].partner_reference_no ?? id} ditolak Finance Manager`,
          dto.reject_reason ?? undefined,
        );
      }
    } else {
      throw new BadRequestException("decision must be APPROVE or REJECT");
    }

    await this.audit(
      actorId,
      `TRANSFER_${next.rows[0].status}`,
      String(id),
      row,
      next.rows[0],
      ip,
    );
    return next.rows[0];
  }

  // ---------------------------------------------------------------------------
  // SET RESULT (SUCCESS/FAILED) – FinanceManager
  // ---------------------------------------------------------------------------
  async setResult(
    id: number,
    user: AuthedUser,
    dto: SetTransferResultDto,
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
      id,
    ]);
    const rowCount = prev.rowCount ?? 0;
    if (rowCount === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (user.role !== "FinanceManager" && !FULL_ACCESS_ROLES.includes(user.role)) {
      throw new ForbiddenException("Only FinanceManager can set result");
    }

    if (!["APPROVED", "COMPLETED"].includes(row.status)) {
      throw new BadRequestException("Only APPROVED or COMPLETED can have result set");
    }

    if (dto.result !== "SUCCESS" && dto.result !== "FAILED") {
      throw new BadRequestException("result must be SUCCESS or FAILED");
    }

    const actorId = resolveUserId(user);
    const resultNotes = dto.result_notes ?? dto.note ?? null;
    const isSuccess = dto.result === "SUCCESS";

    const next = await this.pool.query(
      `UPDATE transfers SET
        status='COMPLETED',
        result=$2,
        result_notes=$3,
        attachment_uri = COALESCE($4, attachment_uri),
        result_attachment_uri = COALESCE($5, result_attachment_uri),
        result_reference_no = COALESCE($6, result_reference_no),
        bank_reference_no = COALESCE($7, bank_reference_no),
        external_reference_no = COALESCE($8, external_reference_no),
        provider_reference_no = COALESCE($9, provider_reference_no),
        latest_transaction_status = COALESCE($10, latest_transaction_status),
        transaction_status_desc = COALESCE($11, transaction_status_desc),
        provider_response_code = COALESCE($12, provider_response_code),
        provider_response_message = COALESCE($13, provider_response_message),
        provider_response = COALESCE($14, provider_response),
        failed_reason = $15,
        completed_at = $16,
        failed_at = $17,
        result_updated_by = $18,
        result_updated_at = now(),
        updated_at=now()
      WHERE id=$1
      RETURNING *`,
      [
        id,
        dto.result,
        resultNotes,
        dto.attachmentUri ?? null,
        dto.result_attachment_uri ?? null,
        dto.result_reference_no ?? null,
        dto.bank_reference_no ?? null,
        dto.external_reference_no ?? null,
        dto.provider_reference_no ?? null,
        dto.latest_transaction_status ?? null,
        dto.transaction_status_desc ?? null,
        dto.provider_response_code ?? null,
        dto.provider_response_message ?? null,
        dto.provider_response ? JSON.stringify(dto.provider_response) : null,
        isSuccess ? null : dto.failed_reason ?? null,
        isSuccess ? new Date() : null,
        isSuccess ? null : new Date(),
        actorId,
      ],
    );

    await this.audit(
      actorId,
      "TRANSFER_SET_RESULT",
      String(id),
      row,
      next.rows[0],
      ip,
    );

    // Auto monitoring evaluation pada hasil SUCCESS — tidak boleh menggagalkan transfer.
    if (isSuccess) {
      await this.monitoring.safeEvaluateTransfer(id, user);
    }

    return next.rows[0];
  }

  // ---------------------------------------------------------------------------
  // LIST – FinanceStaff: hanya miliknya; FinanceManager/SystemAdmin: semua
  // transfer_mode memisahkan single vs item bulk; tanpa filter = perilaku lama.
  // ---------------------------------------------------------------------------
  async list(
    user: AuthedUser,
    status?: string,
    opts: { transferMode?: string; batchId?: number } = {},
  ) {
    const role = user.role;
    const params: any[] = [];
    let where = "WHERE 1=1";

    if (role === "FrontDesk") {
      // FrontDesk → hanya transfer yang dia buat sendiri
      params.push(resolveUserId(user));
      where += ` AND (t.created_by = $${params.length} OR t.created_by IS NULL)`;
    }
    // FinanceStaff, OperationSupervisor, FinanceManager, SystemAdmin, Director, Auditor → semua

    const normStatus = status?.toUpperCase();
    if (normStatus && normStatus !== "ALL") {
      params.push(normStatus);
      where += ` AND t.status = $${params.length}`;
    }

    const mode = (opts.transferMode ?? "").toUpperCase();
    if (mode === "SINGLE") {
      where += ` AND t.batch_id IS NULL`;
    } else if (mode === "BULK_ITEM") {
      where += ` AND t.batch_id IS NOT NULL`;
    } else if (mode && mode !== "ALL") {
      throw new BadRequestException(
        "transfer_mode harus salah satu dari: all, single, bulk_item",
      );
    }

    if (opts.batchId !== undefined) {
      params.push(opts.batchId);
      where += ` AND t.batch_id = $${params.length}`;
    }

    const q = await this.pool.query(
      `SELECT
         t.id, t.public_id, t.partner_reference_no, t.reference_no, t.sender_application_id,
         t.amount, t.currency, t.amount_value, t.amount_currency,
         t.beneficiary_account_name, t.beneficiary_account_number,
         t.beneficiary_bank_code, t.beneficiary_bank_name,
         t.beneficiary_relationship_to_sender,
         t.batch_id, tb.batch_no, tb.bulk_reference_no,
         t.status, t.result, t.created_at, t.submitted_at, t.approved_at,
         t.completed_at, t.failed_at,
         -- Tanggal transaksi dibuat backend saat transfer disetujui; list ikut
         -- membawanya supaya Pencatatan Transfer bisa menampilkannya tanpa
         -- panggil detail. requested_transfer_at sengaja tidak ikut: hanya
         -- dipakai di detail/report, list tidak menampilkannya.
         t.transaction_date,
         t.source_of_funds, t.source_of_funds_other, t.transaction_purpose,
         COALESCE(p.full_name, b.legal_name) AS sender_name,
         CASE WHEN p.cif_relationship_type = 'WIC' THEN NULL ELSE COALESCE(p.cif_no, b.cif_no) END AS sender_cif_no,
         p.cif_relationship_type AS sender_cif_relationship_type,
         a.type                              AS sender_type,
         cr.status                           AS compliance_review_status,
         COALESCE(wl.list_types, ARRAY[]::text[]) AS watchlist_list_types,
         (wl.list_types IS NOT NULL)         AS has_watchlist_hit
       FROM transfers t
       LEFT JOIN applications a ON a.id = t.sender_application_id
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       LEFT JOIN transfer_batches tb ON tb.id = t.batch_id
       LEFT JOIN LATERAL (
         SELECT status FROM transfer_compliance_reviews
          WHERE transfer_id = t.id ORDER BY id DESC LIMIT 1
       ) cr ON true
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT list_type) AS list_types
           FROM transfer_watchlist_hits WHERE transfer_id = t.id
       ) wl ON true
       ${where}
       ORDER BY t.id DESC
       LIMIT 200`,
      params,
    );

    return q.rows;
  }

  // ---------------------------------------------------------------------------
  // BULK BATCH LIST/DETAIL — satu baris per batch (bukan per transfer anak).
  // Hak baca sama dengan list transfer; FrontDesk hanya batch buatannya sendiri.
  // ---------------------------------------------------------------------------
  private static readonly BATCH_STATUS_KEYS = [
    "DRAFT",
    "SUBMITTED",
    "PENDING_COMPLIANCE_REVIEW",
    "PENDING_FINANCE_STAFF_REVIEW",
    "PENDING_FINANCE_MANAGER_APPROVAL",
    "REVISION_REQUIRED",
    "COMPLETED",
    "REJECTED",
  ];

  // Kunci wajib selalu ada (nol bila tidak dipakai); status di luar daftar
  // (mis. APPROVED) tetap disertakan agar jumlah tidak hilang.
  private buildStatusSummary(counts: Record<string, any> | null) {
    const summary: Record<string, number> = {};
    for (const key of TransfersService.BATCH_STATUS_KEYS) summary[key] = 0;
    for (const [status, cnt] of Object.entries(counts ?? {})) {
      summary[status] = Number(cnt);
    }
    return summary;
  }

  private batchSelectSql(where: string, tail = "") {
    return `SELECT tb.id, tb.public_id, tb.batch_no, tb.bulk_reference_no, tb.sender_application_id,
                   tb.total_count, tb.total_amount, tb.status, tb.created_by,
                   tb.created_at, tb.updated_at,
                   tb.qlola_debit_account, tb.qlola_sender_name,
                   COALESCE(p.full_name, b.legal_name) AS sender_display_name,
                   sc.counts
            FROM transfer_batches tb
            LEFT JOIN applications a ON a.id = tb.sender_application_id
            LEFT JOIN persons p ON p.id = a.person_id
            LEFT JOIN business_entities b ON b.id = a.business_id
            LEFT JOIN LATERAL (
              SELECT json_object_agg(s.status, s.cnt) AS counts
              FROM (
                SELECT t.status::text AS status, COUNT(*)::int AS cnt
                FROM transfers t WHERE t.batch_id = tb.id GROUP BY t.status
              ) s
            ) sc ON true
            ${where}
            ${tail}`;
  }

  private mapBatchRow(row: any) {
    const { counts, ...batch } = row;
    return { ...batch, status_summary: this.buildStatusSummary(counts) };
  }

  async listBulkBatches(
    user: AuthedUser,
    filters: {
      q?: string;
      date_from?: string;
      date_to?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
    const offset = (page - 1) * limit;

    const params: any[] = [];
    let where = "WHERE 1=1";

    if (user.role === "FrontDesk") {
      params.push(resolveUserId(user));
      where += ` AND (tb.created_by = $${params.length} OR tb.created_by IS NULL)`;
    }

    const q = (filters.q ?? "").trim();
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (tb.batch_no ILIKE $${params.length}
                      OR COALESCE(tb.bulk_reference_no, '') ILIKE $${params.length}
                      OR COALESCE(p.full_name, b.legal_name, '') ILIKE $${params.length})`;
    }
    if (filters.date_from) {
      params.push(filters.date_from);
      where += ` AND tb.created_at >= $${params.length}`;
    }
    if (filters.date_to) {
      params.push(filters.date_to);
      where += ` AND tb.created_at <= $${params.length}`;
    }

    const countQ = await this.pool.query(
      `SELECT COUNT(*)::int AS total
       FROM transfer_batches tb
       LEFT JOIN applications a ON a.id = tb.sender_application_id
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       ${where}`,
      params,
    );

    const dataQ = await this.pool.query(
      this.batchSelectSql(where, `ORDER BY tb.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`),
      [...params, limit, offset],
    );

    return {
      data: dataQ.rows.map((r) => this.mapBatchRow(r)),
      page,
      limit,
      total: countQ.rows[0].total,
    };
  }

  /**
   * FrontDesk hanya boleh mengakses batch yang dia buat sendiri — satu-satunya
   * model kepemilikan batch di KESH, dipakai getBulkBatchById (deteksi/lihat)
   * dan exportBriQlola purpose=MAKER (unduh instruksi bayar) supaya keduanya
   * tidak pernah berbeda pendapat soal siapa pemilik sebuah batch.
   *
   * `allowLegacyUnowned` membedakan dua konteks yang butuh sikap berbeda pada
   * batch lama tanpa creator (created_by NULL):
   *   true  (default, dipakai getBulkBatchById/list) — lolos, supaya batch
   *         lama tetap bisa DIBACA. Perilaku ini TIDAK berubah oleh koreksi ini.
   *   false (dipakai exportBriQlola purpose=MAKER) — ditolak. Maker
   *         mengunduh instruksi bayar bank sungguhan; kepemilikan yang tidak
   *         bisa dibuktikan tidak boleh dianggap "boleh" hanya karena
   *         datanya lama. Jangan membackfill created_by untuk menghindari ini.
   */
  private assertFrontDeskOwnsBatch(
    batch: { created_by: unknown },
    user: AuthedUser,
    { allowLegacyUnowned = true }: { allowLegacyUnowned?: boolean } = {},
  ) {
    if (user.role !== "FrontDesk") return;
    const creator =
      batch.created_by === null || batch.created_by === undefined
        ? null
        : String(batch.created_by);
    if (creator === null) {
      if (!allowLegacyUnowned) throw new ForbiddenException("Not allowed");
      return;
    }
    if (creator !== String(resolveUserId(user))) {
      throw new ForbiddenException("Not allowed");
    }
  }

  async getBulkBatchById(id: number, user: AuthedUser) {
    const q = await this.pool.query(this.batchSelectSql("WHERE tb.id = $1"), [id]);
    if ((q.rowCount ?? 0) === 0) {
      throw new NotFoundException("Transfer batch not found");
    }
    const batch = this.mapBatchRow(q.rows[0]);

    // FrontDesk hanya boleh melihat batch yang dia buat (sama seperti list transfer).
    this.assertFrontDeskOwnsBatch(batch, user);

    // Baris transfer anak memakai shape yang sama dengan list transfer.
    const transfers = await this.list(user, undefined, { batchId: id });

    return { batch, transfers };
  }

  // ---------------------------------------------------------------------------
  // EXPORT BRI QLOLA (BI-Fast) — dua tujuan, dua populasi baris
  //
  // FINAL (default): HANYA transfer anak yang benar-benar selesai lewat
  // persetujuan internal KESH, yaitu status COMPLETED DAN result SUCCESS
  // (hasil akhir decide() APPROVE oleh Finance Manager). Diunduh
  // FinanceStaff/FinanceManager — tidak berubah oleh koreksi Maker ini.
  //
  // MAKER: HANYA transfer anak berstatus PENDING_FINANCE_STAFF_REVIEW. Peran
  // BRI Qlola adalah FrontDesk = Maker, FinanceStaff = Checker, FinanceManager
  // = Approver — jadi file yang diunggah sebagai instruksi bayar diunduh
  // FrontDesk, BUKAN FinanceStaff (mereka mengecek lewat
  // POST /transfers/:id/finance-review, bukan lewat file ini). File ini tidak
  // pernah mengubah status transfer apa pun; tidak ada alur pengembalian baru.
  //
  // Kedua populasi TIDAK PERNAH dicampur dalam satu file: satu masih bisa
  // berubah/dikembalikan, satunya sudah sah dieksekusi. Status lain
  // (DRAFT, REVISION_REQUIRED, SUBMITTED, PENDING_COMPLIANCE_REVIEW,
  // PENDING_FINANCE_MANAGER_APPROVAL, REJECTED) tidak masuk ke mana pun.
  //
  // Batch dengan status campuran TIDAK diblokir: baris yang layak untuk tujuan
  // yang diminta tetap boleh diekspor, dan jumlahnya dilaporkan ke pemanggil
  // (eligible_count dari total_count). Batch di KESH bukan unit atomik — tiap
  // transfer anak menjalani rantai approval sendiri-sendiri (lihat bulkCreate).
  // ---------------------------------------------------------------------------
  async exportBriQlola(
    batchId: number,
    user: AuthedUser,
    purpose: QlolaPurpose = "FINAL",
    ip?: string,
  ) {
    // RBAC per-purpose: @Roles di controller hanya union kasar (FrontDesk,
    // FinanceStaff, FinanceManager boleh MENCOBA endpoint) karena purpose baru
    // diketahui lewat query string saat runtime. Pemeriksaan sebenarnya di sini.
    const isMakerCaller =
      user.role === "FrontDesk" || FULL_ACCESS_ROLES.includes(user.role);
    const isFinalCaller =
      user.role === "FinanceStaff" ||
      user.role === "FinanceManager" ||
      FULL_ACCESS_ROLES.includes(user.role);
    if (purpose === "MAKER" && !isMakerCaller) {
      throw new ForbiddenException(
        "Hanya FrontDesk selaku Maker (atau SystemAdmin/Director) yang dapat mengunduh file ini.",
      );
    }
    if (purpose === "FINAL" && !isFinalCaller) {
      throw new ForbiddenException(
        "Hanya FinanceStaff/FinanceManager (atau SystemAdmin/Director) yang dapat mengunduh file ini.",
      );
    }

    const batchQ = await this.pool.query(
      `SELECT id, batch_no, total_count, qlola_debit_account, qlola_sender_name, created_by
         FROM transfer_batches WHERE id = $1`,
      [batchId],
    );
    if ((batchQ.rowCount ?? 0) === 0) {
      throw new NotFoundException("Transfer batch not found");
    }
    const batch = batchQ.rows[0];

    // Maker adalah instruksi bayar bank sungguhan: FrontDesk hanya boleh
    // mengunduhnya untuk batch miliknya sendiri — sama persis dengan aturan
    // kepemilikan getBulkBatchById (lihat assertFrontDeskOwnsBatch), bukan
    // model baru. SystemAdmin/Director tidak disentuh (bukan role FrontDesk).
    // Tidak berlaku untuk FINAL: FinanceStaff/FinanceManager tidak pernah
    // FrontDesk, jadi pengecekan ini otomatis no-op untuk mereka.
    //
    // allowLegacyUnowned: false — beda dengan getBulkBatchById (yang tetap
    // membiarkan batch lama created_by NULL terbaca). Di sini kepemilikan
    // yang tidak bisa dibuktikan HARUS ditolak karena Maker menghasilkan
    // instruksi bayar sungguhan, bukan sekadar tampilan. Jangan membackfill
    // created_by batch lama untuk "memperbaiki" ini.
    if (purpose === "MAKER") {
      this.assertFrontDeskOwnsBatch(batch, user, { allowLegacyUnowned: false });
    }

    // Filter kelayakan per tujuan — satu-satunya perbedaan antara kedua export.
    const eligibilitySql =
      purpose === "MAKER"
        ? `t.status = 'PENDING_FINANCE_STAFF_REVIEW'`
        : `t.status = 'COMPLETED' AND t.result = 'SUCCESS'`;

    const { rows } = await this.pool.query(
      `SELECT t.id, t.partner_reference_no, t.amount, t.currency,
              t.beneficiary_account_number, t.beneficiary_account_name,
              t.beneficiary_address, t.beneficiary_mobile_number,
              t.beneficiary_bank_code, t.beneficiary_bank_name,
              t.transaction_purpose, t.description,
              t.requested_execution_date,
              rb.bic_code
         FROM transfers t
         LEFT JOIN ref_banks rb ON rb.kesh_bank_code = t.beneficiary_bank_code
        WHERE t.batch_id = $1
          AND ${eligibilitySql}
        ORDER BY t.id ASC`,
      [batchId],
    );

    if (rows.length === 0) {
      throw new BadRequestException({
        message:
          purpose === "MAKER"
            ? "Belum ada transaksi yang siap dibuat sebagai Maker di BRI Qlola pada batch ini."
            : "Belum ada transaksi yang disetujui final pada batch ini, jadi belum ada yang bisa diekspor ke BRI Qlola.",
        purpose,
        eligible_count: 0,
        total_count: Number(batch.total_count ?? 0),
        errors: [],
      });
    }

    // Validasi seluruh baris dulu: lebih baik gagal dengan daftar field yang
    // kurang daripada menghasilkan file yang ditolak Qlola.
    const errors: QlolaRowError[] = [];
    for (const row of rows as QlolaSourceRow[]) {
      const missing = validateQlolaRow(row, batch);
      if (missing.length > 0) {
        errors.push({
          reference: row.partner_reference_no ?? `#${row.id}`,
          bank: row.beneficiary_bank_name ?? null,
          missing,
        });
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: "Belum siap diekspor ke BRI Qlola",
        purpose,
        eligible_count: rows.length,
        total_count: Number(batch.total_count ?? 0),
        errors,
      });
    }

    // Audit unduhan: purpose + batch + siapa (actor_id) + kapan (created_at,
    // default now()) + eligible_count sudah cukup terwakili oleh audit_logs yang
    // ada — tidak perlu subsistem/tabel baru untuk ini.
    await this.audit(
      resolveUserId(user),
      "TRANSFER_QLOLA_EXPORT",
      String(batchId),
      null,
      { purpose, eligible_count: rows.length, total_count: Number(batch.total_count ?? 0) },
      ip,
    );

    return {
      fileName: buildQlolaFileName(batch.batch_no, purpose),
      buffer: buildQlolaWorkbook(rows as QlolaSourceRow[], batch),
      purpose,
      eligible_count: rows.length,
      total_count: Number(batch.total_count ?? 0),
    };
  }

  // ---------------------------------------------------------------------------
  // DETAIL
  // ---------------------------------------------------------------------------
  async getById(id: number, user: AuthedUser) {
    const isManager =
      user.role === "FinanceManager" ||
      user.role === "FinanceStaff" ||
      user.role === "OperationSupervisor" ||
      user.role === "ComplianceLead" ||
      user.role === "Auditor" ||
      FULL_ACCESS_ROLES.includes(user.role);

    const q = await this.pool.query(
      `SELECT t.*,
              COALESCE(p.full_name, b.legal_name) AS sender_name,
              CASE WHEN p.cif_relationship_type = 'WIC' THEN NULL ELSE COALESCE(p.cif_no, b.cif_no) END AS sender_cif_no,
              p.cif_relationship_type AS sender_cif_relationship_type,
              a.type                              AS sender_type,
              tb.batch_no, tb.bulk_reference_no,
              COALESCE(u_created.name, u_created.email) AS created_by_name,
              COALESCE(u_submitted.name, u_submitted.email) AS submitted_by_name,
              COALESCE(u_approved.name, u_approved.email) AS approved_by_name,
              COALESCE(u_rejected.name, u_rejected.email) AS rejected_by_name,
              COALESCE(u_result.name, u_result.email) AS result_updated_by_name,
              COALESCE(u_supervisor.name, u_supervisor.email) AS supervisor_reviewed_by_name,
              COALESCE(u_finance.name, u_finance.email) AS finance_reviewed_by_name
       FROM transfers t
       LEFT JOIN applications a ON a.id = t.sender_application_id
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       LEFT JOIN transfer_batches tb ON tb.id = t.batch_id
       LEFT JOIN users u_created ON u_created.id = t.created_by
       LEFT JOIN users u_submitted ON u_submitted.id = t.submitted_by
       LEFT JOIN users u_approved ON u_approved.id = t.approved_by
       LEFT JOIN users u_rejected ON u_rejected.id = t.rejected_by
       LEFT JOIN users u_result ON u_result.id = t.result_updated_by
       LEFT JOIN users u_supervisor ON u_supervisor.id = t.supervisor_reviewed_by
       LEFT JOIN users u_finance ON u_finance.id = t.finance_reviewed_by
       WHERE t.id=$1`,
      [id],
    );
    const rowCount = q.rowCount ?? 0;
    if (rowCount === 0) {
      throw new NotFoundException("Transfer not found");
    }

    const row = q.rows[0];

    // Non-manager hanya boleh lihat transfer yang dia buat.
    // pg mengembalikan BIGINT sebagai string → bandingkan sebagai string.
    if (!isManager) {
      const creatorId =
        row.created_by !== null && row.created_by !== undefined
          ? String(row.created_by)
          : null;
      const userId = String(resolveUserId(user));

      if (creatorId !== null && creatorId !== userId) {
        throw new ForbiddenException("Not allowed");
      }
    }

    // Sertakan review compliance terbaru (flagged transfer) bila ada.
    const latestReview = await this.fetchLatestComplianceReview(id);
    row.latest_compliance_review = latestReview
      ? {
          id: latestReview.id,
          status: latestReview.status,
          red_flags: latestReview.red_flags,
          report_notes: latestReview.report_notes,
          reported_by: latestReview.reported_by,
          reported_by_name: latestReview.reported_by_name,
          reported_at: latestReview.reported_at,
          reviewed_by: latestReview.reviewed_by,
          reviewed_by_name: latestReview.reviewed_by_name,
          reviewed_at: latestReview.reviewed_at,
          decision_notes: latestReview.decision_notes,
        }
      : null;
    row.compliance_review_status = latestReview ? latestReview.status : null;

    // Hit watchlist beneficiary (aditif; [] bila bersih). Hak baca mengikuti
    // hak baca detail transfer di atas — termasuk Auditor read-only.
    row.watchlist_hits = await this.fetchWatchlistHits(id);

    return row;
  }

  // ---------------------------------------------------------------------------
  // SNAP PREVIEW – pure mapping, NO external call
  // ---------------------------------------------------------------------------
  async snapPreview(id: number, user: AuthedUser) {
    const row = await this.getById(id, user);
    return buildSnapTransferPayload(row);
  }

  // ---------------------------------------------------------------------------
  // SENDER SEARCH — cari aplikasi APPROVED sebagai calon pengirim
  // ---------------------------------------------------------------------------
  async searchSenders(q = '', page = 1, limit = 20) {
    const pageN = Math.max(1, page);
    const limitN = Math.min(100, Math.max(1, limit));
    const offset = (pageN - 1) * limitN;
    const pattern = `%${q}%`;

    const countQ = await this.pool.query(
      `SELECT COUNT(*)::int AS total
       FROM applications a
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       WHERE a.status = 'APPROVED'
         AND ($1 = '' OR COALESCE(p.full_name, b.legal_name) ILIKE $2
              OR COALESCE(p.cif_no, b.cif_no) ILIKE $2
              OR COALESCE(p.cif_relationship_type, '') ILIKE $2
              OR COALESCE(p.identity_number, '') ILIKE $2
              OR COALESCE(b.nib, '') ILIKE $2
              OR COALESCE(b.npwp, '') ILIKE $2)`,
      [q, pattern],
    );

    const dataQ = await this.pool.query(
      `SELECT a.id AS application_id, a.type AS application_type, a.status,
              COALESCE(p.full_name, b.legal_name) AS display_name,
              CASE WHEN p.cif_relationship_type = 'WIC' THEN NULL ELSE COALESCE(p.cif_no, b.cif_no) END AS cif_no,
              p.cif_relationship_type,
              COALESCE(p.identity_number, b.nib) AS identity_number_or_business_number
       FROM applications a
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       WHERE a.status = 'APPROVED'
         AND ($1 = '' OR COALESCE(p.full_name, b.legal_name) ILIKE $2
              OR COALESCE(p.cif_no, b.cif_no) ILIKE $2
              OR COALESCE(p.cif_relationship_type, '') ILIKE $2
              OR COALESCE(p.identity_number, '') ILIKE $2
              OR COALESCE(b.nib, '') ILIKE $2
              OR COALESCE(b.npwp, '') ILIKE $2)
       ORDER BY a.id DESC
       LIMIT $3 OFFSET $4`,
      [q, pattern, limitN, offset],
    );

    return { data: dataQ.rows, page: pageN, limit: limitN, total: countQ.rows[0].total };
  }

  // ---------------------------------------------------------------------------
  // BANK CATALOG — daftar bank statis untuk FE dropdown.
  //
  // `code` di sini adalah singkatan internal untuk lookup nama di FE
  // (banks.find(b => b.code === selected)) — BUKAN kode bank resmi BI/SKNBI
  // 3-digit (014, 008, dst). Tidak ada logic lain di backend yang mencocokkan
  // string ini secara literal, jadi aman diubah/ditambah kapan saja tanpa
  // migrasi. Kalau nanti butuh kode SKNBI resmi (mis. untuk integrasi SNAP
  // interbank sungguhan), itu perlu tabel referensi terpisah yang divalidasi
  // manual terhadap daftar resmi BI/ASPI — jangan tebak dari sini.
  // ---------------------------------------------------------------------------
  getBanks() {
    return [
      // ── Himbara (bank BUMN) ──────────────────────────────────────────
      { code: 'BRI',      name: 'Bank Rakyat Indonesia' },
      { code: 'MANDIRI',  name: 'Bank Mandiri' },
      { code: 'BNI',      name: 'Bank Negara Indonesia' },
      { code: 'BTN',      name: 'Bank Tabungan Negara' },

      // ── Bank swasta nasional besar ───────────────────────────────────
      { code: 'BCA',      name: 'Bank Central Asia' },
      { code: 'CIMB',     name: 'CIMB Niaga' },
      { code: 'DANAMON',  name: 'Bank Danamon' },
      { code: 'PERMATA',  name: 'Bank Permata' },
      { code: 'MAYBANK',  name: 'Maybank Indonesia' },
      { code: 'OCBC',     name: 'OCBC NISP' },
      { code: 'PANIN',    name: 'Panin Bank' },
      { code: 'NOBU',     name: 'Bank Nobu' },
      { code: 'MEGA',     name: 'Bank Mega' },
      { code: 'BUKOPIN',  name: 'KB Bukopin' },
      { code: 'SINARMAS', name: 'Bank Sinarmas' },
      { code: 'WOORI',    name: 'Bank Woori Saudara' },
      { code: 'BTPN',     name: 'Bank BTPN' },
      { code: 'MAYAPADA', name: 'Bank Mayapada International' },
      { code: 'MESTIKA',  name: 'Bank Mestika Dharma' },
      { code: 'ARTHA_GRAHA', name: 'Bank Artha Graha Internasional' },
      { code: 'BUMI_ARTA', name: 'Bank Bumi Arta' },
      { code: 'CAPITAL',  name: 'Bank Capital Indonesia' },
      { code: 'VICTORIA', name: 'Bank Victoria International' },
      { code: 'GANESHA',  name: 'Bank Ganesha' },
      { code: 'INDEX_SELINDO', name: 'Bank Index Selindo' },
      { code: 'SAHABAT_SAMPOERNA', name: 'Bank Sahabat Sampoerna' },
      { code: 'MULTIARTA_SENTOSA', name: 'Bank Multiarta Sentosa' },

      // ── Bank asing / joint venture ────────────────────────────────────
      { code: 'HSBC',     name: 'HSBC Indonesia' },
      { code: 'CITIBANK', name: 'Citibank Indonesia' },
      { code: 'STANCHART', name: 'Standard Chartered Bank Indonesia' },
      { code: 'DBS',      name: 'Bank DBS Indonesia' },
      { code: 'UOB',      name: 'Bank UOB Indonesia' },
      { code: 'ANZ',      name: 'Bank ANZ Indonesia' },
      { code: 'BNP_PARIBAS', name: 'Bank BNP Paribas Indonesia' },
      { code: 'QNB',      name: 'Bank QNB Indonesia' },
      { code: 'CCB',      name: 'China Construction Bank Indonesia' },
      { code: 'ICBC',     name: 'Bank ICBC Indonesia' },
      { code: 'SMBC',     name: 'Bank SMBC Indonesia' },
      { code: 'HANA',     name: 'Bank KEB Hana Indonesia' },
      { code: 'CTBC',     name: 'Bank CTBC Indonesia' },
      { code: 'SHINHAN',  name: 'Bank Shinhan Indonesia' },
      { code: 'IBK',      name: 'Bank IBK Indonesia' },
      { code: 'RESONA_PERDANIA', name: 'Bank Resona Perdania' },

      // ── Bank syariah ───────────────────────────────────────────────────
      { code: 'BSI',      name: 'Bank Syariah Indonesia' },
      { code: 'MUAMALAT', name: 'Bank Muamalat Indonesia' },
      { code: 'MEGA_SYARIAH', name: 'Bank Mega Syariah' },
      { code: 'BTPN_SYARIAH', name: 'Bank BTPN Syariah' },
      { code: 'PANIN_DUBAI_SYARIAH', name: 'Bank Panin Dubai Syariah' },

      // ── Bank Pembangunan Daerah (BPD) ───────────────────────────────────
      { code: 'BJB',      name: 'Bank BJB (Jabar Banten)' },
      { code: 'BPD_DKI',  name: 'Bank DKI' },
      { code: 'BPD_JATENG', name: 'Bank Jateng' },
      { code: 'BPD_JATIM', name: 'Bank Jatim' },
      { code: 'BPD_SUMUT', name: 'Bank Sumut' },
      { code: 'BPD_SUMSEL_BABEL', name: 'Bank Sumsel Babel' },
      { code: 'BPD_NAGARI', name: 'Bank Nagari (Sumatera Barat)' },
      { code: 'BPD_RIAU_KEPRI', name: 'Bank Riau Kepri' },
      { code: 'BPD_KALBAR', name: 'Bank Kalbar' },
      { code: 'BPD_KALSEL', name: 'Bank Kalsel' },
      { code: 'BPD_KALTENG', name: 'Bank Kalteng' },
      { code: 'BPD_KALTIMTARA', name: 'Bank Kaltimtara' },
      { code: 'BPD_SULSELBAR', name: 'Bank Sulselbar' },
      { code: 'BPD_SULUTGO', name: 'Bank SulutGo' },
      { code: 'BPD_NTB_SYARIAH', name: 'Bank NTB Syariah' },
      { code: 'BPD_NTT',  name: 'Bank NTT' },
      { code: 'BPD_PAPUA', name: 'Bank Papua' },
      { code: 'BPD_MALUKU_MALUT', name: 'Bank Maluku Malut' },
      { code: 'BPD_BENGKULU', name: 'Bank Bengkulu' },
      { code: 'BPD_LAMPUNG', name: 'Bank Lampung' },
      { code: 'BPD_ACEH_SYARIAH', name: 'Bank Aceh Syariah' },
      { code: 'BPD_DIY',  name: 'Bank BPD DIY' },

      // ── Bank digital ────────────────────────────────────────────────────
      { code: 'JAGO',     name: 'Bank Jago' },
      { code: 'SEABANK',  name: 'SeaBank Indonesia' },
      { code: 'NEOBANK',  name: 'Bank Neo Commerce (neobank)' },
      { code: 'ALADIN',   name: 'Bank Aladin Syariah' },
      { code: 'RAYA',     name: 'Bank Raya Indonesia' },
      { code: 'ALLO',     name: 'Allo Bank Indonesia' },
      { code: 'BLU_BCA',  name: 'blu by BCA Digital' },
      { code: 'SUPERBANK', name: 'Superbank Indonesia' },
      { code: 'KROM',     name: 'Krom Bank Indonesia' },
      { code: 'SAQU',     name: 'Bank Saqu' },
      // Jenius sengaja tidak dicantumkan sebagai entri terpisah — itu produk
      // digital yang berjalan di atas lisensi Bank BTPN, bukan bank sendiri.
    ];
  }
}
