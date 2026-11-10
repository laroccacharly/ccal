import type { BookingRequest } from "@ccal/shared"
import { Cmail } from "cmail-client"
import { Config, Effect, Option, Schema } from "effect"
import type { HttpClient } from "effect/http"

import type { MeetingOutcome } from "./meetings"
import { RETRY_CRON_MINUTES } from "./meetings"

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

const meetingLine = (meeting: MeetingOutcome) => {
  if (meeting.status === "failed") {
    return `Google Meet: not created yet (${meeting.error}); it is retried every ${RETRY_CRON_MINUTES} minutes`
  }
  return Option.match(meeting.meetLink, {
    onNone: () => "Google Meet: created; its link is on the calendar event",
    onSome: (link) => `Google Meet: ${link}`,
  })
}

/**
 * Emails ADMIN_EMAIL, through cmail, that a booking request came in, with its Google Meet link. CMAIL_ORIGIN, when set, stands in for
 * cmail's server: the end-to-end tests point the Worker at a fake.
 */
export const notifyAdmin: (
  booking: BookingRequest,
  meeting: MeetingOutcome
) => Effect.Effect<
  {
    readonly id: number
    readonly messageId: string
    readonly to: string
    readonly from: string
    readonly title: string
  },
  AdminEmailNotSent,
  HttpClient.HttpClient
> = Effect.fn("notifyAdmin")(
  function* notifyAdmin(booking: BookingRequest, meeting: MeetingOutcome) {
    const to = yield* Config.String("ADMIN_EMAIL")
    const cmail = yield* Cmail
    return yield* cmail.sendEmail({
      to,
      title: `New booking request from ${booking.name}`,
      body: [
        `When: ${bookedAt(booking)}`,
        `Name: ${booking.name}`,
        `Email: ${booking.email}`,
        meetingLine(meeting),
        "",
        booking.description,
      ].join("\n"),
    })
  },
  Effect.provide(Cmail.layerConfig),
  Effect.mapError((cause) => new AdminEmailNotSent({ detail: cause.message }))
)
