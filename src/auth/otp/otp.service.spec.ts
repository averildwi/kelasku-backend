import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { HashingService } from '../../common/hashing/hashing.service';
import { OTP_SENDER } from '../../common/mail/otp-sender';
import { PrismaService } from '../../prisma/prisma.service';
import { MAX_OTP_ATTEMPTS, OtpService } from './otp.service';

describe('OtpService', () => {
  let service: OtpService;
  let tx: { otpCode: { updateMany: jest.Mock } };
  let prisma: {
    otpCode: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let hashing: { hash: jest.Mock; verify: jest.Mock };
  let sender: { send: jest.Mock };
  const settings: Record<string, number> = {
    OTP_TTL_MINUTES: 10,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
  };

  beforeEach(async () => {
    tx = { otpCode: { updateMany: jest.fn() } };
    prisma = {
      otpCode: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (client: typeof tx) => Promise<unknown>)(tx)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    };
    hashing = {
      hash: jest.fn().mockResolvedValue('salt:hash'),
      verify: jest.fn(),
    };
    sender = { send: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: HashingService, useValue: hashing },
        { provide: OTP_SENDER, useValue: sender },
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: string) => settings[key] },
        },
      ],
    }).compile();
    service = moduleRef.get(OtpService);
  });

  describe('OtpService.consume', () => {
    beforeEach(() => {
      prisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: 'h',
      });
    });

    it('lets at most MAX_OTP_ATTEMPTS parallel guesses reach the code check', async () => {
      // The mock imitates the guarded UPDATE ... WHERE attempts < 5.
      let attempts = 0;
      prisma.otpCode.updateMany.mockImplementation(() => {
        if (attempts >= MAX_OTP_ATTEMPTS) return Promise.resolve({ count: 0 });
        attempts += 1;
        return Promise.resolve({ count: 1 });
      });
      hashing.verify.mockResolvedValue(false);

      await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          service.consume('u1', 'PASSWORD_RESET', '000000', jest.fn()),
        ),
      );
      expect(hashing.verify).toHaveBeenCalledTimes(MAX_OTP_ATTEMPTS);
    });

    it('runs onSuccess once when the same correct code arrives twice in parallel', async () => {
      prisma.otpCode.updateMany.mockResolvedValue({ count: 1 });
      hashing.verify.mockResolvedValue(true);
      let used = false;
      tx.otpCode.updateMany.mockImplementation(() => {
        const count = used ? 0 : 1;
        used = true;
        return Promise.resolve({ count });
      });
      const onSuccess = jest.fn().mockResolvedValue('ok');

      const results = await Promise.allSettled([
        service.consume('u1', 'PASSWORD_RESET', '123456', onSuccess),
        service.consume('u1', 'PASSWORD_RESET', '123456', onSuccess),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it('rejects without comparing when no attempt can be claimed', async () => {
      prisma.otpCode.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.consume('u1', 'PASSWORD_RESET', '123456', jest.fn()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(hashing.verify).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the purpose', async () => {
      prisma.otpCode.findFirst.mockResolvedValue(null);
      await expect(
        service.consume('u1', 'PASSWORD_RESET', '123456', jest.fn()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.otpCode.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'u1',
            purpose: 'PASSWORD_RESET',
          }) as unknown,
        }),
      );
    });
  });

  describe('OtpService.issue', () => {
    const user = { id: 'u1', email: 'a@x.com' };

    it('retires older codes, stores only a hash, and sends the code', async () => {
      prisma.otpCode.findFirst.mockResolvedValue(null);
      await service.issue(user, 'EMAIL_VERIFICATION');

      expect(prisma.otpCode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', purpose: 'EMAIL_VERIFICATION', usedAt: null },
        }),
      );
      const [{ code }] = sender.send.mock.calls[0] as [{ code: string }];
      expect(code).toMatch(/^\d{6}$/);
      expect(hashing.hash).toHaveBeenCalledWith(code);
      expect(JSON.stringify(prisma.otpCode.create.mock.calls)).not.toContain(
        code,
      );
    });

    it('does nothing inside the cooldown', async () => {
      prisma.otpCode.findFirst.mockResolvedValue({ createdAt: new Date() });
      await service.issue(user, 'EMAIL_VERIFICATION');
      expect(prisma.otpCode.create).not.toHaveBeenCalled();
      expect(sender.send).not.toHaveBeenCalled();
    });

    it('does not throw when delivery fails, so the response stays the same', async () => {
      prisma.otpCode.findFirst.mockResolvedValue(null);
      sender.send.mockRejectedValue(new Error('Resend responded with 500'));
      await expect(
        service.issue(user, 'PASSWORD_RESET'),
      ).resolves.toBeUndefined();
    });
  });
});
