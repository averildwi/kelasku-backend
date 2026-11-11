import { PrismaModule } from './prisma/prisma.module';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AnnouncementsModule } from './announcements/announcements.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CashDuesModule } from './cash-dues/cash-dues.module';
import { CashTransactionsModule } from './cash-transactions/cash-transactions.module';
import { ClassroomsModule } from './classrooms/classrooms.module';
import { DevicesModule } from './devices/devices.module';
import { AppConfigModule } from './common/config/app-config.module';
import { HashingModule } from './common/hashing/hashing.module';
import { MailModule } from './common/mail/mail.module';
import { NotificationsModule } from './common/notifications/notifications.module';
import { UploadModule } from './common/upload/upload.module';
import { projectEnvSchema } from './config/env.schema';
import { LessonSchedulesModule } from './lesson-schedules/lesson-schedules.module';
import { NotificationsModule as NotificationInboxModule } from './notifications/notifications.module';
import { PicketsModule } from './pickets/pickets.module';
import { PollsModule } from './polls/polls.module';
import { SubjectsModule } from './subjects/subjects.module';
import { UsersModule } from './users/users.module';
import { WhiteboardsModule } from './whiteboards/whiteboards.module';

@Module({
  imports: [
    AppConfigModule.forProject(projectEnvSchema),
    HashingModule,
    MailModule,
    NotificationsModule,
    UploadModule,
    PrismaModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    ClassroomsModule,
    AnnouncementsModule,
    SubjectsModule,
    LessonSchedulesModule,
    WhiteboardsModule,
    PicketsModule,
    PollsModule,
    CashTransactionsModule,
    CashDuesModule,
    DevicesModule,
    NotificationInboxModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
