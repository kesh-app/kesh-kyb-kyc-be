/**
 * INDIVIDUAL (KYC)
 */
export declare class CreateIndividualDto {
    full_name: string;
    identity_type: 'KTP' | 'SIM' | 'PASPOR' | 'LAINNYA';
    identity_number: string;
    address_identity: string;
    address_residential?: string;
    pob: string;
    dob: string;
    nationality: string;
    phone: string;
    occupation: string;
    gender: 'M' | 'F' | 'O';
    email?: string;
    signature_uri?: string;
}
/**
 * BUSINESS (KYB)
 */
export declare class CreateBusinessDto {
    legal_name: string;
    legal_form: string;
    incorporation_place: string;
    incorporation_date: string;
    business_license_number: string;
    nib: string;
    npwp: string;
    address_line: string;
    city: string;
    province: string;
    postal_code: string;
    business_activity: string;
    industry_code?: string;
    phone: string;
}
/**
 * DOCUMENT metadata
 */
export declare class AddDocumentDto {
    doc_type: string;
    file_uri: string;
}
