import { v4 as uuidv4 } from 'uuid';
import globalDB from '../database/db';

export interface TranscriptTurn {
  sender: string; // "patient" | "ai" | "doctor" | "doctor_system"
  message: string;
  timestamp: Date | string;
}

export interface Case {
  id: string;
  patientPhone: string;
  patientName: string;
  patientGender: string;
  patientAge: string;
  primaryComplaint: string;
  symptoms: string;
  duration: string;
  urgencyBand: string; // critical, emergency, urgent, routine, non_urgent
  redFlagTriggered?: string;
  rawTranscript: TranscriptTurn[];
  status: string; // draft, queued, resolved, needs_visit, pending_followup
  doctorReply?: string;
  doctorOutcome?: string;
  assignedDoctorId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const urgencyPriority: Record<string, number> = {
  critical: 1,
  emergency: 2,
  urgent: 3,
  routine: 4,
  non_urgent: 5
};

export async function createOrUpdateCase(c: Case): Promise<Case> {
  if (!c.id) {
    c.id = uuidv4();
  }
  const now = new Date();
  if (!c.createdAt) {
    c.createdAt = now;
  }
  c.updatedAt = now;

  if (!c.rawTranscript) {
    c.rawTranscript = [];
  }

  if (!globalDB.prisma || globalDB.isInMemory) {
    globalDB.memoryStore.casesByID.set(c.id, c);
    if (c.status !== 'resolved') {
      globalDB.memoryStore.activeCasesByPhone.set(c.patientPhone, c);
    } else {
      globalDB.memoryStore.activeCasesByPhone.delete(c.patientPhone);
    }
    return c;
  }

  const transcriptJSON = JSON.stringify(c.rawTranscript);

  const upserted = await globalDB.prisma.case.upsert({
    where: { id: c.id },
    create: {
      id: c.id,
      patientPhone: c.patientPhone,
      patientName: c.patientName || '',
      patientGender: c.patientGender || '',
      patientAge: c.patientAge || '',
      primaryComplaint: c.primaryComplaint || '',
      symptoms: c.symptoms || '',
      duration: c.duration || '',
      urgencyBand: c.urgencyBand || 'routine',
      redFlagTriggered: c.redFlagTriggered || '',
      rawTranscript: transcriptJSON,
      status: c.status || 'queued',
      doctorReply: c.doctorReply || '',
      doctorOutcome: c.doctorOutcome || '',
      assignedDoctorId: c.assignedDoctorId || '',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    },
    update: {
      patientName: c.patientName || '',
      patientGender: c.patientGender || '',
      patientAge: c.patientAge || '',
      primaryComplaint: c.primaryComplaint || '',
      symptoms: c.symptoms || '',
      duration: c.duration || '',
      urgencyBand: c.urgencyBand || 'routine',
      redFlagTriggered: c.redFlagTriggered || '',
      rawTranscript: transcriptJSON,
      status: c.status || 'queued',
      doctorReply: c.doctorReply || '',
      doctorOutcome: c.doctorOutcome || '',
      assignedDoctorId: c.assignedDoctorId || '',
      updatedAt: c.updatedAt
    }
  });

  return mapPrismaRowToCase(upserted);
}

export async function findActiveCaseByPatientPhone(phone: string): Promise<Case | null> {
  if (!globalDB.prisma || globalDB.isInMemory) {
    const c = globalDB.memoryStore.activeCasesByPhone.get(phone);
    if (!c || c.status === 'resolved') {
      return null;
    }
    return c;
  }

  const found = await globalDB.prisma.case.findFirst({
    where: {
      patientPhone: phone,
      NOT: { status: 'resolved' }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!found) return null;
  return mapPrismaRowToCase(found);
}

export async function findCaseById(id: string): Promise<Case> {
  if (!globalDB.prisma || globalDB.isInMemory) {
    const c = globalDB.memoryStore.casesByID.get(id);
    if (!c) {
      throw new Error('case not found');
    }
    return c;
  }

  const found = await globalDB.prisma.case.findUnique({
    where: { id }
  });

  if (!found) {
    throw new Error('case not found');
  }

  return mapPrismaRowToCase(found);
}

export async function getDoctorQueue(statusFilter?: string, urgencyFilter?: string): Promise<Case[]> {
  let casesList: Case[] = [];

  if (!globalDB.prisma || globalDB.isInMemory) {
    for (const c of globalDB.memoryStore.casesByID.values()) {
      if (statusFilter && c.status !== statusFilter) {
        continue;
      }
      if (urgencyFilter && c.urgencyBand !== urgencyFilter) {
        continue;
      }
      casesList.push(c);
    }
  } else {
    const where: any = {};
    if (statusFilter) where.status = statusFilter;
    if (urgencyFilter) where.urgencyBand = urgencyFilter;

    const rows = await globalDB.prisma.case.findMany({ where });
    casesList = rows.map(mapPrismaRowToCase);
  }

  // Sort Queue: Critical first, then Emergency -> Urgent -> Routine -> Non-Urgent, then CreatedAt (Oldest waiting first)
  casesList.sort((a, b) => {
    const p1 = urgencyPriority[a.urgencyBand] || 99;
    const p2 = urgencyPriority[b.urgencyBand] || 99;

    if (p1 !== p2) {
      return p1 - p2;
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return casesList;
}

function mapPrismaRowToCase(row: any): Case {
  let rawTranscript: TranscriptTurn[] = [];
  try {
    rawTranscript = typeof row.rawTranscript === 'string' ? JSON.parse(row.rawTranscript) : row.rawTranscript || [];
  } catch (err) {
    rawTranscript = [];
  }

  return {
    id: row.id,
    patientPhone: row.patientPhone,
    patientName: row.patientName,
    patientGender: row.patientGender,
    patientAge: row.patientAge,
    primaryComplaint: row.primaryComplaint,
    symptoms: row.symptoms,
    duration: row.duration,
    urgencyBand: row.urgencyBand,
    redFlagTriggered: row.redFlagTriggered,
    rawTranscript,
    status: row.status,
    doctorReply: row.doctorReply,
    doctorOutcome: row.doctorOutcome,
    assignedDoctorId: row.assignedDoctorId,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt)
  };
}
