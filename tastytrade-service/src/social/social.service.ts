import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialMentionEntity } from './social-mention.entity';
import { StockTwitsClient, StockTwitsMessage } from './stocktwits.client';
import { ContentStatus, MatchType, SourceType } from './social.types';

const SOURCE = 'stocktwits';

export interface IngestSummary {
  source: string;
  symbols: string[];
  messagesScanned: number;
  mentionsUpserted: number;
  distinctSymbols: number;
  errors: { symbol: string; error: string }[];
}

export interface TrendingRow {
  symbol: string;
  mentions: number;
  distinctAuthors: number;
  totalLikes: number;
  bullish: number;
  bearish: number;
  /** bullish − bearish (crowd lean; retail skews bullish, so treat relatively). */
  netSentiment: number;
}

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);
  private readonly defaultSymbols: string[];

  constructor(
    @InjectRepository(SocialMentionEntity)
    private readonly mentions: Repository<SocialMentionEntity>,
    private readonly stocktwits: StockTwitsClient,
    private readonly config: ConfigService,
  ) {
    this.defaultSymbols = (this.config.get<string>('SOCIAL_SYMBOLS') ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  /**
   * Pull StockTwits messages (with Bullish/Bearish tags) for a set of symbols and
   * upsert one mention row per message. With no symbols given, uses the current
   * StockTwits trending list (equities only). Re-ingesting a seen message just
   * refreshes its likes/sentiment.
   */
  async ingest(opts?: {
    symbols?: string[];
    limit?: number;
  }): Promise<IngestSummary> {
    let symbols = opts?.symbols?.length
      ? opts.symbols.map((s) => s.toUpperCase())
      : this.defaultSymbols;
    if (!symbols.length) {
      try {
        symbols = await this.stocktwits.getTrendingSymbols();
      } catch (err) {
        return {
          source: SOURCE,
          symbols: [],
          messagesScanned: 0,
          mentionsUpserted: 0,
          distinctSymbols: 0,
          errors: [{ symbol: '(trending)', error: errMsg(err) }],
        };
      }
    }

    const perSymbol = opts?.limit ?? 30;
    let messagesScanned = 0;
    let mentionsUpserted = 0;
    const seen = new Set<string>();
    const errors: { symbol: string; error: string }[] = [];

    for (const symbol of symbols) {
      let msgs: StockTwitsMessage[] = [];
      try {
        msgs = await this.stocktwits.getSymbolStream(symbol, perSymbol);
      } catch (err) {
        errors.push({ symbol, error: errMsg(err) });
        continue;
      }
      messagesScanned += msgs.length;
      for (const m of msgs) {
        await this.upsertMention(symbol, m);
        mentionsUpserted += 1;
        seen.add(symbol);
      }
    }

    this.logger.log(
      `Ingest (stocktwits): ${symbols.length} symbols → ${messagesScanned} ` +
        `messages, ${mentionsUpserted} mentions`,
    );
    return {
      source: SOURCE,
      symbols,
      messagesScanned,
      mentionsUpserted,
      distinctSymbols: seen.size,
      errors,
    };
  }

  private async upsertMention(
    symbol: string,
    m: StockTwitsMessage,
  ): Promise<void> {
    const now = new Date();
    const sourceId = `st_${m.id}`;
    const existing = await this.mentions.findOne({
      where: { symbol, sourceId },
    });
    if (existing) {
      existing.upvotes = m.likes;
      existing.sentiment = m.sentiment;
      existing.lastCheckedAt = now;
      await this.mentions.save(existing);
      return;
    }
    await this.mentions.save(
      this.mentions.create({
        symbol,
        source: SOURCE,
        sourceType: SourceType.POST,
        sourceId,
        matchType: MatchType.CASHTAG, // StockTwits symbols are explicit
        author: m.username,
        upvotes: m.likes, // engagement (likes)
        permalink: null,
        title: null,
        bodyText: m.body || null,
        sentiment: m.sentiment,
        contentStatus: ContentStatus.LIVE,
        createdUtc: m.createdAt ? new Date(m.createdAt) : null,
        sampledAt: now,
        lastCheckedAt: now,
      }),
    );
  }

  /** List raw mentions, newest first. */
  async findMentions(filters?: {
    symbol?: string;
    source?: string;
    limit?: number;
  }): Promise<SocialMentionEntity[]> {
    const where: Record<string, unknown> = {};
    if (filters?.symbol) where.symbol = filters.symbol.toUpperCase();
    if (filters?.source) where.source = filters.source;
    return this.mentions.find({
      where,
      order: { sampledAt: 'DESC' },
      take: Math.min(filters?.limit ?? 100, 500),
    });
  }

  /**
   * Rank symbols by attention over a rolling window, with the crowd's bull/bear
   * lean. Ordered by mention volume; net sentiment is the directional read.
   */
  async trending(windowHours = 24, limit = 25): Promise<TrendingRow[]> {
    const since = new Date(Date.now() - windowHours * 3600_000);
    const rows = await this.mentions
      .createQueryBuilder('m')
      .select('m.symbol', 'symbol')
      .addSelect('COUNT(*)', 'mentions')
      .addSelect('COUNT(DISTINCT m.author)', 'distinctAuthors')
      .addSelect('COALESCE(SUM(m.upvotes), 0)', 'totalLikes')
      .addSelect(`COUNT(*) FILTER (WHERE m.sentiment = 'Bullish')`, 'bullish')
      .addSelect(`COUNT(*) FILTER (WHERE m.sentiment = 'Bearish')`, 'bearish')
      .where('m.sampledAt >= :since', { since })
      .andWhere('m.contentStatus = :live', { live: ContentStatus.LIVE })
      .groupBy('m.symbol')
      .orderBy('"mentions"', 'DESC')
      .addOrderBy('"distinctAuthors"', 'DESC')
      .limit(Math.min(limit, 200))
      .getRawMany();

    return rows.map((r) => {
      const bullish = Number(r.bullish);
      const bearish = Number(r.bearish);
      return {
        symbol: r.symbol,
        mentions: Number(r.mentions),
        distinctAuthors: Number(r.distinctAuthors),
        totalLikes: Number(r.totalLikes),
        bullish,
        bearish,
        netSentiment: bullish - bearish,
      };
    });
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
