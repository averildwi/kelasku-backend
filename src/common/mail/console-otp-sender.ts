import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpMessage, OtpSender } from './otp-sender';

/**
 * Local development only, chosen explicitly with OTP_SENDER=console. It is
 * the one place a code is printed, and it refuses to exist in production so a
 * wrong NODE_ENV default cannot leak codes into production logs.
 */
@Injectable()
export class ConsoleOtpSender implements OtpSender {
  constructor(config: ConfigService) {
    if (config.getOrThrow<string>('NODE_ENV') === 'production') {
      throw new Error('OTP_SENDER=console is not allowed in production');
    }
  }

  send({ to, code, purpose }: OtpMessage): Promise<void> {
    process.stdout.write(`[dev otp] ${purpose} ${to}: ${code}\n`);
    return Promise.resolve();
  }
}
