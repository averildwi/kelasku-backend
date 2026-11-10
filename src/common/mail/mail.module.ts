import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleOtpSender } from './console-otp-sender';
import { OTP_SENDER } from './otp-sender';
import { ResendOtpSender } from './resend-otp-sender';

@Global()
@Module({
  providers: [
    {
      provide: OTP_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('OTP_SENDER') === 'console'
          ? new ConsoleOtpSender(config)
          : new ResendOtpSender(config),
    },
  ],
  exports: [OTP_SENDER],
})
export class MailModule {}
