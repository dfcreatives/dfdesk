import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import type { RequestHandler } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { loadActor } from "./middleware/auth.js";
import { csrfProtection } from "./middleware/csrf.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestContext } from "./middleware/request-context.js";
import {
  attendanceRouter,
  legacyAttendanceRouter,
} from "./modules/attendance/attendance.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { integrationsRouter } from "./modules/integrations/integrations.routes.js";
import { legacyWorkspaceRouter } from "./modules/legacy-workspace/legacy-workspace.routes.js";
import { resourceRouter } from "./modules/resources/resource.routes.js";
import { orderFieldsRouter } from "./modules/order-fields/order-fields.routes.js";
import { ok } from "./shared/http/respond.js";
import { openApiDocument } from "./openapi.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(requestContext);
  const httpLogger = (
    pinoHttp as unknown as (options: {
      logger: typeof logger;
    }) => RequestHandler
  )({ logger });
  app.use(httpLogger);
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (
          !origin ||
          env().frontendOrigins.includes(origin.replace(/\/$/, ""))
        )
          callback(null, true);
        else callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["content-type", "x-csrf-token", "x-request-id"],
    }),
  );
  app.use(
    express.json({
      limit: "2mb",
      verify(request, _response, buffer) {
        (request as express.Request).rawBody = buffer.toString("utf8");
      },
    }),
  );
  app.use(cookieParser());
  app.use(loadActor);
  app.use(csrfProtection);

  app.get("/api/v1/health", (_request, response) =>
    ok(response, { status: "ok" }),
  );
  app.get("/api/v1/ready", async (_request, response) => {
    await prisma.$queryRaw`SELECT 1`;
    return ok(response, { status: "ready" });
  });
  app.get("/api/v1/openapi.json", (_request, response) =>
    response.json(openApiDocument),
  );
  app.use("/api/v1/auth", authRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/v1/attendance", attendanceRouter);
  app.use("/api/v1/integrations", integrationsRouter);
  app.use("/api/v1/order-fields", orderFieldsRouter);
  app.use("/api/v1", resourceRouter);
  app.use("/api/workspace", legacyWorkspaceRouter);
  app.use("/api/attendance", legacyAttendanceRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
