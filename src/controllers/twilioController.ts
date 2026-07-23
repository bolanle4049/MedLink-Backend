import { Request, Response } from 'express';
import { MediaPart } from '../services/ai';
import { contactRepo, episodeRepo } from '../models/clinical';
import { SimulatePatientSchema } from '../schemas';
import { assembleCase } from '../services/caseAssembly';
import { handleInboundMessage } from '../services/episodeFlow';
import { downloadTwilioMedia, sendWhatsAppMessage, verifyTwilioSignature } from '../services/twilioService';

// De-dup inbound webhooks by message SID (Spec Sections 14, 19).
const processedMessageSids = new Set<string>();

// Empty TwiML ack — 200 with no <Message>, so Twilio delivers nothing here.
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// Collect + download any attached WhatsApp media from a Twilio webhook body
// (NumMedia / MediaUrl{i} / MediaContentType{i}).
async function collectInboundMedia(body: any): Promise<MediaPart[]> {
  const count = parseInt(body.NumMedia || '0', 10);
  const media: MediaPart[] = [];
  for (let i = 0; i < count; i++) {
    const url = body[`MediaUrl${i}`];
    const mimeType = body[`MediaContentType${i}`];
    if (!url || !mimeType) continue;
    media.push({ mimeType, data: await downloadTwilioMedia(url) });
  }
  return media;
}

export async function webhook(req: Request, res: Response): Promise<void> {
  // Signature verification (Spec Section 16 analog for Twilio).
  if (!verifyTwilioSignature(req)) {
    res.status(403).send('Invalid signature');
    return;
  }

  const fromPhone = req.body.From || req.body.from;
  const body = (req.body.Body || req.body.body || '').trim();
  const messageSid = req.body.MessageSid || req.body.SmsMessageSid;
  const hasMedia = parseInt(req.body.NumMedia || '0', 10) > 0;

  // Idempotency: ignore duplicate deliveries of the same message.
  if (messageSid && processedMessageSids.has(messageSid)) {
    res.set('Content-Type', 'application/xml');
    res.status(200).send(EMPTY_TWIML);
    return;
  }

  if (!fromPhone || (!body && !hasMedia)) {
    res.status(400).send('Missing From, and no Body or media');
    return;
  }

  // ACK immediately. Media understanding + the AI interview can take well over
  // Twilio's ~15s webhook timeout (audio understanding alone is ~13s), so we
  // must not process inline — otherwise Twilio times out and the patient gets
  // no reply. We reply asynchronously via the outbound WhatsApp API instead.
  if (messageSid) processedMessageSids.add(messageSid);
  res.set('Content-Type', 'application/xml');
  res.status(200).send(EMPTY_TWIML);

  void processInboundAsync(fromPhone, body, req.body);
}

// Background: download media, run triage, and send the reply to the patient's
// WhatsApp thread via the outbound API (decoupled from the webhook timeout).
async function processInboundAsync(fromPhone: string, body: string, rawBody: any): Promise<void> {
  try {
    const media = await collectInboundMedia(rawBody);
    const reply = await handleInboundMessage(fromPhone, body, media);
    if (reply) await sendWhatsAppMessage(fromPhone, reply);
  } catch (err) {
    console.error('[WEBHOOK async] failed:', err);
    try {
      await sendWhatsAppMessage(
        fromPhone,
        'Sorry — something went wrong processing your message. Please send it again.'
      );
    } catch {
      /* best effort */
    }
  }
}

export async function simulatePatient(req: Request, res: Response): Promise<void> {
  const parseResult = SimulatePatientSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'bad_request',
      message: parseResult.error.errors[0]?.message || 'Validation error'
    });
    return;
  }

  const { patientPhone, message, media: mediaInput } = parseResult.data;

  const media: MediaPart[] = (mediaInput || []).map((m) => ({
    mimeType: m.mimeType,
    data: Buffer.from(m.dataBase64, 'base64')
  }));

  try {
    console.log(`[INBOUND] Phone: ${patientPhone} | Message: ${message} | media: ${media.length}`);
    const aiReply = await handleInboundMessage(patientPhone, message, media);

    // Assemble the current episode view for convenience during testing.
    let assembled: any = null;
    const contact = await contactRepo.findFirst({ waPhone: patientPhone });
    if (contact) {
      const episodes = (await episodeRepo.findMany({ contactId: contact.id }))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (episodes[0]) {
        assembled = await assembleCase(episodes[0]);
      }
    }

    res.status(200).json({ patientPhone, userMessage: message, aiReply, episode: assembled });
  } catch (err: any) {
    console.error('[SIMULATE] failed:', err);
    res.status(500).json({ error: 'server_error', message: err?.message || 'Failed to process message' });
  }
}
