import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';

function extractDbError(err: unknown): string {
  // AggregateError (ES2021) contains an `errors` array — duck-type it since target is ES2020
  const aggregate = err as { errors?: unknown[] };
  if (Array.isArray(aggregate?.errors)) {
    return aggregate.errors
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .join(' | ');
  }
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private users: UsersService, private jwt: JwtService) {}

  async validateAndLogin(email: string, password: string) {
    let u: Awaited<ReturnType<UsersService['findByEmail']>>;
    try {
      u = await this.users.findByEmail(email);
    } catch (err) {
      this.logger.error(`DB error during login for "${email}": ${extractDbError(err)}`);
      throw new InternalServerErrorException(
        'Database unavailable — please try again or contact support',
      );
    }

    if (!u) throw new UnauthorizedException('Invalid credentials');

    const ok = await this.users.verifyPassword(password, u.password_hash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    try {
      await this.users.touchLastLogin(u.id);
    } catch (err) {
      // Non-fatal: login still succeeds even if last_login_at update fails
      this.logger.warn(`Could not update last_login_at for user ${u.id}: ${extractDbError(err)}`);
    }

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
