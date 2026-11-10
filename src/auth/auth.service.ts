import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '../../generated/prisma/client';
import { HashingService } from '../common/hashing/hashing.service';
import type { JwtPayload } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestCodeDto } from './dto/request-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { INVALID_CODE, OtpService } from './otp/otp.service';

const INVALID_CREDENTIALS = 'Invalid credentials';

const tokenUserSelect = {
  id: true,
  email: true,
  globalRole: true,
  isActive: true,
  tokenVersion: true,
} satisfies Prisma.UserSelect;

/** What the API may show about a user. Never passwordHash or tokenVersion. */
export const profileSelect = {
  id: true,
  email: true,
  globalRole: true,
  emailVerifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthService implements OnModuleInit {
  // Unknown emails are checked against this, so they cost the same scrypt run.
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hashing.hash(randomBytes(16).toString('hex'));
  }

  async login({ email, password }: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { ...tokenUserSelect, passwordHash: true, emailVerifiedAt: true },
    });
    const passwordOk = await this.hashing.verify(
      password,
      user?.passwordHash ?? this.dummyHash,
    );
    if (!user?.passwordHash || !passwordOk) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    // Status only after the password: it is revealed to the owner, never to a guesser.
    if (!user.isActive) throw new ForbiddenException('Account is disabled');
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException('Email is not verified');
    }
    return { accessToken: await this.signToken(user) };
  }

  async register({
    name,
    email,
    password,
    globalRole,
  }: RegisterDto): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    // Conscious exception to rule 12 (UX), throttled. Never update the existing
    // row: that would let anyone replace the password of an unverified account.
    if (existing) throw new ConflictException('Email is already registered');

    const user = await this.prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await this.hashing.hash(password),
        globalRole,
      },
      select: { id: true, email: true },
    });
    await this.otp.issue(user, 'EMAIL_VERIFICATION');
  }

  async verifyEmail({
    email,
    code,
  }: VerifyOtpDto): Promise<{ accessToken: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) throw new BadRequestException(INVALID_CODE);

    const verified = await this.otp.consume(
      user.id,
      'EMAIL_VERIFICATION',
      code,
      (tx) =>
        tx.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: new Date() },
          select: tokenUserSelect,
        }),
    );
    // Both self-registration roles get a token here; a disabled account does not.
    if (!verified.isActive) return null;
    return { accessToken: await this.signToken(verified) };
  }

  async resendVerification({ email }: RequestCodeDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    if (user && !user.emailVerifiedAt) {
      await this.otp.issue(user, 'EMAIL_VERIFICATION');
    }
  }

  async forgotPassword({ email }: RequestCodeDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, isActive: true },
    });
    if (user?.isActive) await this.otp.issue(user, 'PASSWORD_RESET');
  }

  async resetPassword({
    email,
    code,
    newPassword,
  }: ResetPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true },
    });
    if (!user) throw new BadRequestException(INVALID_CODE);

    const passwordHash = await this.hashing.hash(newPassword);
    await this.otp.consume(user.id, 'PASSWORD_RESET', code, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          // Ends every session, including one an attacker may hold.
          tokenVersion: { increment: 1 },
          // The code proves the inbox, so the email counts as verified.
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
        select: { id: true },
      }),
    );
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    const currentOk = await this.hashing.verify(
      dto.currentPassword,
      user?.passwordHash ?? this.dummyHash,
    );
    // 400, not 401: the session is valid, only the field is wrong.
    if (!user?.passwordHash || !currentOk) {
      throw new BadRequestException('Current password is incorrect');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.hashing.hash(dto.newPassword),
        tokenVersion: { increment: 1 },
      },
      select: tokenUserSelect,
    });
    // Other devices are logged out; this one gets a fresh token.
    return { accessToken: await this.signToken(updated) };
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { id: true },
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: profileSelect,
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  private signToken(user: {
    id: string;
    email: string;
    tokenVersion: number;
  }): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tv: user.tokenVersion,
    };
    return this.jwt.signAsync(payload);
  }
}
