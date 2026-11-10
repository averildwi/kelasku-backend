import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';
import {
  CLASS_CODE_ALPHABET,
  CLASS_CODE_LENGTH,
} from '../../common/helpers/class-code.helper';

// The code alphabet is fixed (BR-6), so a typo is rejected before any query.
const CODE_PATTERN = new RegExp(
  `^[${CLASS_CODE_ALPHABET}]{${CLASS_CODE_LENGTH}}$`,
);

export class JoinClassroomDto {
  @ApiProperty({
    example: 'ABCD23',
    description: 'The 6-character code the homeroom teacher shared',
  })
  // Codes are shared by hand, so trim and uppercase before validating.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(CLASS_CODE_LENGTH, CLASS_CODE_LENGTH)
  @Matches(CODE_PATTERN, { message: 'code must be a valid class code' })
  code: string;
}
