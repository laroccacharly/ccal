import { Availability, Booking } from "@ccal/shared"
import { Effect, Match, Schema, Stream } from "effect"
import { Command, Port, Subscription } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import type { Return } from "foldkit/update"

import { HOST_TIME_ZONE, TIME_ZONES } from "@/lib/slots"

const Loading = Schema.TaggedStruct("Loading", {})
const Failed = Schema.TaggedStruct("Failed", {})
const Loaded = Schema.TaggedStruct("Loaded", {
  availability: Availability,
  receivedAt: Schema.Finite,
})

// All booking-page state lives here; React owns only routing and subsequent pages.
export const Model = Schema.Struct({
  availability: Schema.Union([Loading, Failed, Loaded]),
  date: Schema.NullOr(Schema.String),
  selected: Schema.NullOr(Schema.String),
  moved: Schema.NullOr(Schema.Finite),
  timeZone: Schema.String,
  elapsed: Schema.Finite,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  SucceededLoadAvailability: {
    availability: Availability,
    receivedAt: Schema.Finite,
  },
  FailedLoadAvailability: {},
  ClickedDate: { date: Schema.String },
  ClickedMonth: { month: Schema.Finite },
  ChangedTimeZone: { timeZone: Schema.String },
  ClickedSlot: { startsAt: Schema.String },
  Ticked: { at: Schema.Finite },
  ClickedConfirm: {},
  CompletedReportBooking: {},
})
export type Message = typeof Message.Type
export type Step = Return<Model, Message>

export const ports = { outbound: { confirmed: Port.outbound(Booking) } }

export const LoadAvailability = Command.define("LoadAvailability", {
  messages: [Message.SucceededLoadAvailability, Message.FailedLoadAvailability],
  execute: Effect.tryPromise(async (signal) => {
    const response = await fetch("/api/availability", { signal })
    if (!response.ok) {
      throw new Error(`Loading availability failed (${response.status})`)
    }
    return await response.text()
  }).pipe(
    Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Availability))),
    Effect.map((availability) =>
      Message.SucceededLoadAvailability({
        availability,
        receivedAt: performance.now(),
      })
    ),
    Effect.orElseSucceed(() => Message.FailedLoadAvailability())
  ),
})

export const ReportBooking = Command.define("ReportBooking", {
  args: { booking: Booking },
  messages: [Message.CompletedReportBooking],
  execute: ({ booking }) =>
    Port.emit(ports.outbound.confirmed, booking).pipe(
      Effect.as(Message.CompletedReportBooking())
    ),
})

export const init = (): Step => ({
  model: {
    availability: Loading.make({}),
    date: null,
    selected: null,
    moved: null,
    timeZone: HOST_TIME_ZONE,
    elapsed: 0,
  },
  commands: [LoadAvailability()],
})

export const loadedOf = (model: Model) =>
  Match.value(model.availability).pipe(
    Match.tag("Loaded", ({ availability }) => availability),
    Match.orElse(() => null)
  )

export const selectedBooking = (model: Model): Booking | null => {
  const available = loadedOf(model)
  const slot = available?.days
    .find((day) => day.date === model.date)
    ?.slots.find((item) => item.startsAt === model.selected)
  if (model.date === null || slot === undefined) {
    return null
  }
  return {
    date: model.date,
    slot: { startsAt: slot.startsAt, label: slot.times[model.timeZone] ?? "" },
    timeZone: model.timeZone,
  }
}

export const update = (model: Model, message: Message): Step =>
  Match.value(message).pipe(
    Match.withReturnType<Step>(),
    Match.tagsExhaustive({
      SucceededLoadAvailability: ({ availability, receivedAt }) => ({
        model: {
          ...model,
          availability: Loaded.make({ availability, receivedAt }),
          elapsed: 0,
        },
      }),
      FailedLoadAvailability: () => ({
        model: { ...model, availability: Failed.make({}) },
      }),
      ClickedDate: ({ date }) => ({
        model:
          loadedOf(model)?.days.some((day) => day.date === date) === true
            ? { ...model, date, selected: null }
            : model,
      }),
      ClickedMonth: ({ month }) => ({ model: { ...model, moved: month } }),
      ChangedTimeZone: ({ timeZone }) => ({
        model: TIME_ZONES.some((zone) => zone.value === timeZone)
          ? { ...model, timeZone }
          : model,
      }),
      ClickedSlot: ({ startsAt }) => ({
        model:
          loadedOf(model)
            ?.days.find((day) => day.date === model.date)
            ?.slots.some((slot) => slot.startsAt === startsAt) === true
            ? { ...model, selected: startsAt }
            : model,
      }),
      Ticked: ({ at }) =>
        Match.value(model.availability).pipe(
          Match.tag("Loaded", ({ receivedAt }) => ({
            model: { ...model, elapsed: Math.max(0, at - receivedAt) },
          })),
          Match.orElse((): Step => ({ model }))
        ),
      ClickedConfirm: () => {
        const booking = selectedBooking(model)
        return {
          model,
          commands: booking === null ? [] : [ReportBooking({ booking })],
        }
      },
      CompletedReportBooking: () => ({ model }),
    })
  )

// Dependency changes start/stop the stream; selection changes do not restart it.
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  clock: entry(
    { loaded: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ loaded: loadedOf(model) !== null }),
      dependenciesToStream: ({ loaded }) =>
        loaded
          ? Stream.tick("1 second").pipe(
              Stream.map(() => Message.Ticked({ at: performance.now() }))
            )
          : Stream.empty,
    }
  ),
}))
