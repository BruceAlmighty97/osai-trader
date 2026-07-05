import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PositionsService } from './positions.service';
import { RecordPositionDto } from './dto/record-position.dto';
import { ClosePositionDto } from './dto/close-position.dto';
import { PositionEntity } from './entities/position.entity';
import { PositionStatus } from './persistence.types';

@ApiTags('positions')
@Controller('positions')
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  /**
   * Record an open position by hand. Until execution is built, this is how we
   * seed holdings so the management loop has real DB rows to work against.
   */
  @Post()
  @ApiOperation({ summary: 'Record an open position (manual write path)' })
  record(@Body() dto: RecordPositionDto): Promise<PositionEntity> {
    return this.positions.record(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List positions (optionally filter by status)' })
  @ApiQuery({ name: 'status', required: false, enum: PositionStatus })
  findAll(@Query('status') status?: PositionStatus): Promise<PositionEntity[]> {
    return this.positions.findAll(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one position by id' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<PositionEntity> {
    return this.positions.findOne(id);
  }

  @Patch(':id/close')
  @ApiOperation({ summary: 'Close a position (mark closed + record outcome)' })
  close(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ClosePositionDto,
  ): Promise<PositionEntity> {
    return this.positions.close(id, dto);
  }
}
