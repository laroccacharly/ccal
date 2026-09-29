import { ArrowLeft01Icon, ArrowRight01Icon, Clock01Icon, Video01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Availability } from "@ccal/shared"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/components/ui/lib/utils"
import { getAvailability } from "@/lib/api"
import { formatSelectedDate, fromIsoDate, isoDate, monthLabel } from "@/lib/dates"
import { HOST_TIME_ZONE, TIME_ZONES, slotsIn, type Slot } from "@/lib/slots"

export type Booking = { date: string; slot: Slot; timeZone: string }

// Bookable days mapped to their slots (ISO datetimes), or why they are not known yet.
type Days = Map<string, string[]> | "loading" | "error"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const Panel = ({ className, ...props }: React.ComponentProps<"section">) => (
  <section className={cn("rounded-3xl border bg-card p-6", className)} {...props} />
)

const MeetingInfo = () => (
  <Panel className="flex flex-col gap-4 md:w-56">
    <h1 className="text-xl font-semibold">Book a Meeting</h1>
    <p className="flex items-center gap-2 text-muted-foreground">
      <HugeiconsIcon icon={Clock01Icon} className="size-4" /> 30 min
    </p>
    <p className="flex items-center gap-2 text-muted-foreground">
      <HugeiconsIcon icon={Video01Icon} className="size-4" /> Google Meet
    </p>
  </Panel>
)

const Banner = ({ testId, children }: { testId: string; children: React.ReactNode }) => (
  <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-card/70 backdrop-blur-[1px]">
    <p data-testid={testId} role="status" className="rounded-2xl border bg-card px-4 py-2 text-sm font-medium shadow-sm">
      {children}
    </p>
  </div>
)

const Calendar = ({
  days: bookable,
  selected,
  onSelect,
}: {
  days: Days
  selected: string | null
  onSelect: (date: string) => void
}) => {
  const [today] = useState(() => new Date())
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const monthsAhead = (view.year - today.getFullYear()) * 12 + view.month - today.getMonth()
  const isBookable = (date: string) => typeof bookable !== "string" && bookable.has(date)
  // The last month with a bookable day, counted from the current one.
  const lastDate = typeof bookable === "string" ? undefined : [...bookable.keys()].at(-1)
  const last = lastDate ? fromIsoDate(lastDate) : today
  const maxMonthsAhead = (last.getFullYear() - today.getFullYear()) * 12 + last.getMonth() - today.getMonth()

  const leadingBlanks = new Date(view.year, view.month, 1).getDay()
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => isoDate(new Date(view.year, view.month, i + 1)))
  const noAvailableDays = typeof bookable !== "string" && !days.some(isBookable)

  const shiftMonth = (delta: number) => {
    const next = new Date(view.year, view.month + delta, 1)
    setView({ year: next.getFullYear(), month: next.getMonth() })
  }

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous month"
          data-testid="prev-month"
          disabled={monthsAhead <= 0}
          onClick={() => shiftMonth(-1)}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} />
        </Button>
        <h2 data-testid="month-label" className="font-semibold">
          {monthLabel(view.year, view.month)}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next month"
          data-testid="next-month"
          disabled={monthsAhead >= maxMonthsAhead}
          onClick={() => shiftMonth(1)}
        >
          <HugeiconsIcon icon={ArrowRight01Icon} />
        </Button>
      </div>

      <p data-testid="selected-date" className="rounded-2xl bg-muted px-4 py-2 text-center text-sm">
        {selected ? formatSelectedDate(selected) : "Select a date"}
      </p>

      <div className="relative grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} className="pb-1 text-xs text-muted-foreground">
            {weekday}
          </span>
        ))}
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {days.map((date) => (
          <Button
            key={date}
            variant={date === selected ? "default" : "ghost"}
            size="icon"
            data-testid="day"
            data-date={date}
            aria-pressed={date === selected}
            disabled={!isBookable(date)}
            onClick={() => onSelect(date)}
          >
            {Number(date.slice(8))}
          </Button>
        ))}
        {noAvailableDays && <Banner testId="no-available-days">No available days this month</Banner>}
        {bookable === "error" && <Banner testId="availability-error">Could not load available days</Banner>}
      </div>
    </Panel>
  )
}

const CurrentTime = ({ timeZone }: { timeZone: string }) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now)

  return (
    <p data-testid="current-time" className="text-sm text-muted-foreground">
      Current time: {time}
    </p>
  )
}

const TimePicker = ({
  days,
  date,
  onConfirm,
}: {
  days: Days
  date: string | null
  onConfirm: (booking: Booking) => void
}) => {
  const [timeZone, setTimeZone] = useState(HOST_TIME_ZONE)
  const [selected, setSelected] = useState<string | null>(null)
  // Until a date is picked, the first bookable day's slots are shown, disabled.
  const startsAts = typeof days === "string" ? [] : ((date ? days.get(date) : days.values().next().value) ?? [])
  const slots = slotsIn(startsAts, timeZone)
  const slot = date ? slots.find((s) => s.startsAt === selected) : undefined

  return (
    <Panel className="flex flex-col gap-3 md:w-56">
      <h2 className="font-semibold">Time</h2>
      <select
        data-testid="timezone-select"
        aria-label="Time zone"
        value={timeZone}
        onChange={(event) => setTimeZone(event.target.value)}
        className="h-9 rounded-4xl border bg-background px-3 text-sm"
      >
        {TIME_ZONES.map((zone) => (
          <option key={zone.value} value={zone.value}>
            {zone.label}
          </option>
        ))}
      </select>
      <CurrentTime timeZone={timeZone} />

      {slots.map((s) => (
        <Button
          key={s.startsAt}
          variant={s === slot ? "default" : "outline"}
          data-testid="time-slot"
          aria-pressed={s === slot}
          disabled={!date}
          onClick={() => setSelected(s.startsAt)}
        >
          {s.label}
        </Button>
      ))}

      <Button
        size="lg"
        className="mt-auto"
        data-testid="confirm-button"
        disabled={!date || !slot}
        onClick={() => date && slot && onConfirm({ date, slot, timeZone })}
      >
        Ok
      </Button>
    </Panel>
  )
}

export const BookingPage = ({ onConfirm }: { onConfirm: (booking: Booking) => void }) => {
  const [date, setDate] = useState<string | null>(null)
  const [days, setDays] = useState<Days>("loading")

  useEffect(() => {
    let active = true
    getAvailability().then(
      (availability: Availability) => active && setDays(new Map(availability.days.map((day) => [day.date, day.slots]))),
      () => active && setDays("error"),
    )
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="flex flex-col gap-4 rounded-4xl border p-4 md:flex-row">
      <MeetingInfo />
      <Calendar days={days} selected={date} onSelect={setDate} />
      <TimePicker days={days} date={date} onConfirm={onConfirm} />
    </div>
  )
}
