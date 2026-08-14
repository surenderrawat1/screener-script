import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultIndicesDir } from './indices-dir.js';

describe('defaultIndicesDir', () => {
  it('resolves to repo data/indices when present', () => {
    const dir = defaultIndicesDir();
    expect(dir).toContain('indices');
    const repoIndices = resolve(process.cwd(), 'data/indices');
    if (existsSync(repoIndices)) {
      expect(dir).toBe(repoIndices);
    }
  });
});
