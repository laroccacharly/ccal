import { createMeeting } from "@ccal/shared/google"
import { Console, Effect, Option, Schema } from "effect"
import { Command, Flag } from "effect/unstable/cli"

import { accessToken } from "../../local/google-login"

export class InvalidMeeting extends Schema.TaggedError<InvalidMeeting>()(
  "InvalidMeeting",
  { detail: Schema.String }
) {
  override get message(): string {
    return this.detail
  }
}

const create = Command.make(
  "create",
  {
    email: Flag.String("email").pipe(
      Flag.withDescription("Attendee email; repeat for several people"),
      Flag.atLeast(1)
    ),
    title: Flag.String("title").pipe(
      Flag.withDescription("Event title"),
      Flag.withDefault("Meeting")
    ),
    start: Flag.String("start").pipe(
      Flag.withDescription(
        "ISO date-time, e.g. 2026-09-29T15:00 (local time). Default: now"
      ),
      Flag.optional
    ),
    duration: Flag.Int("duration").pipe(
      Flag.withDescription("Length in minutes"),
      Flag.withDefault(30)
    ),
  },
  Effect.fn("meetCreateCommand")(function* meetCreateCommand({
    email,
    title,
    start: startFlag,
    duration,
  }) {
    const start = Option.match(startFlag, {
      onNone: () => new Date(),
      onSome: (value) => new Date(value),
    })
    if (Number.isNaN(start.getTime())) {
      yield* new InvalidMeeting({
        detail: `Invalid --start: ${Option.getOrElse(startFlag, () => "")}`,
      })
    }
    if (duration <= 0) {
      yield* new InvalidMeeting({
        detail: `Invalid --duration: ${duration}`,
      })
    }
    const end = new Date(start.getTime() + duration * 60_000)

    const event = yield* createMeeting(yield* accessToken, {
      title,
      start,
      end,
      emails: email,
    })
    yield* Console.log(event.hangoutLink ?? "(no Meet link was returned)")
    yield* Console.error(
      `Invite sent to ${email.join(", ")} for ${start.toLocaleString()}.`
    )
  })
).pipe(
  Command.withDescription(
    "Create a Google Meet and email the invite to the attendees"
  )
)

export const meetCommand = Command.make("meet").pipe(
  Command.withDescription("Google Meet meetings"),
  Command.withSubcommands([create])
)
