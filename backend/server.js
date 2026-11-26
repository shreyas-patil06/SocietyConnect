import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPublicSupabaseConfig, getSqliteDb, isSupabaseConfigured } from './config/supabaseAdmin.js';
import { verifyCsrf } from './middleware/authMiddleware.js';
import authRoutes from './routes/auth.js';
import visitorsRoutes from './routes/visitors.js';
import complaintsRoutes from './routes/complaints.js';
import paymentsRoutes from './routes/payments.js';
import emergencyRoutes from './routes/emergency.js';
import residentsRoutes from './routes/residents.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Initialize SQLite fallback if Supabase credentials are not yet configured
if (!isSupabaseConfigured()) {
  getSqliteDb();
}

app.set('trust proxy', 1);

// Basic security headers (do not set X-Frame-Options so preview iframe works)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Block direct HTTP access to sensitive backend/database/config folders
app.use((req, res, next) => {
  const reqPath = req.path.toLowerCase();
  if (
    reqPath.startsWith('/backend') ||
    reqPath.startsWith('/database') ||
    reqPath.startsWith('/node_modules') ||
    reqPath.startsWith('/.env') ||
    reqPath === '/package.json' ||
    reqPath === '/package-lock.json'
  ) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
});

// Public client configuration endpoint (safe public keys only)
app.get('/api/config/public', (req, res) => {
  res.json(getPublicSupabaseConfig());
});

// Vendor QR scanner library served locally for offline/iframe reliability
app.get('/vendor/jsQR.js', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'node_modules', 'jsqr', 'dist', 'jsQR.js'));
});

// CSRF protection on mutating API routes
app.use('/api', verifyCsrf);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/visitors', visitorsRoutes);
app.use('/api/complaints', complaintsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/emergency', emergencyRoutes);
app.use('/api/residents', residentsRoutes);

// Static files for HTML5, CSS3, Vanilla JS, and uploaded/public images
app.use('/css', express.static(path.join(ROOT_DIR, 'css')));
app.use('/js', express.static(path.join(ROOT_DIR, 'js')));
app.use('/pages', express.static(path.join(ROOT_DIR, 'pages')));
app.use('/images', express.static(path.join(ROOT_DIR, 'images')));
app.use('/public', express.static(path.join(ROOT_DIR, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'login.html'));
});
app.get('/register.html', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'register.html'));
});

// Error handler for Multer & API errors
app.use((err, req, res, next) => {
  if (req.path.startsWith('/api')) {
    const status = err.status || (err.name === 'MulterError' ? 400 : 500);
    return res.status(status).json({ error: err.message || 'Internal server error' });
  }
  return next(err);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SocietyConnect server listening on http://0.0.0.0:${PORT} (${isSupabaseConfigured() ? 'Supabase' : 'SQLite local'} mode)`);
});
