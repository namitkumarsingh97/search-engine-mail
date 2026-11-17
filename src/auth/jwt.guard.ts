import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import jwt from "jsonwebtoken";
import { AppConfig } from "../config/configuration";

export interface AuthedRequest extends Request {
  userId: string;
}

/**
 * Checks the Nexa login token (the same one the API issues: signed with the shared JWT_SECRET)
 * and puts the user's id on the request. This service never creates tokens.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) throw new UnauthorizedException("Authentication required");

    try {
      const payload = jwt.verify(header.slice(7), this.config.get<AppConfig>("app")!.jwtSecret);
      if (typeof payload !== "object" || typeof payload.sub !== "string") throw new Error("bad payload");
      req.userId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException("Authentication required");
    }
  }
}
