import { Injectable } from '@nestjs/common';

export interface EtParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: number; // 0=Sun .. 6=Sat
  hour: number; // 0-23 (ET)
  minute: number;
}

/**
 * NYSE trading calendar, computed (no dependency, never goes stale). Handles
 * full-day holidays (incl. Good Friday + weekend-observed shifts) and the three
 * 1pm early-close half-days. Verified against NYSE's official 2025-2027 calendar
 * (see market-calendar.spec-style check in git history / CI).
 *
 * Rare one-off closures (national days of mourning) aren't algorithmic — add them
 * to SPECIAL_CLOSURES as ISO dates when announced.
 */
@Injectable()
export class MarketCalendarService {
  /** One-off full closures not covered by the rules, as 'YYYY-MM-DD'. */
  private static readonly SPECIAL_CLOSURES = new Set<string>([
    // e.g. '2025-01-09' (Jimmy Carter national day of mourning)
  ]);

  private readonly holidayCache = new Map<number, Set<string>>();

  /** Wall-clock parts in America/New_York (DST-correct via Intl). */
  etParts(date: Date = new Date()): EtParts {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
    const year = +p.year;
    const month = +p.month;
    const day = +p.day;
    let hour = +p.hour;
    if (hour === 24) hour = 0; // some engines emit '24' for midnight
    const minute = +p.minute;
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return { year, month, day, weekday, hour, minute };
  }

  /** Is the NYSE open at all on this ET date (not weekend, not a holiday)? */
  isTradingDay(date: Date = new Date()): boolean {
    const { year, month, day, weekday } = this.etParts(date);
    if (weekday === 0 || weekday === 6) return false; // Sun / Sat
    const iso = isoDate(year, month, day);
    if (MarketCalendarService.SPECIAL_CLOSURES.has(iso)) return false;
    return !this.holidays(year).has(iso);
  }

  /** Is this a 1pm early-close half-day (July 3 / day-after-Thanksgiving / Dec 24)? */
  isEarlyClose(date: Date = new Date()): boolean {
    if (!this.isTradingDay(date)) return false; // a full holiday isn't "early close"
    const { year, month, day } = this.etParts(date);
    return this.earlyCloses(year).has(isoDate(year, month, day));
  }

  /** Observed full-closure dates for a year, memoized. */
  private holidays(year: number): Set<string> {
    const cached = this.holidayCache.get(year);
    if (cached) return cached;

    const h = new Set<string>();
    const add = (m: number, d: number) => h.add(isoDate(year, m, d));

    // New Year's Day (Jan 1). Sun -> observed Mon; Sat -> NOT observed (NYSE rule).
    const nyDow = dow(year, 1, 1);
    if (nyDow === 0) add(1, 2);
    else if (nyDow !== 6) add(1, 1);

    add(1, nthWeekday(year, 1, 1, 3)); // MLK — 3rd Monday Jan
    add(2, nthWeekday(year, 2, 1, 3)); // Washington's Birthday — 3rd Monday Feb

    const gf = goodFriday(year); // Good Friday — 2 days before Easter
    add(gf.month, gf.day);

    add(5, lastWeekday(year, 5, 1)); // Memorial — last Monday May

    if (year >= 2022) observed(h, year, 6, 19); // Juneteenth (since 2022)
    observed(h, year, 7, 4); // Independence Day
    add(9, nthWeekday(year, 9, 1, 1)); // Labor — 1st Monday Sep
    add(11, nthWeekday(year, 11, 4, 4)); // Thanksgiving — 4th Thursday Nov
    observed(h, year, 12, 25); // Christmas

    this.holidayCache.set(year, h);
    return h;
  }

  /** Candidate early-close dates for a year (filtered to real trading days by caller). */
  private earlyCloses(year: number): Set<string> {
    const s = new Set<string>();
    s.add(isoDate(year, 7, 3)); // day before Independence Day
    s.add(isoDate(year, 12, 24)); // Christmas Eve
    const thanksgiving = nthWeekday(year, 11, 4, 4);
    s.add(isoDate(year, 11, thanksgiving + 1)); // day after Thanksgiving (Friday)
    return s;
  }
}

// --- date helpers (all pure) ---

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function dow(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The day-of-month for the nth given weekday (1=Mon..0=Sun) of a month. */
function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  const firstDow = dow(y, m, 1);
  const offset = (weekday - firstDow + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** The day-of-month for the last given weekday of a month. */
function lastWeekday(y: number, m: number, weekday: number): number {
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDow = dow(y, m, daysInMonth);
  const offset = (lastDow - weekday + 7) % 7;
  return daysInMonth - offset;
}

/** Add a fixed-date holiday with the Sat->Fri / Sun->Mon observed shift. */
function observed(set: Set<string>, y: number, m: number, d: number): void {
  const wd = dow(y, m, d);
  if (wd === 6) set.add(isoDate(y, m, d - 1)); // Sat -> Fri
  else if (wd === 0) set.add(isoDate(y, m, d + 1)); // Sun -> Mon
  else set.add(isoDate(y, m, d));
}

/** Good Friday = Easter Sunday - 2 (Anonymous Gregorian algorithm for Easter). */
function goodFriday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const hh = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - hh - k) % 7;
  const mm = Math.floor((a + 11 * hh + 22 * l) / 451);
  const month = Math.floor((hh + l - 7 * mm + 114) / 31); // 3=Mar, 4=Apr
  const day = ((hh + l - 7 * mm + 114) % 31) + 1;
  // subtract 2 days for Good Friday
  const easter = new Date(Date.UTC(year, month - 1, day));
  easter.setUTCDate(easter.getUTCDate() - 2);
  return { month: easter.getUTCMonth() + 1, day: easter.getUTCDate() };
}
