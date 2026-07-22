import { Router } from 'express';
import { simulatePatient, webhook } from '../controllers/twilioController';

const router = Router();

router.post('/webhook', webhook);
router.post('/simulate-patient', simulatePatient);

export default router;
