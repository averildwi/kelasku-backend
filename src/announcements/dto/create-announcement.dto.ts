import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class CreateAnnouncementDto {
  @ApiProperty({
    example: 'Class meeting moved to Friday',
    maxLength: 150,
    description: 'Announcement title',
  })
  @IsString()
  @Length(1, 150)
  title: string;

  @ApiProperty({
    example:
      'We will hold the weekly meeting on Friday at 15:00 in the classroom.',
    maxLength: 5000,
    description: 'Announcement body',
  })
  @IsString()
  @Length(1, 5000)
  content: string;

  @ApiPropertyOptional({
    example: true,
    default: false,
    description: 'Pin the announcement to the top of the list',
  })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}
