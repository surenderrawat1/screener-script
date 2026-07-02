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
    config({ path });
    break;
  }
}
