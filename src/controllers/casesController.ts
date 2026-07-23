import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { formatTwiMLResponse, sendWhatsAppMessage } from '../services/twilioService';

const prisma = new PrismaClient();

const OverrideSchema = z.object({
  urgencyBand: z.enum(['critical', 'emergency', 'urgent', 'routine', 'non_urgent']),
  reason: z.string().min(1, "A reason must be provided to override an urgency band.")
});

const ReplySchema = z.object({
  responseMessage: z.string().min(1),
  outcome: z.enum(['resolved', 'needs_visit', 'pending_followup'])
});

export async function getCases(req: Request, res: Response): Promise<void> {
  const doctor = (req as any).user;
  const statusFilter = req.query.status as string | undefined;
  const urgencyFilter = req.query.urgency as string | undefined;

  const where: any = { facilityId: doctor.facilityId };
  if (statusFilter) where.status = statusFilter;
  if (urgencyFilter) where.triageBand = urgencyFilter;

  const episodes = await prisma.episode.findMany({
    where,
    orderBy: [
      { triageBand: 'asc' }, // Note: we need an actual custom sort for bands, this is simplified for now
      { queuedAt: 'asc' }
    ],
    include: {
      patient: true,
      contact: true,
      observations: true
    }
  });

  res.status(200).json({
    count: episodes.length,
    cases: episodes.map(ep => ({
      id: ep.id,
      patientPhone: ep.contact?.waPhone || '',
      patientName: ep.patient?.name || 'Unknown',
      patientGender: ep.subjectSex || '',
      patientAge: ep.subjectAge ? `${ep.subjectAge} years` : '',
      primaryComplaint: ep.observations.find(o => o.code === 'COMPLAINT')?.value || '',
      urgencyBand: ep.triageBand,
      redFlagTriggered: ep.isCritical ? "Red Flag matched" : "",
      status: ep.status,
      createdAt: ep.createdAt
    }))
  });
}

export async function getCaseById(req: Request, res: Response): Promise<void> {
  const doctor = (req as any).user;
  const id = req.params.id as string;

  const episode = await prisma.episode.findFirst({
    where: { id, facilityId: doctor.facilityId },
    include: {
      patient: true,
      contact: true,
      observations: true,
      messages: { orderBy: { createdAt: 'asc' } },
      hmoVerification: { include: { hmo: true } }
    }
  });

  if (!episode) {
    res.status(404).json({ error: 'not_found', message: 'Case not found or unauthorized' });
    return;
  }

  res.status(200).json({
    case: {
      id: episode.id,
      patientPhone: episode.contact?.waPhone || '',
      patientName: episode.patient?.name || 'Unknown',
      urgencyBand: episode.triageBand,
      isCritical: episode.isCritical,
      identityMismatch: episode.identityMismatch,
      observations: episode.observations,
      hmoVerification: episode.hmoVerification,
      rawTranscript: episode.messages.map((m: any) => ({
        sender: m.direction === 'inbound' ? 'patient' : 'ai',
        message: m.body,
        timestamp: m.createdAt
      })),
      status: episode.status,
      createdAt: episode.createdAt
    }
  });
}

export async function overrideUrgency(req: Request, res: Response): Promise<void> {
  const doctor = (req as any).user;
  const id = req.params.id as string;

  const parseResult = OverrideSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'bad_request', message: parseResult.error.errors[0]?.message });
    return;
  }

  const { urgencyBand, reason } = parseResult.data;

  const episode = await prisma.episode.findFirst({ where: { id, facilityId: doctor.facilityId } });
  if (!episode) {
    res.status(404).json({ error: 'not_found', message: 'Case not found or unauthorized' });
    return;
  }

  const oldUrgency = episode.triageBand;

  await prisma.episode.update({
    where: { id },
    data: { triageBand: urgencyBand }
  });

  await prisma.auditLog.create({
    data: {
      episodeId: id,
      doctorId: doctor.id,
      action: 'override_urgency_band',
      reason: `Changed from ${oldUrgency} to ${urgencyBand}. Reason: ${reason}`
    }
  });

  res.status(200).json({
    message: 'Case urgency band updated successfully',
    caseId: id,
    oldUrgency,
    newUrgency: urgencyBand
  });
}

export async function replyToCase(req: Request, res: Response): Promise<void> {
  const doctor = (req as any).user;
  const id = req.params.id as string;

  const parseResult = ReplySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'bad_request', message: parseResult.error.errors[0]?.message });
    return;
  }

  const { responseMessage, outcome } = parseResult.data;

  const episode = await prisma.episode.findFirst({
    where: { id, facilityId: doctor.facilityId },
    include: { contact: true }
  });

  if (!episode) {
    res.status(404).json({ error: 'not_found', message: 'Case not found or unauthorized' });
    return;
  }

  // Use Twilio API to send the doctor's message to the patient
  try {
    await sendWhatsAppMessage(episode.contact.waPhone, responseMessage);
  } catch (err) {
    console.error('Twilio Delivery Error:', err);
    res.status(500).json({ error: 'twilio_error', message: 'Failed to deliver message via WhatsApp' });
    return;
  }

  // Log to transcript
  await prisma.message.create({
    data: {
      episodeId: id,
      direction: 'outbound',
      body: responseMessage,
      waMessageId: 'doctor-reply-' + Date.now() // Mock ID for outgoing message
    }
  });

  // Update case status
  const updatedEpisode = await prisma.episode.update({
    where: { id },
    data: {
      status: outcome,
      outcome: outcome,
      doctorId: doctor.id
    }
  });

  await prisma.auditLog.create({
    data: {
      episodeId: id,
      doctorId: doctor.id,
      action: 'doctor_reply',
      reason: `Doctor replied and set outcome to ${outcome}`
    }
  });

  res.status(200).json({
    message: 'Doctor reply delivered to patient WhatsApp thread via Twilio',
    case: {
      id: updatedEpisode.id,
      status: updatedEpisode.status,
      doctorReply: responseMessage,
      doctorOutcome: updatedEpisode.outcome,
      assignedDoctorId: updatedEpisode.doctorId
    }
  });
}

export async function ingestCase(req: Request, res: Response): Promise<void> {
  const data = req.body;
  if (!data.patientPhone) {
    res.status(400).json({ error: 'bad_request', message: 'patientPhone is required' });
    return;
  }

  // Find or create contact
  let contact = await prisma.contact.findUnique({
    where: { waPhone: data.patientPhone }
  });
  if (!contact) {
    contact = await prisma.contact.create({ data: { waPhone: data.patientPhone } });
  }

  let coverageCase = 3;
  if (data.coverageType === 'hmo') coverageCase = 1;
  else if (data.coverageType === 'card') coverageCase = 2;

  // Create episode
  const episode = await prisma.episode.create({
    data: {
      contactId: contact.id,
      status: "queued",
      reporterRelationship: "me",
      subjectAge: 30, // Mock default
      subjectSex: "Unknown", // Mock default
      triageBand: data.urgencyBand || "routine",
      queuedAt: new Date(),
      coverageCase,
      facilityId: (req as any).user?.facilityId || null
    }
  });

  // Create messages from chatHistory
  if (data.chatHistory && Array.isArray(data.chatHistory)) {
    for (let i = 0; i < data.chatHistory.length; i++) {
      await prisma.message.create({
        data: {
          episodeId: episode.id,
          direction: i % 2 === 0 ? "inbound" : "outbound",
          body: typeof data.chatHistory[i] === 'string' ? data.chatHistory[i] : JSON.stringify(data.chatHistory[i]),
          waMessageId: `mock-msg-${episode.id}-${i}`
        }
      });
    }
  } else if (data.latestPatientMessage) {
    await prisma.message.create({
      data: {
        episodeId: episode.id,
        direction: "inbound",
        body: data.latestPatientMessage,
        waMessageId: `mock-msg-${episode.id}-latest`
      }
    });
  }

  // Create HMO Verification if present
  if (data.hmoVerification) {
    await prisma.enrolleeVerification.create({
      data: {
        episodeId: episode.id,
        hmoId: "dummy-hmo-id",
        valid: data.hmoVerification.verified || false,
        enrolleeId: data.hmoVerification.hmoNumber || "unknown",
        enrolleeName: "Simulated Patient",
        planTier: "standard",
        coverageStatus: data.hmoVerification.status || "unknown",
        verificationMethod: data.hmoVerification.verificationMode || "manual"
      }
    });
  }

  res.status(201).json({
    message: "Case ingested successfully",
    episodeId: episode.id
  });
}
