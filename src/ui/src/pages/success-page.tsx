import { formatSelectedDate } from "@/lib/dates"
import { timeZoneLabel } from "@/lib/slots"
import type { Contact } from "@/lib/validation"
import type { Booking } from "@/pages/booking-page"

export type ConfirmedBooking = Booking & Contact

export const SuccessPage = ({ booking }: { booking: ConfirmedBooking }) => (
  <section data-testid="success-page" className="flex w-80 flex-col gap-3 rounded-3xl border bg-card p-6">
    <h1 className="text-xl font-semibold">You're booked!</h1>
    <p data-testid="success-date">{formatSelectedDate(booking.date)}</p>
    <p data-testid="success-time">
      {booking.slot.label} ({timeZoneLabel(booking.timeZone)})
    </p>
    <p data-testid="success-name">{booking.name}</p>
    <p data-testid="success-email">{booking.email}</p>
    <p data-testid="success-description" className="whitespace-pre-wrap text-muted-foreground">
      {booking.description}
    </p>
  </section>
)
