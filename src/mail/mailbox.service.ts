import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { randomUUID } from "crypto";
import { Model } from "mongoose";
import { AppConfig } from "../config/configuration";
import { MailItem, MailItemDocument, Mailbox, MailboxDocument, Person } from "../schemas/schemas";
import { AddressService } from "./address.service";
import { snippetOf } from "./mail.service";

const SYSTEM_SENDER: Person = { name: "Nexa Team", handle: "welcome" };

/**
 * Sets a person's mailbox up the first time they use mail, and drops the welcome message in it.
 * It happens once per person, ever: deleting the welcome mail does not bring it back.
 */
@Injectable()
export class MailboxService {
  private readonly logger = new Logger(MailboxService.name);
  /** People already confirmed as welcomed, so most requests skip the database check. */
  private readonly known = new Set<string>();
  private readonly appUrl: string;

  constructor(
    @InjectModel(Mailbox.name) private readonly boxes: Model<MailboxDocument>,
    @InjectModel(MailItem.name) private readonly items: Model<MailItemDocument>,
    @Inject(AddressService) private readonly address: AddressService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.appUrl = config.get<AppConfig>("app")!.appUrl;
  }

  async ensure(userId: string): Promise<void> {
    if (this.known.has(userId)) return;

    // No address yet (an account the API hasn't given one to): try again on the next request.
    const me = await this.address.person(userId);
    if (!me) return;

    // Welcome first, mark the mailbox second. Requests that arrive together all wait for the welcome
    // mail to exist before they carry on (the database allows only one welcome mail per person, so
    // simultaneous attempts can't create two), and "already welcomed" is only recorded afterwards.
    if (!(await this.boxes.exists({ userId }))) {
      await this.sendWelcome(me);
      await this.boxes.updateOne({ userId }, { $setOnInsert: { userId, welcomedAt: new Date() } }, { upsert: true });
    }
    this.known.add(userId);
  }

  private async sendWelcome(me: Person): Promise<void> {
    const first = (me.name.trim().split(/\s+/)[0] || me.handle).slice(0, 40);
    const address = this.address.addressOf(me.handle);
    const body = [
      `Hi ${first},`,
      "",
      "Welcome to Nexa! This is your Nexa mailbox.",
      "",
      `Your address: ${address}`,
      "",
      "What you can do here",
      "- Write to anyone else on Nexa using their address, for example ada@nexa.com.",
      "- Reply, forward, star and tidy up your mail with folders and the trash.",
      "- Find your mail from the main Nexa search box. Only you can see your mail in search.",
      "",
      "Good to know",
      "- Mail is plain text. Web links such as https://example.com are clickable.",
      "- Mail stays inside Nexa: it can't be sent to or received from Gmail or other services.",
      "- Messages in the trash are hidden from search until you delete them for good.",
      ...(this.appUrl ? ["", `Open Nexa any time: ${this.appUrl}`] : []),
      "",
      "Enjoy,",
      "The Nexa team",
    ].join("\n");

    const now = new Date();
    try {
      await this.items.create({
        userId: me.userId,
        folder: "inbox",
        read: false,
        starred: false,
        date: now,
        sentAt: now,
        threadId: randomUUID(),
        // A fixed key: the database allows only one of these per person (see the one_welcome index).
        messageKey: "welcome",
        from: SYSTEM_SENDER,
        to: [me],
        cc: [],
        subject: `Welcome to Nexa, ${first}!`,
        body,
        snippet: snippetOf(body),
        people: `${SYSTEM_SENDER.name} ${this.address.addressOf(SYSTEM_SENDER.handle)} ${me.name} ${address}`,
      });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) this.logger.error(`could not send the welcome mail: ${(err as Error).message}`);
    }
  }
}
