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
import { CreateSubjectDto } from './dto/create-subject.dto';
import { QuerySubjectDto } from './dto/query-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { SubjectsService } from './subjects.service';

@ApiTags('Subjects')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('WALI_KELAS', 'MURID')
@Controller('classrooms/:classId/subjects')
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Post()
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Create a subject',
    description:
      'The homeroom teacher of this class or an active KETUA (checked in the service).',
  })
  async create(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: CreateSubjectDto,
    @CurrentUser('id') userId: string,
  ) {
    const subject = await this.subjectsService.create(classId, userId, dto);
    return new MessageResponse(subject, 'Subject created');
  }

  @Get()
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] List subjects',
    description:
      'Includes soft-deleted subjects for history views. Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  async findAll(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query() query: QuerySubjectDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.subjectsService.findAll(classId, userId, query);
    return new Paginated(result.data, result.meta);
  }

  @Patch(':subjectId')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Update a subject',
    description:
      'The homeroom teacher of this class or an active KETUA (checked in the service).',
  })
  async update(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() dto: UpdateSubjectDto,
    @CurrentUser('id') userId: string,
  ) {
    const subject = await this.subjectsService.update(
      classId,
      subjectId,
      userId,
      dto,
    );
    return new MessageResponse(subject, 'Subject updated');
  }

  @Delete(':subjectId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Delete a subject',
    description:
      'Soft delete, so schedules and whiteboards keep their history. The homeroom teacher of this class or an active KETUA (checked in the service).',
  })
  async remove(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.subjectsService.remove(classId, subjectId, userId);
    return new MessageResponse(null, 'Subject deleted');
  }
}
