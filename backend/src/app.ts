import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import { corsOrigins, env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { authRouter } from "./modules/auth.routes.js";
import { banksRouter } from "./modules/banks.routes.js";
import { customersRouter } from "./modules/customers.routes.js";
import { healthRouter } from "./modules/health.routes.js";
import {
  auditRouter,
  notificationsRouter,
  recycleBinRouter,
  rolesRouter,
  teamsRouter,
  usersRouter,
} from "./modules/admin.routes.js";
import { importsRouter } from "./modules/imports.routes.js";
import {
  bankOrdersRouter,
  dashboardRouter,
  disbursementsRouter,
  documentsRouter,
  fundingSourcesRouter,
  ledgerRouter,
  loansRouter,
  serviceProvidersRouter,
  settlementsRouter,
  transactionsRouter,
  verificationsRouter,
} from "./modules/operations.routes.js";

export function createApp(): Express {
  const config = env();
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: false, // API only; the frontend sets its own CSP.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  const allowed = corsOrigins(config.CORS_ORIGIN);
  app.use(
    cors({
      // credentials:true forbids a wildcard origin, so the allow-list is
      // checked explicitly. Set CORS_ORIGIN to the Vercel URL in production.
      origin(origin, callback) {
        if (!origin || allowed.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not permitted`));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.use((req, _res, next) => {
    req.requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
    next();
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(cookieParser());

  if (config.NODE_ENV !== "test") {
    app.use(pinoHttp({ logger, genReqId: (req) => (req as { requestId?: string }).requestId ?? randomUUID() }));
  }

  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/banks", banksRouter);
  app.use("/api/customers", customersRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/roles", rolesRouter);
  app.use("/api/teams", teamsRouter);
  app.use("/api/loans", loansRouter);
  app.use("/api/verifications", verificationsRouter);
  app.use("/api/bank-orders", bankOrdersRouter);
  app.use("/api/disbursements", disbursementsRouter);
  app.use("/api/settlements", settlementsRouter);
  app.use("/api/transactions", transactionsRouter);
  app.use("/api/ledger", ledgerRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/funding-sources", fundingSourcesRouter);
  app.use("/api/service-providers", serviceProvidersRouter);
  app.use("/api/recycle-bin", recycleBinRouter);
  app.use("/api/audit-logs", auditRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/imports", importsRouter);
  app.use("/api/dashboard", dashboardRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
