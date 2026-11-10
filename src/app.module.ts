import { PrismaModule } from './prisma/prisma.module';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './common/config/app-config.module';
import { HashingModule } from './common/hashing/hashing.module';

@Module({
  imports: [AppConfigModule.forProject(), HashingModule, PrismaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
