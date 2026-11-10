import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/** Hex color: #RGB or #RRGGBB, used by the timetable and subject chips. */
export const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export class CreateSubjectDto {
  @ApiProperty({ example: 'Matematika', maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiPropertyOptional({
    example: 'Bu Sari',
    maxLength: 60,
    description: 'Teacher who teaches this subject',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  teacherName?: string;

  @ApiPropertyOptional({
    example: '#2563EB',
    description: 'Hex color used to render the subject',
  })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_PATTERN, { message: 'color must be a hex color' })
  color?: string;
}
