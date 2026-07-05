/** Shared enums for the social-sentiment scanner (Reddit ingestion). */

/** Where a mention came from within Reddit. */
export enum SourceType {
  POST = 'post',
  COMMENT = 'comment', // Phase A ingests posts; comments are a later extension.
}

/** How the ticker was recognized in the text — cashtags are high-confidence. */
export enum MatchType {
  CASHTAG = 'cashtag', // "$SPY" — self-disambiguating, trusted
  BARE = 'bare', // "SPY" — validated against a stoplist (noisier)
}

/**
 * Deletion state of the source content. We retain body text for `live` rows;
 * the deletion-audit job flips these and purges text when Reddit reports the
 * content gone (ToS compliance — see docs/ideas-backlog.md).
 */
export enum ContentStatus {
  LIVE = 'live',
  DELETED = 'deleted', // user deleted ("[deleted]")
  REMOVED = 'removed', // mod/admin removed ("[removed]")
}
