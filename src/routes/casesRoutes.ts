import { Router } from 'express';
import { doctorReply, getByID, getQueue, overrideUrgency } from '../controllers/casesController';
import authMiddleware from '../middleware/auth';

const router = Router();

router.use(authMiddleware as any);

router.get('/', getQueue as any);
router.get('/:id', getByID as any);
router.post('/:id/override', overrideUrgency as any);
router.post('/:id/reply', doctorReply as any);

export default router;
