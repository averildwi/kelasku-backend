import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose, Prisma } from '../../../generated/prisma/client';
import { HashingService } from '../../common/hashing/hashing.service';
import { OTP_SENDER } from '../../common/mail/otp-sender';
import type { OtpSender } from '../../common/mail/otp-sender';
import { PrismaService } from '../../prisma/prisma.service';

export const MAX_OTP_ATTEMPTS = 5;
/** One message for unknown user, no code, wrong code, expired and exhausted. */
export const INVALID_CODE = 'Code is invalid or expired';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly config: ConfigService,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {}

  /** Issues and sends a new code. Inside the cooldown it does nothing, silently. */
  async issue(
    user: { id: string; email: string },
    purpose: OtpPurpose,
  ): Promise<void> {
    const cooldownMs =
      this.config.getOrThrow<number>('OTP_RESEND_COOLDOWN_SECONDS') * 1000;
    const last = await this.prisma.otpCode.findFirst({
      where: { userId: user.id, purpose },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    // The caller answers the same either way, so the cooldown reveals nothing.
    if (last && Date.now() - last.createdAt.getTime() < cooldownMs) return;

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const ttlMinutes = this.config.getOrThrow<number>('OTP_TTL_MINUTES');
    const now = new Date();
    const codeHash = await this.hashing.hash(code);
    await this.prisma.$transaction([
      // A new code retires every older unused code of the same purpose.
      this.prisma.otpCode.updateMany({
        where: { userId: user.id, purpose, usedAt: null },
        data: { usedAt: now },
      }),
      this.prisma.otpCode.create({
        data: {
          userId: user.id,
          purpose,
          codeHash,
          expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
        },
        select: { id: true },
      }),
    ]);

    try {
      await this.sender.send({
        to: user.email,
        code,
        purpose,
        expiresInMinutes: ttlMinutes,
      });
    } catch (err) {
      // Not rethrown: an error response here would differ from the one for an
      // unknown email. Logged without the code or the address; the user can resend.
      this.logger.error(
        `OTP delivery failed for user ${user.id} (${purpose}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Verifies a code and runs `onSuccess` in the transaction that consumes it.
   * Order is fixed: claim an attempt atomically, compare, consume once.
   */
  async consume<T>(
    userId: string,
    purpose: OtpPurpose,
    code: string,
    onSuccess: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const now = new Date();
    const otp = await this.prisma.otpCode.findFirst({
      where: { userId, purpose, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, codeHash: true },
    });
    if (!otp) throw new BadRequestException(INVALID_CODE);

    const claim = await this.prisma.otpCode.updateMany({
      where: {
        id: otp.id,
        usedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: MAX_OTP_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    if (claim.count === 0) throw new BadRequestException(INVALID_CODE);

    if (!(await this.hashing.verify(code, otp.codeHash))) {
      throw new BadRequestException(INVALID_CODE);
    }

    return this.prisma.$transaction(async (tx) => {
      const consumed = await tx.otpCode.updateMany({
        where: { id: otp.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      // A parallel request with the same code won.
      if (consumed.count === 0) throw new BadRequestException(INVALID_CODE);
      return onSuccess(tx);
    });
  }
}
