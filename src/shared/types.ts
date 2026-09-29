// Types shared by the UI and the server.

export type Contact = { name: string; email: string; description: string }

export type BookingRequest = Contact & {
  startsAt: string // ISO datetime, e.g. "2026-10-02T13:00:00.000Z"
  timeZone: string // the booker's IANA zone, e.g. "Europe/Paris"
}
