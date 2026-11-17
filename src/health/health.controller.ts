import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

@Controller()
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  root() {
    return { name: "nexa-mail", status: "running" };
  }

  /** For the host's health check. 503 when the database is unreachable. */
  @Get("health")
  health() {
    const db = this.connection.readyState === 1;
    if (!db) throw new ServiceUnavailableException("Database not connected");
    return { ok: true, db };
  }
}
