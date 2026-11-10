import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { userProfileSelect, UsersService } from './users.service';

describe('UsersService.updateProfile', () => {
  let service: UsersService;
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  it('updates the fields that were sent and returns the profile', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    const profile = {
      id: 'u1',
      name: 'Budi',
      email: 'a@x.com',
      globalRole: 'MURID',
      avatarUrl: 'https://x/y.png',
      emailVerifiedAt: null,
      createdAt: new Date(),
    };
    prisma.user.update.mockResolvedValue(profile);

    await expect(
      service.updateProfile('u1', {
        name: 'Budi',
        avatarUrl: 'https://x/y.png',
      }),
    ).resolves.toEqual(profile);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: 'Budi', avatarUrl: 'https://x/y.png' },
      select: userProfileSelect,
    });
  });

  it('writes only the provided field on a partial update', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.user.update.mockResolvedValue({ id: 'u1' });

    await service.updateProfile('u1', { name: 'Budi' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: 'Budi' },
      select: userProfileSelect,
    });
  });

  it('clears the avatar when null is sent', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.user.update.mockResolvedValue({ id: 'u1' });

    await service.updateProfile('u1', { avatarUrl: null });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { avatarUrl: null },
      select: userProfileSelect,
    });
  });

  it('throws NotFoundException and writes nothing when the user is gone', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.updateProfile('u1', { name: 'Budi' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
