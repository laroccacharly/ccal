// Stands in for Google's token and Calendar APIs during the end-to-end tests: the Worker reaches it through
// GOOGLE_API_ORIGIN. Tests read the events it created, and make it fail for an attendee, over /stub/*.
import { Option, Schema } from "effect"

const PORT = Number(process.env.GOOGLE_STUB_PORT ?? 3102)
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN
const ACCESS_TOKEN = "e2e-google-access-token"
const EVENTS = "/calendar/v3/calendars/primary/events"

// The event the Worker asks Google to create.
const EventBody = Schema.Struct({
  id: Schema.optional(Schema.String),
  summary: Schema.String,
  description: Schema.optional(Schema.String),
  start: Schema.Struct({ dateTime: Schema.String }),
  end: Schema.Struct({ dateTime: Schema.String }),
  attendees: Schema.Array(Schema.Struct({ email: Schema.String })),
  conferenceData: Schema.Struct({
    createRequest: Schema.Struct({
      requestId: Schema.String,
      conferenceSolutionKey: Schema.Struct({ type: Schema.String }),
    }),
  }),
})

export interface StubEvent {
  id: string
  hangoutLink: string
  query: Record<string, string>
  body: typeof EventBody.Type
}

const events = new Map<string, StubEvent>()
// Attendees whose events Google fails to create.
const outages = new Set<string>()

const attendees = (event: StubEvent) =>
  event.body.attendees.map((attendee) => attendee.email)

const googleError = (code: number, message: string) =>
  Response.json({ error: { code, message } }, { status: code })

const token = async (req: Request) => {
  const form = new URLSearchParams(await req.text())
  const valid =
    form.get("grant_type") === "refresh_token" &&
    form.get("refresh_token") === REFRESH_TOKEN &&
    form.get("client_id") === CLIENT_ID &&
    form.get("client_secret") === CLIENT_SECRET
  return valid
    ? Response.json({ access_token: ACCESS_TOKEN, expires_in: 3599 })
    : Response.json({ error: "invalid_grant" }, { status: 400 })
}

const createEvent = async (req: Request, url: URL) => {
  const decoded = Schema.decodeUnknownOption(EventBody)(await req.json())
  if (Option.isNone(decoded)) {
    return googleError(400, "Invalid event")
  }
  const body = decoded.value
  const id = body.id ?? crypto.randomUUID().replaceAll("-", "")
  const event: StubEvent = {
    id,
    hangoutLink: `https://meet.google.com/e2e-${id}`,
    query: Object.fromEntries(url.searchParams),
    body,
  }
  if (attendees(event).some((email) => outages.has(email))) {
    return googleError(503, "Backend Error")
  }
  if (events.has(id)) {
    return googleError(409, "The requested identifier already exists.")
  }
  events.set(id, event)
  return Response.json({ id, hangoutLink: event.hangoutLink })
}

const readEvent = (path: string) => {
  const event = events.get(path.slice(EVENTS.length + 1))
  return event === undefined
    ? new Response("Not found", { status: 404 })
    : Response.json({ id: event.id, hangoutLink: event.hangoutLink })
}

// GET /stub/events?attendee= lists the events created for an attendee.
const listEvents = (url: URL) => {
  const attendee = url.searchParams.get("attendee")
  return Response.json(
    [...events.values()].filter(
      (event) => attendee === null || attendees(event).includes(attendee)
    )
  )
}

// PUT /stub/outages/:email makes Google fail to create that attendee's events; DELETE ends the outage.
const setOutage = (req: Request, path: string) => {
  const email = decodeURIComponent(path.slice("/stub/outages/".length))
  if (req.method === "PUT") {
    outages.add(email)
  } else if (req.method === "DELETE") {
    outages.delete(email)
  }
  return new Response(null, { status: 204 })
}

const calendar = async (req: Request, url: URL) => {
  const path = url.pathname
  if (req.headers.get("authorization") !== `Bearer ${ACCESS_TOKEN}`) {
    return googleError(401, "Invalid Credentials")
  }
  if (req.method === "POST" && path === EVENTS) {
    return await createEvent(req, url)
  }
  if (req.method === "GET" && path.startsWith(`${EVENTS}/`)) {
    return readEvent(path)
  }
  return new Response("Not found", { status: 404 })
}

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname
    if (req.method === "POST" && path === "/token") {
      return await token(req)
    }
    if (path.startsWith(EVENTS)) {
      return await calendar(req, url)
    }
    if (req.method === "GET" && path === "/stub/events") {
      return listEvents(url)
    }
    if (path.startsWith("/stub/outages/")) {
      return setOutage(req, path)
    }
    return new Response("Not found", { status: 404 })
  },
})
console.log(`Google stub listening on http://127.0.0.1:${PORT}`)
