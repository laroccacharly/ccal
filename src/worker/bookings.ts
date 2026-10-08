import type { BookingRequest, Meeting } from "@ccal/shared"
import { Effect, Schema } from "effect"
import type { SqlError } from "effect/sql"
import { SqlClient } from "effect/sql"

export class BookingNotStored extends Schema.TaggedError<BookingNotStored>()(
  "BookingNotStored",
  {}
) {}

type BookingRow = BookingRequest & { id: number }

export const insertBookingRequest: (
  input: BookingRequest
) => Effect.Effect<
  BookingRow,
  SqlError.SqlError | BookingNotStored,
  SqlClient.SqlClient
> = Effect.fn("insertBookingRequest")(function* insertBookingRequest(
  input: BookingRequest
) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<BookingRow>`
    INSERT INTO booking_requests (startsAt, timeZone, name, email, description)
    VALUES (${input.startsAt}, ${input.timeZone}, ${input.name}, ${input.email}, ${input.description})
    RETURNING *
  `
  const [row] = rows
  if (row === undefined) {
    return yield* new BookingNotStored()
  }
  return row
})

type ListedRow = BookingRow & {
  meetingStatus: Meeting["status"] | null
  meetLink: string | null
  attempts: number | null
  lastError: string | null
  updatedAt: string | null
}

// Each booking with its meeting; null for bookings stored before meetings were created.
const withMeeting = ({
  meetingStatus,
  meetLink,
  attempts,
  lastError,
  updatedAt,
  ...booking
}: ListedRow) => ({
  ...booking,
  meeting:
    meetingStatus === null
      ? null
      : ({
          status: meetingStatus,
          meetLink,
          attempts: attempts ?? 0,
          lastError,
          updatedAt: updatedAt ?? "",
        } satisfies Meeting),
})

export const listBookingRequests: (
  email?: string
) => Effect.Effect<
  (BookingRow & { meeting: Meeting | null })[],
  SqlError.SqlError,
  SqlClient.SqlClient
> = Effect.fn("listBookingRequests")(function* listBookingRequests(
  email?: string
) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<ListedRow>`
    SELECT b.*, m.status AS meetingStatus, m.meetLink, m.attempts, m.lastError, m.updatedAt
    FROM booking_requests b LEFT JOIN meetings m ON m.bookingRequestId = b.id
    ${email === undefined ? sql`` : sql`WHERE b.email = ${email}`}
    ORDER BY b.id
  `
  return rows.map(withMeeting)
})
