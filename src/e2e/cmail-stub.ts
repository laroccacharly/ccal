// Stands in for cmail's send API during the end-to-end tests: the Worker reaches it through CMAIL_ORIGIN. Tests
// read the emails it received, and make it fail for emails mentioning a given text, over /stub/*.
import { Option, Schema } from "effect"

const PORT = Number(process.env.CMAIL_STUB_PORT ?? 3103)
const API_KEY = process.env.CMAIL_API_KEY

// The email the Worker asks cmail to send.
const EmailBody = Schema.Struct({
  to: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  body: Schema.NonEmptyString,
})

export type StubEmail = typeof EmailBody.Type

const emails: StubEmail[] = []
// Emails whose body contains one of these fail to send.
const outages = new Set<string>()

const sendEmail = async (req: Request) => {
  if (req.headers.get("authorization") !== `Bearer ${API_KEY}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const decoded = Schema.decodeUnknownOption(EmailBody)(await req.json())
  if (Option.isNone(decoded)) {
    return Response.json({ error: "invalid_request" }, { status: 400 })
  }
  const email = decoded.value
  if ([...outages].some((text) => email.body.includes(text))) {
    return Response.json({ error: "send_failed" }, { status: 502 })
  }
  emails.push(email)
  return Response.json(
    {
      id: emails.length,
      messageId: `e2e-message-${emails.length}`,
      to: email.to,
      from: "cmail@example.com",
      title: email.title,
    },
    { status: 201 }
  )
}

// GET /stub/emails?contains= lists the emails received whose body contains the text.
const listEmails = (url: URL) => {
  const text = url.searchParams.get("contains")
  return Response.json(
    emails.filter((email) => text === null || email.body.includes(text))
  )
}

// PUT /stub/outages/:text makes sending fail for emails whose body contains the text; DELETE ends the outage.
const setOutage = (req: Request, path: string) => {
  const text = decodeURIComponent(path.slice("/stub/outages/".length))
  if (req.method === "PUT") {
    outages.add(text)
  } else if (req.method === "DELETE") {
    outages.delete(text)
  }
  return new Response(null, { status: 204 })
}

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname
    if (req.method === "POST" && path === "/api/email/send") {
      return await sendEmail(req)
    }
    if (req.method === "GET" && path === "/stub/emails") {
      return listEmails(url)
    }
    if (path.startsWith("/stub/outages/")) {
      return setOutage(req, path)
    }
    return new Response("Not found", { status: 404 })
  },
})
console.log(`cmail stub listening on http://127.0.0.1:${PORT}`)
