import "dotenv/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { AppConfig } from "./config/configuration";

async function bootstrap() {
  // Checked before Nest loads, so a missing setting gives one clear line instead of a stack trace.
  const missing = ["MONGODB_URI", "JWT_SECRET"].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[mail] Missing settings: ${missing.join(", ")}. Copy .env.example to .env and fill them in (or set them in your host's environment variables).`);
    process.exit(1);
  }

  // Loaded only now, because importing the app module reads the environment.
  const { Logger } = await import("@nestjs/common");
  const { ConfigService } = await import("@nestjs/config");
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("./app.module");
  const { HttpErrorFilter } = await import("./http-error.filter");

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["log", "warn", "error"] });
  const { port, corsOrigins } = app.get(ConfigService).get<AppConfig>("app")!;

  app.disable("x-powered-by");
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableCors({
    origin: (origin, callback) => callback(null, !origin || corsOrigins.includes(origin)),
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  app.use((_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store"); // mail is private: never cached by a browser or proxy
    next();
  });
  app.enableShutdownHooks();

  await app.listen(port, "0.0.0.0");
  new Logger("Mail").log(`listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error("[mail] failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => console.error("[mail] unhandled rejection:", reason));
