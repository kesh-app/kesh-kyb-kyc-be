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
};
export declare class WatchlistService {
    private readonly pool;
    constructor(pool: Pool);
    /** Normalize string */
    norm(v?: string | null): string | null;
    buildNaturalKey(r: IngestRow): string;
    parseAliases(v?: string | null): string[] | null;
    parseAssociated(v?: string | null): string[] | null;
    mapRow(raw: any, list_type: IngestRow["list_type"], list_source: string): IngestRow;
    parseWorkbook(buf: Buffer, list_type: IngestRow["list_type"], list_source: string): IngestRow[];
    upsertRow(r: IngestRow): Promise<void>;
    ingestBuffer(buf: Buffer, list_type: IngestRow["list_type"], list_source: string, userId: number, originalFilename: string): Promise<{
        ok: boolean;
        total: number;
        success: number;
        errors: string | null;
    }>;
    listIngestHistory(limit?: number): Promise<any[]>;
}
export {};
