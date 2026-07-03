import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IbkrService } from './ibkr.service';

@ApiTags('IBKR')
@Controller('ibkr')
export class IbkrController {
  constructor(private readonly ibkrService: IbkrService) {}

  @Get('account-summary')
  @ApiOperation({ summary: 'Get account cash summary from IBKR' })
  async getAccountSummary() {
    return this.ibkrService.getAccountSummary();
  }

  @Get('status')
  @ApiOperation({ summary: 'Get IBKR connection status' })
  getStatus() {
    return {
      connected: this.ibkrService.isConnected(),
      state: this.ibkrService.getConnectionState(),
    };
  }
}
