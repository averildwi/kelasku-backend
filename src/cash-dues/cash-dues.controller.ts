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
import { CashDuesService } from './cash-dues.service';
import { CreateCashDueDto } from './dto/create-due.dto';
import { QueryCashDueDto } from './dto/query-due.dto';

const CREATE_THROTTLE = { default: { limit: 6, ttl: 60_000 } };

@ApiTags('CashDues')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('WALI_KELAS', 'MURID')
@Controller('classrooms/:classId/cash')
export class CashDuesController {
  constructor(private readonly cashDuesService: CashDuesService) {}

  @Post('dues')
  @Throttle(CREATE_THROTTLE)
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Create a cash due',
    description:
      'Snapshots an UNPAID row for every currently-active member in one transaction. Only the class treasurer may write (checked in the service).',
  })
  async create(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: CreateCashDueDto,
    @CurrentUser('id') userId: string,
  ) {
    const due = await this.cashDuesService.create(classId, userId, dto);
    return new MessageResponse(due, 'Cash due created');
  }

  @Get('dues')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] List cash dues',
    description:
      'Newest first, each with its paid/unpaid snapshot counts. Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  async findAll(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query() query: QueryCashDueDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.cashDuesService.findAll(classId, userId, query);
    return new Paginated(result.data, result.meta);
  }

  @Get('dues/:dueId')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Get a cash due',
    description:
      'Per-member payments; an active member without a snapshot row appears as computed UNPAID. Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  findOne(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('dueId', ParseUUIDPipe) dueId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.cashDuesService.findOne(classId, dueId, userId);
  }

  @Delete('dues/:dueId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Delete a cash due',
    description:
      'Only before any payment is marked, 409 otherwise. Only the class treasurer may write (checked in the service).',
  })
  async remove(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('dueId', ParseUUIDPipe) dueId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.cashDuesService.remove(classId, dueId, userId);
    return new MessageResponse(null, 'Cash due deleted');
  }

  @Post('dues/:dueId/payments/:memberId/pay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Mark a due payment as paid',
    description:
      'Records who/when and creates a linked INCOME transaction in one transaction; 409 when already paid. Only the class treasurer may write (checked in the service).',
  })
  async pay(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('dueId', ParseUUIDPipe) dueId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser('id') userId: string,
  ) {
    const payment = await this.cashDuesService.pay(
      classId,
      dueId,
      memberId,
      userId,
    );
    return new MessageResponse(payment, 'Cash due payment recorded');
  }

  @Post('dues/:dueId/payments/:memberId/unpay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Revert a due payment to unpaid',
    description:
      'Clears the payment and voids its linked transaction with reason "payment reverted"; 409 when not marked paid. Only the class treasurer may write (checked in the service).',
  })
  async unpay(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('dueId', ParseUUIDPipe) dueId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser('id') userId: string,
  ) {
    const payment = await this.cashDuesService.unpay(
      classId,
      dueId,
      memberId,
      userId,
    );
    return new MessageResponse(payment, 'Cash due payment reverted');
  }

  @Get('members/:memberId')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Get one member dues and outstanding',
    description:
      'A MEMBER sees only their own membership; the homeroom teacher, KETUA and BENDAHARA see anyone (checked in the service).',
  })
  memberDetail(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.cashDuesService.memberDetail(classId, memberId, userId);
  }
}
