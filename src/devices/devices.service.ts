import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

export const deviceSelect = {
  id: true,
  token: true,
  platform: true,
  lastSeenAt: true,
} satisfies Prisma.DeviceTokenSelect;

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert on the unique token. A token that moved to another account is
   * reassigned to the caller, so a shared/restored device follows the last
   * account that registered it.
   */
  async register(userId: string, dto: RegisterDeviceDto) {
    return this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: { userId, token: dto.token, platform: dto.platform },
      update: { userId, platform: dto.platform, lastSeenAt: new Date() },
      select: deviceSelect,
    });
  }

  /** Ownership check in the service; only the owner may remove the token. */
  async remove(userId: string, deviceId: string): Promise<void> {
    const device = await this.prisma.deviceToken.findUnique({
      where: { id: deviceId },
      select: { id: true, userId: true },
    });
    if (!device) throw new NotFoundException('Device not found');
    if (device.userId !== userId) {
      throw new ForbiddenException('You can only remove your own device');
    }
    await this.prisma.deviceToken.delete({ where: { id: device.id } });
  }
}
