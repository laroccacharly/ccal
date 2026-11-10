# ccal

A minimal Cal clone. Visitors pick a time slot on a web page and send a booking request, and the app emails them a Google Meet invite. The admin also receives a notification email.

## Demo

[![ccal demo](https://img.youtube.com/vi/I_TaOakOukE/maxresdefault.jpg)](https://youtu.be/I_TaOakOukE)

Why:

- You own how you define your availability
- You own the customer experience
- A self-contained problem
- Good for learning; builds on the fundamentals

## Features

For a backend of roughly 1,000 lines of TypeScript, we have

- Self-service booking: pick a date and time
- Timezone picker
- Server-driven time
- User info form
- Turnstile protection on the booking POST
- Google Meet integration
- Admin notification email
- Rate limiting
- E2E and smoke tests

## Stack

- effect-ts
- Cloudflare
- Alchemy for infrastructure as code
- Playwright E2E and smoke tests

## Develop and deploy

```sh
bun dev             # run locally on http://localhost:1337
bun test:e2e        # end-to-end tests
bun run deploy login  # store the URL and secrets (.env.example) in the OS keyring
bun run deploy      # rebuild the UI, deploy, then wait for /health to answer the commit
bun run test:smoke  # smoke test against the deployed app
```

## License

MIT
