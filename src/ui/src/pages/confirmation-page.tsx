import { AlertDialog } from "@base-ui/react/alert-dialog"
import type { Contact } from "@ccal/shared"
import { useState } from "react"

import { Turnstile } from "@/components/turnstile"
import { Button } from "@/components/ui/button"
import { postBookingRequest } from "@/lib/api"
import { formatSelectedDate } from "@/lib/dates"
import { timeZoneLabel } from "@/lib/slots"
import { validateContact } from "@/lib/validation"
import type { ContactErrors } from "@/lib/validation"
import type { Booking } from "@/pages/booking-page"

const fieldClass =
  "rounded-2xl border bg-background px-3 py-2 text-sm aria-invalid:border-destructive"

const Field = ({
  id,
  label,
  error,
  children,
}: {
  id: keyof Contact
  label: string
  error?: string
  children: React.ReactNode
}) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={id} className="text-sm font-medium">
      {label}
    </label>
    {children}
    {error !== undefined && (
      <p data-testid={`${id}-error`} className="text-destructive text-xs">
        {error}
      </p>
    )}
  </div>
)

export const ConfirmationPage = ({
  booking,
  onConfirm,
}: {
  booking: Booking
  onConfirm: (contact: Contact) => void
}) => {
  const [contact, setContact] = useState<Contact>({
    name: "",
    email: "",
    description: "",
  })
  const [errors, setErrors] = useState<ContactErrors>({})
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [verificationAttempt, setVerificationAttempt] = useState(0)
  const [sendError, setSendError] = useState<string | null>(null)
  const date = formatSelectedDate(booking.date)
  const time = booking.slot.label
  const filled = Object.values(contact).every((value) => value !== "")

  const update =
    (key: keyof Contact) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setContact({ ...contact, [key]: event.target.value })
    }

  const submit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found = validateContact(contact)
    setErrors(found)
    if (Object.keys(found).length === 0) {
      setDialogOpen(true)
    }
  }

  const send = async () => {
    if (token === null || sending) {
      return
    }
    setSending(true)
    setSendError(null)
    try {
      await postBookingRequest(booking, contact, token)
      onConfirm(contact)
    } catch {
      setSendError("We couldn't send your booking request. Please try again.")
      setToken(null)
      setVerificationAttempt((value) => value + 1)
      setSending(false)
    }
  }

  return (
    <div
      data-testid="confirmation-page"
      className="flex flex-col gap-4 rounded-4xl border p-4 md:flex-row"
    >
      <section
        data-testid="summary"
        className="bg-card flex flex-col gap-3 rounded-3xl border p-6 md:w-64"
      >
        <h1 className="text-xl font-semibold">Summary</h1>
        <p data-testid="summary-date">{date}</p>
        <p data-testid="summary-time">{time}</p>
        <p data-testid="summary-time-zone">{timeZoneLabel(booking.timeZone)}</p>
        <p
          data-testid="meeting-link-message"
          className="text-muted-foreground mt-auto text-sm"
        >
          Once you confirm, you&apos;ll shortly receive an email with the Google
          Meet link.
        </p>
      </section>

      <form
        noValidate
        onSubmit={submit}
        className="bg-card flex flex-col gap-4 rounded-3xl border p-6 md:w-72"
      >
        <Field id="name" label="Name" error={errors.name}>
          <input
            id="name"
            className={fieldClass}
            value={contact.name}
            onChange={update("name")}
            aria-invalid={errors.name !== undefined}
          />
        </Field>
        <Field id="email" label="Email" error={errors.email}>
          <input
            id="email"
            type="email"
            className={fieldClass}
            value={contact.email}
            onChange={update("email")}
            aria-invalid={errors.email !== undefined}
          />
        </Field>
        <Field id="description" label="Description" error={errors.description}>
          <textarea
            id="description"
            rows={4}
            className={fieldClass}
            value={contact.description}
            onChange={update("description")}
            aria-invalid={errors.description !== undefined}
          />
        </Field>
        <Button
          type="submit"
          size="lg"
          className="mt-auto"
          data-testid="submit-button"
          disabled={!filled}
        >
          Confirm
        </Button>
      </form>

      <AlertDialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 bg-black/40" />
          <AlertDialog.Popup
            data-testid="confirm-dialog"
            className="bg-card fixed top-1/2 left-1/2 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-3xl border p-5 sm:p-6"
          >
            <AlertDialog.Title className="text-lg font-semibold">
              Confirm your booking
            </AlertDialog.Title>
            <AlertDialog.Description>
              {date} at {time}
            </AlertDialog.Description>
            {sendError !== null && (
              <p
                data-testid="booking-error"
                className="text-destructive text-sm"
              >
                {sendError}
              </p>
            )}
            {dialogOpen && (
              <Turnstile key={verificationAttempt} onToken={setToken} />
            )}
            <div className="flex justify-end gap-2">
              <AlertDialog.Close render={<Button variant="outline" />}>
                Cancel
              </AlertDialog.Close>
              <Button
                disabled={sending || token === null}
                onClick={() => {
                  void send()
                }}
              >
                OK
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  )
}
