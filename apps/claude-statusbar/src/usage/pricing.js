'use strict';

// Versioned price table, USD per million tokens (MTok), first-party API rates.
//
// This is ALWAYS an estimate: a Claude subscription doesn't charge per token,
// so what this computes is "what these tokens would have cost on the API" —
// useful to compare projects and models against each other, meaningless as a
// bill. Every surface that shows it has to label it as estimate.
//
// Cache rates are derived, not typed in: writes cost 1.25x input for the
// 5-minute TTL and 2x for the 1-hour one, reads 0.1x input (Fable 5.1 is the
// exception at 0.025x). Deriving them keeps a price update to one line.

const PRICING_VERSION = '2026-06-24'; // date of the rate table this was built from

const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;
const CACHE_READ_MULTIPLIER = 0.1;

const MODELS = {
  'claude-fable-5-1': { input: 10, output: 50, cacheReadMultiplier: 0.025 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/**
 * Resolves a model id from a transcript to a price row.
 *
 * Transcripts carry both bare ids (`claude-opus-5`) and dated ones
 * (`claude-haiku-4-5-20251001`), so an exact lookup isn't enough. Unknown
 * models return null instead of a guessed price — the report shows how much of
 * the total had no price rather than quietly pricing it at zero.
 */
function priceFor(model) {
  if (typeof model !== 'string' || !model) return null;
  if (MODELS[model]) return MODELS[model];

  const undated = model.replace(/-\d{8}$/, '');
  if (MODELS[undated]) return MODELS[undated];

  // Longest known prefix wins, so `claude-opus-4-8-something` doesn't match
  // the shorter `claude-opus-4` if both were ever listed.
  let best = null;
  for (const [id, price] of Object.entries(MODELS)) {
    if (undated.startsWith(id) && (!best || id.length > best.id.length)) best = { id, price };
  }
  return best ? best.price : null;
}

/**
 * Estimated USD for one usage record. Returns null when the model has no
 * price row — callers must treat that as "unpriced", not as zero.
 *
 * @param {{model: string, input: number, output: number, cacheWrite5m: number, cacheWrite1h: number, cacheRead: number}} rec
 */
function estimateCost(rec) {
  const price = priceFor(rec.model);
  if (!price) return null;
  const readMultiplier = price.cacheReadMultiplier ?? CACHE_READ_MULTIPLIER;
  const perToken = (tokens, rate) => (tokens || 0) * rate;
  const usd =
    perToken(rec.input, price.input) +
    perToken(rec.output, price.output) +
    perToken(rec.cacheWrite5m, price.input * CACHE_WRITE_5M_MULTIPLIER) +
    perToken(rec.cacheWrite1h, price.input * CACHE_WRITE_1H_MULTIPLIER) +
    perToken(rec.cacheRead, price.input * readMultiplier);
  return usd / 1e6;
}

function isPriced(model) {
  return priceFor(model) !== null;
}

module.exports = { PRICING_VERSION, estimateCost, isPriced, priceFor };
