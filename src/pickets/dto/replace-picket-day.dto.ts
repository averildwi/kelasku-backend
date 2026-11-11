import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ReplacePicketDayDto {
  @ApiPropertyOptional({ example: 'Monday crew', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiProperty({
    type: [String],
    example: ['6f2a3b1c-0000-4000-8000-000000000001'],
    description:
      'Active ClassMember ids of this class; max 40, no duplicates. An empty list keeps the group without seats.',
    maxItems: 40,
  })
  @IsArray()
  @ArrayMaxSize(40)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  memberIds: string[];
}
