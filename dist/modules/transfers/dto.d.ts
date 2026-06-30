export declare class CreateTransferDto {
    amount: number;
    beneficiaryBankName: string;
    beneficiaryBankCode?: string;
    sender_application_id: number;
    beneficiaryAccountNumber: string;
    beneficiaryAccountName: string;
    description?: string;
    requestedTransferAt?: string;
    partner_reference_no?: string;
    source_account_no?: string;
    source_account_name?: string;
    source_bank_code?: string;
    source_bank_name?: string;
    beneficiary_address?: string;
    beneficiary_email?: string;
    beneficiary_customer_residence?: string;
    beneficiary_customer_type?: string;
    currency?: string;
    transfer_method?: string;
    transfer_channel?: string;
    transaction_date?: string;
    requested_execution_date?: string;
    additional_info?: Record<string, unknown>;
}
export declare class UpdateTransferDto extends CreateTransferDto {
}
export declare class DecideTransferDto {
    decision: 'APPROVE' | 'REJECT';
    note?: string;
    decision_notes?: string;
    reject_reason?: string;
}
export declare class SetTransferResultDto {
    result: 'SUCCESS' | 'FAILED';
    note?: string;
    attachmentUri?: string;
    result_notes?: string;
    result_reference_no?: string;
    result_attachment_uri?: string;
    bank_reference_no?: string;
    external_reference_no?: string;
    provider_reference_no?: string;
    latest_transaction_status?: string;
    transaction_status_desc?: string;
    provider_response_code?: string;
    provider_response_message?: string;
    provider_response?: Record<string, unknown>;
    failed_reason?: string;
}
