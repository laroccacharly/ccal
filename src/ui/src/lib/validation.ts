import type { Contact } from "@ccal/shared"

export type ContactErrors = Partial<Record<keyof Contact, string>>

// Characters that could be used to inject markup or scripts.
const DANGEROUS = /[<>{}`\\]|javascript:/iu
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

const FIELDS = ["name", "email", "description"] as const

export const validateContact = (contact: Contact): ContactErrors => {
  const { name, email, description } = contact
  const errors: ContactErrors = {}
  if (!name.trim()) {
    errors.name = "Please enter your name."
  }
  if (!EMAIL.test(email.trim())) {
    errors.email = "Please enter a valid email address."
  }
  if (!description.trim()) {
    errors.description = "Please enter a description."
  }
  for (const key of FIELDS) {
    if (DANGEROUS.test(contact[key])) {
      errors[key] = "This field contains characters that are not allowed."
    }
  }
  return errors
}
