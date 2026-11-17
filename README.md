# Nexa Mail

A simple, **text-only mail service for Nexa users**. People write to each other at `name@nexa.com` and mail is stored in MongoDB. It is its own NestJS project so that mail can change without touching the rest of Nexa.

- **Nexa only.** Mail stays inside Nexa: it can't be sent to or received from Gmail or any other service. `nexa.com` is just a label for addresses (the domain isn't ours); nothing is ever delivered to it on the internet.
- **Plain text and links.** No attachments, no HTML. Web links in a message are made clickable by the UI.
- **Private.** Every request needs a Nexa login token, and every query is scoped to the signed-in person's own mail.

## How it fits with the rest of Nexa

```
 Main UI (/mail page) ──token──▶  Nexa Mail  ──▶ MongoDB  ◀── Nexa API
                                     ▲                          (accounts, `users`)
 Nexa API (main search) ──token──────┘  /search
```

- **Sign-in:** this service only *checks* the login token the Nexa API issues (same `JWT_SECRET`). It never creates tokens.
- **People:** it reads the API's `users` collection read-only. A person's address is `handle@nexa.com`, where `handle` is set on their account by the API (chosen at sign-up, or made from their name).
- **Its own data:** collections `mail_items`, `mail_boxes`, `mail_ratelimits`. It never writes to `users`.
- **Search:** the main Nexa search calls `GET /search` with the user's own token and shows the result as "From your mail" and a Mail tab.

## Run it

```bash
npm install
cp .env.example .env     # fill in MONGODB_URI and JWT_SECRET (the same values the API uses)
npm run dev              # http://localhost:4200
# or
npm run build && npm start
```

| Variable | Needed | Description |
| --- | --- | --- |
| `MONGODB_URI` | yes | The same database the Nexa API uses. |
| `JWT_SECRET` | yes | The same secret the API signs login tokens with. |
| `CORS_ORIGIN` | optional | Browser origins allowed to call this service (the main UI), comma separated. Default `http://localhost:3000`. |
| `MAIL_DOMAIN` | optional | The part after `@`. Default `nexa.com`. |
| `APP_URL` | optional | Main UI address, used for the link in the welcome mail. |
| `MAIL_QUOTA_MB` | optional | Storage each person may use, in MB. Default 10. |
| `SEND_LIMIT_PER_HOUR` | optional | Sends and draft saves per person per hour. Default 150. |
| `PORT` | optional | Default 4200. |

## Endpoints

All need `Authorization: Bearer <Nexa token>` except `/` and `/health`. Errors are `{ "error": "message" }`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | `200` when MongoDB is connected, `503` otherwise. |
| `GET` | `/mailbox` | `{ name, handle, address }`. The first call also sets the mailbox up and delivers the welcome mail. |
| `GET` | `/storage` | `{ used, limit, percent, full }` in bytes: the person's storage use. |
| `GET` | `/folders` | Counts: `inbox`, `sent`, `draft`, `trash`, `starred` (`total`, `unread`). |
| `GET` | `/messages?folder=&page=` | A page of messages (30). Folders: `inbox`, `sent`, `draft`, `trash`, `starred`. |
| `GET` | `/messages/:id` | The full message. Opening it marks it read. |
| `GET` | `/threads/:threadId` | This person's messages in one conversation, oldest first. |
| `POST` | `/messages` | `{ to, cc, subject, body, send, draftId?, replyTo? }`. `send: true` delivers; otherwise saves a draft. |
| `PATCH` | `/messages/:id` | `{ read?, starred? }` |
| `POST` | `/messages/:id/trash` · `/restore` | Move to the trash and back. |
| `DELETE` | `/messages/:id` | Delete for good (only from the trash, or a discarded draft). |
| `DELETE` | `/trash` | Empty the trash. |
| `GET` | `/contacts?q=` | Address suggestions (2+ characters, max 8). |
| `GET` | `/search?q=&page=&pageSize=` | Search the person's own mail (not the trash). Marks matches with `\u0001` … `\u0002`. |

Limits: subject 200 characters, body 20,000, at most 20 recipients, 150 sends per hour per person, **10 MB of storage per person**.

## Storage limit

Each person can hold 10 MB of mail (`MAIL_QUOTA_MB`). Everything they keep counts: inbox, sent, drafts and the trash (until it is emptied). A message counts for its subject, body and people plus a fixed 512 bytes. When a person is full, sending and saving drafts fail with HTTP 413 and a message telling them to delete old messages and empty the Trash. If a *recipient* is full the send is refused and names them; nothing is delivered to anyone and the sender keeps no copy. Reading, trashing and deleting always work, and the welcome mail is exempt.

## The welcome mail

The first time someone opens their mailbox (the first authenticated request) they get a welcome message from `welcome@nexa.com`, signed "The Nexa team". It happens **once per person, ever**: deleting it does not bring it back. A database rule (one `welcome` message per person) means even simultaneous first requests create only one. An account with no address yet is skipped and welcomed on the first request after it gets one. `welcome@nexa.com` and a few other system names can't be written to or claimed.

## Design notes

- **One document per person per message** (`mail_items`). Sending writes a copy for the sender and one for each recipient, so a message is always one read and deleting your copy never affects anyone else's.
- **Search** is a MongoDB text index prefixed by `userId`, so it only ever looks inside one person's mail.
- **Rate limits** live in MongoDB (`mail_ratelimits`, expire on their own), so they hold across serverless instances.
- Written for Vercel as well as a normal host: no in-memory state that matters, no background timers, explicit `@Inject` on every constructor (nothing relies on emitted metadata), and a missing setting gives one readable message.
- `src/schemas/schemas.ts` repeats the shape of the API's `users` documents it reads (`email`, `name`, `handle`). Keep it in step with `search-engine-api`.

## Later (not built)

Real internet email (it would plug in beside the delivery step in `MailService.compose`), attachments, HTML mail with sanitising, labels, push notifications instead of polling for the unread count.
