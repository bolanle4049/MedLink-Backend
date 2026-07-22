import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { createOrUpdateCase, findCaseById, getDoctorQueue } from '../models/caseModel';
import { DoctorReplySchema, OverrideUrgencySchema } from '../schemas';
import { sendWhatsAppMessage } from '../services/twilioService';

export async function getQueue(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const statusFilter = req.query.status as string | undefined;
    const urgencyFilter = req.query.urgency as string | undefined;

    const cases = await getDoctorQueue(statusFilter, urgencyFilter);

    res.status(200).json({
      count: cases.length,
      cases
    });
  } catch (err: any) {
    res.status(500).json({ error: 'server_error', message: err.message });
  }
}

export async function getByID(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const caseID = req.params.id as string;
    const caseData = await findCaseById(caseID);

    res.status(200).json({
      case: caseData
    });
  } catch (err: any) {
    res.status(404).json({ error: 'not_found', message: 'Case not found' });
  }
}

export async function overrideUrgency(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const caseID = req.params.id as string;
    const parseResult = OverrideUrgencySchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        error: 'bad_request',
        message: parseResult.error.errors[0]?.message || 'Validation error'
      });
      return;
    }

    const { urgencyBand, reason } = parseResult.data;

    const caseData = await findCaseById(caseID);
    const doctorID = req.doctorId || 'unknown_doctor';

    const oldUrgency = caseData.urgencyBand;
    caseData.urgencyBand = urgencyBand;
    caseData.updatedAt = new Date();

    const overrideNote = `Doctor ID ${doctorID} overridden urgency from '${oldUrgency}' to '${urgencyBand}'. Reason: ${reason || 'N/A'}`;
    caseData.rawTranscript.push({
      sender: 'doctor_system',
      message: overrideNote,
      timestamp: new Date()
    });

    await createOrUpdateCase(caseData);

    res.status(200).json({
      message: 'Case urgency band updated successfully',
      caseId: caseData.id,
      oldUrgency,
      newUrgency: caseData.urgencyBand
    });
  } catch (err: any) {
    res.status(500).json({ error: 'server_error', message: err.message });
  }
}

export async function doctorReply(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const caseID = req.params.id as string;
    const parseResult = DoctorReplySchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        error: 'bad_request',
        message: parseResult.error.errors[0]?.message || 'Validation error'
      });
      return;
    }

    const { responseMessage, outcome } = parseResult.data;

    const caseData = await findCaseById(caseID);
    const doctorID = req.doctorId || 'unknown_doctor';

    const whatsappMsg = `💬 Doctor's Note:\n${responseMessage}\n\nStatus: ${outcome}`;
    try {
      await sendWhatsAppMessage(caseData.patientPhone, whatsappMsg);
    } catch (err: any) {
      res.status(500).json({ error: 'twilio_delivery_failed', message: err.message });
      return;
    }

    caseData.doctorReply = responseMessage;
    caseData.doctorOutcome = outcome;
    caseData.assignedDoctorId = doctorID;
    caseData.status = outcome;
    caseData.updatedAt = new Date();

    caseData.rawTranscript.push({
      sender: 'doctor',
      message: responseMessage,
      timestamp: new Date()
    });

    await createOrUpdateCase(caseData);

    res.status(200).json({
      message: 'Doctor reply delivered to patient WhatsApp thread via Twilio',
      case: caseData
    });
  } catch (err: any) {
    res.status(500).json({ error: 'server_error', message: err.message });
  }
}
