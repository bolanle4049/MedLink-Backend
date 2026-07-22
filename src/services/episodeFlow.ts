import {
  addMessage,
  addObservation,
  Episode,
  episodeRepo,
  getOrCreateContact,
  getTranscript,
  recordAudit,
  consentRepo
} from '../models/clinical';
import { parseAgeSex, parseConsent, parseCoverage, parseWhoFor } from './identity';
import { routeEpisode } from './routing';
import { bandCase, TriageBand } from './triage/banding';
import { runInterviewTurn } from './triage/interview';
import { checkRedFlags } from './triage/redflags';

// ---------------------------------------------------------------------------
// Episode lifecycle orchestrator (Spec Sections 7, 10).
// AwaitingConsent -> Identifying -> Interviewing -> Confirming -> Queued
// with a Critical short-circuit on any red-flag, and Declined on refusal.
//
// The deterministic red-flag check runs on EVERY inbound message, before the
// consent gate and before any model call. The triage core (interview, banding)
// is invoked with clinical/subject data only — never coverage.
// ---------------------------------------------------------------------------

const CONSENT_PROMPT =
  'Welcome to MedLink. I can help gather your symptoms for a doctor. ' +
  'I am an AI assistant and do not diagnose — a licensed doctor reviews every case. ' +
  'Your information is handled under Nigeria\'s data protection rules (NDPA). ' +
  'Do you consent to continue? Reply YES to proceed or NO to stop.';

const WHO_FOR_PROMPT =
  'Who is this for?\n1. Me\n2. My child\n3. Another adult';

const COVERAGE_PROMPT =
  'How will this visit be covered?\n- Send your HMO/enrollee number\n- Reply CARD if you have a hospital card\n- Reply NONE if neither';

const CRITICAL_REPLY = (rule: string) =>
  `⚠️ URGENT: Your message suggests a potentially life-threatening emergency (${rule}). ` +
  'Please go to the nearest emergency department or call for help NOW. ' +
  'A doctor has been alerted on our system.';

function ageForRedFlags(ep: Episode): number | null {
  return typeof ep.subjectAge === 'number' ? ep.subjectAge : null;
}

async function findActiveEpisode(contactId: string): Promise<Episode | null> {
  const episodes = await episodeRepo.findMany({ contactId });
  const active = episodes.filter(
    (e) => e.state !== 'Resolved' && e.state !== 'Declined' && e.state !== 'Abandoned'
  );
  active.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return active[0] || null;
}

async function newEpisode(contactId: string): Promise<Episode> {
  const now = new Date();
  return episodeRepo.create({
    contactId,
    patientId: '',
    facilityId: '',
    doctorId: '',
    coverageCase: 0,
    coverageType: '',
    coverageRef: '',
    triageBand: '',
    isCritical: false,
    redFlagTriggered: '',
    reporterRelationship: '',
    subjectAge: null,
    subjectSex: '',
    identityMismatch: false,
    primaryComplaint: '',
    rollingSummary: '',
    state: 'AwaitingConsent',
    outcome: '',
    queuedAt: null,
    createdAt: now,
    updatedAt: now
  });
}

async function reply(episodeId: string, text: string): Promise<string> {
  await addMessage(episodeId, 'outbound', text);
  return text;
}

/**
 * Entry point for every inbound patient message.
 */
export async function handleInboundMessage(waPhone: string, body: string): Promise<string> {
  const message = body.trim();
  const contact = await getOrCreateContact(waPhone);

  let episode = await findActiveEpisode(contact.id);

  // Reset keyword: abandon the current episode and start a fresh intake. Checked
  // before everything else so it works even from a Critical/Queued state (a
  // patient whose earlier message tripped a red flag can still start over).
  if (/^(reset|restart|start over|new case|new)$/i.test(message)) {
    if (episode) {
      await addMessage(episode.id, 'inbound', message);
      await episodeRepo.update(episode.id, { state: 'Abandoned', updatedAt: new Date() });
      await recordAudit('session_reset', { episodeId: episode.id });
    }
    const fresh = await newEpisode(contact.id);
    return reply(fresh.id, CONSENT_PROMPT);
  }

  if (!episode) {
    episode = await newEpisode(contact.id);
  }

  await addMessage(episode.id, 'inbound', message);

  // --- Deterministic red-flag layer: EVERY message, before anything else ----
  const rf = checkRedFlags(message, ageForRedFlags(episode));
  if (rf.isRedFlag) {
    return handleCritical(episode, rf.ruleName);
  }

  switch (episode.state) {
    case 'AwaitingConsent':
      return handleConsent(episode, message);
    case 'Identifying':
      return handleIdentifying(episode, message);
    case 'Interviewing':
      return handleInterviewing(episode, message);
    case 'Confirming':
      return handleConfirming(episode, message);
    case 'Queued':
    case 'Critical':
    case 'InReview':
      return reply(
        episode.id,
        'Thank you — your case is with our clinical team and a doctor will reply here shortly.'
      );
    default:
      return reply(episode.id, CONSENT_PROMPT);
  }
}

async function handleCritical(episode: Episode, ruleName: string): Promise<string> {
  await episodeRepo.update(episode.id, {
    state: 'Critical',
    isCritical: true,
    redFlagTriggered: ruleName,
    triageBand: 'emergency',
    queuedAt: new Date(),
    updatedAt: new Date()
  });
  await recordAudit('red_flag_triggered', { episodeId: episode.id, reason: ruleName });
  await recordAudit('band_assigned', { episodeId: episode.id, reason: 'emergency (red-flag halt)' });
  const text = CRITICAL_REPLY(ruleName);
  return reply(episode.id, text);
}

async function handleConsent(episode: Episode, message: string): Promise<string> {
  // If this is the very first inbound (no consent conversation yet), ask.
  const transcript = await getTranscript(episode.id);
  const askedBefore = transcript.some((m) => m.direction === 'outbound');
  if (!askedBefore) {
    return reply(episode.id, CONSENT_PROMPT);
  }

  const consent = parseConsent(message);
  if (consent === 'yes') {
    await consentRepo.create({ contactId: episode.contactId, scope: 'triage', grantedAt: new Date() });
    await recordAudit('consent_granted', { episodeId: episode.id });
    await episodeRepo.update(episode.id, { state: 'Identifying', updatedAt: new Date() });
    return reply(episode.id, WHO_FOR_PROMPT);
  }
  if (consent === 'no') {
    await episodeRepo.update(episode.id, { state: 'Declined', updatedAt: new Date() });
    await recordAudit('consent_declined', { episodeId: episode.id });
    return reply(episode.id, 'Understood. We will not proceed. Take care, and please seek in-person care if you feel unwell.');
  }
  return reply(episode.id, 'Sorry, I did not catch that. ' + CONSENT_PROMPT);
}

async function handleIdentifying(episode: Episode, message: string): Promise<string> {
  // Step 1: who-for
  if (!episode.reporterRelationship) {
    const who = parseWhoFor(message);
    if (!who) {
      return reply(episode.id, 'Please reply 1, 2, or 3.\n' + WHO_FOR_PROMPT);
    }
    await episodeRepo.update(episode.id, { reporterRelationship: who, updatedAt: new Date() });
    await recordAudit('who_for_captured', { episodeId: episode.id, reason: who });
    episode.reporterRelationship = who;
    const possessive = who === 'self' ? 'your' : who === 'child' ? "your child's" : "the patient's";
    return reply(episode.id, `Thank you. What is ${possessive} age and sex? (e.g. "34, female")`);
  }

  // Step 2: subject age + sex (drives age-aware red flags)
  if (episode.subjectAge === null || !episode.subjectSex) {
    const { age, sex } = parseAgeSex(message);
    const nextAge = episode.subjectAge === null ? age : episode.subjectAge;
    const nextSex = episode.subjectSex || sex;
    await episodeRepo.update(episode.id, {
      subjectAge: nextAge,
      subjectSex: nextSex,
      updatedAt: new Date()
    });
    episode.subjectAge = nextAge;
    episode.subjectSex = nextSex;
    if (episode.subjectAge === null || !episode.subjectSex) {
      return reply(episode.id, 'Please share both age and sex (e.g. "5 months, male" or "42, female").');
    }
    await recordAudit('subject_attributes_captured', {
      episodeId: episode.id,
      reason: `age=${episode.subjectAge}, sex=${episode.subjectSex}`
    });
    return reply(episode.id, COVERAGE_PROMPT);
  }

  // Step 3: coverage (routing lane only — never seen by triage core)
  const coverage = parseCoverage(message);
  if (!coverage) {
    return reply(episode.id, 'I did not understand the coverage option.\n' + COVERAGE_PROMPT);
  }
  await episodeRepo.update(episode.id, {
    coverageType: coverage.coverageType,
    coverageRef: JSON.stringify({
      enrolleeId: coverage.enrolleeId || '',
      hmoName: coverage.hmoName || '',
      cardFacilityId: coverage.cardFacilityId || ''
    }),
    state: 'Interviewing',
    updatedAt: new Date()
  });
  await recordAudit('coverage_captured', { episodeId: episode.id, reason: coverage.coverageType });

  const proxy = episode.reporterRelationship !== 'self';
  const opener = proxy
    ? 'Thank you. Now, what is the main problem the patient is experiencing today?'
    : 'Thank you. Now, what is the main problem you are experiencing today?';
  return reply(episode.id, opener);
}

async function handleInterviewing(episode: Episode, message: string): Promise<string> {
  const result = await runInterviewTurn(
    {
      reporterRelationship: episode.reporterRelationship,
      subjectAge: episode.subjectAge,
      subjectSex: episode.subjectSex
    },
    {
      primaryComplaint: episode.primaryComplaint,
      symptoms: episode.rollingSummary ? extractSymptoms(episode.rollingSummary) : '',
      duration: extractDuration(episode.rollingSummary)
    },
    message
  );

  // Persist source-traced observations (the dispute defence).
  const transcript = await getTranscript(episode.id);
  const lastInbound = [...transcript].reverse().find((m) => m.direction === 'inbound');
  for (const obs of result.observations) {
    await addObservation(episode.id, obs.code, obs.value, obs.sourceQuote, lastInbound?.id || '');
  }

  const rollingSummary = JSON.stringify({
    complaint: result.updated.primaryComplaint,
    symptoms: result.updated.symptoms,
    duration: result.updated.duration
  });

  await episodeRepo.update(episode.id, {
    primaryComplaint: result.updated.primaryComplaint,
    rollingSummary,
    state: result.readyToConfirm ? 'Confirming' : 'Interviewing',
    updatedAt: new Date()
  });
  episode.rollingSummary = rollingSummary;

  if (result.readyToConfirm) {
    const summaryText = buildSummary(episode, result.updated);
    return reply(episode.id, summaryText);
  }
  return reply(episode.id, result.nextQuestion);
}

async function handleConfirming(episode: Episode, message: string): Promise<string> {
  const consent = parseConsent(message);
  if (consent === 'no') {
    await episodeRepo.update(episode.id, { state: 'Interviewing', updatedAt: new Date() });
    return reply(episode.id, 'No problem — what would you like to correct or add?');
  }
  if (consent !== 'yes') {
    return reply(episode.id, 'Please reply YES to confirm, or tell me what to correct.');
  }

  const summary = safeParse(episode.rollingSummary);

  // --- Triage core: banding is payment-blind ---
  const banding = bandCase({
    subjectAge: episode.subjectAge,
    subjectSex: episode.subjectSex,
    primaryComplaint: episode.primaryComplaint,
    symptoms: summary.symptoms || '',
    duration: summary.duration || '',
    transcriptText: (await getTranscript(episode.id))
      .filter((m) => m.direction === 'inbound')
      .map((m) => m.body)
      .join(' ')
  });
  await recordAudit('band_assigned', { episodeId: episode.id, reason: banding.rationale });

  // --- Routing lane: coverage fork, AFTER the band exists ---
  const coverageRef = safeParse(episode.coverageRef);
  const routing = await routeEpisode({
    episodeId: episode.id,
    band: banding.band as TriageBand,
    coverageType: (episode.coverageType || 'none') as any,
    reporterRelationship: episode.reporterRelationship,
    enrolleeId: coverageRef.enrolleeId,
    hmoName: coverageRef.hmoName,
    cardFacilityId: coverageRef.cardFacilityId
  });

  await episodeRepo.update(episode.id, {
    triageBand: banding.band,
    coverageCase: routing.coverageCase,
    facilityId: routing.facilityId,
    identityMismatch: routing.identityMismatch,
    state: 'Queued',
    queuedAt: new Date(),
    updatedAt: new Date()
  });

  const bandMsg = banding.band === 'emergency'
    ? 'Your case has been marked high priority. '
    : '';
  const preAuthMsg = routing.preAuthFired
    ? 'We have also begun a coverage pre-authorisation with your HMO. '
    : '';

  return reply(
    episode.id,
    `Thank you. ${bandMsg}Your case has been sent to a doctor and placed in the queue by urgency. ${preAuthMsg}A doctor will reply here shortly.`
  );
}

// --- helpers -----------------------------------------------------------------

function safeParse(json: string): any {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

function extractSymptoms(rollingSummary: string): string {
  return safeParse(rollingSummary).symptoms || '';
}

function extractDuration(rollingSummary: string): string {
  return safeParse(rollingSummary).duration || '';
}

function buildSummary(episode: Episode, known: { primaryComplaint: string; symptoms: string; duration: string }): string {
  const subject = episode.reporterRelationship === 'self' ? 'You' : 'Patient';
  return (
    `Please confirm this summary:\n` +
    `- ${subject}: ${episode.subjectAge ?? '?'} yrs, ${episode.subjectSex || 'sex not given'}\n` +
    `- Main problem: ${known.primaryComplaint || '-'}\n` +
    `- Symptoms: ${known.symptoms || '-'}\n` +
    `- Duration: ${known.duration || '-'}\n\n` +
    `Reply YES to confirm, or tell me what to correct.`
  );
}
