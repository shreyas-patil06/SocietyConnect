import { createClient } from '@supabase/supabase-js';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
export const STORAGE_BUCKET = (process.env.SUPABASE_STORAGE_BUCKET || 'society-uploads').trim();

// Session signing secret: read from env or generate strong per-process cryptographic fallback
export const SERVER_SECRET = (process.env.SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
}

export const supabaseAdmin = isSupabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

export const supabasePublic = isSupabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

export function getPublicSupabaseConfig() {
  return {
    mode: isSupabaseConfigured() ? 'supabase' : 'local',
    supabaseUrl: isSupabaseConfigured() ? SUPABASE_URL : '',
    supabaseAnonKey: isSupabaseConfigured() ? SUPABASE_ANON_KEY : '',
    storageBucket: STORAGE_BUCKET,
  };
}

let sqliteInstance = null;

export function getSqliteDb() {
  if (sqliteInstance) return sqliteInstance;

  const dbDir = path.join(ROOT_DIR, 'database');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = path.join(dbDir, 'societyconnect.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS societies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      upi_id TEXT NOT NULL DEFAULT '',
      upi_qr_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS flats (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
      wing TEXT NOT NULL DEFAULT 'A',
      flat_number TEXT NOT NULL,
      floor INTEGER NOT NULL DEFAULT 1,
      area_sqft INTEGER DEFAULT 1200,
      occupancy_status TEXT NOT NULL DEFAULT 'Vacant',
      created_at TEXT NOT NULL,
      UNIQUE (society_id, wing, flat_number)
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      society_id TEXT REFERENCES societies(id) ON DELETE SET NULL,
      flat_id TEXT REFERENCES flats(id) ON DELETE SET NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('resident', 'guard', 'staff', 'admin')),
      personal_qr_token TEXT UNIQUE,
      staff_specialty TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      password_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visitors (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      visitor_type TEXT NOT NULL DEFAULT 'Guest',
      vehicle_number TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visitor_passes (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
      flat_id TEXT NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
      resident_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
      qr_token TEXT NOT NULL UNIQUE,
      purpose TEXT NOT NULL DEFAULT 'Guest Visit',
      pass_type TEXT NOT NULL DEFAULT 'Single-Use',
      status TEXT NOT NULL DEFAULT 'Active',
      valid_from TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS walkin_requests (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
      flat_id TEXT NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
      resident_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      guard_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL DEFAULT 'Walk-in Visit',
      approval_status TEXT NOT NULL DEFAULT 'Pending',
      otp_verified INTEGER NOT NULL DEFAULT 0,
      entry_allowed INTEGER NOT NULL DEFAULT 0,
      resident_note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      responded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS otp_verifications (
      id TEXT PRIMARY KEY,
      walkin_request_id TEXT NOT NULL REFERENCES walkin_requests(id) ON DELETE CASCADE,
      phone TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      verified INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visitor_logs (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
      flat_id TEXT NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
      visitor_id TEXT REFERENCES visitors(id) ON DELETE SET NULL,
      resident_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
      pass_id TEXT REFERENCES visitor_passes(id) ON DELETE SET NULL,
      walkin_request_id TEXT REFERENCES walkin_requests(id) ON DELETE SET NULL,
      guard_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      entry_method TEXT NOT NULL,
      visitor_name TEXT NOT NULL,
      visitor_phone TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Checked In',
      check_in_time TEXT NOT NULL,
      check_out_time TEXT,
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
      flat_id TEXT NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
      resident_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'Medium',
      status TEXT NOT NULL DEFAULT 'Pending',
      resolution_notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS complaint_assignments (
      id TEXT PRIMARY KEY,
      complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
      staff_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      assigned_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      staff_status TEXT NOT NULL DEFAULT 'Assigned',
      progress_notes TEXT DEFAULT '',
      assigned_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maintenance_bills (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
      flat_id TEXT NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      billing_period TEXT NOT NULL,
      amount REAL NOT NULL,
      due_date TEXT NOT NULL,
      bill_document_url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Unpaid',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_receipts (
      id TEXT PRIMARY KEY,
      bill_id TEXT NOT NULL REFERENCES maintenance_bills(id) ON DELETE CASCADE,
      society_id TEXT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
      flat_id TEXT NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
      resident_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      transaction_ref TEXT NOT NULL,
      amount_paid REAL NOT NULL,
      receipt_image_url TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'Payment Submitted',
      verified_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
      admin_remarks TEXT DEFAULT '',
      submitted_at TEXT NOT NULL,
      verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS emergency_alerts (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
      flat_id TEXT NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
      resident_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      emergency_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'Critical',
      details TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      acknowledged_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
      response_notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      acknowledged_at TEXT,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      society_id TEXT REFERENCES societies(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      reference_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // Seed default society and initial flat directory only if empty (no fake users/passwords)
  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM societies').get();
  if (Number(countRow.cnt) === 0) {
    const now = new Date().toISOString();
    const societyId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO societies (id, name, address, city, upi_id, upi_qr_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      societyId,
      'Emerald Heights Residency',
      'Sector 14, Palm Avenue',
      'Pune',
      'emeraldheights@upi',
      '',
      now,
      now
    );

    const insertFlat = db.prepare(
      'INSERT INTO flats (id, society_id, wing, flat_number, floor, area_sqft, occupancy_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const initialFlats = [
      ['A', '101', 1, 1250],
      ['A', '102', 1, 1250],
      ['A', '201', 2, 1400],
      ['A', '202', 2, 1400],
      ['B', '101', 1, 1250],
      ['B', '102', 1, 1250],
      ['B', '201', 2, 1550],
      ['B', '202', 2, 1550],
    ];
    for (const [wing, num, floor, area] of initialFlats) {
      insertFlat.run(crypto.randomUUID(), societyId, wing, num, floor, area, 'Vacant', now);
    }
  }

  sqliteInstance = db;
  return sqliteInstance;
}
