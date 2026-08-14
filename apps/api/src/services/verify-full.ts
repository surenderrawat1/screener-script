import {
  buildEmptyVerifyInput,
  buildVerifyFullPrefill,
  FormState,
  mergeSavedFields,
  normalizeVerifySymbol,
  runVerificationEngine,
  VERIFY_FULL_PHASES,
  VERIFY_SECTOR_OPTIONS,
} from '@sv/core';
import type { VerificationResult, VerifyFullInput } from '@sv/core';
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { prisma } from '@sv/db';
import { fetchVerifierData } from '@sv/data-adapters';
import { lookupSectorHint, NSE_SECTOR_HINTS } from '@sv/shared';
import { getWatchlistItemMeta, syncWatchlistFromFullVerify } from './watchlist.js';

const DRAFT_TTL_SEC = 60 * 60 * 24 * 30;

function sectorHintsForSymbol(symbol: string): Record<string, string> {
  const hint = lookupSectorHint(symbol);
  return hint ? { [symbol]: hint } : {};
}

function draftCacheKey(userId: string, symbol: string): string {
  return cacheKey('sv:verify', `full:draft:${userId}:${normalizeVerifySymbol(symbol)}`);
}

export function getVerifyFullPrefill(symbol = '') {
  const normalized = normalizeVerifySymbol(symbol);
  if (normalized.length > 20) {
    throw new Error('Invalid symbol');
  }
  return buildVerifyFullPrefill(normalized);
}

export interface VerifyFullFetchResponse {
  success: boolean;
  symbol: string;
  input: VerifyFullInput;
  auto_keys: string[];
  sources: string[];
  from_cache?: boolean;
  fetch_meta: {
    count: number;
    name: string;
    symbol: string;
    sources: string[];
    from_cache?: boolean;
    cached_until?: string;
  };
  /** Unix seconds — pass through to /run for D1 data-quality gate. */
  cache_meta: {
    created_at: number;
    expires_at?: number;
    from_cache?: boolean;
  };
  phases: typeof VERIFY_FULL_PHASES;
  sectors: typeof VERIFY_SECTOR_OPTIONS;
}

export async function fetchVerifyFull(
  symbol: string,
  options: {
    refresh?: boolean;
    manual?: VerifyFullInput;
    userId?: string;
  } = {},
): Promise<VerifyFullFetchResponse> {
  const normalized = normalizeVerifySymbol(symbol);
  if (!normalized) throw new Error('Invalid symbol');
  if (normalized.length > 20) throw new Error('Invalid symbol');

  const fetched = await fetchVerifierData(normalized, options.refresh ?? false);
  if (!fetched.success || !fetched.auto) {
    throw new Error(fetched.error ?? `Could not fetch data for ${normalized}`);
  }

  let input = { ...fetched.auto.input };
  let autoKeys = [...fetched.auto.auto_keys];

  if (options.userId) {
    const meta = await getWatchlistItemMeta(options.userId, normalized);
    const before = { ...input };
    input = mergeSavedFields(input, meta ?? undefined);
    for (const key of [
      'review_date',
      'thesis_business',
      'thesis_financials',
      'thesis_valuation',
      'invalidation_1',
      'invalidation_2',
    ]) {
      if (!String(before[key] ?? '').trim() && String(meta?.[key] ?? '').trim()) {
        autoKeys = autoKeys.filter((k) => k !== key);
      }
    }
  }

  if (options.manual && Object.keys(options.manual).length > 0) {
    const state = new FormState();
    state.mergeAuto(input, options.manual, autoKeys);
    input = state.all();
    autoKeys = state.autoKeysList();
  }

  const name = String(input.stock_name ?? normalized);
  const ttlDays = 7;
  const createdAt = Math.floor(Date.now() / 1000);
  const expiresAt = createdAt + ttlDays * 86400;
  const cachedUntil = new Date(expiresAt * 1000);

  return {
    success: true,
    symbol: normalized,
    input,
    auto_keys: autoKeys,
    sources: fetched.sources,
    from_cache: fetched.from_cache,
    fetch_meta: {
      count: autoKeys.length,
      name,
      symbol: normalized,
      sources: fetched.sources,
      from_cache: fetched.from_cache,
      cached_until: cachedUntil.toISOString().slice(0, 10),
    },
    cache_meta: {
      created_at: createdAt,
      expires_at: expiresAt,
      from_cache: Boolean(fetched.from_cache),
    },
    phases: VERIFY_FULL_PHASES,
    sectors: VERIFY_SECTOR_OPTIONS,
  };
}

export function buildVerifyFullDraft(symbol: string, input: VerifyFullInput, autoKeys: string[]) {
  return {
    symbol: normalizeVerifySymbol(symbol),
    input: { ...buildEmptyVerifyInput(), ...input },
    auto_keys: autoKeys,
    updatedAt: new Date().toISOString(),
  };
}

export async function getVerifyFullDraft(userId: string, symbol: string) {
  const normalized = normalizeVerifySymbol(symbol);
  if (!normalized) throw new Error('Invalid symbol');
  const draft = await cacheGetJson<ReturnType<typeof buildVerifyFullDraft>>(
    draftCacheKey(userId, normalized),
  );
  return draft ?? null;
}

export async function saveVerifyFullDraft(
  userId: string,
  symbol: string,
  input: VerifyFullInput,
  autoKeys: string[] = [],
) {
  const normalized = normalizeVerifySymbol(symbol);
  if (!normalized) throw new Error('Invalid symbol');
  const draft = buildVerifyFullDraft(normalized, input, autoKeys);
  await cacheSetJson(draftCacheKey(userId, normalized), draft, DRAFT_TTL_SEC);
  return draft;
}

export interface VerifyFullRunResponse {
  success: boolean;
  symbol: string;
  result: VerificationResult;
  run_id?: string;
  watchlist_saved?: boolean;
}

export async function runVerifyFull(
  input: VerifyFullInput,
  options: {
    symbol?: string;
    userId?: string;
    cacheMeta?: { created_at?: number; expires_at?: number; from_cache?: boolean } | null;
  } = {},
): Promise<VerifyFullRunResponse> {
  const sym = normalizeVerifySymbol(
    String(options.symbol ?? input.fetch_symbol ?? input.stock_name ?? ''),
  );
  if (!sym) throw new Error('Invalid symbol');

  const hints = { ...NSE_SECTOR_HINTS, ...sectorHintsForSymbol(sym) };
  const cacheMeta =
    options.cacheMeta && (options.cacheMeta.created_at ?? 0) > 0
      ? {
          created_at: Number(options.cacheMeta.created_at),
          expires_at:
            options.cacheMeta.expires_at != null
              ? Number(options.cacheMeta.expires_at)
              : undefined,
        }
      : { created_at: Math.floor(Date.now() / 1000) };

  const result = runVerificationEngine(input as Record<string, unknown>, {
    sectorHints: hints,
    cacheMeta,
  });

  let runId: string | undefined;
  let watchlistSaved = false;
  if (options.userId) {
    const row = await prisma.verificationRun
      .create({
        data: {
          userId: options.userId,
          symbol: sym,
          mode: 'full',
          input: input as object,
          result: result as object,
        },
      })
      .catch(() => undefined);
    runId = row?.id;

    const wl = await syncWatchlistFromFullVerify(options.userId, sym, input, result).catch(
      () => ({ saved: false }),
    );
    watchlistSaved = wl.saved;
  }

  return {
    success: true,
    symbol: sym,
    result,
    run_id: runId,
    watchlist_saved: watchlistSaved,
  };
}
