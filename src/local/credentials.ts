import * as Credentials from "effect-lib/credentials"

// What deploying ccal needs, read from the environment first, then the OS keyring, where `bun run deploy login`
// stores it. Shared by `bun run deploy` and the smoke test, which targets the same URL.

/** Where visitors load the app, e.g. https://cal.example.com; its host is attached to the Worker as a custom domain. */
export const CcalUrl = Credentials.secret("CCAL_URL", {
  label: "ccal URL",
  sensitive: false,
})

/** The Worker's secrets, handed to alchemy as the environment variables of the same names. */
export const workerSecrets = [
  // Required to read bookings (GET /api/booking-requests).
  Credentials.secret("CCAL_API_KEY", { label: "ccal API key" }),
  Credentials.secret("TURNSTILE_SECRET_KEY", { label: "Turnstile secret key" }),
  // The OAuth client the Worker creates Meet invites with, and `ccal login` logs in with.
  Credentials.secret("GOOGLE_CLIENT_ID", {
    label: "Google OAuth client id",
    sensitive: false,
  }),
  Credentials.secret("GOOGLE_CLIENT_SECRET", {
    label: "Google OAuth client secret",
  }),
  // To email ADMIN_EMAIL about each booking request, through cmail.
  Credentials.secret("CMAIL_API_KEY", { label: "cmail API key" }),
  Credentials.secret("ADMIN_EMAIL", {
    label: "Admin email address",
    sensitive: false,
  }),
]
