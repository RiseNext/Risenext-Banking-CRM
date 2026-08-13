import { Router } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db/index.js";

export const healthRouter = Router();

/** Liveness. Never touches the database — Railway uses this for restarts. */
healthRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

/** Readiness. Verifies the Neon connection actually answers. */
healthRouter.get("/health/ready", async (_req, res) => {
  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    res.json({
      status: "ok",
      database: { connected: true, latencyMs: Date.now() - started },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "degraded",
      database: { connected: false, error: (error as Error).message },
      timestamp: new Date().toISOString(),
    });
  }
});
