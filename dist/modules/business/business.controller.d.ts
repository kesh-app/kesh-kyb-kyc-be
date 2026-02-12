import { BusinessService } from './business.service';
import { CreateBusinessPartyWithPersonDto, LinkExistingPersonDto } from './dto';
export declare class BusinessController {
    private readonly svc;
    constructor(svc: BusinessService);
    list(businessId: number): Promise<any[]>;
    createWithPerson(businessId: number, dto: CreateBusinessPartyWithPersonDto): Promise<any>;
    linkExisting(businessId: number, dto: LinkExistingPersonDto): Promise<any>;
    remove(businessId: number, partyId: number): Promise<{
        ok: boolean;
    }>;
}
