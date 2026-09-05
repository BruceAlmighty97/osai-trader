import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  /** Unauthenticated liveness check (for load balancers / uptime probes). */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness check (no auth required)' })
  check(): { status: string } {
    return { status: 'ok' };
  }
}
