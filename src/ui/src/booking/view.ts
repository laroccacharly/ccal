import { Match } from "effect"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"

import { buttonVariants } from "@/components/ui/button"
import {
  daysInMonth,
  firstWeekday,
  formatSelectedDate,
  isoDate,
  monthLabel,
  timeAtOffset,
  yearMonth,
} from "@/lib/dates"
import { MEETING_MINUTES, TIME_ZONES, slotsIn } from "@/lib/slots"

import { Message, loadedOf, selectedBooking } from "./model"
import type { Model } from "./model"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const monthIndex = (date: string) => {
  const { year, month } = yearMonth(date)
  return year * 12 + month
}

export const calendarMonth = (model: Model) => {
  const loaded = loadedOf(model)
  if (loaded === null) {
    return null
  }
  const current = monthIndex(loaded.today)
  const lastDay = loaded.days.at(-1)
  const last = lastDay === undefined ? current : monthIndex(lastDay.date)
  const shown = model.moved ?? current
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

// oxlint-disable-next-line complexity -- Declarative view branches reflect loading and selection states.
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const loaded = loadedOf(model)
  const month = calendarMonth(model)
  const bookable = new Set(loaded?.days.map((day) => day.date))
  const booking = selectedBooking(model)
  const day =
    model.date === null
      ? loaded?.days[0]
      : loaded?.days.find((item) => item.date === model.date)
  const slots = slotsIn([...(day?.slots ?? [])], model.timeZone)
  const offset = loaded?.offsets[model.timeZone]
  const time =
    loaded === null || offset === undefined
      ? "--:--"
      : timeAtOffset(Date.parse(loaded.now) + model.elapsed, offset)

  const testId = (id: string) => h.DataAttribute("testid", id)
  const panel = (classes: string, children: Html[]) =>
    h.section([h.Class(`bg-card rounded-3xl border p-6 ${classes}`)], children)
  const button = (
    attributes: Attribute<Message>[],
    text: string,
    variant: "default" | "ghost" | "outline" = "ghost",
    size: "default" | "icon" | "lg" = "default"
  ) =>
    h.button(
      [
        h.Type("button"),
        h.Class(buttonVariants({ variant, size })),
        ...attributes,
      ],
      [text]
    )
  const banner = (id: string, text: string) =>
    h.div(
      [
        h.Class(
          "bg-card/70 pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl backdrop-blur-[1px]"
        ),
      ],
      [
        h.output(
          [
            testId(id),
            h.Class(
              "bg-card rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm"
            ),
          ],
          [text]
        ),
      ]
    )

  const banners: Html[] = []
  const statusBanner = Match.value(model.availability).pipe(
    Match.tagsExhaustive({
      Loading: () => [banner("availability-loading", "Loading available days")],
      Failed: () => [
        banner("availability-error", "Could not load available days"),
      ],
      Loaded: () => [],
    })
  )
  banners.push(...statusBanner)
  if (
    loaded !== null &&
    !(month?.days.some((date) => bookable.has(date)) ?? false)
  ) {
    banners.push(banner("no-available-days", "No available days this month"))
  }

  return h.div(
    [h.Class("flex flex-col gap-4 rounded-4xl border p-4 md:flex-row")],
    [
      panel("flex flex-col gap-4 md:w-56", [
        h.h1([h.Class("text-xl font-semibold")], ["Book a Meeting"]),
        h.p(
          [h.Class("text-muted-foreground flex items-center gap-2")],
          [`◷ ${MEETING_MINUTES} min`]
        ),
        h.p(
          [h.Class("text-muted-foreground flex items-center gap-2")],
          ["▱ Google Meet"]
        ),
      ]),
      panel("flex flex-col gap-4", [
        h.div(
          [h.Class("flex items-center justify-between gap-4")],
          [
            button(
              [
                h.AriaLabel("Previous month"),
                testId("prev-month"),
                h.Disabled(month?.canGoBack !== true),
                h.OnClick(
                  Message.ClickedMonth({ month: (month?.shown ?? 0) - 1 })
                ),
              ],
              "‹",
              "ghost",
              "icon"
            ),
            h.h2(
              [testId("month-label"), h.Class("min-h-6 font-semibold")],
              [month?.label ?? ""]
            ),
            button(
              [
                h.AriaLabel("Next month"),
                testId("next-month"),
                h.Disabled(month?.canGoForward !== true),
                h.OnClick(
                  Message.ClickedMonth({ month: (month?.shown ?? 0) + 1 })
                ),
              ],
              "›",
              "ghost",
              "icon"
            ),
          ]
        ),
        h.p(
          [
            testId("selected-date"),
            h.Class("bg-muted rounded-2xl px-4 py-2 text-center text-sm"),
          ],
          [
            model.date === null
              ? "Select a date"
              : formatSelectedDate(model.date),
          ]
        ),
        h.div(
          [
            h.Class(
              "relative grid min-h-64 grid-cols-7 content-start gap-1 text-center"
            ),
          ],
          [
            ...WEEKDAYS.map((weekday) =>
              h.span([h.Class("text-muted-foreground pb-1 text-xs")], [weekday])
            ),
            ...Array.from({ length: month?.leadingBlanks ?? 0 }, () =>
              h.span([], [])
            ),
            ...(month?.days ?? []).map((date) =>
              button(
                [
                  testId("day"),
                  h.DataAttribute("date", date),
                  h.AriaPressed(String(date === model.date)),
                  h.Disabled(!bookable.has(date)),
                  h.OnClick(Message.ClickedDate({ date })),
                ],
                String(Number(date.slice(8))),
                date === model.date ? "default" : "ghost",
                "icon"
              )
            ),
            ...banners,
          ]
        ),
      ]),
      panel("flex flex-col gap-3 md:w-56", [
        h.h2([h.Class("font-semibold")], ["Time"]),
        h.select(
          [
            testId("timezone-select"),
            h.AriaLabel("Time zone"),
            h.Disabled(loaded === null),
            h.Value(model.timeZone),
            h.OnChange((timeZone) => Message.ChangedTimeZone({ timeZone })),
            h.Class("bg-background h-9 rounded-4xl border px-3 text-sm"),
          ],
          TIME_ZONES.map((zone) =>
            h.option([h.Value(zone.value)], [zone.label])
          )
        ),
        h.p(
          [testId("current-time"), h.Class("text-muted-foreground text-sm")],
          [`Current time: ${time}`]
        ),
        ...slots.map((slot) =>
          button(
            [
              testId("time-slot"),
              h.AriaLabel(`${slot.label} (${model.timeZone})`),
              h.AriaPressed(String(slot.startsAt === model.selected)),
              h.Disabled(model.date === null),
              h.OnClick(Message.ClickedSlot({ startsAt: slot.startsAt })),
            ],
            slot.label,
            slot.startsAt === model.selected ? "default" : "outline"
          )
        ),
        button(
          [
            testId("confirm-button"),
            h.Class(`${buttonVariants({ size: "lg" })} mt-auto`),
            h.Disabled(booking === null),
            h.OnClick(Message.ClickedConfirm()),
          ],
          "Ok",
          "default",
          "lg"
        ),
      ]),
    ]
  )
}
