import pino from "pino";

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info");

export const logger = pino({
  level,
  /**
   * Belt and braces: even if a handler logs a whole request body, these never
   * reach the log sink.
   */
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
      "*.password_hash",
      "*.currentPassword",
      "*.newPassword",
      "*.aadhaar",
      "*.aadhaarHash",
      "*.token",
      "*.refreshToken",
      "*.accessToken",
    ],
    censor: "[redacted]",
  },
});
