import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { episodeRepo, facilityRepo, recordAudit } from '../models/clinical';
import { createDoctor, listDoctorsByFacility, toDoctorResponse } from '../models/doctorModel';
import { CreateFacilitySchema, EnrollDoctorSchema, EnrolleeUploadSchema } from '../schemas';
import { seedEnrollee } from '../services/hmo';
import { hashPassword } from '../utils/password';

// ---------------------------------------------------------------------------
// Facility onboarding & admin functions (Spec Sections 12, 14).
// MedLink admin creates a facility + its facility-admin (the only account
// created by hand). The facility admin then enrols doctors and uploads lists.
// Doctors always start with mustResetPassword = true (forced first-login reset).
// ---------------------------------------------------------------------------

export async function createFacility(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const parsed = CreateFacilitySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', message: parsed.error.errors[0]?.message });
      return;
    }
    const { name, type, location, avgResponseMin, adminEmail, adminFullName, adminTempPassword } = parsed.data;

    const facility = await facilityRepo.create({
      name,
      type,
      location: location || '',
      avgResponseMin: avgResponseMin || 30,
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);

    const passwordHash = await hashPassword(adminTempPassword);
    const admin = await createDoctor(adminEmail, passwordHash, adminFullName, 'Facility administrator', {
      facilityId: facility.id,
      role: 'facility_admin',
      isVerified: true,
      mustResetPassword: true
    });

    await recordAudit('facility_onboarded', { doctorId: req.doctorId, reason: `facility ${facility.id}` });

    res.status(201).json({
      message: 'Facility created with a facility-admin account. Admin must reset password on first login.',
      facility,
      facilityAdmin: toDoctorResponse(admin)
    });
  } catch (err: any) {
    res.status(409).json({ error: 'facility_creation_failed', message: err.message });
  }
}

export async function enrollDoctor(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const parsed = EnrollDoctorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', message: parsed.error.errors[0]?.message });
      return;
    }
    // Facility admins may only enrol into their own facility.
    const facilityId = req.role === 'medlink_admin'
      ? (req.params.facilityId as string)
      : (req.facilityId as string);

    if (!facilityId) {
      res.status(400).json({ error: 'bad_request', message: 'facilityId is required' });
      return;
    }

    const { email, fullName, mdcnLicense, tempPassword } = parsed.data;
    const passwordHash = await hashPassword(tempPassword);
    const doctor = await createDoctor(email, passwordHash, fullName, `MDCN ${mdcnLicense}`, {
      facilityId,
      role: 'doctor',
      mdcnLicense,
      isVerified: true,
      mustResetPassword: true
    });

    await recordAudit('doctor_enrolled', { doctorId: req.doctorId, reason: `${email} @ ${facilityId}` });

    res.status(201).json({
      message: 'Doctor enrolled. They must reset their password on first login.',
      doctor: toDoctorResponse(doctor)
    });
  } catch (err: any) {
    res.status(409).json({ error: 'enrollment_failed', message: err.message });
  }
}

export async function listFacilityDoctors(req: AuthenticatedRequest, res: Response): Promise<void> {
  const facilityId = req.role === 'medlink_admin' ? (req.params.facilityId as string) : (req.facilityId as string);
  const doctors = await listDoctorsByFacility(facilityId);
  res.status(200).json({ count: doctors.length, doctors: doctors.map(toDoctorResponse) });
}

export async function uploadEnrollees(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = EnrolleeUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'bad_request', message: parsed.error.errors[0]?.message });
    return;
  }
  const facilityId = req.role === 'medlink_admin' ? (req.params.facilityId as string) : (req.facilityId as string);
  for (const row of parsed.data.enrollees) {
    seedEnrollee({
      enrolleeId: row.enrolleeId,
      patientName: row.patientName,
      hmoName: row.hmoName,
      planTier: row.planTier || 'unknown',
      homeFacilityId: row.homeFacilityId || facilityId,
      coverageStatus: row.coverageStatus
    });
  }
  await recordAudit('enrollee_list_uploaded', { doctorId: req.doctorId, reason: `${parsed.data.enrollees.length} rows` });
  res.status(200).json({ message: 'Enrollee list uploaded', count: parsed.data.enrollees.length });
}

// Aggregate stats only — no clinical detail (admin/clinical separation, §12).
export async function facilityStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  const facilityId = req.role === 'medlink_admin' ? (req.params.facilityId as string) : (req.facilityId as string);
  const episodes = (await episodeRepo.findMany()).filter((e) => e.facilityId === facilityId);

  const byBand: Record<string, number> = {};
  const byState: Record<string, number> = {};
  for (const e of episodes) {
    if (e.triageBand) byBand[e.triageBand] = (byBand[e.triageBand] || 0) + 1;
    byState[e.state] = (byState[e.state] || 0) + 1;
  }

  res.status(200).json({
    facilityId,
    totalEpisodes: episodes.length,
    byBand,
    byState
  });
}
