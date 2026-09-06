import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';

/** The trading-day scheduler/dispatcher (in-process, via @nestjs/schedule). */
@Module({
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
