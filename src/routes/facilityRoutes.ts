import { Router } from 'express';
import {
  createFacility,
  enrollDoctor,
  facilityStats,
  listFacilityDoctors,
  uploadEnrollees
} from '../controllers/facilityController';
import authMiddleware, { requireRole } from '../middleware/auth';

const router = Router();

router.use(authMiddleware as any);

// MedLink admin (root) onboards facilities and their facility-admin (Spec §12).
router.post('/', requireRole('medlink_admin') as any, createFacility as any);

// Facility admin (or MedLink admin) manages doctors, list upload, stats.
router.post('/:facilityId/doctors', requireRole('facility_admin', 'medlink_admin') as any, enrollDoctor as any);
router.get('/:facilityId/doctors', requireRole('facility_admin', 'medlink_admin') as any, listFacilityDoctors as any);
router.post('/:facilityId/enrollees', requireRole('facility_admin', 'medlink_admin') as any, uploadEnrollees as any);
router.get('/:facilityId/stats', requireRole('facility_admin', 'medlink_admin') as any, facilityStats as any);

// Facility admin acting on their own facility (no facilityId in path).
router.post('/doctors', requireRole('facility_admin') as any, enrollDoctor as any);
router.get('/doctors', requireRole('facility_admin') as any, listFacilityDoctors as any);
router.post('/enrollees', requireRole('facility_admin') as any, uploadEnrollees as any);
router.get('/stats', requireRole('facility_admin') as any, facilityStats as any);

export default router;
