// Types shared by the UI and the server.

export type Contact = { name: string; email: string; description: string }

export type BookingRequest = Contact & {
  startsAt: string // ISO datetime, e.g. "2026-10-02T13:00:00.000Z"
  timeZone: string // the booker's IANA zone, e.g. "Europe/Paris"
}

// What can be booked: each day ("YYYY-MM-DD", host calendar) with its slots as ISO datetimes.
export type Availability = { days: { date: string; slots: string[] }[] }

// The Google Meet of a booking request. The server creates it after accepting the booking and retries until it works.
export type Meeting = {
  status: "pending" | "created" | "failed"
  meetLink: string | null
  attempts: number
  lastError: string | null // why the last attempt failed
  updatedAt: string // ISO datetime
}
