import { Module } from '@nestjs/common';
import { LessonSchedulesController } from './lesson-schedules.controller';
import { LessonSchedulesService } from './lesson-schedules.service';

@Module({
  controllers: [LessonSchedulesController],
  providers: [LessonSchedulesService],
})
export class LessonSchedulesModule {}
