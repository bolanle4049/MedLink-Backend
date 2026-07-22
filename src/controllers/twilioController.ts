import { Request, Response } from 'express';
import { findActiveCaseByPatientPhone } from '../models/caseModel';
import { SimulatePatientSchema } from '../schemas';
import { processPatientTurn } from '../services/aiIntake';
import { checkRedFlags } from '../services/redflags';
import { formatTwiMLResponse } from '../services/twilioService';
import { createOrUpdateCase } from '../models/caseModel';

export async function webhook(req: Request, res: Response): Promise<void> {
  const fromPhone = req.body.From || req.body.from;
  const body = (req.body.Body || req.body.body || '').trim();

  if (!fromPhone || !body) {
    res.status(400).send('Missing From or Body form field');
    return;
  }

  const replyMessage = await processInboundMessage(fromPhone, body);

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

  const replyMessage = await processInboundMessage(patientPhone, message);
  const activeCase = await findActiveCaseByPatientPhone(patientPhone);

  res.status(200).json({
    patientPhone,
    userMessage: message,
    aiReply: replyMessage,
    case: activeCase
  });
}

export async function processInboundMessage(fromPhone: string, body: string): Promise<string> {
  console.log(`[TWILIO INBOUND] Phone: ${fromPhone} | Message: ${body}`);

  let activeCase = await findActiveCaseByPatientPhone(fromPhone);
  if (!activeCase) {
    activeCase = {
      id: '',
      patientPhone: fromPhone,
      patientName: '',
      patientGender: '',
      patientAge: '',
      primaryComplaint: '',
      symptoms: '',
      duration: '',
      urgencyBand: 'routine',
      rawTranscript: [],
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  activeCase.rawTranscript.push({
    sender: 'patient',
    message: body,
    timestamp: new Date()
  });

  const { isRedFlag, ruleName } = checkRedFlags(body);
  if (isRedFlag) {
    activeCase.urgencyBand = 'critical';
    activeCase.redFlagTriggered = ruleName;
    activeCase.status = 'queued';

    const emergencyReply = `⚠️ URGENT MEDICAL WARNING: Your reported symptoms indicate a potentially serious critical condition (${ruleName}). Please go to the nearest emergency clinic or hospital immediately. An on-duty clinician has also been alerted on our system.`;

    activeCase.rawTranscript.push({
      sender: 'ai',
      message: emergencyReply,
      timestamp: new Date()
    });

    await createOrUpdateCase(activeCase);
    return emergencyReply;
  }

  try {
    const intakeRes = await processPatientTurn(activeCase, body);
    if (intakeRes.patientName) activeCase.patientName = intakeRes.patientName;
    if (intakeRes.patientGender) activeCase.patientGender = intakeRes.patientGender;
    if (intakeRes.patientAge) activeCase.patientAge = intakeRes.patientAge;
    if (intakeRes.primaryComplaint) activeCase.primaryComplaint = intakeRes.primaryComplaint;
    if (intakeRes.symptoms) activeCase.symptoms = intakeRes.symptoms;
    if (intakeRes.duration) activeCase.duration = intakeRes.duration;
    if (intakeRes.urgencyBand) activeCase.urgencyBand = intakeRes.urgencyBand;

    if (intakeRes.isComplete) {
      activeCase.status = 'queued';
    }

    const replyText = intakeRes.nextQuestion;

    activeCase.rawTranscript.push({
      sender: 'ai',
      message: replyText,
      timestamp: new Date()
    });

    await createOrUpdateCase(activeCase);
    return replyText;
  } catch (err) {
    const fallbackReply = 'Thank you. We have recorded your message and forwarded it to our triage team.';
    await createOrUpdateCase(activeCase);
    return fallbackReply;
  }
}
