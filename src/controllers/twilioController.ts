import { Request, Response } from 'express';
import { contactRepo, episodeRepo } from '../models/clinical';
import { SimulatePatientSchema } from '../schemas';
import { assembleCase } from '../services/caseAssembly';
import { handleInboundMessage } from '../services/episodeFlow';
import { formatTwiMLResponse, verifyTwilioSignature } from '../services/twilioService';

// De-dup inbound webhooks by message SID (Spec Sections 14, 19).
const processedMessageSids = new Set<string>();

export async function webhook(req: Request, res: Response): Promise<void> {
  // Signature verification (Spec Section 16 analog for Twilio).
  if (!verifyTwilioSignature(req)) {
    res.status(403).send('Invalid signature');
    return;
  }

  const fromPhone = req.body.From || req.body.from;
  const body = (req.body.Body || req.body.body || '').trim();
  const messageSid = req.body.MessageSid || req.body.SmsMessageSid;

  if (!fromPhone || !body) {
    res.status(400).send('Missing From or Body form field');
    return;
  }

  // Idempotency: ignore duplicate deliveries of the same message.
  if (messageSid && processedMessageSids.has(messageSid)) {
    res.set('Content-Type', 'application/xml');
    res.status(200).send(formatTwiMLResponse(''));
    return;
  }

  let replyMessage: string;
  try {
    replyMessage = await handleInboundMessage(fromPhone, body);
  } catch (err) {
    // A transient failure (e.g. the AI API) must NOT mark this message as
    // processed, so Twilio's retry can reach us again.
    console.error('[WEBHOOK] Failed to handle inbound message:', err);
    res.status(500).send('Failed to process message');
    return;
  }

  // Only record the SID once handling succeeded.
  if (messageSid) {
    processedMessageSids.add(messageSid);
  }

  res.set('Content-Type', 'application/xml');
  res.status(200).send(formatTwiMLResponse(replyMessage));
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

  const { patientPhone, message } = parseResult.data;

  console.log(`[INBOUND] Phone: ${patientPhone} | Message: ${message}`);
  const aiReply = await handleInboundMessage(patientPhone, message);

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

  res.status(200).json({
    patientPhone,
    userMessage: message,
    aiReply,
    episode: assembled
  });
}
