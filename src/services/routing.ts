import { enrolleeVerificationRepo, facilityRepo, recordAudit } from '../models/clinical';
import { verifyEnrollee, StandardEnrollee, VerificationMethod } from './hmo';
import { TriageBand } from './triage/banding';

// ---------------------------------------------------------------------------
// Routing engine (Spec Sections 5, 6). Deterministic. Runs ONLY AFTER a band
// exists. This is the identity+routing lane — there is NO edge from here back
// into the triage core. Coverage data lives here and never touches banding.
// ---------------------------------------------------------------------------

export type CoverageType = 'hmo' | 'card' | 'none';

export interface RoutingInput {
  episodeId: string;
  band: TriageBand;
  coverageType: CoverageType;
  reporterRelationship: string; // to detect shared-phone identity mismatch
  enrolleeId?: string;
  hmoName?: string;
  hmoMethod?: VerificationMethod;
  cardFacilityId?: string;
}

export interface RoutingResult {
  coverageCase: 1 | 2 | 3;
  facilityId: string;
  preAuthFired: boolean;
  identityMismatch: boolean;
  verification?: StandardEnrollee;
}

async function sharedPoolFacilityId(): Promise<string> {
  // Case 3 routes to a partner clinic / shared doctor pool. Prefer a clinic.
  const facilities = await facilityRepo.findMany();
  const clinic = facilities.find((f) => f.type === 'clinic');
  return (clinic || facilities[0])?.id || '';
}

export async function routeEpisode(input: RoutingInput): Promise<RoutingResult> {
  // --- Case 1: HMO plan -----------------------------------------------------
  if (input.coverageType === 'hmo') {
    const verification = await verifyEnrollee(
      input.enrolleeId || '',
      input.hmoName || 'Unknown HMO',
      input.hmoMethod || 'list'
    );

    await enrolleeVerificationRepo.create({
      episodeId: input.episodeId,
      hmoId: '',
      valid: verification.valid,
      enrolleeId: verification.enrolleeId,
      enrolleeName: verification.patientName,
      planTier: verification.planTier,
      homeFacilityId: verification.homeFacilityId,
      coverageStatus: verification.coverageStatus,
      verificationMethod: verification.verificationMethod,
      createdAt: new Date()
    });

    // Shared phone: the enrollee is the account holder, who may not be the sick
    // person. Flag rather than assume coverage (Spec Section 8, MVP boundary).
    const identityMismatch = input.reporterRelationship !== 'self';

    const facilityId = verification.homeFacilityId || (await sharedPoolFacilityId());

    // Pre-auth can fire early for urgent/emergency bands (Spec Section 6).
    const preAuthFired = input.band === 'emergency' || input.band === 'urgent';
    if (preAuthFired) {
      await recordAudit('preauth_signalled', {
        episodeId: input.episodeId,
        reason: `Pre-authorisation signal sent to ${verification.hmoName} for ${input.band} band`
      });
    }
    if (identityMismatch) {
      await recordAudit('identity_mismatch_flagged', {
        episodeId: input.episodeId,
        reason: 'Enrollee (account holder) may differ from the triaged patient on a shared phone'
      });
    }

    return { coverageCase: 1, facilityId, preAuthFired, identityMismatch, verification };
  }

  // --- Case 2: hospital card only ------------------------------------------
  if (input.coverageType === 'card') {
    return {
      coverageCase: 2,
      facilityId: input.cardFacilityId || (await sharedPoolFacilityId()),
      preAuthFired: false,
      identityMismatch: false
    };
  }

  // --- Case 3: nothing — partner clinic / shared pool, enrolment funnel -----
  return {
    coverageCase: 3,
    facilityId: await sharedPoolFacilityId(),
    preAuthFired: false,
    identityMismatch: false
  };
}
