import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const server = createServer(createApp());
server.listen(env().PORT, () =>
  logger.info({ port: env().PORT }, "Desk API listening"),
);

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  const force = setTimeout(() => {
    logger.fatal("forced shutdown after timeout");
    process.exit(1);
  }, 10_000);
  force.unref();
  server.close((error) => {
    void prisma.$disconnect().finally(() => {
      clearTimeout(force);
      if (error) {
        logger.error({ err: error }, "shutdown failed");
        process.exitCode = 1;
      }
    });
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
