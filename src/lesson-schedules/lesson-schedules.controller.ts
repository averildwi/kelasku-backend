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
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponse } from '../common/interceptors/transform.interceptor';
import { CreateLessonScheduleDto } from './dto/create-lesson-schedule.dto';
import { QueryLessonScheduleDto } from './dto/query-lesson-schedule.dto';
import { ReplaceDayLessonScheduleDto } from './dto/replace-day-lesson-schedule.dto';
import { LessonSchedulesService } from './lesson-schedules.service';

@ApiTags('Lesson schedules')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('WALI_KELAS', 'MURID')
@Controller('classrooms/:classId/lesson-schedules')
export class LessonSchedulesController {
  constructor(
    private readonly lessonSchedulesService: LessonSchedulesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] List the weekly schedule',
    description:
      'Slots grouped by day, ordered by weekday then start time. Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  findAll(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query() query: QueryLessonScheduleDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.lessonSchedulesService.findAll(classId, userId, query);
  }

  @Get('today')
  @ApiOperation({
    summary: "[WALI_KELAS/MURID] Get today's schedule",
    description:
      'Uses the Asia/Jakarta weekday. Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  findToday(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.lessonSchedulesService.findToday(classId, userId);
  }

  @Post()
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Create a schedule slot',
    description:
      'The homeroom teacher of this class or an active KETUA (checked in the service). startTime must be before endTime (400) and must not overlap another slot that day (409).',
  })
  async create(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: CreateLessonScheduleDto,
    @CurrentUser('id') userId: string,
  ) {
    const slot = await this.lessonSchedulesService.create(classId, userId, dto);
    return new MessageResponse(slot, 'Schedule slot created');
  }

  @Put('days/:day')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "[WALI_KELAS/MURID] Replace a day's schedule",
    description:
      "Replaces the whole day's slots in one transaction. The homeroom teacher of this class or an active KETUA (checked in the service). Overlapping input slots are rejected with 409.",
  })
  async replaceDay(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('day', ParseIntPipe) day: number,
    @Body() dto: ReplaceDayLessonScheduleDto,
    @CurrentUser('id') userId: string,
  ) {
    const slots = await this.lessonSchedulesService.replaceDay(
      classId,
      userId,
      day,
      dto,
    );
    return new MessageResponse(slots, 'Day schedule replaced');
  }

  @Delete(':scheduleId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Delete a schedule slot',
    description:
      'Slots are hard-deleted. The homeroom teacher of this class or an active KETUA (checked in the service).',
  })
  async remove(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.lessonSchedulesService.remove(classId, scheduleId, userId);
    return new MessageResponse(null, 'Schedule slot deleted');
  }
}
