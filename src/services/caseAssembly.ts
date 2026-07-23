import {
  contactRepo,
  enrolleeVerificationRepo,
  Episode,
  getAuditTrail,
  getMediaAssets,
  getObservations,
  getTranscript
} from '../models/clinical';

// ---------------------------------------------------------------------------
// Case assembly for the facility dashboard (Spec Section 14). Assembles the
// source-traced report, transcript, coverage verification, and audit trail
// for a single episode. Coverage data is included ONLY in the assembled
// dashboard view — it is never fed back into triage.
// ---------------------------------------------------------------------------

export async function assembleCase(episode: Episode): Promise<any> {
  const [transcript, observations, auditTrail, mediaAssets, contact] = await Promise.all([
    getTranscript(episode.id),
    getObservations(episode.id),
    getAuditTrail(episode.id),
    getMediaAssets(episode.id),
    contactRepo.findById(episode.contactId)
  ]);

  const verifications = await enrolleeVerificationRepo.findMany({ episodeId: episode.id });

  return {
    id: episode.id,
    state: episode.state,
    patientPhone: contact?.waPhone || '',
    subject: {
      reporterRelationship: episode.reporterRelationship,
      age: episode.subjectAge,
      sex: episode.subjectSex,
      identityMismatch: episode.identityMismatch
    },
    primaryComplaint: episode.primaryComplaint,
    triageBand: episode.triageBand,
    isCritical: episode.isCritical,
    redFlagTriggered: episode.redFlagTriggered,
    coverage: {
      coverageCase: episode.coverageCase,
      coverageType: episode.coverageType,
      verification: verifications[0] || null
    },
    facilityId: episode.facilityId,
    doctorId: episode.doctorId,
    outcome: episode.outcome,
    queuedAt: episode.queuedAt,
    // Source traceability: every reported line links to the patient's words.
    report: observations.map((o) => ({
      code: o.code,
      value: o.value,
      sourceQuote: o.sourceQuote,
      sourceMessageId: o.sourceMessageId
    })),
    transcript: transcript.map((m) => ({ direction: m.direction, body: m.body, at: m.at })),
    // Metadata only — bytes are served on demand via GET /api/cases/:id/media/:mediaId.
    media: mediaAssets.map((m) => ({
      id: m.id,
      kind: m.kind,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      analysis: m.analysis, // Gemini's understanding of this attachment
      at: m.createdAt,
      url: `/api/cases/${episode.id}/media/${m.id}`
    })),
    auditTrail: auditTrail.map((a) => ({ action: a.action, reason: a.reason, doctorId: a.doctorId, at: a.at })),
    createdAt: episode.createdAt,
    updatedAt: episode.updatedAt
  };
}
