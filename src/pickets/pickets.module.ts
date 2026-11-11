import { Module } from '@nestjs/common';
import { PicketsController } from './pickets.controller';
import { PicketsScheduler } from './pickets.scheduler';
import { PicketsService } from './pickets.service';

@Module({
  controllers: [PicketsController],
  providers: [PicketsService, PicketsScheduler],
})
export class PicketsModule {}
