import { CallHandler, ExecutionContext, Inject, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { AuthedRequest } from "../auth/jwt.guard";
import { MailboxService } from "./mailbox.service";

/** Runs before every mail request: makes sure the person's mailbox exists (and has been welcomed). */
@Injectable()
export class MailboxInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MailboxInterceptor.name);

  constructor(@Inject(MailboxService) private readonly mailbox: MailboxService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    try {
      await this.mailbox.ensure(req.userId);
    } catch (err) {
      // A hiccup setting the mailbox up must not block the request itself.
      this.logger.error(`could not set up mailbox: ${(err as Error).message}`);
    }
    return next.handle();
  }
}
