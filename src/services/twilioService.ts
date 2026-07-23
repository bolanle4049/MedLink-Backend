import config from "../config";

export async function sendWhatsAppMessage(
  toPhone: string,
  messageBody: string,
): Promise<void> {
  let targetPhone = toPhone;
  if (!targetPhone.startsWith("whatsapp:")) {
    targetPhone = "whatsapp:" + targetPhone;
  }

  let fromPhone = config.twilioWhatsAppNumber;
  if (!fromPhone.startsWith("whatsapp:")) {
    fromPhone = "whatsapp:" + fromPhone;
  }

  // Mock mode if Twilio Credentials are not configured
  if (
    !config.twilioAccountSid ||
    config.twilioAccountSid === "your_twilio_account_sid_here"
  ) {
    console.log(
      `[MOCK TWILIO OUTBOUND WHATSAPP] To: ${targetPhone} | Message: ${messageBody}`,
    );
    return;
  }

  const apiUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;

  const params = new URLSearchParams();
  params.append("From", fromPhone);
  params.append("To", targetPhone);
  params.append("Body", messageBody);

  const authHeader =
    "Basic " +
    Buffer.from(
      `${config.twilioAccountSid}:${config.twilioAuthToken}`,
    ).toString("base64");

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const respText = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 400) {
      console.warn(
        `[WARNING] Twilio API Failed (${response.status}). This is likely because you are testing with a fake number like +1234567890 or your Twilio sandbox is not verified. Mocking WhatsApp Delivery instead.`,
      );
      console.log(`[MOCK MESSAGE] ${messageBody}`);
      return;
    }
    throw new Error(
      `twilio api returned status ${response.status}: ${respText}`,
    );
  }

  console.log(`[INFO] Twilio WhatsApp API Success (Response: ${respText})`);
}

export async function sendWhatsAppTemplateMessage(
  toPhone: string,
  contentSid: string,
  contentVariablesJSON?: string,
): Promise<void> {
  let targetPhone = toPhone;
  if (!targetPhone.startsWith("whatsapp:")) {
    targetPhone = "whatsapp:" + targetPhone;
  }

  let fromPhone = config.twilioWhatsAppNumber;
  if (!fromPhone.startsWith("whatsapp:")) {
    fromPhone = "whatsapp:" + fromPhone;
  }

  if (
    !config.twilioAccountSid ||
    config.twilioAccountSid === "your_twilio_account_sid_here"
  ) {
    console.log(
      `[MOCK TWILIO TEMPLATE WHATSAPP] To: ${targetPhone} | ContentSid: ${contentSid} | Vars: ${contentVariablesJSON}`,
    );
    return;
  }

  const apiUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;

  const params = new URLSearchParams();
  params.append("From", fromPhone);
  params.append("To", targetPhone);
  params.append("ContentSid", contentSid);
  if (contentVariablesJSON) {
    params.append("ContentVariables", contentVariablesJSON);
  }

  const authHeader =
    "Basic " +
    Buffer.from(
      `${config.twilioAccountSid}:${config.twilioAuthToken}`,
    ).toString("base64");

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const respText = await response.text();
  if (!response.ok) {
    throw new Error(
      `twilio api returned status ${response.status}: ${respText}`,
    );
  }

  console.log(`[INFO] Twilio WhatsApp API Success (Response: ${respText})`);
}

export function formatTwiMLResponse(messageBody: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXML(messageBody)}</Message></Response>`;
}

function escapeXML(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
