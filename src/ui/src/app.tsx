import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router"

import { BookingPage } from "@/pages/booking-page"
import type { Booking } from "@/pages/booking-page"
import { ConfirmationPage } from "@/pages/confirmation-page"
import { SuccessPage } from "@/pages/success-page"
import type { ConfirmedBooking } from "@/pages/success-page"

// The booking carried over from the previous step, or null when the page is opened directly.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- T names the state the caller expects
const useStepState = <T,>(): T | null => {
  const state: unknown = useLocation().state
  // SAFETY: only the previous step's navigate() sets location state, and it sets a T.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return state as T | null
}

const FormRoute = () => {
  const navigate = useNavigate()
  return (
    <BookingPage
      onConfirm={(booking) => {
        void navigate("/confirm", { state: booking })
      }}
    />
  )
}

const ConfirmRoute = () => {
  const navigate = useNavigate()
  const booking = useStepState<Booking>()
  if (booking === null) {
    return <Navigate to="/form" replace />
  }
  return (
    <ConfirmationPage
      booking={booking}
      onConfirm={(contact) => {
        void navigate("/success", {
          state: { ...booking, ...contact } satisfies ConfirmedBooking,
        })
      }}
    />
  )
}

const SuccessRoute = () => {
  const booking = useStepState<ConfirmedBooking>()
  return booking === null ? (
    <Navigate to="/form" replace />
  ) : (
    <SuccessPage booking={booking} />
  )
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
