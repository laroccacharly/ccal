import type { Availability, AvailableSlot } from "@ccal/shared"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Clock01Icon,
  Video01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/components/ui/lib/utils"
import { getAvailability } from "@/lib/api"
import {
  daysInMonth,
  firstWeekday,
  formatSelectedDate,
  isoDate,
  monthLabel,
  timeAtOffset,
  yearMonth,
} from "@/lib/dates"
import {
  HOST_TIME_ZONE,
  MEETING_MINUTES,
  TIME_ZONES,
  slotsIn,
} from "@/lib/slots"
import type { Slot } from "@/lib/slots"

export interface Booking {
  date: string
  slot: Slot
  timeZone: string
}

// The server's availability, with when it arrived (performance.now()) so the shown time can move on from the
// server's, or why it is not known yet.
type Loaded = Availability & { status: "loaded"; receivedAt: number }
type State = Loaded | { status: "loading" } | { status: "error" }

const loadedOf = (state: State) => (state.status === "loaded" ? state : null)

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const Panel = ({ className, ...props }: React.ComponentProps<"section">) => (
  <section
    className={cn("bg-card rounded-3xl border p-6", className)}
    {...props}
  />
)

const MeetingInfo = () => (
  <Panel className="flex flex-col gap-4 md:w-56">
    <h1 className="text-xl font-semibold">Book a Meeting</h1>
    <p className="text-muted-foreground flex items-center gap-2">
      <HugeiconsIcon icon={Clock01Icon} className="size-4" /> {MEETING_MINUTES}{" "}
      min
    </p>
    <p className="text-muted-foreground flex items-center gap-2">
      <HugeiconsIcon icon={Video01Icon} className="size-4" /> Google Meet
    </p>
  </Panel>
)

const Banner = ({
  testId,
  children,
}: {
  testId: string
  children: React.ReactNode
}) => (
  <div className="bg-card/70 pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl backdrop-blur-[1px]">
    <output
      data-testid={testId}
      className="bg-card rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm"
    >
      {children}
    </output>
  </div>
)

// A date's month, counted in months since year 0, so stepping and comparing months is plain arithmetic.
const monthIndex = (date: string) => {
  const { year, month } = yearMonth(date)
  return year * 12 + month
}

// The month the calendar shows (`moved` once the visitor stepped away from the server's current month), whether it
// may step back or forward, and its days.
const calendarMonth = (loaded: Loaded, moved: number | null) => {
  const current = monthIndex(loaded.today)
  const lastDay = loaded.days.at(-1)
  const last = lastDay === undefined ? current : monthIndex(lastDay.date)
  const shown = moved ?? current
  const year = Math.floor(shown / 12)
  const month = shown % 12
  return {
    shown,
    canGoBack: shown > current,
    canGoForward: shown < last,
    label: monthLabel(year, month),
    leadingBlanks: firstWeekday(year, month),
    days: Array.from({ length: daysInMonth(year, month) }, (_, i) =>
      isoDate(year, month, i + 1)
    ),
  }
}

const Calendar = ({
  state,
  selected,
  onSelect,
}: {
  state: State
  selected: string | null
  onSelect: (date: string) => void
}) => {
  const loaded = loadedOf(state)
  const [moved, setMoved] = useState<number | null>(null)
  const view = loaded === null ? null : calendarMonth(loaded, moved)
  const days = view?.days ?? []
  const bookable = new Set(loaded?.days.map((day) => day.date))
  const noAvailableDays =
    loaded !== null && !days.some((date) => bookable.has(date))

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous month"
          data-testid="prev-month"
          disabled={view?.canGoBack !== true}
          onClick={() => {
            if (view !== null) {
              setMoved(view.shown - 1)
            }
          }}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} />
        </Button>
        <h2 data-testid="month-label" className="min-h-6 font-semibold">
          {view?.label}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next month"
          data-testid="next-month"
          disabled={view?.canGoForward !== true}
          onClick={() => {
            if (view !== null) {
              setMoved(view.shown + 1)
            }
          }}
        >
          <HugeiconsIcon icon={ArrowRight01Icon} />
        </Button>
      </div>

      <p
        data-testid="selected-date"
        className="bg-muted rounded-2xl px-4 py-2 text-center text-sm"
      >
        {selected === null ? "Select a date" : formatSelectedDate(selected)}
      </p>

      <div className="relative grid min-h-64 grid-cols-7 content-start gap-1 text-center">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} className="text-muted-foreground pb-1 text-xs">
            {weekday}
          </span>
        ))}
        {Array.from({ length: view?.leadingBlanks ?? 0 }, (_, i) => (
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
            disabled={!bookable.has(date)}
            onClick={() => {
              onSelect(date)
            }}
          >
            {Number(date.slice(8))}
          </Button>
        ))}
        {state.status === "loading" && (
          <Banner testId="availability-loading">Loading available days</Banner>
        )}
        {noAvailableDays && (
          <Banner testId="no-available-days">
            No available days this month
          </Banner>
        )}
        {state.status === "error" && (
          <Banner testId="availability-error">
            Could not load available days
          </Banner>
        )}
      </div>
    </Panel>
  )
}

// The server's time when the availability arrived, moved on by the time since, shown at the zone's offset.
const CurrentTime = ({
  loaded,
  timeZone,
}: {
  loaded: Loaded | null
  timeZone: string
}) => {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const tick = () => {
      if (loaded !== null) {
        setElapsed(performance.now() - loaded.receivedAt)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => {
      clearInterval(id)
    }
  }, [loaded])
  const offset = loaded?.offsets[timeZone]
  const time =
    loaded === null || offset === undefined
      ? "--:--"
      : timeAtOffset(Date.parse(loaded.now) + elapsed, offset)

  return (
    <p data-testid="current-time" className="text-muted-foreground text-sm">
      Current time: {time}
    </p>
  )
}

const TimePicker = ({
  state,
  date,
  onConfirm,
}: {
  state: State
  date: string | null
  onConfirm: (booking: Booking) => void
}) => {
  const [timeZone, setTimeZone] = useState(HOST_TIME_ZONE)
  const [selected, setSelected] = useState<string | null>(null)
  const loaded = loadedOf(state)
  // Until a date is picked, the first bookable day's slots are shown, disabled.
  const day =
    date === null
      ? loaded?.days[0]
      : loaded?.days.find((bookable) => bookable.date === date)
  const available: AvailableSlot[] = day?.slots ?? []
  const slots = slotsIn(available, timeZone)
  const slot =
    date === null ? undefined : slots.find((s) => s.startsAt === selected)

  return (
    <Panel className="flex flex-col gap-3 md:w-56">
      <h2 className="font-semibold">Time</h2>
      <select
        data-testid="timezone-select"
        aria-label="Time zone"
        disabled={loaded === null}
        value={timeZone}
        onChange={(event) => {
          setTimeZone(event.target.value)
        }}
        className="bg-background h-9 rounded-4xl border px-3 text-sm"
      >
        {TIME_ZONES.map((zone) => (
          <option key={zone.value} value={zone.value}>
            {zone.label}
          </option>
        ))}
      </select>
      <CurrentTime loaded={loaded} timeZone={timeZone} />

      {slots.map((s) => (
        <Button
          key={s.startsAt}
          variant={s === slot ? "default" : "outline"}
          data-testid="time-slot"
          aria-pressed={s === slot}
          disabled={date === null}
          onClick={() => {
            setSelected(s.startsAt)
          }}
        >
          {s.label}
        </Button>
      ))}

      <Button
        size="lg"
        className="mt-auto"
        data-testid="confirm-button"
        disabled={date === null || slot === undefined}
        onClick={() => {
          if (date !== null && slot !== undefined) {
            onConfirm({ date, slot, timeZone })
          }
        }}
      >
        Ok
      </Button>
    </Panel>
  )
}

export const BookingPage = ({
  onConfirm,
}: {
  onConfirm: (booking: Booking) => void
}) => {
  const [date, setDate] = useState<string | null>(null)
  const [state, setState] = useState<State>({ status: "loading" })

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const availability = await getAvailability()
        if (active) {
          setState({
            ...availability,
            status: "loaded",
            receivedAt: performance.now(),
          })
        }
      } catch {
        if (active) {
          setState({ status: "error" })
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="flex flex-col gap-4 rounded-4xl border p-4 md:flex-row">
      <MeetingInfo />
      <Calendar state={state} selected={date} onSelect={setDate} />
      <TimePicker state={state} date={date} onConfirm={onConfirm} />
    </div>
  )
}
