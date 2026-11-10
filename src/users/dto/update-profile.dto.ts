import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Budi Santoso',
    minLength: 2,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  // `null` clears the avatar; an omitted field leaves it untouched.
  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/demo/avatar.png',
    maxLength: 2048,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatarUrl?: string | null;
}
