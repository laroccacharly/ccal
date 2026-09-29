CREATE TABLE booking_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  startsAt TEXT NOT NULL,
  timeZone TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  description TEXT NOT NULL
);
