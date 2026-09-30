// Stands in for Google's token and Calendar APIs during the end-to-end tests: the Worker reaches it through
// GOOGLE_API_ORIGIN. Tests read the events it created, and make it fail for an attendee, over /stub/*.
const PORT = Number(process.env.GOOGLE_STUB_PORT ?? 3102)
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN
const ACCESS_TOKEN = "e2e-google-access-token"
const EVENTS = "/calendar/v3/calendars/primary/events"

type Attendee = { email: string }
export type StubEvent = { id: string; hangoutLink: string; query: Record<string, string>; body: Record<string, unknown> }

const events = new Map<string, StubEvent>()
const outages = new Set<string>() // attendees whose events Google fails to create

const attendees = (event: StubEvent) => (event.body.attendees as Attendee[]).map((attendee) => attendee.email)

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (req.method === "POST" && path === "/token") {
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

    if (path.startsWith(EVENTS) && req.headers.get("authorization") !== `Bearer ${ACCESS_TOKEN}`) {
      return Response.json({ error: { code: 401, message: "Invalid Credentials" } }, { status: 401 })
    }
    if (req.method === "POST" && path === EVENTS) {
      const body = (await req.json()) as Record<string, unknown>
      const id = (body.id as string | undefined) ?? crypto.randomUUID().replaceAll("-", "")
      const event: StubEvent = { id, hangoutLink: `https://meet.google.com/e2e-${id}`, query: Object.fromEntries(url.searchParams), body }
      if (attendees(event).some((email) => outages.has(email))) {
        return Response.json({ error: { code: 503, message: "Backend Error" } }, { status: 503 })
      }
      if (events.has(id)) return Response.json({ error: { code: 409, message: "The requested identifier already exists." } }, { status: 409 })
      events.set(id, event)
      return Response.json({ id, hangoutLink: event.hangoutLink })
    }
    if (req.method === "GET" && path.startsWith(`${EVENTS}/`)) {
      const event = events.get(path.slice(EVENTS.length + 1))
      return event ? Response.json({ id: event.id, hangoutLink: event.hangoutLink }) : new Response("Not found", { status: 404 })
    }

    // GET /stub/events?attendee= lists the events created for an attendee.
    if (req.method === "GET" && path === "/stub/events") {
      const attendee = url.searchParams.get("attendee")
      return Response.json([...events.values()].filter((event) => attendee === null || attendees(event).includes(attendee)))
    }
    // PUT /stub/outages/:email makes Google fail to create that attendee's events; DELETE ends the outage.
    if (path.startsWith("/stub/outages/")) {
      const email = decodeURIComponent(path.slice("/stub/outages/".length))
      if (req.method === "PUT") outages.add(email)
      else if (req.method === "DELETE") outages.delete(email)
      return new Response(null, { status: 204 })
    }
    return new Response("Not found", { status: 404 })
  },
})
console.log(`Google stub listening on http://127.0.0.1:${PORT}`)
