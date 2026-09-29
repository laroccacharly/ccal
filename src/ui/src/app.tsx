import { useState } from "react"

import { BookingPage, type Booking } from "@/pages/booking-page"
import { ConfirmationPage } from "@/pages/confirmation-page"

export const App = () => {
  const [booking, setBooking] = useState<Booking | null>(null)

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      {booking ? <ConfirmationPage booking={booking} /> : <BookingPage onConfirm={setBooking} />}
    </main>
  )
}
