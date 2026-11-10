import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** One password policy for register, reset and change (never copy the numbers). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Emails are compared lowercased and trimmed, so `A@x.com ` and `a@x.com` are one account. */
export function IsAccountEmail(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ example: 'user@example.com' }),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim().toLowerCase() : value,
    ),
    IsEmail(),
    MaxLength(254),
  );
}

/** A password being set: the policy applies. */
export function IsNewPassword(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      example: 'correct horse battery staple',
      minLength: PASSWORD_MIN_LENGTH,
      maxLength: PASSWORD_MAX_LENGTH,
    }),
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH),
    MaxLength(PASSWORD_MAX_LENGTH),
  );
}

/** A password being checked: no minimum, so the policy is not revealed and old passwords still work. */
export function IsCurrentPassword(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ example: 'correct horse battery staple' }),
    IsString(),
    MaxLength(PASSWORD_MAX_LENGTH),
  );
}

export function IsOtpCode(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      example: '123456',
      description: '6-digit code from the email',
    }),
    IsString(),
    Length(6, 6),
    Matches(/^\d{6}$/),
  );
}
