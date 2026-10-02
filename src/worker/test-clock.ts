import { Clock, Config, Effect, Schema } from "effect"
import { SqlClient } from "effect/sql"

export class TestClockDisabled extends Schema.TaggedError<TestClockDisabled>()(
  "TestClockDisabled",
  {}
) {}

// Only the end-to-end tests start the Worker with ENABLE_TEST_CLOCK; anywhere else the test clock does not exist.
const testClockEnabled = Config.Boolean("ENABLE_TEST_CLOCK").pipe(
  Config.withDefault(false)
)

// An ISO datetime, e.g. "2026-09-29T14:00:00Z", or null to go back to the real time.
export const TestClockBody = Schema.Struct({
  now: Schema.NullOr(
    Schema.String.check(
      Schema.makeFilter((now) => !Number.isNaN(Date.parse(now)))
    )
  ),
})

// The time availability and bookings are based on, in milliseconds: the test clock's when one is set, else the real time.
export const currentTime = Effect.gen(function* currentTime() {
  if (yield* testClockEnabled) {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ now: string }>`
      SELECT now FROM test_clock WHERE id = 1
    `
    if (row !== undefined) {
      return Date.parse(row.now)
    }
  }
  return yield* Clock.currentTimeMillis
})

// Fails unless the Worker runs with ENABLE_TEST_CLOCK, so that the test-clock API does not exist anywhere else.
export const requireTestClock = Effect.gen(function* requireTestClock() {
  if (!(yield* testClockEnabled)) {
    yield* new TestClockDisabled()
  }
})

// Sets the test clock to a fixed time, or resets it with null; it returns the time set, as an ISO datetime.
// It is kept in D1 rather than in memory, since requests may land on different isolates.
export const writeTestClock = Effect.fn("writeTestClock")(
  function* writeTestClock(now: string | null) {
    const sql = yield* SqlClient.SqlClient
    if (now === null) {
      yield* sql`DELETE FROM test_clock`
      return null
    }
    const iso = new Date(Date.parse(now)).toISOString()
    yield* sql`
      INSERT INTO test_clock (id, now) VALUES (1, ${iso})
      ON CONFLICT (id) DO UPDATE SET now = excluded.now
    `
    return iso
  }
)
