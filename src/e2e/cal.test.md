# Page load
- Go to the URL
- Wait until the page loads
- Assert the page content contains "Google Meet"

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

# Time select
- Assert the time slots are disabled until a date is selected
- Assert the time picker shows 3 time slots
- Assert default time zone is Montreal Canada.
- Assert time slots in Montreal time zone are: 13h30, 15:30 and 16:30. 
- Assert switching the time zone updates the time slots accordingly
  - Test with the France (Europe/Paris) and Vancouver (America/Vancouver) time zones
- Assert the confirm button is greyed out and disabled until a time slot is selected
- Assert the confirm button is enabled once a time slot is selected
- Assert clicking the confirm button navigates to the confirmation page

# Confirmation page
- Empty for now
