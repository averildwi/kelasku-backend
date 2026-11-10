import type { Request } from 'express';
import type { GlobalRole } from '../../../generated/prisma/client.js';

/** Role names accepted by @Roles(), derived from the Prisma enum so a typo does not compile. */
export type RoleName = GlobalRole;

/**
 * Type of the User primary key. Keep `string` for uuid/cuid ids, change it to
 * `number` when the User model uses autoincrement.
 */
export type UserId = string;

/** What JwtStrategy.validate() returns and what @CurrentUser() injects. */
export interface AuthUser {
  id: UserId;
  email: string;
  role: RoleName;
}

/**
 * Claims signed into the access token. Only for sign/verify: request.user is
 * always AuthUser. `sub` is a string even for int ids (JWT convention).
 * `tv` is User.tokenVersion at sign time. No `role`: it is read from the
 * database on every request, so a role change applies immediately.
 */
export interface JwtPayload {
  sub: string;
  email: string;
  tv: number;
}

/** Express request after JwtAuthGuard ran. `user` is absent on public routes. */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
