import { Router } from 'express';
import { getCases, getCaseById, overrideUrgency, replyToCase, ingestCase } from '../controllers/casesController';
import authMiddleware from '../middleware/auth';

const router = Router();

router.use(authMiddleware as any);

router.post('/ingest', ingestCase as any);
router.get('/', getCases as any);
router.get('/:id', getCaseById as any);
router.post('/:id/override', overrideUrgency as any);
router.post('/:id/reply', replyToCase as any);

export default router;
