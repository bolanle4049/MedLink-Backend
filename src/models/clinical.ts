import { Repository } from '../database/repository';

// ---------------------------------------------------------------------------
// Section 13 ERD entities. CONTACT (phone/account) and PATIENT (facility
// clinical identity) are deliberately distinct; the EPISODE is the unit of care.
// ---------------------------------------------------------------------------

export interface Facility {
  id: string;
  name: string;
  type: string; // hospital | clinic
  location: string;
  avgResponseMin: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Hmo {
  id: string;
  name: string;
  defaultMethod: string; // api | list | manual
  createdAt: Date;
}

export interface Contact {
  id: string;
  waPhone: string;
  lastSeen: Date;
}

export interface Patient {
  id: string;
  facilityId: string;
  name: string;
  dob: string;
  sex: string;
  facilityPatientId: string;
  createdAt: Date;
}

export interface ContactPatientLink {
  id: string;
  contactId: string;
  patientId: string;
  verifyStatus: string;
  createdAt: Date;
}

export type EpisodeState =
  | 'AwaitingConsent'
  | 'Identifying'
  | 'Interviewing'
  | 'Confirming'
  | 'Queued'
  | 'Critical'
  | 'InReview'
  | 'Resolved'
  | 'Declined';

export interface Episode {
  id: string;
  contactId: string;
  patientId: string;
  facilityId: string;
  doctorId: string;
  coverageCase: number; // 0 unknown, 1 HMO, 2 card, 3 none
  coverageType: string; // hmo | card | none
  coverageRef: string; // JSON stash of enrolleeId/hmoName/cardFacilityId (routing lane only)
  triageBand: string; // emergency | urgent | routine | non_urgent
  isCritical: boolean;
  redFlagTriggered: string;
  reporterRelationship: string; // self | child | other_adult
  subjectAge: number | null;
  subjectSex: string;
  identityMismatch: boolean;
  primaryComplaint: string;
  rollingSummary: string;
  state: EpisodeState | string;
  outcome: string;
  queuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  episodeId: string;
  direction: string; // inbound | outbound
  body: string;
  at: Date;
}

export interface Observation {
  id: string;
  episodeId: string;
  sourceMessageId: string;
  code: string;
  value: string;
  sourceQuote: string;
  createdAt: Date;
}

export interface EnrolleeVerification {
  id: string;
  episodeId: string;
  hmoId: string;
  valid: boolean;
  enrolleeId: string;
  enrolleeName: string;
  planTier: string;
  homeFacilityId: string;
  coverageStatus: string;
  verificationMethod: string;
  createdAt: Date;
}

export interface Consent {
  id: string;
  contactId: string;
  scope: string;
  grantedAt: Date;
}

export interface AuditLog {
  id: string;
  episodeId: string;
  doctorId: string;
  action: string;
  reason: string;
  at: Date;
}

export const facilityRepo = new Repository<Facility>('facility');
export const hmoRepo = new Repository<Hmo>('hmo');
export const contactRepo = new Repository<Contact>('contact');
export const patientRepo = new Repository<Patient>('patient');
export const contactPatientLinkRepo = new Repository<ContactPatientLink>('contactPatientLink');
export const episodeRepo = new Repository<Episode>('episode');
export const messageRepo = new Repository<Message>('message');
export const observationRepo = new Repository<Observation>('observation');
export const enrolleeVerificationRepo = new Repository<EnrolleeVerification>('enrolleeVerification');
export const consentRepo = new Repository<Consent>('consent');
export const auditLogRepo = new Repository<AuditLog>('auditLog');

// --- Contact helpers ---------------------------------------------------------

export async function getOrCreateContact(waPhone: string): Promise<Contact> {
  const existing = await contactRepo.findFirst({ waPhone });
  if (existing) {
    await contactRepo.update(existing.id, { lastSeen: new Date() } as Partial<Contact>);
    return existing;
  }
  return contactRepo.create({ waPhone, lastSeen: new Date() });
}

// --- Audit helper (append-only; never updated or deleted) --------------------

export async function recordAudit(
  action: string,
  opts: { episodeId?: string; doctorId?: string; reason?: string } = {}
): Promise<AuditLog> {
  return auditLogRepo.create({
    episodeId: opts.episodeId || '',
    doctorId: opts.doctorId || '',
    action,
    reason: opts.reason || '',
    at: new Date()
  });
}

export async function getAuditTrail(episodeId: string): Promise<AuditLog[]> {
  const rows = await auditLogRepo.findMany({ episodeId });
  return rows.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

// --- Observation helpers (source traceability) -------------------------------

export async function addObservation(
  episodeId: string,
  code: string,
  value: string,
  sourceQuote: string,
  sourceMessageId = ''
): Promise<Observation> {
  return observationRepo.create({
    episodeId,
    code,
    value,
    sourceQuote,
    sourceMessageId,
    createdAt: new Date()
  });
}

export async function getObservations(episodeId: string): Promise<Observation[]> {
  return observationRepo.findMany({ episodeId });
}

// --- Message helpers ---------------------------------------------------------

export async function addMessage(episodeId: string, direction: string, body: string): Promise<Message> {
  return messageRepo.create({ episodeId, direction, body, at: new Date() });
}

export async function getTranscript(episodeId: string): Promise<Message[]> {
  const rows = await messageRepo.findMany({ episodeId });
  return rows.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
