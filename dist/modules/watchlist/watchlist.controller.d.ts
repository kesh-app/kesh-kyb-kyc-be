import { WatchlistService } from './watchlist.service';
import { UploadWatchlistDto } from './dto';
export declare class WatchlistController {
    private readonly svc;
    constructor(svc: WatchlistService);
    upload(file: Express.Multer.File, body: UploadWatchlistDto): Promise<{
        ok: boolean;
        count: number;
    }>;
    screen(body: {
        name: string;
        dob?: string;
        nationality?: string;
        limit?: number;
    }): Promise<any[]>;
}
