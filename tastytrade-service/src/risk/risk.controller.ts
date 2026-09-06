import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RiskService } from './risk.service';
import { RiskRules, UpdateRulesDto } from './risk.types';

/**
 * The account-agnostic risk policy. Governs the paper account now and the live
 * account later. See docs/risk-management.md.
 */
@ApiTags('risk')
@Controller('risk')
export class RiskController {
  constructor(private readonly risk: RiskService) {}

  @Get('config')
  @ApiOperation({ summary: 'Get the active risk rules' })
  get(): Promise<RiskRules> {
    return this.risk.getRules();
  }

  @Patch('config')
  @ApiOperation({ summary: 'Update risk rules (any subset)' })
  update(@Body() dto: UpdateRulesDto): Promise<RiskRules> {
    return this.risk.updateRules(dto);
  }
}
