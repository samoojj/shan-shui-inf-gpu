import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const readFixture = async name => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
