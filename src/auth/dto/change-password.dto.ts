import {
  IsCurrentPassword,
  IsNewPassword,
} from '../decorators/auth-fields.decorator';

export class ChangePasswordDto {
  @IsCurrentPassword()
  currentPassword: string;

  @IsNewPassword()
  newPassword: string;
}
