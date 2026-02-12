export declare class UploadWatchlistDto {
    list_type: 'PEP' | 'DTTOT' | 'PPPSPM';
    list_source: string;
    overwrite_strategy?: 'merge' | 'replace';
}
