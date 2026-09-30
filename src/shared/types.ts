// Types shared by the UI and the server.

export interface Contact {
  name: string
  email: string
  description: string
}

export type BookingRequest = Contact & {
  // ISO datetime, e.g. "2026-10-02T13:00:00.000Z"
  startsAt: string
  // The booker's IANA zone, e.g. "Europe/Paris"
  timeZone: string
}

// What can be booked: each day ("YYYY-MM-DD", host calendar) with its slots as ISO datetimes.
export interface Availability {
  days: { date: string; slots: string[] }[]
}

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
