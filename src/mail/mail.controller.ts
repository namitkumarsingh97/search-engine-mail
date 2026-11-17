import { Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuthedRequest, JwtGuard } from "../auth/jwt.guard";
import { AddressService } from "./address.service";
import { MailService } from "./mail.service";
import { MailboxInterceptor } from "./mailbox.interceptor";
import { SearchService } from "./search.service";

/** Everything here needs a Nexa login token, and everything is about the signed-in person's own mail. */
@Controller()
@UseGuards(JwtGuard)
@UseInterceptors(MailboxInterceptor)
export class MailController {
  constructor(
    @Inject(MailService) private readonly mail: MailService,
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(AddressService) private readonly address: AddressService,
  ) {}

  /** The signed-in person's Nexa address. Also sets the mailbox up (and sends the welcome mail) the first time. */
  @Get("mailbox")
  async mailbox(@Req() req: AuthedRequest) {
    const me = await this.address.person(req.userId);
    if (!me) throw new NotFoundException("This account doesn't have a Nexa address yet.");
    return { name: me.name, handle: me.handle, address: this.address.addressOf(me.handle) };
  }

  @Get("folders")
  folders(@Req() req: AuthedRequest) {
    return this.mail.folders(req.userId);
  }

  @Get("messages")
  list(@Req() req: AuthedRequest, @Query("folder") folder = "inbox", @Query("page") page = "1") {
    return this.mail.list(req.userId, folder, Number(page));
  }

  @Get("messages/:id")
  open(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.mail.open(req.userId, id);
  }

  @Get("threads/:threadId")
  thread(@Req() req: AuthedRequest, @Param("threadId") threadId: string) {
    return this.mail.thread(req.userId, threadId);
  }

  /** Send (`send: true`) or save a draft. Body: { to, cc, subject, body, send, draftId?, replyTo? } */
  @Post("messages")
  compose(@Req() req: AuthedRequest, @Body() body: Record<string, unknown>) {
    return this.mail.compose(req.userId, body ?? {});
  }

  @Patch("messages/:id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: { read?: unknown; starred?: unknown }) {
    return this.mail.update(req.userId, id, body ?? {});
  }

  @Post("messages/:id/trash")
  trash(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.mail.trash(req.userId, id);
  }

  @Post("messages/:id/restore")
  restore(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.mail.restore(req.userId, id);
  }

  @Delete("messages/:id")
  remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.mail.remove(req.userId, id);
  }

  @Delete("trash")
  emptyTrash(@Req() req: AuthedRequest) {
    return this.mail.emptyTrash(req.userId);
  }

  /** Addresses to suggest while typing in the To field. */
  @Get("contacts")
  contacts(@Query("q") q = "") {
    return this.mail.suggest(q);
  }

  /** Search the signed-in person's own mail. The main Nexa search calls this with the user's token. */
  @Get("search")
  searchMail(@Req() req: AuthedRequest, @Query("q") q = "", @Query("page") page = "1", @Query("pageSize") pageSize = "10") {
    return this.search.search(req.userId, q, Number(page), Number(pageSize));
  }
}
