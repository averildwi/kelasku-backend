import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { deviceSelect, DevicesService } from './devices.service';

describe('DevicesService', () => {
  let service: DevicesService;
  let prisma: {
    deviceToken: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      deviceToken: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [DevicesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(DevicesService);
  });

  describe('DevicesService.register', () => {
    it('upserts on the token and reassigns it to the current user', async () => {
      prisma.deviceToken.upsert.mockResolvedValue({
        id: 'd1',
        token: 'token-1',
        platform: 'ANDROID',
        lastSeenAt: new Date(),
      });

      await service.register('user-1', {
        token: 'token-1',
        platform: 'ANDROID',
      });

      expect(prisma.deviceToken.upsert).toHaveBeenCalledWith({
        where: { token: 'token-1' },
        create: { userId: 'user-1', token: 'token-1', platform: 'ANDROID' },
        update: {
          userId: 'user-1',
          platform: 'ANDROID',
          lastSeenAt: expect.any(Date) as Date,
        },
        select: deviceSelect,
      });
    });
  });

  describe('DevicesService.remove', () => {
    it('deletes the token when the caller owns it', async () => {
      prisma.deviceToken.findUnique.mockResolvedValue({
        id: 'd1',
        userId: 'user-1',
      });
      prisma.deviceToken.delete.mockResolvedValue({ id: 'd1' });

      await service.remove('user-1', 'd1');

      expect(prisma.deviceToken.delete).toHaveBeenCalledWith({
        where: { id: 'd1' },
      });
    });

    it('throws NotFoundException when the device is missing and deletes nothing', async () => {
      prisma.deviceToken.findUnique.mockResolvedValue(null);

      await expect(service.remove('user-1', 'd1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.deviceToken.delete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the device belongs to another user', async () => {
      prisma.deviceToken.findUnique.mockResolvedValue({
        id: 'd1',
        userId: 'user-2',
      });

      await expect(service.remove('user-1', 'd1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.deviceToken.delete).not.toHaveBeenCalled();
    });
  });
});
