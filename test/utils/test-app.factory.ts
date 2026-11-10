import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { PrismaExceptionFilter } from '../../src/common/filters/prisma-exception.filter';
import { LoggerInterceptor } from '../../src/common/interceptors/logger.interceptor';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { OTP_SENDER } from '../../src/common/mail/otp-sender';
import type { OtpMessage } from '../../src/common/mail/otp-sender';
import { createValidationPipe } from '../../src/common/pipes/validation.pipe.config';

/** Codes the app tried to send, newest last. Replaces the real mail adapter. */
export class CapturingOtpSender {
  readonly sent: OtpMessage[] = [];

  send(message: OtpMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  lastCodeFor(to: string): string {
    const hit = [...this.sent].reverse().find((m) => m.to === to);
    if (!hit) throw new Error(`no code sent to ${to}`);
    return hit.code;
  }
}

/**
 * Boots AppModule with the same wiring as main.ts. Keep the two in sync:
 * a test app without the filters or the prefix proves nothing about production.
 */
export async function createApp(
  customize: (b: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
  // Extra main.ts wiring of optional features (cookie parser, WebSocket adapter).
  beforeInit: (app: NestExpressApplication) => void = () => undefined,
) {
  const otp = new CapturingOtpSender();
  const moduleRef = await customize(
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(otp),
  ).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api');
  const allowedOrigins = config
    .getOrThrow<string>('FRONTEND_URL')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(
    new LoggerInterceptor(),
    new TransformInterceptor(),
  );
  app.useGlobalFilters(
    new GlobalExceptionFilter(),
    new PrismaExceptionFilter(),
  );
  beforeInit(app);
  await app.init();
  return { app, moduleRef, otp };
}
