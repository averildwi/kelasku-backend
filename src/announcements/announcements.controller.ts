import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  MessageResponse,
  Paginated,
} from '../common/interceptors/transform.interceptor';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { QueryAnnouncementDto } from './dto/query-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@ApiTags('Announcements')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('WALI_KELAS', 'MURID')
@Controller('classrooms/:classId/announcements')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Post()
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Create an announcement',
    description:
      'The author must be the homeroom teacher of this class or an active KETUA (checked in the service).',
  })
  async create(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: CreateAnnouncementDto,
    @CurrentUser('id') userId: string,
  ) {
    const announcement = await this.announcementsService.create(
      classId,
      userId,
      dto,
    );
    return new MessageResponse(announcement, 'Announcement created');
  }

  @Get()
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] List announcements',
    description:
      'Pinned first, then newest; each item carries isRead for the caller. Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  async findAll(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query() query: QueryAnnouncementDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.announcementsService.findAll(
      classId,
      userId,
      query,
    );
    return new Paginated(result.data, result.meta);
  }

  @Get(':announcementId')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Get an announcement',
    description:
      'Includes myReadAt for the caller. Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  findOne(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.announcementsService.findOne(classId, announcementId, userId);
  }

  @Patch(':announcementId')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Update an announcement',
    description:
      'Only the author or the homeroom teacher of this class (checked in the service).',
  })
  async update(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @Body() dto: UpdateAnnouncementDto,
    @CurrentUser('id') userId: string,
  ) {
    const announcement = await this.announcementsService.update(
      classId,
      announcementId,
      userId,
      dto,
    );
    return new MessageResponse(announcement, 'Announcement updated');
  }

  @Delete(':announcementId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Delete an announcement',
    description:
      'Soft delete, so read receipts survive. Only the author or the homeroom teacher of this class (checked in the service).',
  })
  async remove(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.announcementsService.remove(classId, announcementId, userId);
    return new MessageResponse(null, 'Announcement deleted');
  }

  @Post(':announcementId/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Mark an announcement as read',
    description:
      'Idempotent; readAt stays at the first read (BR-10). Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  async markRead(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.announcementsService.markRead(
      classId,
      announcementId,
      userId,
    );
    return new MessageResponse(result, 'Announcement marked as read');
  }

  @Get(':announcementId/reads')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Get read receipts',
    description:
      'Counts and member lists computed against current ACTIVE members (BR-10). Only the homeroom teacher or an active KETUA (checked in the service).',
  })
  getReadReceipts(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.announcementsService.getReadReceipts(
      classId,
      announcementId,
      userId,
    );
  }
}
