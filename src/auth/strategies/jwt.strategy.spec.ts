import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  let strategy: JwtStrategy;
  let prisma: { user: { findUnique: jest.Mock } };
  const active = {
    id: 'u1',
    email: 'a@x.com',
    globalRole: 'MURID',
    isActive: true,
    emailVerifiedAt: new Date(),
    tokenVersion: 3,
  };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'x'.repeat(32) },
        },
      ],
    }).compile();
    strategy = moduleRef.get(JwtStrategy);
  });

  it('returns the AuthUser with the role read from the database', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...active,
      globalRole: 'WALI_KELAS',
    });
    await expect(
      strategy.validate({ sub: 'u1', email: 'a@x.com', tv: 3 }),
    ).resolves.toEqual({ id: 'u1', email: 'a@x.com', role: 'WALI_KELAS' });
  });

  it.each([
    ['the user is gone', null],
    ['the account is disabled', { ...active, isActive: false }],
    ['the email is not verified', { ...active, emailVerifiedAt: null }],
    [
      'tokenVersion moved on (reset, logout-all)',
      { ...active, tokenVersion: 4 },
    ],
  ])('rejects the token when %s', async (_case, row) => {
    prisma.user.findUnique.mockResolvedValue(row);
    await expect(
      strategy.validate({ sub: 'u1', email: 'a@x.com', tv: 3 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed before tv existed without querying', async () => {
    const legacy = { sub: 'u1', email: 'a@x.com' } as unknown as Parameters<
      JwtStrategy['validate']
    >[0];
    await expect(strategy.validate(legacy)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
