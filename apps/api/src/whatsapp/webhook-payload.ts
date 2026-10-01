import { z } from "zod";

/*
 * Formato dos webhooks da WhatsApp Cloud API (campo "messages").
 * Esquemas tolerantes (.loose): a Meta adiciona campos com frequência, e campos novos não podem
 * derrubar o processamento. Cada item é validado isoladamente: um item ruim não descarta os outros.
 */

export const webhookEnvelopeSchema = z
  .object({
    object: z.string(),
    entry: z.array(z.object({ changes: z.array(z.object({ field: z.string(), value: z.unknown() }).loose()) }).loose()).max(100),
  })
  .loose();

export const changeValueSchema = z
  .object({
    metadata: z.object({ phone_number_id: z.string().regex(/^\d{1,32}$/) }).loose(),
    contacts: z.array(z.unknown()).max(1000).optional(),
    messages: z.array(z.unknown()).max(1000).optional(),
    statuses: z.array(z.unknown()).max(1000).optional(),
  })
  .loose();

export const contactSchema = z
  .object({
    wa_id: z.string().regex(/^\d{8,15}$/),
    profile: z.object({ name: z.string().max(500).optional() }).loose().optional(),
  })
  .loose();

export const inboundMessageSchema = z
  .object({
    id: z.string().min(1).max(128),
    from: z.string().regex(/^\d{10,15}$/),
    timestamp: z.string().regex(/^\d{1,12}$/),
    type: z.string().min(1).max(32),
    text: z.object({ body: z.string() }).loose().optional(),
    button: z.object({ text: z.string() }).loose().optional(),
    interactive: z
      .object({
        button_reply: z.object({ title: z.string() }).loose().optional(),
        list_reply: z.object({ title: z.string() }).loose().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
export type InboundMessagePayload = z.infer<typeof inboundMessageSchema>;

export const statusSchema = z
  .object({
    id: z.string().min(1).max(128),
    status: z.string().max(32),
    timestamp: z.string().regex(/^\d{1,12}$/).optional(),
    errors: z.array(z.object({ code: z.number().optional() }).loose()).optional(),
  })
  .loose();
export type StatusPayload = z.infer<typeof statusSchema>;
