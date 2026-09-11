import { z } from 'zod';

/**
 * Structured-output contract for the research agent. Enforced by the SDK via
 * `outputFormat: json_schema` AND re-validated in the service — the model can
 * be steered, the schema cannot, and downstream code must never parse prose.
 *
 * Adapted from the spec's starter: `sources` is a plain string rather than
 * z.url() because models routinely return a bare domain or a citation-style
 * reference, and rejecting the whole report over a malformed URL loses several
 * dollars of research to a cosmetic failure.
 */

export const ResearchLeg = z.object({
  occSymbol: z
    .string()
    .describe('OCC option symbol, e.g. "META  260914P00625000". Use build_occ_symbol.'),
  action: z.enum(['Sell to Open', 'Buy to Open']),
  quantity: z.number().int().positive(),
  strike: z.number(),
  right: z.enum(['C', 'P']),
  expiration: z.string().describe('YYYY-MM-DD'),
  midAtAnalysis: z.number().describe('Live mid observed this run — never from memory'),
  delta: z.number().nullable(),
});

export const ResearchPlaySchema = z.object({
  underlying: z.string(),
  structure: z.enum([
    'put_credit_spread',
    'call_credit_spread',
    'iron_condor',
    'call_debit_spread',
    'put_debit_spread',
    'calendar',
  ]),
  legs: z.array(ResearchLeg).min(2).max(4),
  netCredit: z.number().describe('Per contract. Positive = credit received, negative = debit paid'),
  maxLoss: z.number().describe('Dollars per contract; must be finite and > 0'),
  maxProfit: z.number(),
  breakevens: z.array(z.number()),
  probabilityOfProfit: z.number().min(0).max(1),
  buyingPowerEffect: z.number().nullable().describe('From tastytrade dry-run'),
  estimatedFees: z.number().nullable(),
  dryRunPassed: z.boolean(),
  edgeType: z
    .enum(['structural', 'volMispricing', 'statistical'])
    .describe('Ranking is by edge type first: structural > volMispricing > statistical'),
  thesis: z.string().describe('2-4 sentences: why this trade, why now'),
  catalysts: z.array(z.string()),
  risks: z.array(z.string()),
  ivContext: z.object({
    ivIndex: z.number().nullable(),
    ivRank: z.number().nullable(),
    ivPercentile: z.number().nullable(),
    ivMinusHv30: z.number().nullable(),
    liquidityRating: z.number().nullable(),
  }),
  managementPlan: z.string(),
  conviction: z.enum(['high', 'medium', 'low']),
  sources: z.array(z.string()),
});

export const ResearchReport = z.object({
  asOf: z.string().describe('ISO timestamp of analysis'),
  marketContext: z
    .string()
    .describe('Macro backdrop: indices, VIX, yields, oil, scheduled events in the window'),
  eventCalendar: z.array(
    z.object({ date: z.string(), event: z.string(), relevance: z.string() }),
  ),
  candidatesScreened: z
    .array(
      z.object({
        symbol: z.string(),
        verdict: z.enum(['selected', 'rejected']),
        reason: z.string(),
      }),
    )
    .describe('EVERY name looked at, with why. This is the tuning signal — do not abridge it.'),
  plays: z.array(ResearchPlaySchema).max(5),
  bestPlay: z.string().describe('Underlying + structure of the single best play, one-line reason'),
  disclaimer: z.string(),
});

export type ResearchLeg = z.infer<typeof ResearchLeg>;
export type ResearchPlay = z.infer<typeof ResearchPlaySchema>;
export type ResearchReport = z.infer<typeof ResearchReport>;
