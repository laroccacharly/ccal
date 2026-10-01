# ccal

Cal minimal clone. Visitors pick a time slot on a web page and send a booking request, and the app emails them a Google Meet invite. Admin also receives a notification email.

## Stack

- effect-ts
- cloudflare worker and email
- google-meet

## Requirements

- [Bun](https://bun.sh)
- A Google Cloud project with the Google Calendar API enabled
- A Cloudflare account

## Setup

1. In the Google Cloud Console, create a project and enable the **Google Calendar API**.
2. Configure the **OAuth consent screen** (External) and add your Google account as a test user. While the app is in "Testing" mode, Google expires the login after 7 days. Publish it ("In production") to keep it indefinitely.
3. Create an **OAuth client ID** of type **Desktop app**.
4. Copy `.env.example` to `.env` and fill it in:
   - Google OAuth client: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - Cloudflare: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`
   - A random `CCAL_API_KEY`, e.g. from `openssl rand -hex 32`
   - A Cloudflare Turnstile widget (Managed) that allows your app's hostname: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`. For local development, Cloudflare's [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) work; never deploy them.
5. `bun install && bun link` puts `ccal` on your PATH. Then run `ccal login`: the deployed app sends invites from that Google account.

## Usage

```sh
ccal meet create --email=someone@example.com   # create a Meet invite; Google emails it
ccal config --set-url=https://cal.example.com  # the URL the app is deployed to
```

## Develop and deploy

```sh
bun dev             # run locally on http://localhost:1337
bun test:e2e        # end-to-end tests
bun run deploy      # deploy to Cloudflare at the URL set with `ccal config --set-url` (required)
bun run test:smoke  # smoke test against the deployed app
```
