import { MEETING_MINUTES } from "@ccal/shared/availability"
import { createMeeting, refreshAccessToken } from "@ccal/shared/google"
import { Config, Effect, Redacted, Result } from "effect"
import { SqlClient } from "effect/unstable/sql/SqlClient"

// How often Cloudflare runs the retry of meetings that are not created yet.
export const RETRY_CRON = "*/15 * * * *"
// Each attempt makes two calls to Google, so a run stays well under a Worker's subrequest limit.
const RETRY_BATCH = 20

// A meeting still to create, with what Google needs from its booking request.
type UnfinishedMeeting = {
  bookingRequestId: number
  eventId: string
  startsAt: string
  name: string
  email: string
  description: string
}

const unfinishedMeetings = (sql: SqlClient) => sql<UnfinishedMeeting>`
  SELECT m.bookingRequestId, m.eventId, b.startsAt, b.name, b.email, b.description
  FROM meetings m JOIN booking_requests b ON b.id = m.bookingRequestId
  WHERE m.status != 'created'
`

/** The meeting of a booking request, unless it is already created. */
export const unfinishedMeeting = Effect.fn("unfinishedMeeting")(function* unfinishedMeeting(bookingRequestId: number) {
  const sql = yield* SqlClient
  const rows = yield* sql<UnfinishedMeeting>`${unfinishedMeetings(sql)} AND m.bookingRequestId = ${bookingRequestId}`
  return rows[0]
})

/**
 * Creates the Google Meet of a booking request, emailing the invite to the booker, and records how it went.
 * A failure (e.g. Google refusing the refresh token) is recorded on the meeting for the next retry, not raised.
 */
export const createBookingMeeting = Effect.fn("createBookingMeeting")(function* createBookingMeeting(
  meeting: UnfinishedMeeting,
) {
  const sql = yield* SqlClient
  const start = new Date(meeting.startsAt)
  const result = yield* Effect.result(
    Effect.gen(function* attempt() {
      const refreshToken = yield* Config.Redacted("GOOGLE_REFRESH_TOKEN")
      const { access_token } = yield* refreshAccessToken(Redacted.value(refreshToken))
      return yield* createMeeting(access_token, {
        id: meeting.eventId,
        title: `Meeting with ${meeting.name}`,
        description: meeting.description,
        start,
        end: new Date(start.getTime() + MEETING_MINUTES * 60_000),
        emails: [meeting.email],
      })
    }),
  )
  if (Result.isSuccess(result)) {
    yield* sql`
      UPDATE meetings
      SET status = 'created', meetLink = ${result.success.hangoutLink ?? null}, attempts = attempts + 1,
        lastError = NULL, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE bookingRequestId = ${meeting.bookingRequestId}
    `
    return "created" as const
  }
  yield* Effect.logWarning(`Creating the meeting of booking request ${meeting.bookingRequestId} failed`, result.failure)
  // A concurrent attempt may have created it meanwhile; never mark a created meeting failed.
  yield* sql`
    UPDATE meetings
    SET status = 'failed', attempts = attempts + 1, lastError = ${result.failure.message},
      updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE bookingRequestId = ${meeting.bookingRequestId} AND status != 'created'
  `
  return "failed" as const
})

/** Tries again to create the meetings that are not created yet, for bookings still to come. */
export const retryMeetings = Effect.fn("retryMeetings")(function* retryMeetings(now: number) {
  const sql = yield* SqlClient
  const due = yield* sql<UnfinishedMeeting>`
    ${unfinishedMeetings(sql)} AND b.startsAt > ${new Date(now).toISOString()}
    ORDER BY b.startsAt LIMIT ${RETRY_BATCH}
  `
  return yield* Effect.forEach(due, createBookingMeeting)
})
