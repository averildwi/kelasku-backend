import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Length } from 'class-validator';
import { DevicePlatform } from '../../../generated/prisma/client';

export class RegisterDeviceDto {
  @ApiProperty({
    example: 'fcm-registration-token',
    maxLength: 4096,
    description: 'FCM registration token of this device',
  })
  @IsString()
  @Length(1, 4096)
  token: string;

  @ApiProperty({ enum: DevicePlatform, example: DevicePlatform.ANDROID })
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;
}
