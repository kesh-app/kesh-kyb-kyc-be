import { WatchlistService } from "./watchlist.service";
import { UploadWatchlistDto } from "./dto";
export declare class WatchlistController {
    private readonly svc;
    constructor(svc: WatchlistService);
    upload(file: Express.Multer.File, body: UploadWatchlistDto, req: Request & {
        user?: any;
    }): Promise<{
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
    history(limit?: string): Promise<{
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
    entries(page?: string, limit?: string, list_type?: string, source_list?: string, watchlist_type?: string, subject_type?: string, q?: string): Promise<{
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
