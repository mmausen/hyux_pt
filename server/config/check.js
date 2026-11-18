// npm run check:config — validates config.js, .env and data/tasks.json without starting the server.
import { loadAll, ConfigError } from './load.js';

try {
  const { env, config } = await loadAll();
  console.log(`Config is valid. Rounds: ${config.flow.rounds}, timer: ${config.timer.mode}, recording: ${config.interaction.recordingMode}, DEV_MODE: ${env.devMode}.`);
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : e);
  process.exit(1);
}
