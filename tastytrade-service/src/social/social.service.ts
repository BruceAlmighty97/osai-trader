import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { SocialMentionEntity } from './social-mention.entity';
import { RedditClient, RedditPost } from './reddit.client';
import { extractTickers } from './ticker-extractor';
import { ContentStatus, MatchType, SourceType } from './social.types';

export interface IngestSummary {
  mode: 'oauth' | 'public';
  subreddits: string[];
  postsScanned: number;
  mentionsUpserted: number;
  distinctSymbols: number;
  errors: { subreddit: string; error: string }[];
}

export interface TrendingRow {
  symbol: string;
  mentions: number;
  distinctAuthors: number;
  totalUpvotes: number;
  cashtagMentions: number;
  subreddits: number;
}

export interface AuditSummary {
  checked: number;
  deleted: number;
  removed: number;
  stillLive: number;
}

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);
  private readonly defaultSubreddits: string[];

  constructor(
    @InjectRepository(SocialMentionEntity)
    private readonly mentions: Repository<SocialMentionEntity>,
    private readonly reddit: RedditClient,
    private readonly config: ConfigService,
  ) {
    this.defaultSubreddits = (
      this.config.get<string>('SOCIAL_SUBREDDITS') ??
      'options,thetagang,wallstreetbets,optionswheel'
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * Poll the configured subreddits, extract tickers from each post, and upsert
   * a mention row per (symbol, post). Re-polling an already-seen post refreshes
   * its upvotes/lastCheckedAt instead of duplicating.
   */
  async ingest(opts?: {
    subreddits?: string[];
    sort?: 'hot' | 'new' | 'rising' | 'top';
    limit?: number;
  }): Promise<IngestSummary> {
    const subreddits = opts?.subreddits?.length
      ? opts.subreddits
      : this.defaultSubreddits;
    const sort = opts?.sort ?? 'hot';
    const limit = opts?.limit ?? 50;

    let postsScanned = 0;
    let mentionsUpserted = 0;
    const symbols = new Set<string>();
    const errors: { subreddit: string; error: string }[] = [];

    for (const sub of subreddits) {
      let posts: RedditPost[] = [];
      try {
        posts = await this.reddit.getSubredditPosts(sub, sort, limit);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to fetch r/${sub}: ${msg}`);
        errors.push({ subreddit: sub, error: msg });
        continue;
      }
      postsScanned += posts.length;

      for (const post of posts) {
        if (post.removedOrDeleted) continue; // nothing to attribute
        const tickers = extractTickers(post.title, post.selftext);
        for (const t of tickers) {
          symbols.add(t.symbol);
          await this.upsertMention(sub, post, t.symbol, t.matchType);
          mentionsUpserted += 1;
        }
      }
    }

    this.logger.log(
      `Ingest (${this.reddit.mode()}): ${postsScanned} posts across ` +
        `${subreddits.length} subs → ${mentionsUpserted} mentions, ` +
        `${symbols.size} symbols`,
    );
    return {
      mode: this.reddit.mode(),
      subreddits,
      postsScanned,
      mentionsUpserted,
      distinctSymbols: symbols.size,
      errors,
    };
  }

  private async upsertMention(
    subreddit: string,
    post: RedditPost,
    symbol: string,
    matchType: MatchType,
  ): Promise<void> {
    const now = new Date();
    const existing = await this.mentions.findOne({
      where: { symbol, sourceId: post.fullname },
    });
    if (existing) {
      existing.upvotes = post.score;
      existing.lastCheckedAt = now;
      // A previously-seen post could have been edited to a cashtag — upgrade.
      if (matchType === MatchType.CASHTAG) existing.matchType = matchType;
      await this.mentions.save(existing);
      return;
    }
    await this.mentions.save(
      this.mentions.create({
        symbol,
        subreddit,
        sourceType: SourceType.POST,
        sourceId: post.fullname,
        matchType,
        author: post.author ?? null,
        upvotes: post.score,
        permalink: post.permalink || null,
        title: post.title || null,
        bodyText: post.selftext || null,
        contentStatus: ContentStatus.LIVE,
        createdUtc: post.createdUtc ? new Date(post.createdUtc * 1000) : null,
        sampledAt: now,
        lastCheckedAt: now,
      }),
    );
  }

  /** List raw mentions, newest first. */
  async findMentions(filters?: {
    symbol?: string;
    subreddit?: string;
    limit?: number;
  }): Promise<SocialMentionEntity[]> {
    const where: Record<string, unknown> = {};
    if (filters?.symbol) where.symbol = filters.symbol.toUpperCase();
    if (filters?.subreddit) where.subreddit = filters.subreddit;
    return this.mentions.find({
      where,
      order: { sampledAt: 'DESC' },
      take: Math.min(filters?.limit ?? 100, 500),
    });
  }

  /**
   * Rank symbols by attention over a rolling window. Phase A scoring is simple —
   * distinct authors + mention count (spike/z-score detection is Phase B). Only
   * live content is counted.
   */
  async trending(windowHours = 24, limit = 25): Promise<TrendingRow[]> {
    const since = new Date(Date.now() - windowHours * 3600_000);
    const rows = await this.mentions
      .createQueryBuilder('m')
      .select('m.symbol', 'symbol')
      .addSelect('COUNT(*)', 'mentions')
      .addSelect('COUNT(DISTINCT m.author)', 'distinctAuthors')
      .addSelect('COALESCE(SUM(m.upvotes), 0)', 'totalUpvotes')
      .addSelect(
        `COUNT(*) FILTER (WHERE m.matchType = :cashtag)`,
        'cashtagMentions',
      )
      .addSelect('COUNT(DISTINCT m.subreddit)', 'subreddits')
      .where('m.sampledAt >= :since', { since })
      .andWhere('m.contentStatus = :live', { live: ContentStatus.LIVE })
      .setParameter('cashtag', MatchType.CASHTAG)
      .groupBy('m.symbol')
      .orderBy('"distinctAuthors"', 'DESC')
      .addOrderBy('"mentions"', 'DESC')
      .limit(Math.min(limit, 200))
      .getRawMany();

    return rows.map((r) => ({
      symbol: r.symbol,
      mentions: Number(r.mentions),
      distinctAuthors: Number(r.distinctAuthors),
      totalUpvotes: Number(r.totalUpvotes),
      cashtagMentions: Number(r.cashtagMentions),
      subreddits: Number(r.subreddits),
    }));
  }

  /**
   * Deletion-compliance audit: re-check the least-recently-verified live rows
   * against Reddit and purge/tombstone any whose source is gone. Reddit emits no
   * deletion events, so this poll is the only mechanism (see docs/ideas-backlog.md).
   */
  async auditDeletions(limit = 300): Promise<AuditSummary> {
    const rows = await this.mentions.find({
      where: { contentStatus: ContentStatus.LIVE },
      order: { lastCheckedAt: 'ASC' },
      take: Math.min(limit, 1000),
    });
    if (!rows.length) return { checked: 0, deleted: 0, removed: 0, stillLive: 0 };

    const fullnames = [...new Set(rows.map((r) => r.sourceId))];
    const info = await this.reddit.getInfo(fullnames);
    const now = new Date();

    let deleted = 0;
    let removed = 0;
    let stillLive = 0;

    for (const row of rows) {
      const result = info[row.sourceId];
      row.lastCheckedAt = now;

      if (result && !result.gone) {
        if (result.post) row.upvotes = result.post.score; // refresh while here
        stillLive += 1;
        await this.mentions.save(row);
        continue;
      }

      // Gone: distinguish user-delete vs mod-remove when we can tell.
      const removedByMod = Boolean(result?.post?.removedOrDeleted) &&
        result?.post?.author !== '[deleted]';
      row.contentStatus = removedByMod
        ? ContentStatus.REMOVED
        : ContentStatus.DELETED;
      row.deletedAt = now;
      row.title = null; // purge retained text
      row.bodyText = null;
      if (removedByMod) removed += 1;
      else deleted += 1;
      await this.mentions.save(row);
    }

    this.logger.log(
      `Audit: checked ${rows.length} → ${deleted} deleted, ${removed} removed, ` +
        `${stillLive} live`,
    );
    return { checked: rows.length, deleted, removed, stillLive };
  }

  /** Purge tombstoned rows older than N days (optional housekeeping). */
  async purgeOldTombstones(olderThanDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86400_000);
    const res = await this.mentions.delete({
      contentStatus: ContentStatus.DELETED,
      deletedAt: LessThan(cutoff),
    });
    return res.affected ?? 0;
  }
}
