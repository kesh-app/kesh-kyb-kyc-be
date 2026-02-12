import { UsersService } from './users.service';
import { CreateAdminUserDto, UpdateAdminUserDto } from './admin.dto';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    listAdmins(): Promise<any[]>;
    createAdmin(req: any, dto: CreateAdminUserDto): Promise<any>;
    updateAdmin(req: any, id: number, dto: UpdateAdminUserDto): Promise<any>;
}
