import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  MessageResponse,
  Paginated,
} from '../common/interceptors/transform.interceptor';
import type { UploadedImageFile } from '../common/upload/storage.service';
import { CreateWhiteboardDto } from './dto/create-whiteboard.dto';
import { QueryWhiteboardDto } from './dto/query-whiteboard.dto';
import { UpdateWhiteboardDto } from './dto/update-whiteboard.dto';
import {
  MAX_WHITEBOARD_FILE_SIZE,
  MAX_WHITEBOARD_IMAGES,
  WhiteboardsService,
} from './whiteboards.service';

const IMAGE_TYPE_PATTERN = /^image\/(jpeg|png|webp)$/;

@ApiTags('Whiteboards')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('WALI_KELAS', 'MURID')
@Controller('classrooms/:classId/whiteboards')
export class WhiteboardsController {
  constructor(private readonly whiteboardsService: WhiteboardsService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FilesInterceptor('images', MAX_WHITEBOARD_IMAGES))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['images', 'subjectId', 'date'],
      properties: {
        images: {
          type: 'array',
          maxItems: MAX_WHITEBOARD_IMAGES,
          items: { type: 'string', format: 'binary' },
        },
        subjectId: { type: 'string', format: 'uuid' },
        date: { type: 'string', format: 'date', example: '2026-11-11' },
        caption: { type: 'string', maxLength: 500 },
      },
    },
  })
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Upload a whiteboard note',
    description:
      '1-5 jpg/png/webp images of at most 5 MB each. The date must not be in the future (Asia/Jakarta). Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  async create(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: CreateWhiteboardDto,
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_WHITEBOARD_FILE_SIZE }),
          new FileTypeValidator({ fileType: IMAGE_TYPE_PATTERN }),
        ],
      }),
    )
    files: UploadedImageFile[],
    @CurrentUser('id') userId: string,
  ) {
    const note = await this.whiteboardsService.create(
      classId,
      userId,
      dto,
      files,
    );
    return new MessageResponse(note, 'Whiteboard note uploaded');
  }

  @Get()
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] List whiteboard notes',
    description:
      'Newest first, filtered by subject and by date or date range. Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  async findAll(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query() query: QueryWhiteboardDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.whiteboardsService.findAll(
      classId,
      userId,
      query,
    );
    return new Paginated(result.data, result.meta);
  }

  @Get(':whiteboardId')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Get a whiteboard note',
    description:
      'Includes the note images. Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  findOne(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('whiteboardId', ParseUUIDPipe) whiteboardId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.whiteboardsService.findOne(classId, whiteboardId, userId);
  }

  @Patch(':whiteboardId')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Update a whiteboard note',
    description:
      'Only the uploader may edit the caption, subject or date (checked in the service). A new date must not be in the future.',
  })
  async update(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('whiteboardId', ParseUUIDPipe) whiteboardId: string,
    @Body() dto: UpdateWhiteboardDto,
    @CurrentUser('id') userId: string,
  ) {
    const note = await this.whiteboardsService.update(
      classId,
      whiteboardId,
      userId,
      dto,
    );
    return new MessageResponse(note, 'Whiteboard note updated');
  }

  @Delete(':whiteboardId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Delete a whiteboard note',
    description:
      'Soft delete plus asynchronous Cloudinary cleanup. Allowed for the uploader, any KETUA, or the homeroom teacher (checked in the service).',
  })
  async remove(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('whiteboardId', ParseUUIDPipe) whiteboardId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.whiteboardsService.remove(classId, whiteboardId, userId);
    return new MessageResponse(null, 'Whiteboard note deleted');
  }
}
