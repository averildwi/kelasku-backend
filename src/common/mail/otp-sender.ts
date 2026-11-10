import type { OtpPurpose } from '../../../generated/prisma/client';

/** DI token for the port, so specs can swap in a fake. */
export const OTP_SENDER = Symbol('OTP_SENDER');

export interface OtpMessage {
  to: string;
  code: string;
  purpose: OtpPurpose;
  expiresInMinutes: number;
}

/** Port: how a one-time code reaches the user. Implementations never log the code. */
export interface OtpSender {
  send(message: OtpMessage): Promise<void>;
}
