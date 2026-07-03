import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RiskManagementService } from './risk-management.service';
import { RiskConfigData, UpdateRiskConfigDto } from './risk-config.types';

@ApiTags('Risk Management')
@Controller('risk')
export class RiskManagementController {
  constructor(private readonly riskService: RiskManagementService) {}

  @Get('config')
  @ApiOperation({ summary: 'Get current risk configuration' })
  async getConfig(): Promise<RiskConfigData> {
    return this.riskService.getConfig();
  }

  @Patch('config')
  @ApiOperation({ summary: 'Update risk configuration (partial merge)' })
  @ApiBody({ type: UpdateRiskConfigDto })
  async updateConfig(@Body() updates: UpdateRiskConfigDto): Promise<RiskConfigData> {
    return this.riskService.updateConfig(updates);
  }

  @Post('config/reset')
  @ApiOperation({ summary: 'Reset risk configuration to defaults' })
  async resetConfig(): Promise<RiskConfigData> {
    return this.riskService.resetConfig();
  }
}
