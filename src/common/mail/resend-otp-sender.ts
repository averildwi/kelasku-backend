import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpMessage, OtpSender } from './otp-sender';

const SUBJECTS: Record<OtpMessage['purpose'], string> = {
  EMAIL_VERIFICATION: 'Verify your email',
  PASSWORD_RESET: 'Reset your password',
};

/** Sends codes through the Resend HTTP API (no SDK dependency needed). */
@Injectable()
export class ResendOtpSender implements OtpSender {
  constructor(private readonly config: ConfigService) {}

  async send({ to, code, purpose, expiresInMinutes }: OtpMessage) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.getOrThrow<string>('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.getOrThrow<string>('MAIL_FROM'),
        to,
        subject: SUBJECTS[purpose],
        text: `Your code is ${code}. It expires in ${expiresInMinutes} minutes.`,
      }),
    });
    // The error carries the status only: the body could echo the recipient or the code.
    if (!response.ok) {
      throw new Error(`Resend responded with ${response.status}`);
    }
  }
}
