export declare class CreateTransferDto {
    amount: number;
    beneficiaryBankName: string;
    beneficiaryBankCode?: string;
    beneficiaryAccountNumber: string;
    beneficiaryAccountName: string;
    description?: string;
    requestedTransferAt?: string;
}
export declare class UpdateTransferDto extends CreateTransferDto {
}
export declare class DecideTransferDto {
    decision: 'APPROVE' | 'REJECT';
    note?: string;
}
export declare class SetTransferResultDto {
    result: 'SUCCESS' | 'FAILED';
    note?: string;
    attachmentUri?: string;
}
