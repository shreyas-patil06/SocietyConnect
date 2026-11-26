import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import {
  STORAGE_BUCKET,
  isSupabaseConfigured,
  supabaseAdmin,
} from '../config/supabaseAdmin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const UPLOADS_DIR = path.resolve(ROOT_DIR, 'images', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_MIME = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
]);

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, WEBP images or PDF files are allowed'));
    }
    return cb(null, true);
  },
});

export async function saveUploadedFile(file, folder = 'general') {
  if (!file) return '';
  const ext = ALLOWED_MIME.get(file.mimetype) || '.bin';
  const safeFolder = String(folder).replace(/[^a-z0-9_-]/gi, '') || 'general';
  const fileName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const relativeObjectPath = `${safeFolder}/${fileName}`;

  if (isSupabaseConfigured()) {
    const { error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(relativeObjectPath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`);
    }
    const { data } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(relativeObjectPath);
    return data.publicUrl;
  }

  const targetDir = path.resolve(UPLOADS_DIR, safeFolder);
  if (!targetDir.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error('Invalid upload folder');
  }
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const resolvedPath = path.resolve(targetDir, fileName);
  if (!resolvedPath.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error('Invalid file destination');
  }
  fs.writeFileSync(resolvedPath, file.buffer);
  return `/images/uploads/${safeFolder}/${fileName}`;
}
