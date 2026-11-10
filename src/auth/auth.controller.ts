import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponse } from '../common/interceptors/transform.interceptor';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestCodeDto } from './dto/request-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

// Per handler, not per class, so GET me keeps the global limit.
const STRICT = { default: { limit: 5, ttl: 60_000 } };
const SEND_CODE = { default: { limit: 3, ttl: 60_000 } };
const CODE_SENT = 'If the account can receive a code, it has been sent';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @ApiOperation({ summary: '[PUBLIC] Log in with email and password' })
  async login(@Body() dto: LoginDto) {
    return new MessageResponse(
      await this.authService.login(dto),
      'Login successful',
    );
  }

  @Post('register')
  @Throttle(STRICT)
  @ApiOperation({ summary: '[PUBLIC] Register and send a verification code' })
  async register(@Body() dto: RegisterDto) {
    await this.authService.register(dto);
    return new MessageResponse(
      null,
      'Registered, check your email for the code',
    );
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @ApiOperation({ summary: '[PUBLIC] Verify the email with a code' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return new MessageResponse(
      await this.authService.verifyEmail(dto),
      'Email verified',
    );
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle(SEND_CODE)
  @ApiOperation({ summary: '[PUBLIC] Send a new verification code' })
  async resendOtp(@Body() dto: RequestCodeDto) {
    await this.authService.resendVerification(dto);
    return new MessageResponse(null, CODE_SENT);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @ApiOperation({ summary: '[PUBLIC] Send a password reset code' })
  async forgotPassword(@Body() dto: RequestCodeDto) {
    await this.authService.forgotPassword(dto);
    return new MessageResponse(null, CODE_SENT);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @ApiOperation({ summary: '[PUBLIC] Reset the password with a code' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return new MessageResponse(null, 'Password reset, please log in');
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '[AUTH] Get my profile' })
  me(@CurrentUser('id') userId: string) {
    return this.authService.me(userId);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '[AUTH] Change my password, end other sessions' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return new MessageResponse(
      await this.authService.changePassword(userId, dto),
      'Password changed',
    );
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '[AUTH] Log out on every device' })
  async logoutAll(@CurrentUser('id') userId: string) {
    await this.authService.logoutAll(userId);
    return new MessageResponse(null, 'Logged out on every device');
  }
}
