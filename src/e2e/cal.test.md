# Page load
- Go to the URL
- Wait until the page loads
- Assert the page content contains "Google Meet"
- Assert url contains "#" (hashrouter)
- Assert url contains "form"

# Date select
- Get the current day, month and year from the local machine
- Assert the displayed month and year match the current month and year
- Assert all past days, today and tomorrow are greyed out
- Assert clicking a greyed-out date does not change the selected date
- Assert clicking an available date changes the selected date
- Assert clicking the next month arrow shows the next month
- Assert selecting a date in the next month updates the selected date
- Assert selected date has the format "Month Day Year"
- Assert next month arrow is disabled at 3 months out in the future 
- Assert a "No available days this month" banner is shown on top of the calendar days when every day in the displayed month is disabled, and hidden otherwise
  - Fake the clock to September 29 2026 (banner shown) and to October 1 2026 (no banner)
- Assert the calendar only offers the days the server says are available
- Assert that when the available days cannot be loaded, a "Could not load available days" banner is shown on top of the calendar days

# Time select
- Assert the time slots are disabled until a date is selected
- Assert the time picker shows 3 time slots
- Assert default time zone is Montreal Canada.
- Assert time slots in Montreal time zone are: 13:30, 15:30 and 16:30. 
- Assert switching the time zone updates the time slots accordingly
  - Test with the France (Europe/Paris) and Vancouver (America/Vancouver) time zones
- Assert there is a "Current time: " with the current time for the selected time zone.
- Assert current time changes to match the selected time zone (with a 1 minute tolerance)
- Assert the time slots offered for a date are the ones the server gives for that date
- Assert the confirm button is greyed out and disabled until a time slot is selected
- Assert the confirm button is enabled once a time slot is selected
- Assert clicking the confirm button navigates to the confirmation page

# Confirmation page
- Assert url contains "confirm"
- Assert the page shows the selected date, time and time zone
- Assert the page shows a message explaining that the meeting link will be sent once we confirm the booking on our end
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

# Success page
- Assert url contains "success"
- Assert the page shows the selected date and time, and the entered name, email and description

# Rate limiting
- Every test acts as its own client, so tests never use up each other's request budget
- Assert a client can make 10 requests to the server's API within 60 seconds, whatever the route or outcome
- Assert the 11th request within those 60 seconds is rejected with "Too Many Requests" (429) and says when to retry
- Assert another client is not affected
