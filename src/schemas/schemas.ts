import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

// `type` is always spelled out on @Prop so nothing depends on TypeScript's emitted metadata.

/** Read-only view of the API's `users` collection (the API owns it; this service never writes to it). */
@Schema({ collection: "users", autoIndex: false })
export class UserRef {
  @Prop({ type: String }) email: string;
  @Prop({ type: String }) name: string;
  /** The part before @nexa.com. */
  @Prop({ type: String }) handle?: string;
}
export type UserRefDocument = HydratedDocument<UserRef>;
export const UserRefSchema = SchemaFactory.createForClass(UserRef);

export type Folder = "inbox" | "sent" | "draft" | "trash";

/** Someone on a message. `userId` is missing for the system sender (the welcome mail). */
export interface Person {
  userId?: string;
  name: string;
  handle: string;
}

/**
 * One person's copy of one message. Sending writes one item for the sender and one for each
 * recipient, so every person has everything they need in a single document: no joins, and
 * deleting your copy never touches anyone else's.
 */
@Schema({ collection: "mail_items", timestamps: false })
export class MailItem {
  @Prop({ type: String, required: true }) userId: string;
  @Prop({ type: String, required: true, enum: ["inbox", "sent", "draft", "trash"] }) folder: Folder;
  /** Where it goes back to when restored from the trash. */
  @Prop({ type: String, enum: ["inbox", "sent", "draft"] }) prevFolder?: Folder;
  @Prop({ type: Boolean, default: false }) read: boolean;
  @Prop({ type: Boolean, default: false }) starred: boolean;
  /** Sort key: sent time, or last edit time for drafts. */
  @Prop({ type: Date, required: true }) date: Date;
  /** Conversation this belongs to. Replies share it. */
  @Prop({ type: String, required: true }) threadId: string;
  /** Links the copies of one message together ("welcome" for the welcome mail). */
  @Prop({ type: String, required: true }) messageKey: string;
  @Prop({ type: Object, required: true }) from: Person;
  @Prop({ type: [Object], default: [] }) to: Person[];
  @Prop({ type: [Object], default: [] }) cc: Person[];
  @Prop({ type: String, default: "" }) subject: string;
  /** Plain text only: never rendered as HTML, so there is nothing to sanitize. */
  @Prop({ type: String, default: "" }) body: string;
  @Prop({ type: String, default: "" }) snippet: string;
  /** Names and addresses of everyone involved, so a search for a person's name finds the mail. */
  @Prop({ type: String, default: "" }) people: string;
  @Prop({ type: Date, default: null }) sentAt: Date | null;
}
export type MailItemDocument = HydratedDocument<MailItem>;
export const MailItemSchema = SchemaFactory.createForClass(MailItem);

MailItemSchema.index({ userId: 1, folder: 1, date: -1 });
MailItemSchema.index({ userId: 1, threadId: 1, date: 1 });
// Full-text search inside one user's mail: the equality prefix on userId keeps it fast and private.
MailItemSchema.index(
  { userId: 1, subject: "text", body: "text", people: "text" },
  { weights: { subject: 5, people: 3, body: 1 }, name: "user_text" },
);
// The welcome mail can only ever exist once per user, even if two requests race to create it.
MailItemSchema.index({ userId: 1, messageKey: 1 }, { unique: true, partialFilterExpression: { messageKey: "welcome" }, name: "one_welcome" });

/** Marks a user as "already welcomed", so the welcome mail is sent once, even if they delete it. */
@Schema({ collection: "mail_boxes" })
export class Mailbox {
  @Prop({ type: String, required: true, unique: true }) userId: string;
  @Prop({ type: Date, required: true }) welcomedAt: Date;
}
export type MailboxDocument = HydratedDocument<Mailbox>;
export const MailboxSchema = SchemaFactory.createForClass(Mailbox);

/** Counters for rate limiting, kept in MongoDB because serverless instances don't share memory. */
@Schema({ collection: "mail_ratelimits" })
export class RateLimit {
  @Prop({ type: String, required: true }) key: string;
  @Prop({ type: Number, required: true }) windowStart: number;
  @Prop({ type: Number, default: 0 }) count: number;
  @Prop({ type: Date, required: true }) expiresAt: Date;
}
export type RateLimitDocument = HydratedDocument<RateLimit>;
export const RateLimitSchema = SchemaFactory.createForClass(RateLimit);
RateLimitSchema.index({ key: 1, windowStart: 1 }, { unique: true });
RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
