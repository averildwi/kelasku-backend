import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class CreatePollDto {
  @ApiProperty({ example: 'Where should the study tour go?', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  question: string;

  @ApiProperty({
    type: [String],
    example: ['Bandung', 'Yogyakarta', 'Malang'],
    minItems: 2,
    maxItems: 10,
    description: '2 to 10 options, each 1 to 60 characters',
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  options: string[];

  @ApiPropertyOptional({
    example: '2026-12-01T10:00:00.000Z',
    description:
      'ISO 8601 deadline; must be in the future. Omit for an open-ended poll.',
  })
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Allow picking several options',
  })
  @IsOptional()
  @IsBoolean()
  allowMultiple?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Hide the voter lists in results',
  })
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;
}
