import type { Contact, Booking } from "@ccal/shared"

import { formatSelectedDate } from "@/lib/dates"
import { timeZoneLabel } from "@/lib/slots"

export type ConfirmedBooking = Booking & Contact

export const SuccessPage = ({ booking }: { booking: ConfirmedBooking }) => (
  <section
    data-testid="success-page"
    className="bg-card flex w-80 flex-col gap-3 rounded-3xl border p-6"
  >
    <h1 className="text-xl font-semibold">You&apos;re booked!</h1>
    <p data-testid="success-date">{formatSelectedDate(booking.date)}</p>
    <p data-testid="success-time">
      {booking.slot.label} ({timeZoneLabel(booking.timeZone)})
    </p>
    <p data-testid="success-name">{booking.name}</p>
    <p data-testid="success-email">{booking.email}</p>
    <p
      data-testid="success-description"
      className="text-muted-foreground whitespace-pre-wrap"
    >
      {booking.description}
    </p>
    <p
      data-testid="success-meeting-link-message"
      className="text-muted-foreground text-sm"
    >
      Check your inbox: an email with the Google Meet link is on its way to{" "}
      {booking.email}.
    </p>
  </section>
)
