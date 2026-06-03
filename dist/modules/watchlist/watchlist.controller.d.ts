import { WatchlistService } from "./watchlist.service";
import { UploadWatchlistDto } from "./dto";
export declare class WatchlistController {
    private readonly svc;
    constructor(svc: WatchlistService);
    upload(file: Express.Multer.File, body: UploadWatchlistDto, req: Request & {
        user?: any;
    }): Promise<{
        ok: boolean;
        total: number;
        success: number;
        errors: string | null;
        log: {
            uploaded_by: any;
        };
    }>;
    history(limit?: string): Promise<any[]>;
}
