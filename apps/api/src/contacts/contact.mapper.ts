import type { Contact } from "@arthur-ai/database";
import type { ContactDetail, ContactSummary } from "@arthur-ai/shared";

export function toContactSummary(contact: Contact): ContactSummary {
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    status: contact.status,
    source: contact.source,
    createdAt: contact.createdAt.toISOString(),
  };
}

export function toContactDetail(contact: Contact): ContactDetail {
  return { ...toContactSummary(contact), notes: contact.notes, updatedAt: contact.updatedAt.toISOString() };
}
