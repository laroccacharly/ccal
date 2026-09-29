import type { BookingRequest } from "@ccal/shared"
import { Effect, Schema } from "effect"
import { SqlClient } from "effect/unstable/sql/SqlClient"

export class BookingNotStored extends Schema.TaggedError<BookingNotStored>()("BookingNotStored", {}) {}

type BookingRow = BookingRequest & { id: number }

export const insertBookingRequest = Effect.fn("insertBookingRequest")(function* insertBookingRequest(
  input: BookingRequest,
) {
  const sql = yield* SqlClient
  const rows = yield* sql<BookingRow>`
    INSERT INTO booking_requests (startsAt, timeZone, name, email, description)
    VALUES (${input.startsAt}, ${input.timeZone}, ${input.name}, ${input.email}, ${input.description})
    RETURNING *
  `
  const row = rows[0]
  if (row === undefined) {
    return yield* new BookingNotStored()
  }
  return row
})

export const listBookingRequests = Effect.fn("listBookingRequests")(function* listBookingRequests(email?: string) {
  const sql = yield* SqlClient
  return email === undefined
    ? yield* sql<BookingRow>`SELECT * FROM booking_requests ORDER BY id`
    : yield* sql<BookingRow>`SELECT * FROM booking_requests WHERE email = ${email} ORDER BY id`
})
