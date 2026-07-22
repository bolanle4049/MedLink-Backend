import { episodeRepo, recordAudit } from '../models/clinical';

// ---------------------------------------------------------------------------
// No-response safety net (Spec Section 17). A scheduled worker over queued_at
// + triage_band. Cases waiting past a per-band threshold auto-climb the queue;
// an emergency-banded case unanswered beyond its threshold escalates to a
// fallback. A triage system that flags an emergency and then goes silent is a
// liability, not a feature.
// ---------------------------------------------------------------------------

// Minutes a case may wait in each band before it climbs.
const bandThresholdMin: Record<string, number> = {
  emergency: 5,
  urgent: 30,
  routine: 120,
  non_urgent: 240
};

// One-step upward climb (never downward).
const climbTo: Record<string, string> = {
  non_urgent: 'routine',
  routine: 'urgent',
  urgent: 'emergency'
};

const WAITING_STATES = ['Queued', 'Critical'];

let timer: ReturnType<typeof setInterval> | null = null;

export async function runEscalationSweep(now: Date = new Date()): Promise<number> {
  const episodes = await episodeRepo.findMany();
  let escalated = 0;

  for (const ep of episodes) {
    if (!WAITING_STATES.includes(ep.state)) continue;
    if (!ep.queuedAt) continue;

    const band = ep.triageBand || 'routine';
    const threshold = bandThresholdMin[band] ?? 120;
    const waitedMin = (now.getTime() - new Date(ep.queuedAt).getTime()) / 60000;
    if (waitedMin < threshold) continue;

    if (band === 'emergency') {
      // Already top band: escalate to a fallback rather than climbing.
      await recordAudit('escalation_fallback', {
        episodeId: ep.id,
        reason: `Emergency case unanswered for ${Math.round(waitedMin)}m; escalated to supervising fallback`
      });
      // Reset the clock so we don't spam the fallback every sweep.
      await episodeRepo.update(ep.id, { queuedAt: now, updatedAt: now });
      escalated++;
      continue;
    }

    const next = climbTo[band];
    if (next) {
      await episodeRepo.update(ep.id, { triageBand: next, queuedAt: now, updatedAt: now });
      await recordAudit('auto_climb', {
        episodeId: ep.id,
        reason: `Waited ${Math.round(waitedMin)}m in '${band}'; auto-climbed to '${next}'`
      });
      escalated++;
    }
  }

  return escalated;
}

export function startEscalationWorker(intervalMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => {
    runEscalationSweep().catch((err) => console.error('[ESCALATION] sweep error:', err?.message));
  }, intervalMs);
  console.log(`[INFO] No-response escalation worker started (every ${intervalMs / 1000}s).`);
}

export function stopEscalationWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
