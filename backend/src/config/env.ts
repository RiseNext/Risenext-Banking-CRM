import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_DATABASE_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_DOMAIN: z.string().optional(),

  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  FRONTEND_URL: z.string().default("http://localhost:3000"),

  BOOTSTRAP_SUPERADMIN_EMAIL: z.string().optional(),
  BOOTSTRAP_SUPERADMIN_PASSWORD: z.string().optional(),

  RECYCLE_BIN_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(10),
  AADHAAR_PEPPER: z.string().min(16).default("dev-only-pepper-change-me!!"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Fail fast on boot. A backend that starts with a missing JWT secret is worse
 * than one that refuses to start.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    if (parsed.data.AADHAAR_PEPPER === "dev-only-pepper-change-me!!") {
      throw new Error("AADHAAR_PEPPER must be set to a unique value in production");
    }
    if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
      throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ");
    }
  }
  return parsed.data;
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}

export const corsOrigins = (value: string): string[] =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
