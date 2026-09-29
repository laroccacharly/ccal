// Fake booking API for e2e tests. Every run starts with a fresh SQLite database in a new temp dir.
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BookingRequest } from "@ccal/shared";

const PORT = Number(process.env.PORT ?? 3101);
const FIELDS = ["startsAt", "timeZone", "name", "email", "description"] as const satisfies readonly (keyof BookingRequest)[];

const dir = mkdtempSync(join(tmpdir(), "ccal-test-server-"));
const db = new Database(join(dir, "bookings.sqlite"));
db.run(`CREATE TABLE booking_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  startsAt TEXT NOT NULL,
  timeZone TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  description TEXT NOT NULL
)`);

const insert = db.query(
  `INSERT INTO booking_requests (startsAt, timeZone, name, email, description)
   VALUES ($startsAt, $timeZone, $name, $email, $description) RETURNING *`,
);
const all = db.query("SELECT * FROM booking_requests ORDER BY id");
const byEmail = db.query("SELECT * FROM booking_requests WHERE email = $email ORDER BY id");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

function parseBookingRequest(body: unknown): BookingRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (!FIELDS.every((field) => typeof record[field] === "string" && record[field] !== "")) return null;
  return Object.fromEntries(FIELDS.map((field) => [field, record[field]])) as BookingRequest;
}

const server = Bun.serve({
  port: PORT,
  routes: {
    "/health": () => new Response("ok"),
    "/api/booking-requests": {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      GET: (req) => {
        const email = new URL(req.url).searchParams.get("email");
        return json(email ? byEmail.all({ $email: email }) : all.all());
      },
      POST: async (req) => {
        const booking = parseBookingRequest(await req.json().catch(() => null));
        if (!booking) return json({ error: `Expected non-empty strings for: ${FIELDS.join(", ")}` }, 400);
        const params = Object.fromEntries(Object.entries(booking).map(([key, value]) => [`$${key}`, value]));
        return json(insert.get(params), 201);
      },
    },
  },
});

console.log(`test-server listening on ${server.url} (db: ${dir})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  });
}
