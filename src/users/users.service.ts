import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { profileSelect } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

/** The shared profile plus the fields the user may edit themselves. */
export const userProfileSelect = {
  ...profileSelect,
  name: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('User not found');

    // Only fields the client sent are written, so a partial update cannot wipe
    // the other one. `avatarUrl: null` is a deliberate clear.
    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: userProfileSelect,
    });
  }
}
