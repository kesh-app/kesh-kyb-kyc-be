export declare class CreateBusinessPartyWithPersonDto {
    role: 'DIRECTOR' | 'COMMISSIONER' | 'MANAGER' | 'BO' | 'AUTHORIZED_REP';
    full_name: string;
    identity_type: 'KTP' | 'SIM' | 'PASPOR' | 'LAINNYA';
    identity_number: string;
    address_identity: string;
    pob: string;
    dob: string;
    nationality: string;
    phone: string;
    gender: 'M' | 'F' | 'O';
    occupation?: string;
    email?: string;
}
export declare class LinkExistingPersonDto {
    role: 'DIRECTOR' | 'COMMISSIONER' | 'MANAGER' | 'BO' | 'AUTHORIZED_REP';
    person_id: number;
}
export declare class UpdatePartyActiveDto {
    is_active: boolean;
}
