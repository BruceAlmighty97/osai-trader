/** Shared enums for the social-sentiment scanner (StockTwits ingestion). */

/** What kind of social item a mention came from. */
export enum SourceType {
  POST = 'post', // a StockTwits message (or Reddit post, historically)
  COMMENT = 'comment',
}

/** How the ticker was recognized. StockTwits attaches symbols explicitly. */
export enum MatchType {
  CASHTAG = 'cashtag', // explicit symbol tag — trusted
  BARE = 'bare', // inferred from free text (noisier)
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
