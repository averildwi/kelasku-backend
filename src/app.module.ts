import { PrismaModule } from './prisma/prisma.module';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './common/config/app-config.module';
import { HashingModule } from './common/hashing/hashing.module';
import { MailModule } from './common/mail/mail.module';
import { projectEnvSchema } from './config/env.schema';

@Module({
  imports: [
    AppConfigModule.forProject(projectEnvSchema),
    HashingModule,
    MailModule,
    PrismaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
