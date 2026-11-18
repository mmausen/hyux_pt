// Loads .env, config.js and data/tasks.json, validates them and returns one frozen app context.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateConfig, validateTasks } from './validate.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export class ConfigError extends Error {
  constructor(problems) {
    super(`Configuration problems:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.problems = problems;
  }
}

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
  const devMode = String(process.env.DEV_MODE ?? '').trim().toLowerCase() === 'true';
  const port = Number(process.env.PORT || 3000);
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
  return { devMode, port, apiKey, hasApiKey: apiKey.length > 0 && !apiKey.startsWith('sk-your') };
}

export async function loadAll() {
  const env = loadEnv();
  const problems = [];

  let config;
  try {
    config = (await import(pathToFileURL(path.join(ROOT, 'config.js')).href)).default;
  } catch (e) {
    throw new ConfigError([`config.js could not be loaded: ${e.message}`]);
  }

  let tasks = [];
  try {
    tasks = JSON.parse(readFileSync(path.join(ROOT, 'data', 'tasks.json'), 'utf8'));
  } catch (e) {
    problems.push(`data/tasks.json could not be read: ${e.message}`);
  }
  problems.push(...validateTasks(tasks));

  const modes = readdirSync(path.join(ROOT, 'public', 'js', 'modes'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);

  problems.push(...validateConfig(config, { tasks: Array.isArray(tasks) ? tasks : [], modes, hasApiKey: env.hasApiKey, devMode: env.devMode }));

  for (const f of [`content/strings.${config?.study?.locale}.js`, `content/survey.${config?.study?.locale}.js`]) {
    if (!existsSync(path.join(ROOT, f))) problems.push(`${f} is missing (study.locale is '${config?.study?.locale}')`);
  }

  if (problems.length) throw new ConfigError(problems);

  return Object.freeze({ env, config, tasks, modes, tasksById: new Map(tasks.map((t) => [t.id, t])) });
}
