import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router"

import { BookingPage, type Booking } from "@/pages/booking-page"
import { ConfirmationPage } from "@/pages/confirmation-page"

const FormRoute = () => {
  const navigate = useNavigate()
  return <BookingPage onConfirm={(booking) => navigate("/confirm", { state: booking })} />
}

const ConfirmRoute = () => {
  const booking = useLocation().state as Booking | null
  return booking ? <ConfirmationPage booking={booking} /> : <Navigate to="/form" replace />
}

export const App = () => (
  <HashRouter>
    <main className="flex min-h-svh items-center justify-center p-6">
      <Routes>
        <Route path="/form" element={<FormRoute />} />
        <Route path="/confirm" element={<ConfirmRoute />} />
        <Route path="*" element={<Navigate to="/form" replace />} />
      </Routes>
    </main>
  </HashRouter>
)
