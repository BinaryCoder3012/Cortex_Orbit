import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Loads the repo-root .env before anything reads process.env. Imported first.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
