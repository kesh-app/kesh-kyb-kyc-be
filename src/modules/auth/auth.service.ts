import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private users: UsersService, private jwt: JwtService) {}

  async validateAndLogin(email: string, password: string) {
    const u = await this.users.findByEmail(email);
    if (!u) throw new UnauthorizedException('Invalid credentials');
    const ok = await this.users.verifyPassword(password, u.password_hash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    await this.users.touchLastLogin(u.id);
    const payload = { sub: u.id, role: u.role, email: u.email };
    const access_token = await this.jwt.signAsync(payload);
    return {
      access_token,
      user: { id: u.id, name: u.name, email: u.email, role: u.role },
    };
  }

  async verifyUser(id: number) {
    return this.users.findById(id);
  }
}
