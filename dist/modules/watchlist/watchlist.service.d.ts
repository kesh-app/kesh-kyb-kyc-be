import { Pool } from "pg";
type IngestRow = {
    list_type: "PEP" | "DTTOT" | "PPPSPM";
    list_source: string;
    unique_id?: string | null;
    full_name?: string | null;
    alias_name?: string[] | null;
    gender?: string | null;
    date_of_birth?: string | null;
    place_of_birth?: string | null;
    nationality?: string | null;
    national_id_number?: string | null;
    tax_identification_number?: string | null;
    position_title?: string | null;
    institution_name?: string | null;
    pep_type?: string | null;
    status?: string | null;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    entity_name?: string | null;
    registration_number?: string | null;
    legal_form?: string | null;
    country_of_registration?: string | null;
    associated_individuals?: string[] | null;
    associated_entities?: string[] | null;
    relationship_type?: string | null;
    sanction_number?: string | null;
    inclusion_date?: string | null;
    removal_date?: string | null;
    list_updated_date?: string | null;
    source_url?: string | null;
    remarks?: string | null;
    watchlist_type?: string | null;
    subject_type?: string | null;
    raw_date_of_birth?: string | null;
    description?: string | null;
};
export declare class WatchlistService {
    private readonly pool;
    constructor(pool: Pool);
    /** Normalize string */
    norm(v?: string | null): string | null;
    buildNaturalKey(r: IngestRow): string;
    /**
     * Generate deterministic unique_id ketika kolom Unique_ID kosong pada file upload.
     * Deterministik (bukan random) agar upload ulang baris yang sama tidak membuat duplikat.
     * Normalisasi tiap field: trim + uppercase + string kosong bila null, digabung "|".
     * Format: KESH-WL-AUTO-<16 hex uppercase>  (contoh: KESH-WL-AUTO-8F3A91C2D4B7E102)
     */
    generateWatchlistUniqueId(r: IngestRow): string;
    /**
     * Normalisasi Subject_Type → PERSON / ENTITY.
     * Menerima input Indonesia: Orang→PERSON; Korporasi/Perusahaan/Badan→ENTITY.
     * Kosong / tak dikenal → null (kolom audit opsional, tidak dipaksa).
     */
    normalizeSubjectType(v?: string | null): string | null;
    /**
     * Normalisasi Watchlist_Type → {DTTOT, PEP, PPPSPM, OTHER} (uppercase).
     * - Diisi & valid → dipakai apa adanya.
     * - Diisi tapi tak dikenal → OTHER.
     * - Kosong → infer dari list_type (form) → fallback scan list_source → OTHER.
     */
    normalizeWatchlistType(v: string | null | undefined, list_type: string, list_source: string): string;
    parseAliases(v?: string | null): string[] | null;
    parseAssociated(v?: string | null): string[] | null;
    mapRow(raw: any, list_type: IngestRow["list_type"], list_source: string): IngestRow;
    parseWorkbook(buf: Buffer, list_type: IngestRow["list_type"], list_source: string): IngestRow[];
    upsertRow(r: IngestRow): Promise<void>;
    ingestBuffer(buf: Buffer, list_type: IngestRow["list_type"], list_source: string, userId: number, originalFilename: string): Promise<{
        ok: boolean;
        status: string;
        total: number;
        success: number;
        error_count: number;
        errors: string | null;
        row_errors: {
            row: number;
            message: string;
        }[];
        log: {
            uploaded_by: any;
        };
    }>;
    listIngestHistory(limit?: number): Promise<{
        id: any;
        list_type: any;
        source_list: any;
        original_filename: any;
        uploaded_at: any;
        uploaded_by: any;
        total: number;
        success: number;
        error_count: number;
        status: string;
        error_message: any;
    }[]>;
    /**
     * List watchlist entries yang sudah tersimpan (untuk FE menampilkan data, bukan hanya riwayat upload).
     * Filter: list_type, source_list, watchlist_type, subject_type, dan search `q`.
     * Pagination: page (default 1) + limit (default 20, max 100), plus total.
     */
    listEntries(opts: {
        page?: number;
        limit?: number;
        list_type?: string;
        source_list?: string;
        watchlist_type?: string;
        subject_type?: string;
        q?: string;
    }): Promise<{
        data: {
            id: any;
            unique_id: any;
            list_type: any;
            source_list: any;
            watchlist_type: any;
            subject_type: any;
            full_name: any;
            alias_name: any;
            entity_name: any;
            date_of_birth: any;
            raw_date_of_birth: any;
            place_of_birth: any;
            nationality: any;
            national_id_number: any;
            position_title: any;
            institution_name: any;
            address: any;
            sanction_number: any;
            source_url: any;
            description: any;
            remarks: any;
            created_at: any;
            updated_at: any;
        }[];
        page: number;
        limit: number;
        total: any;
    }>;
}
export {};
