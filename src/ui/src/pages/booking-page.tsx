import type { Booking } from "@ccal/shared"
import { Runtime } from "foldkit"
import { useEffect, useRef } from "react"

import { Model, init, ports, subscriptions, update } from "@/booking/model"
import { view } from "@/booking/view"

// React owns this boundary; Foldkit owns everything inside the empty container.
export const BookingPage = ({
  onConfirm,
}: {
  onConfirm: (booking: Booking) => void
}) => {
  const container = useRef<HTMLDivElement>(null)
  const confirmed = useRef(onConfirm)
  useEffect(() => {
    confirmed.current = onConfirm
  }, [onConfirm])

  useEffect(() => {
    if (container.current === null) {
      return () => {
        // No runtime was mounted.
      }
    }
    // Foldkit replaces its root node. Keep that node below the React-owned host.
    const host = container.current
    const root = document.createElement("div")
    root.id = "booking-program"
    host.append(root)
    const handle = Runtime.embed(
      Runtime.makeElement({
        Model,
        init,
        update,
        view,
        ports,
        subscriptions,
        container: root,
      })
    )
    const unsubscribe = handle.ports.confirmed.subscribe((booking) => {
      confirmed.current(booking)
    })
    return () => {
      unsubscribe()
      handle.dispose()
      host.replaceChildren()
    }
  }, [])

  return <div ref={container} data-testid="foldkit-booking" />
}
