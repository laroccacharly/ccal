# Page load

- Go to the URL
- Wait until the page loads
- Assert the page content contains "Google Meet"
- Assert url contains "#" (hashrouter)
- Assert url contains "form"
- Assert the Foldkit booking page remounts with fresh selection after navigating to confirmation and going back

# Loading

- Assert that while the available days are loading, a "Loading available days" banner is shown on top of the calendar days, the month arrows, time zone and confirm button are disabled, and no day or time slot can be selected
- Assert the banner disappears once the available days are loaded

# Server time

- Every date and time the page shows comes from the server: the current month, today, the current time and the time slots in each time zone. The page never uses the browser's clock or time zone data.
- The server's clock can be faked through its test-clock API, called with the API key, only when the server is started with ENABLE_TEST_CLOCK
- Assert the test-clock API rejects calls without a valid API key
- Assert resetting the test clock brings back the real time
- The date and time scenarios below fake the server's clock to October 1 2026, 10:00 in Montreal, then reload the page

# Date select

- Assert the displayed month and year are October 2026
- Assert all past days, today (October 1) and tomorrow (October 2) are greyed out
- Assert clicking a greyed-out date does not change the selected date
- Assert clicking an available date changes the selected date
- Assert clicking the next month arrow shows the next month
- Assert selecting a date in the next month updates the selected date
- Assert selected date has the format "Month Day Year"
- Assert next month arrow is disabled at 3 months out in the future (January 2027)
- Assert a "No available days this month" banner is shown on top of the calendar days when every day in the displayed month is disabled, and hidden otherwise
  - Fake the server's clock to September 29 2026 (September shown, banner shown) and to October 1 2026 (October shown, no banner)
- Assert the calendar only offers the days the server says are available
- Assert that when the available days cannot be loaded, a "Could not load available days" banner is shown on top of the calendar days
- Assert a malformed successful availability response shows the error banner and leaves booking disabled

# Time select

- Assert the time slots are disabled until a date is selected
- Assert the time picker shows 3 time slots
- Assert default time zone is Montreal Canada.
- Assert time slots in Montreal time zone are: 13:30, 15:30 and 16:30.
- Assert each time slot has an accessible label with its displayed time and time zone
- Assert switching the time zone updates the time slots accordingly
  - On October 3 2026: Vancouver (America/Vancouver) shows 10:30, 12:30 and 13:30, and France (Europe/Paris) shows 19:30, 21:30 and 22:30
- Assert there is a "Current time: " with the current time for the selected time zone: 10:00 in Montreal (with a 1 minute tolerance)
- Assert current time changes to match the selected time zone: 16:00 in Paris and 07:00 in Vancouver (with a 1 minute tolerance)
- Assert the time slots offered for a date are the ones the server gives for that date
- Assert the confirm button is greyed out and disabled until a time slot is selected
- Assert the confirm button is enabled once a time slot is selected
- Assert selecting another date clears the selected time slot and disables confirmation
- Assert clicking the confirm button navigates to the confirmation page

# Confirmation page

- Assert url contains "confirm"
- Assert the page shows the selected date, time and time zone
- Assert the page shows a message explaining that, once they confirm, they will shortly receive an email with the Google Meet link
- Assert there is a form with Name, Email and Description fields
- Assert clicking the confirm button runs the form validations
- Assert the name is non-empty
- Assert the email has a valid format
- Assert the description is non-empty
- Assert every field (Name, Email and Description) is rejected when it contains a dangerous string
- Assert the confirm button is disabled until all 3 fields are non-empty
- Assert clicking the confirm button opens an alert dialog
- Assert the dialog shows the date and time, with "OK" and "Cancel" buttons
- Assert clicking "Cancel" closes the dialog
- Assert clicking "OK" navigates to the success page
- Assert the server's booking-request API, called with the API key, returns exactly one booking with the entered data; the selected date and time are stored as a single ISO datetime (`startsAt`) alongside the time zone
- Assert the server's booking-request API rejects listing bookings without a valid API key
- Assert the server's booking-request API rejects, and does not store, a booking that is not for an available time slot: a past date, today, tomorrow, a date more than 3 months out, or a time that is not one of the offered slots
- Assert the server's booking-request API rejects, and does not store, a booking with a time zone the UI does not offer
- Assert that when the booking request fails, the dialog shows an error and the page stays on the confirmation page

# Turnstile

- The final confirmation dialog renders a Managed Turnstile widget explicitly; OK stays disabled until its callback supplies a token.
- Closing the dialog removes the widget; reopening starts fresh. Errors and expiry clear the token and offer a retry.
- A failed booking submission resets verification before another attempt.
- The UI sends the token in the booking JSON; the Worker verifies it before storing anything or scheduling notifications or meetings.
- Verification requires the app's hostname and the action "booking", with no exception for test keys.
- Assert missing, empty, overlong, invalid, expired/duplicate, wrong-hostname, and wrong-action tokens cannot create a booking, email, or Google event.
- Assert verification outages fail closed with 503 and no side effects.
- Assert widget script failure blocks submission and exposes a retry.
- Assert a rejected browser submission stays in the dialog and can succeed after fresh verification.

# Success page

- Assert url contains "success"
- Assert the page shows the selected date and time, and the entered name, email and description
- Assert the page tells them to check their inbox: an email with the Google Meet link is on its way to the entered email

# Google Meet

- Assert that once a booking is accepted, a Google Meet is created for it: a 30-minute Google Calendar event at the booked time, titled "Meeting with <name>", described with the booker's description, inviting the booker, with Google emailing the invite
- Assert the server's booking-request API, called with the API key, shows the booking's meeting as "created" with its Meet link
- Assert that when Google fails to create the meeting, the booking is still accepted and stored, and the booking-request API shows its meeting as "failed", with the error and the number of attempts
- Failed meetings are retried every 15 minutes, and on demand through the server's meeting-retry API, called with the API key
- Assert the meeting-retry API creates a failed meeting once Google works again, and the booking-request API then shows it as "created"
- Assert the meeting-retry API leaves a created meeting alone: no second Google event is created
- Assert the meeting-retry API rejects calls without a valid API key

# Admin notification

- Assert that once a booking is accepted, an email is sent to ADMIN_EMAIL, titled "New booking request from <name>", with the booked date, time and time zone, and the booker's name, email and description
- Assert exactly one email is sent per booking request
- Assert that when the email cannot be sent, the booking is still accepted and stored, and the failure is recorded in the Worker's logs as an error rather than swallowed

# Rate limiting

- Every test acts as its own client, so tests never use up each other's request budget
- Assert a client can make 10 requests to the server's API within 60 seconds, whatever the route or outcome
- The version API is exempt: it is cheap, and checked repeatedly right after a deploy
- Assert the 11th request within those 60 seconds is rejected with "Too Many Requests" (429) and says when to retry
- Assert another client is not affected
- Assert a client that used up its budget can still call the version API

# Version

- Assert the server's version API returns the id, tag and timestamp of the Worker version serving it, without an API key
