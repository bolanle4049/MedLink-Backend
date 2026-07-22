import crypto from 'crypto';
import { Request } from 'express';
import config from '../config';

/**
 * Verify the X-Twilio-Signature header (Spec Section 16 — webhook signature
 * verification). In mock mode (no auth token configured) this is a no-op so
 * local simulation works without Twilio credentials.
 */
export function verifyTwilioSignature(req: Request): boolean {
  if (!config.twilioAuthToken || config.twilioAuthToken === 'your_twilio_auth_token_here') {
    return true; // mock / local mode
  }

  const signature = req.header('X-Twilio-Signature');
  if (!signature) return false;

  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const params = req.body || {};
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expected = crypto
    .createHmac('sha1', config.twilioAuthToken)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function sendWhatsAppMessage(toPhone: string, messageBody: string): Promise<void> {
  let targetPhone = toPhone;
  if (!targetPhone.startsWith('whatsapp:')) {
    targetPhone = 'whatsapp:' + targetPhone;
  }

  let fromPhone = config.twilioWhatsAppNumber;
  if (!fromPhone.startsWith('whatsapp:')) {
    fromPhone = 'whatsapp:' + fromPhone;
  }

  // Mock mode if Twilio Credentials are not configured
  if (!config.twilioAccountSid || config.twilioAccountSid === 'your_twilio_account_sid_here') {
    console.log(`[MOCK TWILIO OUTBOUND WHATSAPP] To: ${targetPhone} | Message: ${messageBody}`);
    return;
  }

  const apiUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;

  const params = new URLSearchParams();
  params.append('From', fromPhone);
  params.append('To', targetPhone);
  params.append('Body', messageBody);

  const authHeader = 'Basic ' + Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const respText = await response.text();
  if (!response.ok) {
    throw new Error(`twilio api returned status ${response.status}: ${respText}`);
  }

  console.log(`[INFO] Twilio WhatsApp API Success (Response: ${respText})`);
}

export async function sendWhatsAppTemplateMessage(toPhone: string, contentSid: string, contentVariablesJSON?: string): Promise<void> {
  let targetPhone = toPhone;
  if (!targetPhone.startsWith('whatsapp:')) {
    targetPhone = 'whatsapp:' + targetPhone;
  }

  let fromPhone = config.twilioWhatsAppNumber;
  if (!fromPhone.startsWith('whatsapp:')) {
    fromPhone = 'whatsapp:' + fromPhone;
  }

  if (!config.twilioAccountSid || config.twilioAccountSid === 'your_twilio_account_sid_here') {
    console.log(`[MOCK TWILIO TEMPLATE WHATSAPP] To: ${targetPhone} | ContentSid: ${contentSid} | Vars: ${contentVariablesJSON}`);
    return;
  }

  const apiUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;

  const params = new URLSearchParams();
  params.append('From', fromPhone);
  params.append('To', targetPhone);
  params.append('ContentSid', contentSid);
  if (contentVariablesJSON) {
    params.append('ContentVariables', contentVariablesJSON);
  }

  const authHeader = 'Basic ' + Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const respText = await response.text();
  if (!response.ok) {
    throw new Error(`twilio api returned status ${response.status}: ${respText}`);
  }

  console.log(`[INFO] Twilio WhatsApp API Success (Response: ${respText})`);
}

export function formatTwiMLResponse(messageBody: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXML(messageBody)}</Message></Response>`;
}

function escapeXML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
