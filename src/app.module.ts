import { PrismaModule } from './prisma/prisma.module';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ClassroomsModule } from './classrooms/classrooms.module';
import { AppConfigModule } from './common/config/app-config.module';
import { HashingModule } from './common/hashing/hashing.module';
import { MailModule } from './common/mail/mail.module';
import { projectEnvSchema } from './config/env.schema';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    AppConfigModule.forProject(projectEnvSchema),
    HashingModule,
    MailModule,
    PrismaModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    AuthModule,
    UsersModule,
    ClassroomsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
