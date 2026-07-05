import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { ContentStatus, MatchType, SourceType } from './social.types';

/**
 * One row per (symbol, source) mention extracted from Reddit — the audit trail
 * behind trending detection. We keep full `title`/`bodyText` for live content;
 * the deletion-audit job purges + tombstones rows when Reddit reports the source
 * deleted/removed. The unique (symbol, sourceId) pair lets re-polling upsert
 * rather than duplicate. See docs/ideas-backlog.md (social-sentiment design).
 */
@Entity('social_mentions')
@Unique('UQ_social_symbol_source', ['symbol', 'sourceId'])
export class SocialMentionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Ticker mentioned, e.g. SPY (upper-cased). */
  @Index()
  @Column()
  symbol: string;

  @Index()
  @Column()
  subreddit: string;

  @Column({ type: 'varchar', default: SourceType.POST })
  sourceType: SourceType;

  /** Reddit fullname, e.g. `t3_abc123` (post) or `t1_...` (comment). */
  @Column()
  sourceId: string;

  @Column({ type: 'varchar', default: MatchType.CASHTAG })
  matchType: MatchType;

  @Column({ type: 'varchar', nullable: true })
  author: string | null;

  /** Reddit score (upvotes − downvotes) at sample time. */
  @Column({ type: 'integer', default: 0 })
  upvotes: number;

  @Column({ type: 'varchar', nullable: true })
  permalink: string | null;

  /** Post title (retained; purged on deletion). */
  @Column({ type: 'text', nullable: true })
  title: string | null;

  /** Post/comment body (retained; purged on deletion). */
  @Column({ type: 'text', nullable: true })
  bodyText: string | null;

  /** Optional sentiment tag — populated by the Phase C LLM pass. */
  @Column({ type: 'varchar', nullable: true })
  sentiment: string | null;

  @Index()
  @Column({ type: 'varchar', default: ContentStatus.LIVE })
  contentStatus: ContentStatus;

  /** When the source was created on Reddit. */
  @Column({ type: 'timestamptz', nullable: true })
  createdUtc: Date | null;

  /** When we first ingested this mention. */
  @Column({ type: 'timestamptz' })
  sampledAt: Date;

  /** Last time the deletion-audit job checked this row against Reddit. */
  @Column({ type: 'timestamptz', nullable: true })
  lastCheckedAt: Date | null;

  /** When the source was found deleted/removed (text purged at that point). */
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
