import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

export class VoteDto {
  @ApiProperty({
    type: [String],
    example: ['3d6c1e9a-9c1b-4c1e-9f0a-1b2c3d4e5f60'],
    description:
      'Option ids of this poll. Exactly one for a single-choice poll; 2 to 10 for a multiple-choice poll.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  optionIds: string[];
}
