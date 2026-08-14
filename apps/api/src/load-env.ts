import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(here, '../../../.env'),
  resolve(process.cwd(), '.env'),
];

for (const path of candidates) {
  if (existsSync(path)) {
    const { parsed } = config({ path });
    // CRLF-authored .env files leave a trailing CR that Node rejects in HTTP headers.
    for (const key of Object.keys(parsed ?? {})) {
      const value = process.env[key];
      if (typeof value === 'string' && /\r$/.test(value)) {
        process.env[key] = value.replace(/\r+$/, '');
      }
    }
    break;
  }
}
