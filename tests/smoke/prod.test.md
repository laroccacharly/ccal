# Booking in production

Runs against the deployed app, after a deploy. It makes a real booking, so a real Google Meet invite and a real admin email go out. Production runs the real human verification (Turnstile): whoever runs the test completes the check when it asks for one.

- Wait until the version serving the URL is the latest deployed one, so a run right after a deploy never tests the old code
- Assert the deployed app's clock cannot be faked: the test-clock API is not found (404), even with the API key
- Go to the URL and wait until the available days are loaded
- Select the first available date, moving to the next month if the current one has none left
- Select the first time slot and click the confirm button
- Fill in the contact form with a name, an email and a description saying it is a smoke test
- Click "Confirm"
- In the confirm dialog, wait until the verification completes, prompting whoever runs the test to complete the check if it asks for one; fail if it has not completed within 5 minutes
- Click "OK"
- Assert the booking request is accepted
- Assert the success page is shown, with the booked date and the contact details
- Assert the booking is stored with the selected time and the contact details
- Assert the booking's Google Meet is created, with a Meet link and no error
- Assert no errors happened in the browser: no console errors, no uncaught page errors and no failed requests. The verification widget's own requests and messages are left out: it reports expected failures while it probes the browser, and a real failure already shows as the verification never completing
- At the end of the run, whether the test passed or failed, print the deployed Worker's logs for every request the test made to its API, once the logs of all of them can be found, including errors logged in the background after the booking response, such as a failed admin email. Say which requests' logs never showed up, if any
