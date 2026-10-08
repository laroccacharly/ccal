import { Schema } from "effect"

// Domain schemas shared by the UI and server; no framework or browser dependencies.
export const Contact = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  description: Schema.String,
})
export type Contact = typeof Contact.Type

export const BookingRequest = Schema.Struct({
  ...Contact.fields,
  // ISO datetime, e.g. "2026-10-02T13:00:00.000Z".
  startsAt: Schema.String,
  timeZone: Schema.String,
})
export type BookingRequest = typeof BookingRequest.Type

// A server slot, with its display time in every offered zone.
export const AvailableSlot = Schema.Struct({
  startsAt: Schema.String,
  times: Schema.Record(Schema.String, Schema.String),
})
export type AvailableSlot = typeof AvailableSlot.Type

export const Availability = Schema.Struct({
  now: Schema.String,
  today: Schema.String,
  // Zone offsets from UTC at `now`, in minutes.
  offsets: Schema.Record(Schema.String, Schema.Finite),
  days: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        date: Schema.String,
        slots: Schema.mutable(Schema.Array(AvailableSlot)),
      })
    )
  ),
})
export type Availability = typeof Availability.Type

// A selected slot labelled in the visitor's chosen zone.
export const Slot = Schema.Struct({
  startsAt: Schema.String,
  label: Schema.String,
})
export type Slot = typeof Slot.Type

export const Booking = Schema.Struct({
  date: Schema.String,
  slot: Slot,
  timeZone: Schema.String,
})
export type Booking = typeof Booking.Type

// The Google Meet of a booking request. The server creates it after accepting the booking and retries until it works.
export interface Meeting {
  status: "pending" | "created" | "failed"
  meetLink: string | null
  attempts: number
  // Why the last attempt failed
  lastError: string | null
  // ISO datetime
  updatedAt: string
}
