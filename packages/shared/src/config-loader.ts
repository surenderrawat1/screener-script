import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** Walk up from cwd to find repo `config/` directory. */
export function resolveConfigRoot(): string {
  if (process.env.SV_CONFIG_ROOT) {
    return process.env.SV_CONFIG_ROOT;
  }

  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'config', 'data-policy.yaml');
    if (existsSync(candidate)) {
      return join(dir, 'config');
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return resolve(process.cwd(), 'config');
}

export function readYamlFile<T>(configRoot: string, filename: string): T | null {
  const path = join(configRoot, filename);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  return parseYaml(raw) as T;
}

export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  patch: Record<string, unknown>,
): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof existing === 'object' &&
      existing !== null &&
      !Array.isArray(existing)
    ) {
      out[key] = deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}
