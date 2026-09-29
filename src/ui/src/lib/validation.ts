import type { Contact } from "@ccal/shared"

export type ContactErrors = Partial<Record<keyof Contact, string>>

// Characters that could be used to inject markup or scripts.
const DANGEROUS = /[<>{}`\\]|javascript:/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateContact({ name, email, description }: Contact): ContactErrors {
  const errors: ContactErrors = {}
  if (!name.trim()) errors.name = "Please enter your name."
  if (!EMAIL.test(email.trim())) errors.email = "Please enter a valid email address."
  if (!description.trim()) errors.description = "Please enter a description."
  for (const [key, value] of Object.entries({ name, email, description }) as [keyof Contact, string][]) {
    if (DANGEROUS.test(value)) errors[key] = "This field contains characters that are not allowed."
  }
  return errors
}
