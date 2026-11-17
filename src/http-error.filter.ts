import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { Response } from "express";

/** Every error leaves as `{ "error": "message" }`, the shape the Nexa UI already understands. */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("Http");

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message =
        typeof body === "string" ? body : Array.isArray((body as { message?: unknown }).message)
          ? String(((body as { message: unknown[] }).message)[0])
          : String((body as { message?: unknown }).message ?? exception.message);
      res.status(exception.getStatus()).json({ error: message });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ error: "Internal server error" });
  }
}
