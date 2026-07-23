import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { adminVerify, login, logout, me, register } from '../controllers/authController';
import authMiddleware from '../middleware/auth';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const fileName = `credentials_${uuidv4().substring(0, 8)}${ext}`;
    cb(null, fileName);
  }
});

const upload = multer({ storage });

router.post('/register', upload.single('mdcnLicense'), register);
router.post('/login', login);
router.post('/admin/verify', adminVerify);

router.get('/me', authMiddleware as any, me as any);
router.post('/logout', authMiddleware as any, logout as any);

export default router;
