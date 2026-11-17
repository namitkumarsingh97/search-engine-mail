import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { RateLimit, RateLimitDocument } from "../schemas/schemas";

/** Fixed-window limiter backed by MongoDB, so the limit holds across serverless instances. */
@Injectable()
export class RateLimitService {
  constructor(@InjectModel(RateLimit.name) private readonly limits: Model<RateLimitDocument>) {}

  /** Counts one use of `key`; throws 429 once it goes over `max` in the current window. */
  async hit(key: string, max: number, windowMs: number, message: string): Promise<void> {
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;

    let doc: RateLimitDocument | null = null;
    for (let attempt = 0; attempt < 2 && !doc; attempt++) {
      try {
        doc = await this.limits.findOneAndUpdate(
          { key, windowStart },
          { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowStart + windowMs) } },
          { upsert: true, new: true },
        );
      } catch (err) {
        // Two requests created the first counter at once: the loser just retries and increments it.
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    }

    if (doc && doc.count > max) throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
