import { Schema } from "effect"

const isTestRequest = Schema.is(
  Schema.Struct({
    secret: Schema.Literal("1x0000000000000000000000000000000AA"),
    response: Schema.String,
  })
)

const HOSTNAME = "localhost"
const ACTION = "booking"

const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX"

// Answers Siteverify locally, so no test reaches Cloudflare. Controlled tokens exercise rejection paths.
const PORT = Number(process.env.TURNSTILE_STUB_PORT ?? 3105)
Bun.serve({
  port: PORT,
  async fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname === "/health") {
      return new Response("ok")
    }
    if (pathname !== "/turnstile/v0/siteverify" || request.method !== "POST") {
      return new Response("Not found", { status: 404 })
    }
    const body = await request.text()
    // Every request comes from our Worker; only the dummy test secret is accepted.
    const parsed: unknown = JSON.parse(body)
    if (!isTestRequest(parsed)) {
      return new Response("Invalid test credentials", { status: 400 })
    }
    const token = parsed.response
    if (token === "e2e-outage") {
      return new Response("Unavailable", { status: 503 })
    }
    if (token === "e2e-invalid" || token === "e2e-spent") {
      return Response.json({
        success: false,
        "error-codes": [
          token === "e2e-spent"
            ? "timeout-or-duplicate"
            : "invalid-input-response",
        ],
      })
    }
    if (token === "e2e-wrong-host" || token === "e2e-wrong-action") {
      return Response.json({
        success: true,
        hostname: token === "e2e-wrong-host" ? "mail.example.com" : HOSTNAME,
        action: token === "e2e-wrong-action" ? "mail" : ACTION,
      })
    }
    // Cloudflare's dummy token, which the fake widget script in cal.test.ts hands out, passes with the app's hostname
    // and action, so the Worker applies its production checks unchanged. Anything else is invalid.
    if (token === DUMMY_TOKEN) {
      return Response.json({
        success: true,
        hostname: HOSTNAME,
        action: ACTION,
        metadata: { result_with_testing_key: true },
      })
    }
    return Response.json({
      success: false,
      "error-codes": ["invalid-input-response"],
    })
  },
})
