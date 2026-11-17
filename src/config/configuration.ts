/** Everything the service reads from the environment, typed, in one place. */
export interface AppConfig {
  mongoUri: string;
  jwtSecret: string;
  port: number;
  corsOrigins: string[];
  /** The part after @ in Nexa addresses. */
  domain: string;
  appUrl: string;
  sendLimitPerHour: number;
  /** Mail storage each person may use, in bytes (default 10 MB). */
  quotaBytes: number;
}

export default (): { app: AppConfig } => ({
  app: {
    mongoUri: process.env.MONGODB_URI ?? "",
    jwtSecret: process.env.JWT_SECRET ?? "",
    port: Number(process.env.PORT ?? 4200),
    corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:3000")
      .split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean),
    domain: (process.env.MAIL_DOMAIN ?? "nexa.com").toLowerCase(),
    appUrl: (process.env.APP_URL ?? "").replace(/\/$/, ""),
    sendLimitPerHour: Number(process.env.SEND_LIMIT_PER_HOUR ?? 150),
    quotaBytes: Math.round(Number(process.env.MAIL_QUOTA_MB ?? 10) * 1024 * 1024),
  },
});

/** Names every missing required setting at once. */
export function missingSettings(env: Record<string, unknown> = process.env): string[] {
  return ["MONGODB_URI", "JWT_SECRET"].filter((k) => !env[k]);
}

export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const missing = missingSettings(env);
  if (missing.length > 0) throw new Error(`Missing settings: ${missing.join(", ")}. Copy .env.example to .env and fill them in (or set them in your host's environment variables).`);
  return env;
}
