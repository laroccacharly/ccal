# ccal

Cal minimal clone. Visitors pick a time slot on a web page and send a booking request, and the app emails them a Google Meet invite. Admin also receives a notification email.

## Features

- Self-serving booking, pick a time and date
- Timezone picker
- Server-driven time
- User info form
- Turnstile protection on the post
- Google meet integration
- Admin notification email
- Rate limiting
- E2E and smoke tests

## Stack

- effect-ts
- cloudflare
- alchemy for Infra as Code
- Playwright E2E and smoke tests

## Develop and deploy

```sh
bun dev             # run locally on http://localhost:1337
bun test:e2e        # end-to-end tests
bun alchemy deploy
bun run test:smoke  # smoke test against the deployed app
```

## License

MIT
