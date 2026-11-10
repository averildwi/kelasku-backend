import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import { LessonSlotDto } from './create-lesson-schedule.dto';

export class ReplaceDayLessonScheduleDto {
  @ApiProperty({
    type: [LessonSlotDto],
    description:
      'The complete set of slots for the day; replaces the existing slots. Empty clears the day.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LessonSlotDto)
  slots: LessonSlotDto[];
}
