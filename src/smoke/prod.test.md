# Booking in production

Runs against the deployed app, after a deploy. It makes a real booking, so a real Google Meet invite and a real admin email go out.

- Wait until the version serving the URL is the latest deployed one, so a run right after a deploy never tests the old code
- Go to the URL
- Select the first available date, moving to the next month if the current one has none left
- Select the first time slot and click the confirm button
- Fill in the contact form with a name, an email and a description saying it is a smoke test
- Click "Confirm", then "OK" in the confirm dialog
- Assert the booking request is accepted
- Assert the success page is shown, with the booked date and the contact details
- Assert the booking is stored with the selected time and the contact details
- Assert the booking's Google Meet is created, with a Meet link and no error
- Assert no errors happened in the browser: no console errors, no uncaught page errors and no failed requests
- At the end of the run, whether the test passed or failed, print the deployed Worker's logs for every request the test made to its API, once the logs of all of them can be found, including errors logged in the background after the booking response, such as a failed admin email. Say which requests' logs never showed up, if any
