# ccal 

Assume .env.example var are in shell env 

ccal login, to login with google 
ccal meet create --email=test@example.com, create a meeting link for that person and send the email. 
ccal config, print the saved config; ccal config --set-url=https://cal.example.com, save the URL the Worker is deployed to (in `~/.config/ccal/config.json`). `bun run deploy` attaches its host to the Worker as a custom domain (the zone must be in your Cloudflare account; a `workers.dev` URL is left as is).

## Setup

1. In the Google Cloud Console, create a project and enable the **Google Calendar API**.
2. Configure the **OAuth consent screen** (External) and add your Google account as a test user.
   While the app is in "Testing" mode Google expires the login after 7 days; publish it
   ("In production") to keep it indefinitely.
3. Create an **OAuth client ID** of type **Desktop app** and put its ID and secret in
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. `bun install && bun link` to put `ccal` on your PATH, then `ccal login`.

The login token is stored in `~/.config/ccal/token.json`. The CLI (`src/cli/`) is written with Effect.

## Options for `ccal meet create`

- `--email` — attendee, repeat for several people (required)
- `--title` — event title, default "Meeting"
- `--start` — e.g. `2026-09-29T15:00` in local time, default now
- `--duration` — minutes, default 30

Google sends the invite email itself (with the Meet link); the link is also printed to stdout.

## Deploy

One Cloudflare Worker (`src/worker`, written with Effect) serves the built UI (`src/ui/dist`) as static assets and the booking API under `/api/*`, backed by D1 (`migrations/`). It is deployed with Alchemy (`alchemy.run.ts`).

```sh
bun run plan        # preview infra changes
bun run deploy      # builds the UI, then deploys
bun dev             # builds the UI, then alchemy dev: the Worker serves it and /api on http://localhost:1337 (+ local D1)
```

`bun test:e2e` builds the UI and runs the stack under `alchemy dev --stage e2e` on port 3100. Listing bookings (`GET /api/booking-requests[?email=]`) requires `Authorization: Bearer $CCAL_API_KEY`; set `CCAL_API_KEY` in `.env` before `bun dev` or `deploy` (e.g. `openssl rand -hex 32`). Booking (`POST`) stays public for the UI. The e2e run uses its own key.

The Worker's compatibility date must not be newer than what Alchemy's bundled workerd supports (it fails with a `ConfigError` otherwise).

Cloudflare credentials come from env vars, not an Alchemy profile: set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (see `.env.example`). Alchemy state is kept locally in `.alchemy/`.

Versions: alchemy `2.0.0-beta.79` requires effect `>=4.0.0-rc.115`, but effect `rc.118` moved `effect/unstable/cli` to `effect/cli` and breaks it. All effect packages are pinned to `4.0.0-rc.117` (see `overrides` in `package.json`).
