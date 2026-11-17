import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { MailItem, MailItemDocument } from "../schemas/schemas";

// The API wraps matched words in control characters; the UI turns them into <mark> itself,
// so message text can never inject markup.
const MARK_OPEN = "\u0001";
const MARK_CLOSE = "\u0002";
const stripMarks = (s: string) => s.replace(/[\u0001\u0002]/g, "");

const wordsOf = (q: string): string[] => [...new Set((q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []))];

function wordRegex(words: string[]): RegExp | null {
  if (words.length === 0) return null;
  const alt = words.sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, "giu");
}

const mark = (text: string, re: RegExp | null) => (re ? stripMarks(text).replace(re, (m) => `${MARK_OPEN}${m}${MARK_CLOSE}`) : stripMarks(text));

/** A short excerpt around the first match, with matches marked. */
function excerpt(body: string, re: RegExp | null, max = 200): string {
  const text = stripMarks(body).replace(/\s+/g, " ").trim();
  if (!re) return text.slice(0, max);
  re.lastIndex = 0;
  const first = re.exec(text);
  if (!first) return text.length > max ? `${text.slice(0, max)}…` : text;

  const start = Math.max(0, first.index - 50);
  const end = Math.min(text.length, start + max);
  return `${start > 0 ? "…" : ""}${mark(text.slice(start, end), re)}${end < text.length ? "…" : ""}`;
}

@Injectable()
export class SearchService {
  constructor(@InjectModel(MailItem.name) private readonly items: Model<MailItemDocument>) {}

  /**
   * Full-text search over ONE user's mail (never anyone else's). Trashed mail is not searchable.
   * Results look like the rest of Nexa's search results so the main search can show them.
   */
  async search(userId: string, rawQuery: string, page: number, pageSize: number) {
    const q = rawQuery.trim();
    if (!q) throw new BadRequestException("Query param 'q' is required");
    if (q.length > 200) throw new BadRequestException("Query is limited to 200 characters");

    const p = Math.max(1, page || 1);
    const size = Math.min(50, Math.max(1, pageSize || 10));
    const filter = { userId, folder: { $ne: "trash" }, $text: { $search: q } };

    const [hits, total] = await Promise.all([
      this.items
        .find(filter, { score: { $meta: "textScore" } })
        .sort({ score: { $meta: "textScore" }, date: -1 })
        .skip((p - 1) * size)
        .limit(size)
        .lean<Array<MailItem & { _id: unknown; score: number }>>(),
      this.items.countDocuments(filter),
    ]);

    const re = wordRegex(wordsOf(q));
    return {
      query: q,
      total,
      page: p,
      pageSize: size,
      items: hits.map((h) => ({
        id: String(h._id),
        type: "mail" as const,
        title: h.subject || "(no subject)",
        titleMarked: mark(h.subject || "(no subject)", re),
        url: `/mail?folder=${h.folder}&item=${String(h._id)}`,
        snippet: excerpt(h.body, re),
        score: Math.round(h.score * 1000) / 1000,
        date: h.date,
      })),
    };
  }
}
