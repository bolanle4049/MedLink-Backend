import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  addMessage,
  contactRepo,
  Episode,
  episodeRepo,
  mediaAssetRepo,
  recordAudit
} from '../models/clinical';
import { DoctorReplySchema, OverrideUrgencySchema } from '../schemas';
import { assembleCase } from '../services/caseAssembly';
import { sendWhatsAppMessage } from '../services/twilioService';

const bandPriority: Record<string, number> = {
  emergency: 1,
  urgent: 2,
  routine: 3,
  non_urgent: 4
};

// A doctor may only see their own facility's queue. MedLink admin sees all.
function facilityScope(req: AuthenticatedRequest): string | null {
  if (req.role === 'medlink_admin') return null; // no scope restriction
  return req.facilityId || '__none__';
}

export async function getQueue(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const stateFilter = (req.query.status as string | undefined) || undefined;
    const bandFilter = (req.query.urgency as string | undefined) || undefined;
    const scope = facilityScope(req);

    // Default view = the live queue (active states). An explicit ?status= (e.g.
    // Resolved for the "attended patients" view) selects that state instead.
    const states = stateFilter ? [stateFilter] : ['Queued', 'Critical', 'InReview'];

    let episodes = await episodeRepo.findMany();
    episodes = episodes.filter((e) => states.includes(e.state));
    if (scope !== null) episodes = episodes.filter((e) => e.facilityId === scope);
    if (bandFilter) episodes = episodes.filter((e) => e.triageBand === bandFilter);

    const resolvedView = stateFilter === 'Resolved';
    episodes.sort((a, b) => {
      if (resolvedView) {
        // Attended view: most recently resolved first.
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      // Live queue: by band, then longest wait first (Spec Sections 1, 9).
      const pa = bandPriority[a.triageBand] || 99;
      const pb = bandPriority[b.triageBand] || 99;
      if (pa !== pb) return pa - pb;
      return new Date(a.queuedAt || a.createdAt).getTime() - new Date(b.queuedAt || b.createdAt).getTime();
    });

    const cases = await Promise.all(episodes.map((e) => assembleCase(e)));
    res.status(200).json({ count: cases.length, cases });
  } catch (err: any) {
    res.status(500).json({ error: 'server_error', message: err.message });
  }
}

async function loadScopedEpisode(req: AuthenticatedRequest, id: string): Promise<Episode> {
  const episode = await episodeRepo.findById(id);
  if (!episode) throw new Error('not_found');
  const scope = facilityScope(req);
  if (scope !== null && episode.facilityId !== scope) {
    throw new Error('forbidden');
  }
  // Admin/clinical permission separation: a facility_admin may see aggregate
  // stats but must not read arbitrary clinical reports unless treating (§12).
  if (req.role === 'facility_admin' && episode.doctorId && episode.doctorId !== req.doctorId) {
    throw new Error('forbidden');
  }
  return episode;
}

export async function getByID(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const episode = await loadScopedEpisode(req, req.params.id as string);
    const caseData = await assembleCase(episode);
    res.status(200).json({ case: caseData });
  } catch (err: any) {
    if (err.message === 'forbidden') {
      res.status(403).json({ error: 'forbidden', message: 'Not permitted to view this case' });
      return;
    }
    res.status(404).json({ error: 'not_found', message: 'Case not found' });
  }
}

// Stream a patient-sent media asset (photo, PDF result, voice note, video) to
// the treating doctor. Facility-scoped via the parent episode.
export async function getCaseMedia(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const episode = await loadScopedEpisode(req, req.params.id as string);
    const asset = await mediaAssetRepo.findById(req.params.mediaId as string);
    if (!asset || asset.episodeId !== episode.id) {
      res.status(404).json({ error: 'not_found', message: 'Media not found for this case' });
      return;
    }
    const bytes = Buffer.isBuffer(asset.data) ? asset.data : Buffer.from(asset.data as any);
    res.set('Content-Type', asset.mimeType);
    res.set('Content-Length', String(bytes.length));
    // Inline so images/PDFs render in-browser; not cached across facilities.
    res.set('Content-Disposition', 'inline');
    res.set('Cache-Control', 'private, no-store');
    res.status(200).send(bytes);
  } catch (err: any) {
    const code = err.message === 'forbidden' ? 403 : 404;
    res.status(code).json({ error: err.message, message: 'Unable to load media' });
  }
}

export async function claimCase(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const episode = await loadScopedEpisode(req, req.params.id as string);
    const doctorId = req.doctorId || 'unknown_doctor';
    await episodeRepo.update(episode.id, { doctorId, state: 'InReview', updatedAt: new Date() });
    await recordAudit('case_opened', { episodeId: episode.id, doctorId });
    res.status(200).json({ message: 'Case claimed and marked in review', caseId: episode.id });
  } catch (err: any) {
    const code = err.message === 'forbidden' ? 403 : 404;
    res.status(code).json({ error: err.message, message: 'Unable to claim case' });
  }
}

export async function overrideUrgency(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const parseResult = OverrideUrgencySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'bad_request', message: parseResult.error.errors[0]?.message || 'Validation error' });
      return;
    }
    const { urgencyBand, reason } = parseResult.data;
    const episode = await loadScopedEpisode(req, req.params.id as string);
    const doctorId = req.doctorId || 'unknown_doctor';
    const oldBand = episode.triageBand;

    await episodeRepo.update(episode.id, { triageBand: urgencyBand, updatedAt: new Date() });
    // Every override is logged with doctor ID and reason (Spec Sections 9, 18).
    await recordAudit('band_override', {
      episodeId: episode.id,
      doctorId,
      reason: `from '${oldBand}' to '${urgencyBand}': ${reason || 'N/A'}`
    });

    res.status(200).json({ message: 'Triage band updated', caseId: episode.id, oldBand, newBand: urgencyBand });
  } catch (err: any) {
    const code = err.message === 'forbidden' ? 403 : err.message === 'not_found' ? 404 : 500;
    res.status(code).json({ error: err.message, message: 'Unable to override band' });
  }
}

export async function doctorReply(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const parseResult = DoctorReplySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'bad_request', message: parseResult.error.errors[0]?.message || 'Validation error' });
      return;
    }
    const { responseMessage, outcome } = parseResult.data;
    const episode = await loadScopedEpisode(req, req.params.id as string);
    const doctorId = req.doctorId || 'unknown_doctor';

    const contact = await contactRepo.findById(episode.contactId);
    const whatsappMsg = `💬 Doctor's Note:\n${responseMessage}`;
    try {
      await sendWhatsAppMessage(contact?.waPhone || '', whatsappMsg);
    } catch (err: any) {
      res.status(502).json({ error: 'delivery_failed', message: err.message });
      return;
    }

    await addMessage(episode.id, 'outbound', whatsappMsg);
    // MVP resolution is a reply plus an outcome (Spec Section 10).
    await episodeRepo.update(episode.id, {
      doctorId,
      outcome, // resolved | needs_visit | follow_up
      state: 'Resolved',
      updatedAt: new Date()
    });
    await recordAudit('doctor_reply', { episodeId: episode.id, doctorId, reason: `outcome: ${outcome}` });

    const updated = await episodeRepo.findById(episode.id);
    res.status(200).json({
      message: 'Doctor reply delivered to patient WhatsApp thread',
      case: updated ? await assembleCase(updated) : null
    });
  } catch (err: any) {
    const code = err.message === 'forbidden' ? 403 : err.message === 'not_found' ? 404 : 500;
    res.status(code).json({ error: err.message, message: 'Unable to send reply' });
  }
}
