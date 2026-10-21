import { createRouterConfig } from "../router.config.ts";
import { requireEnv } from "./config.ts";
import { startHttpServer } from "./http.ts";
import { createJsonLogger, describeError } from "./logger.ts";
import { connectAsterisk } from "./pbx/asterisk/adapter.ts";
import { validateAsteriskRoutes } from "./pbx/asterisk/dialplan.ts";
import { createCallRouter } from "./router.ts";

const logger = createJsonLogger();

// Read a positive number from env, falling back to the default when unset/invalid.
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function start(): void {
  const config = createRouterConfig(logger);
  validateAsteriskRoutes(config.routes);
  const router = createCallRouter(config);
  const app = process.env.ARI_APP?.trim() || "jev-router";

  const httpServer = startHttpServer({ router, logger });

  const connection = connectAsterisk({
    url: requireEnv("ARI_URL"),
    username: requireEnv("ARI_USERNAME"),
    password: requireEnv("ARI_PASSWORD"),
    app,
    router,
    logger,
    // Keep the original 2s silence / 15s max defaults unless overridden by env.
    recording: {
      maxSeconds: envNumber("RECORD_MAX_SECONDS", 15),
      maxSilenceSeconds: envNumber("RECORD_MAX_SILENCE_SECONDS", 2),
    },
  });
  logger.info("service.started", { app, routes: Object.keys(config.routes), fallbackRoute: config.fallbackRoute });

  const stop = () => {
    logger.info("service.stopping");
    httpServer.stop();
    connection.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

try {
  start();
} catch (error) {
  logger.error("service.start_failed", { error: describeError(error) });
  process.exit(1);
}
