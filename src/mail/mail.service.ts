import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { randomUUID } from "crypto";
import mongoose, { Model, isValidObjectId } from "mongoose";
import { AppConfig } from "../config/configuration";
import { Folder, MailItem, MailItemDocument, Person } from "../schemas/schemas";
import { AddressService } from "./address.service";
import { RateLimitService } from "./rate-limit.service";

const PAGE_SIZE = 30;
const MAX_SUBJECT = 200;
const MAX_BODY = 20_000;
const MAX_RECIPIENTS = 20;
const HOUR_MS = 60 * 60 * 1000;

export const snippetOf = (body: string) => body.replace(/\s+/g, " ").trim().slice(0, 140);

@Injectable()
export class MailService {
  private readonly sendLimit: number;

  constructor(
    @InjectModel(MailItem.name) private readonly items: Model<MailItemDocument>,
    @Inject(AddressService) private readonly address: AddressService,
    @Inject(RateLimitService) private readonly limiter: RateLimitService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.sendLimit = config.get<AppConfig>("app")!.sendLimitPerHour;
  }

  // ---- How mail looks to the UI ------------------------------------------------------

  summary(i: MailItemDocument) {
    return {
      id: String(i._id),
      folder: i.folder,
      read: i.read,
      starred: i.starred,
      date: i.date,
      threadId: i.threadId,
      from: this.address.toContact(i.from),
      to: i.to.map(this.address.toContact),
      subject: i.subject,
      snippet: i.snippet,
    };
  }

  detail(i: MailItemDocument) {
    return {
      ...this.summary(i),
      messageId: i.messageKey,
      cc: i.cc.map(this.address.toContact),
      body: i.body,
      sentAt: i.sentAt,
    };
  }

  private async findOwned(userId: string, id: string): Promise<MailItemDocument | null> {
    return isValidObjectId(id) ? this.items.findOne({ _id: id, userId }) : null;
  }

  private async mustFind(userId: string, id: string): Promise<MailItemDocument> {
    const item = await this.findOwned(userId, id);
    if (!item) throw new NotFoundException("Message not found");
    return item;
  }

  // ---- Reading ------------------------------------------------------------------------

  /** Message counts for the sidebar. */
  async folders(userId: string) {
    const rows = await this.items.aggregate<{ _id: Folder; total: number; unread: number }>([
      { $match: { userId } },
      { $group: { _id: "$folder", total: { $sum: 1 }, unread: { $sum: { $cond: ["$read", 0, 1] } } } },
    ]);
    const out: Record<string, { total: number; unread: number }> = {
      inbox: { total: 0, unread: 0 },
      sent: { total: 0, unread: 0 },
      draft: { total: 0, unread: 0 },
      trash: { total: 0, unread: 0 },
    };
    for (const r of rows) out[r._id] = { total: r.total, unread: r.unread };
    out.starred = { total: await this.items.countDocuments({ userId, starred: true, folder: { $ne: "trash" } }), unread: 0 };
    return out;
  }

  async list(userId: string, folder: string, page: number) {
    let filter: Record<string, unknown>;
    if (folder === "starred") filter = { userId, starred: true, folder: { $ne: "trash" } };
    else if (["inbox", "sent", "draft", "trash"].includes(folder)) filter = { userId, folder };
    else throw new BadRequestException("Unknown folder");

    const p = Math.max(1, page || 1);
    const [items, total] = await Promise.all([
      this.items.find(filter).sort({ date: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE),
      this.items.countDocuments(filter),
    ]);
    return { page: p, total, pageSize: PAGE_SIZE, items: items.map((i) => this.summary(i)) };
  }

  /** The full message. Opening it marks it read. */
  async open(userId: string, id: string) {
    const item = await this.mustFind(userId, id);
    if (!item.read) {
      item.read = true;
      await item.save();
    }
    return this.detail(item);
  }

  /** This user's messages in one conversation, oldest first. */
  async thread(userId: string, threadId: string) {
    const items = await this.items.find({ userId, threadId, folder: { $ne: "trash" } }).sort({ date: 1 });
    return items.map((i) => this.detail(i));
  }

  // ---- Writing ------------------------------------------------------------------------

  /**
   * Saves a draft or sends. Sending gives every recipient (To and Cc) an inbox copy and the
   * sender a "sent" copy; nothing leaves Nexa.
   */
  async compose(userId: string, input: Record<string, unknown>) {
    await this.limiter.hit(`compose:${userId}`, this.sendLimit, HOUR_MS, "You've reached the hourly sending limit. Try again later.");

    const me = await this.address.person(userId);
    if (!me) throw new ForbiddenException("Your account doesn't have a Nexa address yet. Reload Nexa in a moment and try again.");

    const sending = input.send === true || input.send === "1" || input.send === 1;
    const subject = String(input.subject ?? "").trim().slice(0, MAX_SUBJECT);
    const body = String(input.body ?? "");
    if (body.length > MAX_BODY) throw new BadRequestException(`Messages are limited to ${MAX_BODY.toLocaleString()} characters.`);

    const toHandles = this.address.parseList(input.to);
    const ccHandles = this.address.parseList(input.cc).filter((h) => !toHandles.includes(h));
    if (toHandles.length + ccHandles.length > MAX_RECIPIENTS) throw new BadRequestException(`At most ${MAX_RECIPIENTS} recipients.`);

    if (sending) {
      if (toHandles.length === 0) throw new BadRequestException("Add at least one recipient.");
      if (!subject && !body.trim()) throw new BadRequestException("Write a subject or a message first.");
    }

    // Sending needs every recipient to exist. A draft can hold addresses that don't resolve yet.
    const known = sending ? await this.address.resolve([...toHandles, ...ccHandles]) : await this.address.resolveLoose([...toHandles, ...ccHandles]);
    const person = (h: string): Person => known.get(h) ?? { handle: h, name: "" };
    const to = toHandles.map(person);
    const cc = ccHandles.map(person);

    // An existing draft being edited or sent?
    let draft: MailItemDocument | null = null;
    if (input.draftId) {
      draft = await this.findOwned(userId, String(input.draftId));
      if (!draft || draft.folder !== "draft") throw new NotFoundException("Draft not found");
    }

    // Replying joins the parent's conversation.
    let threadId = draft?.threadId;
    if (!threadId && input.replyTo) threadId = (await this.findOwned(userId, String(input.replyTo)))?.threadId;
    threadId ??= randomUUID();

    const now = new Date();
    const fields = {
      threadId,
      messageKey: draft?.messageKey ?? new mongoose.Types.ObjectId().toString(),
      from: me,
      to,
      cc,
      subject,
      body,
      snippet: snippetOf(body),
      people: [me, ...to, ...cc].map((p) => `${p.name} ${this.address.addressOf(p.handle)}`).join(" "),
      date: now,
      sentAt: sending ? now : null,
    };

    const mine = draft ?? new this.items({ userId, read: true, starred: false });
    mine.set({ ...fields, folder: sending ? "sent" : "draft", read: true });
    await mine.save();

    if (sending) {
      const recipientIds = [...new Set([...to, ...cc].map((p) => p.userId!))];
      await this.items.insertMany(
        recipientIds.map((rid) => ({ ...fields, userId: rid, folder: "inbox", read: false, starred: false })),
      );
    }
    return this.detail(mine);
  }

  async update(userId: string, id: string, patch: { read?: unknown; starred?: unknown }) {
    const item = await this.mustFind(userId, id);
    if (typeof patch.read === "boolean") item.read = patch.read;
    if (typeof patch.starred === "boolean") item.starred = patch.starred;
    await item.save();
    return this.summary(item);
  }

  async trash(userId: string, id: string) {
    const item = await this.mustFind(userId, id);
    if (item.folder === "trash") throw new NotFoundException("Message not found");
    item.prevFolder = item.folder as "inbox" | "sent" | "draft";
    item.folder = "trash";
    await item.save();
    return { trashed: true };
  }

  async restore(userId: string, id: string) {
    const item = await this.mustFind(userId, id);
    if (item.folder !== "trash") throw new NotFoundException("Message not found in trash");
    item.folder = item.prevFolder ?? "inbox";
    item.prevFolder = undefined;
    await item.save();
    return { restored: true, folder: item.folder };
  }

  /** Deleting for good is only for trash and discarded drafts. */
  async remove(userId: string, id: string) {
    const item = await this.mustFind(userId, id);
    if (item.folder !== "trash" && item.folder !== "draft") throw new NotFoundException("Message not found in trash or drafts");
    await item.deleteOne();
    return { deleted: true };
  }

  async emptyTrash(userId: string) {
    const result = await this.items.deleteMany({ userId, folder: "trash" });
    return { deleted: result.deletedCount };
  }

  suggest(query: string) {
    return this.address.suggest(query);
  }
}
