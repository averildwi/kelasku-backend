import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  MessageResponse,
  Paginated,
} from '../common/interceptors/transform.interceptor';
import { CreatePollDto } from './dto/create-poll.dto';
import { QueryPollDto } from './dto/query-poll.dto';
import { VoteDto } from './dto/vote.dto';
import { PollsService } from './polls.service';

const VOTE_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Polls')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('WALI_KELAS', 'MURID')
@Controller('classrooms/:classId/polls')
export class PollsController {
  constructor(private readonly pollsService: PollsService) {}

  @Post()
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Create a poll',
    description:
      'The homeroom teacher of this class or an active KETUA (checked in the service). 2 to 10 options; an optional future deadline.',
  })
  async create(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: CreatePollDto,
    @CurrentUser('id') userId: string,
  ) {
    const poll = await this.pollsService.create(classId, userId, dto);
    return new MessageResponse(poll, 'Poll created');
  }

  @Get()
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] List polls',
    description:
      'Newest first; filter by status=open|closed. Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  async findAll(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query() query: QueryPollDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.pollsService.findAll(classId, userId, query);
    return new Paginated(result.data, result.meta);
  }

  @Get(':pollId')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Get a poll with results',
    description:
      'Voter lists are hidden when the poll is anonymous. Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  findOne(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.pollsService.findOne(classId, pollId, userId);
  }

  @Post(':pollId/votes')
  @HttpCode(HttpStatus.OK)
  @Throttle(VOTE_THROTTLE)
  @Roles('MURID')
  @ApiOperation({
    summary: '[MURID] Vote or change my vote',
    description:
      "Replaces the caller's previous vote in one transaction. A closed poll answers 403; the homeroom teacher cannot vote (checked in the service).",
  })
  async vote(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @Body() dto: VoteDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.pollsService.vote(classId, pollId, userId, dto);
    return new MessageResponse(result, 'Vote recorded');
  }

  @Delete(':pollId/votes')
  @HttpCode(HttpStatus.OK)
  @Roles('MURID')
  @ApiOperation({
    summary: '[MURID] Withdraw my vote',
    description:
      'Only while the poll is open; 409 when the caller has not voted. The homeroom teacher cannot vote (checked in the service).',
  })
  async withdrawVote(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.pollsService.withdrawVote(
      classId,
      pollId,
      userId,
    );
    return new MessageResponse(result, 'Vote withdrawn');
  }

  @Post(':pollId/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Close a poll',
    description:
      'The creator or the homeroom teacher (checked in the service); 409 when the poll is already closed.',
  })
  async close(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.pollsService.close(classId, pollId, userId);
    return new MessageResponse(result, 'Poll closed');
  }

  @Delete(':pollId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Delete a poll',
    description:
      'Soft delete; the creator or the homeroom teacher (checked in the service).',
  })
  async remove(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.pollsService.remove(classId, pollId, userId);
    return new MessageResponse(null, 'Poll deleted');
  }
}
