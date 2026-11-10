import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser, JwtPayload } from '../../common/types/auth-user';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // One primary-key lookup per request, on purpose: disabling an account, a
  // role change and tokenVersion +1 apply on the very next request.
  async validate(payload: JwtPayload): Promise<AuthUser> {
    // Tokens signed before `tv` existed are rejected: one re-login, then fine.
    if (typeof payload.tv !== 'number') throw new UnauthorizedException();

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        globalRole: true,
        isActive: true,
        emailVerifiedAt: true,
        tokenVersion: true,
      },
    });
    if (
      !user ||
      !user.isActive ||
      !user.emailVerifiedAt ||
      user.tokenVersion !== payload.tv
    ) {
      throw new UnauthorizedException('Session is no longer valid');
    }
    return { id: user.id, email: user.email, role: user.globalRole };
  }
}
