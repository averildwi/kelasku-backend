import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { HashingService } from '../common/hashing/hashing.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { OtpService } from './otp/otp.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  };
  let tx: { user: { update: jest.Mock } };
  let otp: { issue: jest.Mock; consume: jest.Mock };
  const hashing = new HashingService();
  const jwt = new JwtService({ secret: 'x'.repeat(32) });
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashing.hash('correct horse');
  });

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    tx = { user: { update: jest.fn().mockResolvedValue({ id: 'u1' }) } };
    otp = {
      issue: jest.fn(),
      consume: jest.fn(
        (_u: string, _p: string, _c: string, cb: (t: typeof tx) => unknown) =>
          cb(tx),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: HashingService, useValue: hashing },
        { provide: JwtService, useValue: jwt },
        { provide: OtpService, useValue: otp },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
    await service.onModuleInit();
  });

  const user = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'a@x.com',
    globalRole: 'MURID',
    isActive: true,
    emailVerifiedAt: new Date(),
    tokenVersion: 2,
    passwordHash,
    ...over,
  });

  describe('AuthService.login', () => {
    it('returns { accessToken } whose payload is { sub, email, tv } without role', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      const { accessToken } = await service.login({
        email: 'a@x.com',
        password: 'correct horse',
      });
      const claims = jwt.decode<Record<string, unknown>>(accessToken);
      expect(claims).toMatchObject({ sub: 'u1', email: 'a@x.com', tv: 2 });
      expect(claims).not.toHaveProperty('role');
    });

    it('answers an unknown email and a wrong password with the same error', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const unknown = await service
        .login({ email: 'nobody@x.com', password: 'whatever1' })
        .catch((e: unknown) => e);
      prisma.user.findUnique.mockResolvedValueOnce(user());
      const wrong = await service
        .login({ email: 'a@x.com', password: 'whatever1' })
        .catch((e: unknown) => e);

      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect((unknown as Error).message).toBe((wrong as Error).message);
    });

    it('treats an account without a password as invalid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ passwordHash: null }));
      await expect(
        service.login({ email: 'a@x.com', password: 'correct horse' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('reveals a disabled account only after the password is correct', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ isActive: false }));
      await expect(
        service.login({ email: 'a@x.com', password: 'wrong pass' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        service.login({ email: 'a@x.com', password: 'correct horse' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reveals an unverified account only after the password is correct', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ emailVerifiedAt: null }));
      await expect(
        service.login({ email: 'a@x.com', password: 'wrong pass' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        service.login({ email: 'a@x.com', password: 'correct horse' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('AuthService.register', () => {
    it('creates an unverified account and sends a verification code', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'u1', email: 'a@x.com' });

      await service.register({
        name: 'Budi',
        email: 'a@x.com',
        password: 'correct horse',
        globalRole: 'MURID',
      });

      const [{ data }] = prisma.user.create.mock.calls[0] as [
        { data: { name: string; globalRole: string; passwordHash: string } },
      ];
      expect(data.name).toBe('Budi');
      expect(data.globalRole).toBe('MURID');
      await expect(
        hashing.verify('correct horse', data.passwordHash),
      ).resolves.toBe(true);
      expect(otp.issue).toHaveBeenCalledWith(
        { id: 'u1', email: 'a@x.com' },
        'EMAIL_VERIFICATION',
      );
    });

    it('never touches an existing account, verified or not', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

      await expect(
        service.register({
          name: 'Budi',
          email: 'a@x.com',
          password: 'new password',
          globalRole: 'MURID',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('AuthService.verifyEmail', () => {
    it('issues a token for a self-registration role', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      tx.user.update.mockResolvedValue({
        id: 'u1',
        email: 'a@x.com',
        globalRole: 'WALI_KELAS',
        isActive: true,
        tokenVersion: 0,
      });

      const result = await service.verifyEmail({
        email: 'a@x.com',
        code: '123456',
      });

      expect(result?.accessToken).toEqual(expect.any(String));
      expect(otp.consume).toHaveBeenCalledWith(
        'u1',
        'EMAIL_VERIFICATION',
        '123456',
        expect.any(Function),
      );
    });

    it('rejects an unknown email without consuming a code', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyEmail({ email: 'nobody@x.com', code: '123456' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(otp.consume).not.toHaveBeenCalled();
    });
  });

  describe('AuthService.changePassword', () => {
    it('stores the new hash, bumps tokenVersion, and returns a fresh token', async () => {
      prisma.user.findUnique.mockResolvedValue({ passwordHash });
      prisma.user.update.mockResolvedValue({
        id: 'u1',
        email: 'a@x.com',
        globalRole: 'MURID',
        isActive: true,
        tokenVersion: 3,
      });

      const { accessToken } = await service.changePassword('u1', {
        currentPassword: 'correct horse',
        newPassword: 'brand new pass',
      });

      const [{ data }] = prisma.user.update.mock.calls[0] as [
        { data: { tokenVersion: unknown; passwordHash: string } },
      ];
      expect(data.tokenVersion).toEqual({ increment: 1 });
      await expect(
        hashing.verify('brand new pass', data.passwordHash),
      ).resolves.toBe(true);
      expect(jwt.decode<Record<string, unknown>>(accessToken)).toMatchObject({
        tv: 3,
      });
    });

    it('rejects a wrong current password without writing', async () => {
      prisma.user.findUnique.mockResolvedValue({ passwordHash });

      await expect(
        service.changePassword('u1', {
          currentPassword: 'not the right one',
          newPassword: 'brand new pass',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('AuthService.resetPassword', () => {
    it('stores the new hash and bumps tokenVersion in the consuming transaction', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        emailVerifiedAt: null,
      });

      await service.resetPassword({
        email: 'a@x.com',
        code: '123456',
        newPassword: 'brand new pass',
      });

      expect(otp.consume).toHaveBeenCalledWith(
        'u1',
        'PASSWORD_RESET',
        '123456',
        expect.any(Function),
      );
      const [{ data }] = tx.user.update.mock.calls[0] as [
        { data: { tokenVersion: unknown; passwordHash: string } },
      ];
      expect(data.tokenVersion).toEqual({ increment: 1 });
      await expect(
        hashing.verify('brand new pass', data.passwordHash),
      ).resolves.toBe(true);
    });
  });

  describe('AuthService.logoutAll', () => {
    it('bumps tokenVersion so every token dies', async () => {
      prisma.user.update.mockResolvedValue({ id: 'u1' });

      await service.logoutAll('u1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { tokenVersion: { increment: 1 } },
        select: { id: true },
      });
    });
  });

  describe('AuthService.me', () => {
    it('returns the profile without passwordHash or tokenVersion', async () => {
      const profile = {
        id: 'u1',
        email: 'a@x.com',
        globalRole: 'MURID',
        emailVerifiedAt: new Date(),
        createdAt: new Date(),
      };
      prisma.user.findUnique.mockResolvedValue(profile);

      await expect(service.me('u1')).resolves.toEqual(profile);
    });

    it('throws UnauthorizedException when the user is gone', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.me('u1')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
