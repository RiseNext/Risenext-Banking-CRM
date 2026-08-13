/**
 * Vitest loads this before any test module, so configuration is present no
 * matter which module happens to be imported first.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://localhost:5432/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-that-is-definitely-long-enough";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-that-is-definitely-long-enough";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.FRONTEND_URL ??= "http://localhost:3000";
process.env.AADHAAR_PEPPER ??= "test-pepper-value-1234567890";
process.env.RECYCLE_BIN_RETENTION_DAYS ??= "30";
process.env.MAX_UPLOAD_MB ??= "10";
