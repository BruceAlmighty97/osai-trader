/**
 * The tool policy for the research agent, expressed as DATA so it can be
 * unit-tested independently of the service that uses it.
 *
 * HISTORY, because it explains the shape. This agent originally spawned
 * tastytrade's own MCP server, which exposes seven tools that place, replace,
 * edit or cancel REAL orders on a production account. That made this the only
 * component in the system with any path to a live order, with this allowlist as
 * the sole guardrail.
 *
 * The broker tools are now IN-PROCESS wrappers around this app's own
 * TastytradeService (see tastytrade.tools.ts), whose only order-related call is
 * `postOrderDryRun`. So no order-placing capability exists in this process at
 * all, and safety is structural again rather than configuration-dependent —
 * matching the rest of the codebase.
 *
 * The allowlist remains, and is still asserted at boot, as defence in depth:
 * `permissionMode: 'bypassPermissions'` is required for unattended runs, and
 * anyone who reintroduces an order-capable MCP server should hit a wall.
 */

/** Broker-data tools — in-process, wrapping this app's own TastytradeService. */
export const TT = 'mcp__tt__';

/** Project-logic tools — in-process, deterministic, read-only. */
export const OWN = 'mcp__osai__';

/**
 * The broker surface. These are OUR tools wrapping OUR TastytradeService, not
 * tastytrade's MCP server — see tastytrade.tools.ts for why that matters. The
 * only order-related capability in this process is `dry_run_spread`, which
 * validates and never places, so there is no order-placing tool to exclude.
 */
export const ALLOWED_TASTYTRADE_TOOLS = [
  'market_metrics',
  'option_chain',
  'quote_options',
  'quote_equity',
  'earnings_calendar',
  'market_calendar',
  'account_balances',
  'broker_positions',
  'dry_run_spread',
].map((t) => `${TT}${t}`);

/** Our own deterministic helpers — see research-agent.tools.ts. */
export const OWN_TOOLS = [
  'universe_list',
  'sector_proxies',
  'expected_move',
  'build_occ_symbol',
  'spread_math',
  'paper_positions',
  'holding_window',
].map((t) => `${OWN}${t}`);

export const ALLOWED_TOOLS = [
  'WebSearch',
  'WebFetch',
  'Agent',
  ...ALLOWED_TASTYTRADE_TOOLS,
  ...OWN_TOOLS,
];

/**
 * Belt and braces. Order-mutating names are listed even though no such tool
 * exists in this process any more: if anyone ever reintroduces tastytrade's own
 * MCP server (which does expose them), these are already denied. Filesystem and
 * shell tools are denied because an unattended agent has no business with them.
 */
export const DISALLOWED_TOOLS = [
  'mcp__tastytrade__tastytrade_place_order',
  'mcp__tastytrade__tastytrade_place_complex_order',
  'mcp__tastytrade__tastytrade_replace_order',
  'mcp__tastytrade__tastytrade_edit_order',
  'mcp__tastytrade__tastytrade_edit_complex_order',
  'mcp__tastytrade__tastytrade_cancel_order',
  'mcp__tastytrade__tastytrade_cancel_complex_order',
  'Bash',
  'Write',
  'Edit',
  'NotebookEdit',
];

/** Any tool name containing one of these verbs can mutate real orders. */
const MUTATING = /(place|replace|cancel|submit|edit)_?(complex_)?order/i;

/**
 * Guard invoked at startup and in tests. Throws rather than warns: a research
 * agent that can place live orders must not be allowed to boot.
 */
export function assertToolPolicySafe(
  allowed: string[] = ALLOWED_TOOLS,
  disallowed: string[] = DISALLOWED_TOOLS,
): void {
  const offenders = allowed.filter((t) => MUTATING.test(t));
  if (offenders.length) {
    throw new Error(
      `UNSAFE TOOL POLICY: order-mutating tool(s) in allowedTools: ${offenders.join(', ')}`,
    );
  }
  const writeTools = allowed.filter((t) => /^(Bash|Write|Edit|NotebookEdit)$/.test(t));
  if (writeTools.length) {
    throw new Error(
      `UNSAFE TOOL POLICY: filesystem/shell tool(s) in allowedTools: ${writeTools.join(', ')}`,
    );
  }
  const overlap = allowed.filter((t) => disallowed.includes(t));
  if (overlap.length) {
    throw new Error(
      `CONTRADICTORY TOOL POLICY: tool(s) in both lists: ${overlap.join(', ')}`,
    );
  }
}
