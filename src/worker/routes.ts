import * as Cloudflare from "@alchemy.run/cloudflare"
import type { BookingRequest } from "@ccal/shared"
import { TIME_ZONES, availabilityAt, findSlot } from "@ccal/shared/availability"
import { Clock, Config, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

import { insertBookingRequest, listBookingRequests } from "./bookings"
import type { MeetingOutcome, UnfinishedMeeting } from "./meetings"
import {
  createBookingMeeting,
  retryMeetings,
  unfinishedMeeting,
} from "./meetings"
import { notifyAdmin } from "./notify"
import { HEALTH_PATH } from "./rate-limit"
import {
  TestClockBody,
  currentTime,
  requireTestClock,
  writeTestClock,
} from "./test-clock"
import { TurnstileToken, verifyTurnstile } from "./turnstile"

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {}
) {}

export class SlotUnavailable extends Schema.TaggedError<SlotUnavailable>()(
  "SlotUnavailable",
  {}
) {}

const BookingRequestBody = Schema.Struct({
  turnstileToken: Schema.optionalKey(TurnstileToken),
  startsAt: Schema.NonEmptyString,
  timeZone: Schema.String.check(
    Schema.makeFilter((zone) =>
      TIME_ZONES.some((offered) => offered.value === zone)
    )
  ),
  name: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
}) satisfies Schema.Schema<BookingRequest>

const BookingSearchParams = Schema.Struct({
  email: Schema.optionalKey(Schema.String),
})

// The days and time slots the UI offers, and the time it shows. The Worker decides; the UI only displays it.
const availability = Effect.gen(function* availability() {
  return yield* HttpServerResponse.json(availabilityAt(yield* currentTime))
})

// A concurrent retry already created it; the email then points to the calendar event for its link.
const createdElsewhere: MeetingOutcome = {
  status: "created",
  meetLink: Option.none(),
}

// Cloudflare cancels background work 30 seconds after the response, so Google gets half of it and the email the rest.
const MEETING_TIMEOUT_SECONDS = 15

const meetingTimedOut: MeetingOutcome = {
  status: "failed",
  error: `Google did not answer within ${MEETING_TIMEOUT_SECONDS} seconds`,
}

const createBookingMeetingInTime = (meeting: UnfinishedMeeting) =>
  createBookingMeeting(meeting).pipe(
    Effect.timeoutOption(`${MEETING_TIMEOUT_SECONDS} seconds`),
    Effect.map(Option.getOrElse(() => meetingTimedOut))
  )

// Creates a new booking's Google Meet. Never fails, so the admin is emailed whatever happens: a database error or a
// stalled Google is emailed as a failed Meet, which the scheduled retry tries again.
const bookingMeeting = (bookingRequestId: number) =>
  unfinishedMeeting(bookingRequestId).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(createdElsewhere),
        onSome: createBookingMeetingInTime,
      })
    ),
    Effect.tapCause(Effect.logError),
    Effect.catchTag("SqlError", ({ message }): Effect.Effect<MeetingOutcome> =>
      Effect.succeed({ status: "failed", error: message })
    )
  )

// Only a slot from the current availability can be booked; it is stored in its normalized ISO form.
// Its Google Meet is created after the response is sent, then the admin is emailed with the Meet link. If the Meet
// fails, the email says so and the scheduled retry tries again; the email is sent once, without retries, since a
// retried send may arrive twice.
const createBookingRequest = Effect.gen(function* createBookingRequest() {
  const body = yield* HttpServerRequest.schemaBodyJson(BookingRequestBody)
  const startsAt = findSlot(body.startsAt, yield* currentTime)
  if (Option.isNone(startsAt)) {
    return yield* new SlotUnavailable()
  }
  yield* verifyTurnstile(Option.fromNullishOr(body.turnstileToken))
  const { turnstileToken: _token, ...details } = body
  const booking = yield* insertBookingRequest({
    ...details,
    startsAt: startsAt.value,
  })
  const context = yield* Cloudflare.Workers.WorkerExecutionContext
  // The email failure must not fail the request, but it must not vanish either. `waitUntil` only reports a rejection
  // in production (locally workerd swallows it), so log it at error level first — visible in the dev log and matched
  // by Cloudflare's `$metadata.level = error` — then die, so production also records the invocation as an exception.
  yield* context.waitUntil(
    bookingMeeting(booking.id).pipe(
      Effect.flatMap((meeting) => notifyAdmin(booking, meeting)),
      Effect.tapCause(Effect.logError),
      Effect.orDie
    )
  )
  return yield* HttpServerResponse.json(booking, { status: 201 })
})

const requireApiKey = Effect.gen(function* requireApiKey() {
  const apiKey = yield* Config.Redacted("CCAL_API_KEY")
  const request = yield* HttpServerRequest.HttpServerRequest
  if (request.headers.authorization !== `Bearer ${Redacted.value(apiKey)}`) {
    yield* new Unauthorized()
  }
})

// Lists stored bookings (optionally by ?email=), each with its meeting. Public POST is how the UI books; reading requires CCAL_API_KEY.
const bookingRequests = Effect.gen(function* bookingRequests() {
  yield* requireApiKey
  const params =
    yield* HttpServerRequest.schemaSearchParams(BookingSearchParams)
  const bookings = yield* listBookingRequests(params.email)
  return yield* HttpServerResponse.json(bookings)
})

// Retries the meetings not created yet, as the scheduled retry does, e.g. right after fixing the Google login.
const retryMeetingsNow = Effect.gen(function* retryMeetingsNow() {
  yield* requireApiKey
  const outcomes = yield* retryMeetings(yield* Clock.currentTimeMillis)
  return yield* HttpServerResponse.json({
    created: outcomes.filter(({ status }) => status === "created").length,
    failed: outcomes.filter(({ status }) => status === "failed").length,
  })
})

// Fakes the time availability and bookings are based on, for the end-to-end tests; `{ now: null }` resets it.
// Not found unless the Worker runs with ENABLE_TEST_CLOCK, whatever the API key.
const testClock = Effect.gen(function* testClock() {
  yield* requireTestClock
  // Read the body before checking the key. Locally, rejecting a request whose body was never read leaves its connection
  // broken, and the test's next request, sent on that same reused connection, fails with "socket hang up".
  const { now } = yield* HttpServerRequest.schemaBodyJson(TestClockBody)
  yield* requireApiKey
  return yield* HttpServerResponse.json({ now: yield* writeTestClock(now) })
})

// The commit deployed, which `bun run deploy` waits for this to answer.
const health = Effect.gen(function* health() {
  return yield* HttpServerResponse.json({
    version: yield* Config.String("DEPLOY_VERSION"),
  })
})

export const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/api/availability", availability),
  HttpRouter.add("POST", "/api/booking-requests", createBookingRequest),
  HttpRouter.add("GET", "/api/booking-requests", bookingRequests),
  HttpRouter.add("POST", "/api/meetings/retry", retryMeetingsNow),
  HttpRouter.add("POST", "/api/test-clock", testClock),
  HttpRouter.add("GET", HEALTH_PATH, health)
)
