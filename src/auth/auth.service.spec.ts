import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { HashingService } from '../common/hashing/hashing.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
  };
  const hashing = new HashingService();
  const jwt = new JwtService({ secret: 'x'.repeat(32) });
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashing.hash('correct horse');
  });

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: HashingService, useValue: hashing },
        { provide: JwtService, useValue: jwt },
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
