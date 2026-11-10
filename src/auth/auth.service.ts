import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
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
