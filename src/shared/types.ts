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

// A bookable slot: its start as an ISO datetime, and that start as "HH:mm" (24h) in each offered time zone.
export interface AvailableSlot {
  startsAt: string
  times: Record<string, string>
}

// What can be booked, and the server's time, which is the only clock the UI uses.
export interface Availability {
  // The server's current time, as an ISO datetime
  now: string
  // The current day ("YYYY-MM-DD") in the host's calendar
  today: string
  // Each offered time zone's offset from UTC at `now`, in minutes (e.g. -240 for Montreal in summer)
  offsets: Record<string, number>
  // Each bookable day ("YYYY-MM-DD", host calendar) with its slots
  days: { date: string; slots: AvailableSlot[] }[]
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
