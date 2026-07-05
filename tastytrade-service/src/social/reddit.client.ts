import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** A Reddit post ("t3") listing child, trimmed to what we use. */
export interface RedditPost {
  fullname: string; // e.g. t3_abc123
  id: string;
  subreddit: string;
  author: string;
  title: string;
  selftext: string;
  score: number;
  permalink: string;
  createdUtc: number; // epoch seconds
  removedOrDeleted: boolean;
}

/**
 * Reddit read-only client with two transports:
 *
 *  - **public** (default): unauthenticated `.json` endpoints (append `.json` to
 *    any public URL). No credentials, no approval — the viable path since Reddit
 *    killed self-service API keys in Nov 2025 ("Responsible Builder Policy").
 *    Rate-limited (~10 req/min), so we throttle. Fine for a personal, low-volume,
 *    non-commercial scanner.
 *  - **oauth**: used automatically IF `REDDIT_CLIENT_ID`/`REDDIT_SECRET` are set
 *    (i.e. you got an approved app). Higher limits; same interface.
 *
 * See docs/ideas-backlog.md for the policy background.
 */
@Injectable()
export class RedditClient {
  private readonly logger = new Logger(RedditClient.name);
  private readonly clientId?: string;
  private readonly secret?: string;
  private readonly userAgent: string;
  private readonly useOAuth: boolean;
  private readonly requestDelayMs: number;

  private token: string | null = null;
  private tokenExpiresAt = 0; // epoch ms
  private lastRequestAt = 0; // epoch ms (throttle)

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('REDDIT_CLIENT_ID');
    this.secret = this.config.get<string>('REDDIT_SECRET');
    this.userAgent = this.config.get<string>(
      'REDDIT_USER_AGENT',
      'nestjs:osaitrader-social:v0.1 (by /u/unknown)',
    );
    this.useOAuth = Boolean(this.clientId && this.secret);
    // Public endpoints ~10 req/min → default ~2s gap; OAuth is far higher.
    this.requestDelayMs = parseInt(
      this.config.get<string>(
        'SOCIAL_REQUEST_DELAY_MS',
        this.useOAuth ? '400' : '2000',
      ),
      10,
    );
  }

  /** Which transport is active. */
  mode(): 'oauth' | 'public' {
    return this.useOAuth ? 'oauth' : 'public';
  }

  /** Reddit is always reachable now — public mode needs no credentials. */
  isAvailable(): boolean {
    return true;
  }

  /** Space requests out to respect rate limits (esp. public mode). */
  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.requestDelayMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  /** OAuth-mode only: cached app-only bearer token. */
  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }
    const basic = Buffer.from(`${this.clientId}:${this.secret}`).toString(
      'base64',
    );
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(
        `Reddit token request failed (${res.status}): ${detail.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = json.access_token;
    this.tokenExpiresAt = Date.now() + json.expires_in * 1000;
    this.logger.log('Obtained Reddit app-only token (oauth mode)');
    return this.token;
  }

  /** Throttled GET returning parsed JSON; adds auth header in OAuth mode. */
  private async requestJson(url: string): Promise<any> {
    await this.throttle();
    const headers: Record<string, string> = { 'User-Agent': this.userAgent };
    if (this.useOAuth) headers.Authorization = `Bearer ${await this.getToken()}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const detail = await res.text();
      const hint =
        res.status === 429
          ? ' (rate-limited — raise SOCIAL_REQUEST_DELAY_MS)'
          : '';
      throw new Error(
        `Reddit GET failed (${res.status})${hint}: ${detail.slice(0, 200)}`,
      );
    }
    return res.json();
  }

  private static bodyIsGone(text: string | undefined | null): boolean {
    return text === '[deleted]' || text === '[removed]';
  }

  private mapChild(child: any): RedditPost {
    const d = child?.data ?? {};
    return {
      fullname: d.name ?? `t3_${d.id}`,
      id: d.id,
      subreddit: d.subreddit,
      author: d.author,
      title: d.title ?? '',
      selftext: d.selftext ?? '',
      score: typeof d.score === 'number' ? d.score : 0,
      permalink: d.permalink ?? '',
      createdUtc: d.created_utc ?? 0,
      removedOrDeleted:
        d.author === '[deleted]' ||
        RedditClient.bodyIsGone(d.selftext) ||
        Boolean(d.removed_by_category),
    };
  }

  /** Fetch posts from a subreddit listing ('hot' | 'new' | 'rising' | 'top'). */
  async getSubredditPosts(
    subreddit: string,
    sort: 'hot' | 'new' | 'rising' | 'top' = 'hot',
    limit = 50,
  ): Promise<RedditPost[]> {
    const capped = Math.min(Math.max(limit, 1), 100); // Reddit max 100/listing
    const url = this.useOAuth
      ? `https://oauth.reddit.com/r/${subreddit}/${sort}?limit=${capped}&raw_json=1`
      : `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${capped}&raw_json=1`;
    const json = await this.requestJson(url);
    const children = json?.data?.children ?? [];
    return children
      .filter((c: any) => c?.kind === 't3')
      .map((c: any) => this.mapChild(c));
  }

  /**
   * Batch-look up post fullnames for the deletion audit (max 100/call).
   * OAuth mode uses /api/info; public mode uses the /by_id/{names}.json listing.
   * Returns fullname → { gone, post }. (Posts only — t3_; comments come later.)
   */
  async getInfo(
    fullnames: string[],
  ): Promise<Record<string, { gone: boolean; post: RedditPost | null }>> {
    const out: Record<string, { gone: boolean; post: RedditPost | null }> = {};
    if (!fullnames.length) return out;

    for (let i = 0; i < fullnames.length; i += 100) {
      const batch = fullnames.slice(i, i + 100);
      const url = this.useOAuth
        ? `https://oauth.reddit.com/api/info?id=${batch.join(',')}`
        : `https://www.reddit.com/by_id/${batch.join(',')}.json?raw_json=1`;
      const json = await this.requestJson(url);
      const children = json?.data?.children ?? [];
      const seen = new Set<string>();
      for (const c of children) {
        const post = this.mapChild(c);
        seen.add(post.fullname);
        out[post.fullname] = { gone: post.removedOrDeleted, post };
      }
      // Fullnames Reddit didn't return at all are treated as gone.
      for (const fn of batch) {
        if (!seen.has(fn)) out[fn] = { gone: true, post: null };
      }
    }
    return out;
  }
}
