import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** `HH:mm`, 24-hour, Asia/Jakarta local time (BR-11b). */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Fields shared by a slot, without the day (create adds it, replace takes it from the path). */
export class LessonSlotDto {
  @ApiProperty({
    example: '3d6c1e9a-9c1b-4c1e-9f0a-1b2c3d4e5f60',
    description: 'Subject in the same class, not soft-deleted',
  })
  @IsUUID()
  subjectId: string;

  @ApiProperty({
    example: '07:30',
    description: 'Start time, HH:mm (Asia/Jakarta)',
  })
  @IsString()
  @Matches(TIME_PATTERN, { message: 'startTime must be HH:mm' })
  startTime: string;

  @ApiProperty({
    example: '09:00',
    description: 'End time, HH:mm (Asia/Jakarta)',
  })
  @IsString()
  @Matches(TIME_PATTERN, { message: 'endTime must be HH:mm' })
  endTime: string;

  @ApiPropertyOptional({ example: 'Lab 1', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  room?: string;
}

export class CreateLessonScheduleDto extends LessonSlotDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: 7,
    description: '1 = Monday .. 7 = Sunday',
  })
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek: number;
}
