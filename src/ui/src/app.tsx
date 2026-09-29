import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router"

import { BookingPage, type Booking } from "@/pages/booking-page"
import { ConfirmationPage } from "@/pages/confirmation-page"
import { SuccessPage, type ConfirmedBooking } from "@/pages/success-page"

const FormRoute = () => {
  const navigate = useNavigate()
  return <BookingPage onConfirm={(booking) => navigate("/confirm", { state: booking })} />
}

const ConfirmRoute = () => {
  const navigate = useNavigate()
  const booking = useLocation().state as Booking | null
  if (!booking) return <Navigate to="/form" replace />
  return (
    <ConfirmationPage
      booking={booking}
      onConfirm={(contact) => navigate("/success", { state: { ...booking, ...contact } satisfies ConfirmedBooking })}
    />
  )
}

const SuccessRoute = () => {
  const booking = useLocation().state as ConfirmedBooking | null
  return booking ? <SuccessPage booking={booking} /> : <Navigate to="/form" replace />
}

export const App = () => (
  <HashRouter>
    <main className="flex min-h-svh items-center justify-center p-6">
      <Routes>
        <Route path="/form" element={<FormRoute />} />
        <Route path="/confirm" element={<ConfirmRoute />} />
        <Route path="/success" element={<SuccessRoute />} />
        <Route path="*" element={<Navigate to="/form" replace />} />
      </Routes>
    </main>
  </HashRouter>
)
