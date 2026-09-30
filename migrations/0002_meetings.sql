-- The Google Meet of each booking request, and whether creating it has worked yet.
CREATE TABLE meetings (
  bookingRequestId INTEGER PRIMARY KEY REFERENCES booking_requests(id),
  -- The Google Calendar event id, chosen here so a retry finds the event an earlier attempt created
  -- instead of creating a second one.
  eventId TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'created', 'failed')),
  meetLink TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Every new booking request gets its pending meeting in the same statement, so none is ever left without one.
CREATE TRIGGER booking_requests_meeting AFTER INSERT ON booking_requests
BEGIN
  INSERT INTO meetings (bookingRequestId, eventId) VALUES (NEW.id, lower(hex(randomblob(16))));
END;
