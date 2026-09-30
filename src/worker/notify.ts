import type { BookingRequest } from "@ccal/shared"
import { CmailClient } from "cmail-client"
import { Config, Effect, Option, Redacted, Schema } from "effect"

export class AdminEmailNotSent extends Schema.TaggedError<AdminEmailNotSent>()(
  "AdminEmailNotSent",
  { detail: Schema.String }
) {
  override get message(): string {
    return this.detail
  }
}

// The booked time as the booker sees it, e.g. "Friday, October 2, 2026 at 13:30 (America/Toronto)".
const bookedAt = ({ startsAt, timeZone }: BookingRequest) =>
  `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(startsAt))} (${timeZone})`

/**
 * Emails ADMIN_EMAIL, through cmail, that a booking request came in. CMAIL_ORIGIN, when set, stands in for
 * cmail's server: the end-to-end tests point the Worker at a fake.
 */
export const notifyAdmin = Effect.fn("notifyAdmin")(function* notifyAdmin(
  booking: BookingRequest
) {
  const client = new CmailClient({
    apiKey: Redacted.value(yield* Config.Redacted("CMAIL_API_KEY")),
    origin: Option.getOrUndefined(
      yield* Config.option(Config.String("CMAIL_ORIGIN"))
    ),
  })
  const to = yield* Config.String("ADMIN_EMAIL")
  return yield* Effect.tryPromise({
    try: async (signal) =>
      await client.sendEmail(
        {
          to,
          title: `New booking request from ${booking.name}`,
          body: [
            `When: ${bookedAt(booking)}`,
            `Name: ${booking.name}`,
            `Email: ${booking.email}`,
            "",
            booking.description,
          ].join("\n"),
        },
        { signal }
      ),
    catch: (cause) =>
      new AdminEmailNotSent({
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
  })
})
