import { AlertDialog } from "@base-ui/react/alert-dialog"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { postBookingRequest } from "@/lib/api"
import { formatSelectedDate } from "@/lib/dates"
import { timeZoneLabel } from "@/lib/slots"
import { validateContact, type Contact, type ContactErrors } from "@/lib/validation"
import type { Booking } from "@/pages/booking-page"

const fieldClass = "rounded-2xl border bg-background px-3 py-2 text-sm aria-invalid:border-destructive"

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
    {error && (
      <p data-testid={`${id}-error`} className="text-xs text-destructive">
        {error}
      </p>
    )}
  </div>
)

export const ConfirmationPage = ({ booking, onConfirm }: { booking: Booking; onConfirm: (contact: Contact) => void }) => {
  const [contact, setContact] = useState<Contact>({ name: "", email: "", description: "" })
  const [errors, setErrors] = useState<ContactErrors>({})
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const date = formatSelectedDate(booking.date)
  const time = booking.slot.label
  const filled = Object.values(contact).every((value) => value !== "")

  const update = (key: keyof Contact) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setContact({ ...contact, [key]: event.target.value })

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const found = validateContact(contact)
    setErrors(found)
    if (Object.keys(found).length === 0) setDialogOpen(true)
  }

  const send = async () => {
    setSending(true)
    setSendError(null)
    try {
      await postBookingRequest(booking, contact)
      onConfirm(contact)
    } catch {
      setSendError("We couldn't send your booking request. Please try again.")
      setSending(false)
    }
  }

  return (
    <div data-testid="confirmation-page" className="flex flex-col gap-4 rounded-4xl border p-4 md:flex-row">
      <section data-testid="summary" className="flex flex-col gap-3 rounded-3xl border bg-card p-6 md:w-64">
        <h1 className="text-xl font-semibold">Summary</h1>
        <p data-testid="summary-date">{date}</p>
        <p data-testid="summary-time">{time}</p>
        <p data-testid="summary-time-zone">{timeZoneLabel(booking.timeZone)}</p>
        <p data-testid="meeting-link-message" className="mt-auto text-sm text-muted-foreground">
          The meeting link will be sent to you once we confirm the booking on our end.
        </p>
      </section>

      <form noValidate onSubmit={submit} className="flex flex-col gap-4 rounded-3xl border bg-card p-6 md:w-72">
        <Field id="name" label="Name" error={errors.name}>
          <input id="name" className={fieldClass} value={contact.name} onChange={update("name")} aria-invalid={!!errors.name} />
        </Field>
        <Field id="email" label="Email" error={errors.email}>
          <input
            id="email"
            type="email"
            className={fieldClass}
            value={contact.email}
            onChange={update("email")}
            aria-invalid={!!errors.email}
          />
        </Field>
        <Field id="description" label="Description" error={errors.description}>
          <textarea
            id="description"
            rows={4}
            className={fieldClass}
            value={contact.description}
            onChange={update("description")}
            aria-invalid={!!errors.description}
          />
        </Field>
        <Button type="submit" size="lg" className="mt-auto" data-testid="submit-button" disabled={!filled}>
          Confirm
        </Button>
      </form>

      <AlertDialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 bg-black/40" />
          <AlertDialog.Popup
            data-testid="confirm-dialog"
            className="fixed top-1/2 left-1/2 flex w-80 -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-3xl border bg-card p-6"
          >
            <AlertDialog.Title className="text-lg font-semibold">Confirm your booking</AlertDialog.Title>
            <AlertDialog.Description>
              {date} at {time}
            </AlertDialog.Description>
            {sendError && (
              <p data-testid="booking-error" className="text-sm text-destructive">
                {sendError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <AlertDialog.Close render={<Button variant="outline" />}>Cancel</AlertDialog.Close>
              <Button disabled={sending} onClick={send}>
                OK
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  )
}
