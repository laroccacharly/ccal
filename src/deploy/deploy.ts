// `bun run deploy`: builds the UI, deploys it with the Worker, then waits for /health to answer the commit deployed.
// `bun run deploy login` stores the URL and the Worker's secrets in the OS keyring, and
// `bun run deploy config set TURNSTILE_SITE_KEY <key>` saves the key the UI build embeds.

import { Schema } from "effect"
import * as Deploy from "effect-lib/deploy"

import { CcalUrl, workerSecrets } from "../local/credentials"

Deploy.run(
  {
    app: "ccal",
    url: CcalUrl.name,
    secrets: workerSecrets,
    // Saved in ~/.config/ccal/deploy.json; a variable of the same name in the shell wins over it.
    settings: Schema.Struct({
      // Public: the UI embeds it, so the build, which never sees a secret, needs it.
      TURNSTILE_SITE_KEY: Schema.optionalKey(Schema.String),
    }),
    build: ["bun", "run", "build"],
  },
  { version: "0.0.0" }
)
