import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Expand the watchlist from 8 ETFs to a full liquid-options universe (~68).
 *
 * Why: with only 8 symbols the daily quality filters (earnings / liquidity /
 * IV rank) left just 4-5 candidates — too thin to pick a genuinely good entry.
 * Measured against live data, this universe yields ~22 qualified at IVR>=30, so
 * the pool grows WITHOUT lowering the quality bar.
 *
 * Single stocks are only safe here because the earnings gate now works — a live
 * check excluded 15 of these for reporting within 45 days. They're stored with
 * correlationGroup NULL on purpose (see docs/trading-day.md): ETF groups are
 * ~0.95-correlated baskets, unrelated stocks are not, so the per-group cap
 * shouldn't apply to them.
 *
 * Broad indices share one bucket (interchangeable); sector ETFs get their own so
 * the gate doesn't collapse all equity exposure into a single slot.
 */
export class ExpandWatchlistUniverse1788660000000 implements MigrationInterface {
  name = 'ExpandWatchlistUniverse1788660000000';

  private static readonly ETFS: [string, string, string, number][] = [
    // symbol, description, correlationGroup, priority
    ['SPY', 'S&P 500', 'us_equity', 100],
    ['QQQ', 'Nasdaq 100', 'us_equity', 100],
    ['IWM', 'Russell 2000', 'us_equity', 95],
    ['DIA', 'Dow 30', 'us_equity', 90],
    ['EFA', 'Intl developed', 'intl_equity', 85],
    ['EEM', 'Emerging markets', 'intl_equity', 85],
    ['FXI', 'China large-cap', 'intl_equity', 75],
    ['EWZ', 'Brazil', 'intl_equity', 75],
    ['XLF', 'Financials', 'financials', 85],
    ['KRE', 'Regional banks', 'financials', 75],
    ['XLE', 'Energy', 'energy', 85],
    ['XOP', 'Oil & gas E&P', 'energy', 70],
    ['USO', 'Crude oil', 'energy', 65],
    ['XLK', 'Technology', 'tech', 85],
    ['SMH', 'Semiconductors', 'tech', 80],
    ['XLV', 'Healthcare', 'healthcare', 80],
    ['XBI', 'Biotech', 'healthcare', 70],
    ['XLI', 'Industrials', 'industrials', 80],
    ['XLP', 'Consumer staples', 'staples', 80],
    ['XLU', 'Utilities', 'utilities', 80],
    ['XLY', 'Consumer discretionary', 'discretionary', 80],
    ['XRT', 'Retail', 'discretionary', 65],
    ['XLB', 'Materials', 'materials', 75],
    ['XLRE', 'Real estate', 'real_estate', 75],
    ['IYR', 'US real estate', 'real_estate', 65],
    ['GLD', 'Gold', 'precious_metals', 85],
    ['SLV', 'Silver', 'precious_metals', 75],
    ['GDX', 'Gold miners', 'precious_metals', 75],
    ['GDXJ', 'Junior gold miners', 'precious_metals', 65],
    ['TLT', '20+yr Treasuries', 'rates', 85],
    ['IEF', '7-10yr Treasuries', 'rates', 70],
    ['HYG', 'High-yield credit', 'credit', 70],
    ['LQD', 'Investment-grade credit', 'credit', 65],
  ];

  // Ungrouped on purpose — the correlation cap doesn't apply to single stocks.
  private static readonly STOCKS: [string, string][] = [
    ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'Nvidia'],
    ['AMZN', 'Amazon'], ['GOOGL', 'Alphabet'], ['META', 'Meta'],
    ['TSLA', 'Tesla'], ['AMD', 'AMD'], ['INTC', 'Intel'],
    ['NFLX', 'Netflix'], ['DIS', 'Disney'], ['BA', 'Boeing'],
    ['JPM', 'JPMorgan'], ['BAC', 'Bank of America'], ['WFC', 'Wells Fargo'],
    ['GS', 'Goldman Sachs'], ['XOM', 'Exxon'], ['CVX', 'Chevron'],
    ['PFE', 'Pfizer'], ['JNJ', 'Johnson & Johnson'], ['KO', 'Coca-Cola'],
    ['WMT', 'Walmart'], ['T', 'AT&T'], ['VZ', 'Verizon'],
    ['F', 'Ford'], ['GM', 'General Motors'], ['UBER', 'Uber'],
    ['PLTR', 'Palantir'], ['SOFI', 'SoFi'], ['COIN', 'Coinbase'],
    ['MU', 'Micron'], ['QCOM', 'Qualcomm'], ['CRM', 'Salesforce'],
    ['ORCL', 'Oracle'], ['CSCO', 'Cisco'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: string[] = [];
    for (const [sym, desc, group, pri] of ExpandWatchlistUniverse1788660000000.ETFS) {
      rows.push(
        `('${sym}', '${desc.replace(/'/g, "''")}', '${group}', 'daily', true, ${pri})`,
      );
    }
    for (const [sym, desc] of ExpandWatchlistUniverse1788660000000.STOCKS) {
      rows.push(
        `('${sym}', '${desc.replace(/'/g, "''")}', NULL, 'daily', true, 50)`,
      );
    }
    await queryRunner.query(`
      INSERT INTO "watchlist" ("symbol", "description", "correlationGroup", "cadence", "enabled", "priority")
      VALUES ${rows.join(',\n        ')}
      ON CONFLICT ("symbol") DO UPDATE SET
        "description"      = EXCLUDED."description",
        "correlationGroup" = EXCLUDED."correlationGroup",
        "priority"         = EXCLUDED."priority",
        "enabled"          = EXCLUDED."enabled"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const keep = ['SPY', 'QQQ', 'IWM', 'GLD', 'TLT', 'XLE', 'GDX', 'SLV'];
    await queryRunner.query(
      `DELETE FROM "watchlist" WHERE "symbol" NOT IN (${keep
        .map((s) => `'${s}'`)
        .join(',')})`,
    );
  }
}
