-- The fake time the end-to-end tests set through POST /api/test-clock; at most one row. Only read when the Worker runs
-- with ENABLE_TEST_CLOCK, so it stays empty and unused in production.
CREATE TABLE test_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  now TEXT NOT NULL
);
