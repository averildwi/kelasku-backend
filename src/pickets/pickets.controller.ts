import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponse } from '../common/interceptors/transform.interceptor';
import { ReplacePicketDayDto } from './dto/replace-picket-day.dto';
import { PicketsService } from './pickets.service';

@ApiTags('Pickets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('WALI_KELAS', 'MURID')
@Controller('classrooms/:classId/pickets')
export class PicketsController {
  constructor(private readonly picketsService: PicketsService) {}

  @Get()
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] List the week picket groups',
    description:
      'Groups ordered by weekday. Allowed for the homeroom teacher of this class or an ACTIVE member (checked in the service).',
  })
  findWeek(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.picketsService.findWeek(classId, userId);
  }

  @Get('me')
  @Roles('MURID')
  @ApiOperation({
    summary: '[MURID] List my picket duty days',
    description: 'The weekdays the caller is on duty for this class.',
  })
  myDays(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.picketsService.myDays(classId, userId);
  }

  @Put('days/:day')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "[WALI_KELAS/MURID] Replace a day's picket group",
    description:
      "Replaces the day's group and its members in one transaction. The homeroom teacher of this class or an active KETUA (checked in the service). `day` is 1..7.",
  })
  async replaceDay(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('day', ParseIntPipe) day: number,
    @Body() dto: ReplacePicketDayDto,
    @CurrentUser('id') userId: string,
  ) {
    const group = await this.picketsService.replaceDay(
      classId,
      userId,
      day,
      dto,
    );
    return new MessageResponse(group, 'Picket day replaced');
  }

  @Delete('days/:day')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "[WALI_KELAS/MURID] Delete a day's picket group",
    description:
      'The homeroom teacher of this class or an active KETUA (checked in the service). `day` is 1..7.',
  })
  async removeDay(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('day', ParseIntPipe) day: number,
    @CurrentUser('id') userId: string,
  ) {
    await this.picketsService.removeDay(classId, userId, day);
    return new MessageResponse(null, 'Picket day deleted');
  }
}
