import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve NSE index CSV directory — prefers v2 `data/indices`, then legacy PHP tree. */
export function defaultIndicesDir(): string {
  const fromEnv = process.env.INDICES_DIR?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), 'data/indices'),
    resolve(here, '../../../data/indices'),
    resolve(here, '../../../../stock-verifier/data/indices'),
    resolve(process.cwd(), '../stock-verifier/data/indices'),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  return candidates[0]!;
}
