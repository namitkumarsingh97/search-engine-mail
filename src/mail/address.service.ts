import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { Model, isValidObjectId } from "mongoose";
import { AppConfig } from "../config/configuration";
import { Person, UserRef, UserRefDocument } from "../schemas/schemas";

/** Addresses the system itself uses. Nobody can own them, and they can't receive mail. */
const SYSTEM_HANDLES = new Set(["welcome", "noreply", "no-reply", "postmaster", "mailer-daemon"]);

export interface Contact {
  name: string;
  email: string;
}

@Injectable()
export class AddressService {
  private readonly domain: string;

  constructor(
    @InjectModel(UserRef.name) private readonly users: Model<UserRefDocument>,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.domain = config.get<AppConfig>("app")!.domain;
  }

  addressOf = (handle: string) => `${handle}@${this.domain}`;

  /** The shape the UI uses for a person: a name and a full address (in the `email` field). */
  toContact = (p: Person): Contact => ({ name: p.name, email: this.addressOf(p.handle) });

  /**
   * Turns whatever the user typed into a handle: "Ada", "ada@nexa.com" and " ADA@NEXA.COM " are all "ada".
   * Any other domain is refused, because mail never leaves Nexa.
   */
  parseHandle(raw: string): string {
    const text = raw.trim().toLowerCase();
    const at = text.lastIndexOf("@");
    if (at === -1) return text;
    if (text.slice(at + 1) !== this.domain) {
      throw new BadRequestException(`"${raw.trim()}" is not a Nexa address. Mail can only be sent to @${this.domain} addresses.`);
    }
    return text.slice(0, at);
  }

  /** "ada@nexa.com, ben  carl@nexa.com" -> ["ada", "ben", "carl"] (no duplicates). */
  parseList(raw: unknown): string[] {
    const parts = (Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[,;\s]+/)).map((s) => s.trim()).filter(Boolean);
    return [...new Set(parts.map((p) => this.parseHandle(p)))];
  }

  /** Finds the accounts behind the given handles. Throws a clear 400 naming any that don't exist. */
  async resolve(handles: string[]): Promise<Map<string, Person>> {
    const system = handles.filter((h) => SYSTEM_HANDLES.has(h));
    if (system.length > 0) {
      throw new BadRequestException(`${system.map(this.addressOf).join(", ")} is an automated address and can't receive mail.`);
    }

    const found = await this.users.find({ handle: { $in: handles } }).select("name handle");
    const byHandle = new Map<string, Person>(found.map((u) => [u.handle!, { userId: String(u._id), name: u.name, handle: u.handle! }]));

    const unknown = handles.filter((h) => !byHandle.has(h));
    if (unknown.length > 0) {
      throw new BadRequestException(`No Nexa account for: ${unknown.map(this.addressOf).join(", ")}`);
    }
    return byHandle;
  }

  /** Like resolve(), but quietly skips unknown addresses. For drafts, which may name people who don't exist yet. */
  async resolveLoose(handles: string[]): Promise<Map<string, Person>> {
    const found = await this.users.find({ handle: { $in: handles } }).select("name handle");
    return new Map<string, Person>(found.map((u) => [u.handle!, { userId: String(u._id), name: u.name, handle: u.handle! }]));
  }

  /** The signed-in person as a Person, or null if the account has no Nexa address yet. */
  async person(userId: string): Promise<Person | null> {
    if (!isValidObjectId(userId)) return null;
    const user = await this.users.findById(userId).select("name handle");
    return user?.handle ? { userId, name: user.name, handle: user.handle } : null;
  }

  /** Accounts whose address or name starts with what was typed, for the To field. */
  async suggest(query: string): Promise<Contact[]> {
    const q = query.trim().toLowerCase().replace(/@.*$/, "");
    if (q.length < 2) return [];
    const re = new RegExp(`^${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    const users = await this.users.find({ handle: { $exists: true }, $or: [{ handle: re }, { name: re }] }).select("name handle").limit(8);
    return users.map((u) => ({ name: u.name, email: this.addressOf(u.handle!) }));
  }
}
