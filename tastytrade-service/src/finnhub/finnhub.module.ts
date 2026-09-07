import { Module } from '@nestjs/common';
import { FinnhubClient } from './finnhub.client';
import { FinnhubController } from './finnhub.controller';

/**
 * Finnhub — earnings calendar (the pre-market hard exclusion) and, later, news
 * headlines for the morning brief. See docs/data-sources.md.
 */
@Module({
  controllers: [FinnhubController],
  providers: [FinnhubClient],
  exports: [FinnhubClient],
})
export class FinnhubModule {}
