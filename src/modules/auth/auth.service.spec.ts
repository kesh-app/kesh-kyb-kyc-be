import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Penegakan `users.is_active` di jalur login.
 *
 * Sebelum perbaikan ini `validateAndLogin` tidak pernah memeriksa is_active,
 * sehingga menonaktifkan akun TIDAK menghalangi login sama sekali. Alat
 * scripts/deactivate-sanity-users.cjs bergantung penuh pada jaminan ini.
 */
describe('AuthService — penegakan is_active', () => {
  const makeUser = (over = {}) => ({
    id: 7,
    name: 'Test User',
    email: 'user@test.local',
    role: 'FrontDesk',
    password_hash: 'hash',
    is_active: true,
    ...over,
  });

  const makeService = (user: any) => {
    const users = {
      findByEmail: jest.fn().mockResolvedValue(user),
      verifyPassword: jest.fn().mockResolvedValue(true),
      touchLastLogin: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
    };
    const jwt = { signAsync: jest.fn().mockResolvedValue('token-abc') };
    return { svc: new AuthService(users as any, jwt as any), users, jwt };
  };

  it('menolak login user yang is_active=false', async () => {
    const { svc, jwt } = makeService(makeUser({ is_active: false }));
    await expect(svc.validateAndLogin('user@test.local', 'pw')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('user nonaktif tidak pernah menerima token walau password benar', async () => {
    const { svc, users } = makeService(makeUser({ is_active: false }));
    await expect(svc.validateAndLogin('user@test.local', 'pw')).rejects.toThrow();
    // password tetap diverifikasi lebih dulu supaya status akun tidak bocor
    expect(users.verifyPassword).toHaveBeenCalled();
  });

  it('tetap mengizinkan login user aktif', async () => {
    const { svc } = makeService(makeUser({ is_active: true }));
    const res = await svc.validateAndLogin('user@test.local', 'pw');
    expect(res.access_token).toBe('token-abc');
    expect(res.user.id).toBe(7);
  });

  it('password salah tetap ditolak lebih dulu', async () => {
    const { svc, users } = makeService(makeUser());
    users.verifyPassword.mockResolvedValue(false);
    await expect(svc.validateAndLogin('user@test.local', 'salah')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
