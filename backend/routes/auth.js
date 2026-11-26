import express from 'express';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import {
  isSupabaseConfigured,
  supabaseAdmin,
  supabasePublic,
} from '../config/supabaseAdmin.js';
import {
  insertRow,
  selectOne,
  selectRows,
  updateRows,
} from '../config/db.js';
import {
  clearSessionCookie,
  hashPassword,
  requireAuth,
  resolveUserFromRequest,
  sanitizeProfile,
  setSessionCookie,
  signSessionToken,
  verifyPassword,
} from '../middleware/authMiddleware.js';

const router = express.Router();

function makePersonalQrToken() {
  return `SC-RES-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
}

async function enrichUser(profile) {
  if (!profile) return null;
  const safe = sanitizeProfile(profile);
  const society = safe.society_id ? await selectOne('societies', { id: safe.society_id }) : null;
  const flat = safe.flat_id ? await selectOne('flats', { id: safe.flat_id }) : null;
  return {
    ...safe,
    society_name: society?.name || '',
    society_upi_id: society?.upi_id || '',
    society_upi_qr_url: society?.upi_qr_url || '',
    flat_label: flat ? `${flat.wing}-${flat.flat_number}` : '',
    flat,
  };
}

// Public setup status & society directory for registration
router.get('/setup-status', async (req, res) => {
  try {
    const admins = await selectRows('profiles', { filters: { role: 'admin', is_active: true } });
    const societies = await selectRows('societies', { orderBy: 'name', ascending: true });
    const flats = await selectRows('flats', { orderBy: 'flat_number', ascending: true });
    res.json({
      hasAdmin: admins.length > 0,
      mode: isSupabaseConfigured() ? 'supabase' : 'local',
      societies,
      flats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, phone, password, role, society_id, flat_id, staff_specialty } = req.body || {};
    const cleanName = String(full_name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPhone = String(phone || '').trim();
    const requestedRole = String(role || 'resident').trim().toLowerCase();

    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ error: 'Full name is required (at least 2 characters)' });
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!['resident', 'guard', 'staff', 'admin'].includes(requestedRole)) {
      return res.status(400).json({ error: 'Invalid role selected' });
    }

    // Security check: Only allow public admin registration as first-run bootstrap when no admin exists yet
    if (requestedRole === 'admin') {
      const existingAdmins = await selectRows('profiles', { filters: { role: 'admin', is_active: true } });
      if (existingAdmins.length > 0) {
        return res.status(403).json({
          error: 'An Admin account already exists. Ask an existing Admin to create additional Admin accounts.',
        });
      }
    }

    const existingEmail = await selectOne('profiles', { email: cleanEmail });
    if (existingEmail) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Resolve society
    let resolvedSocietyId = society_id || null;
    if (!resolvedSocietyId) {
      const societies = await selectRows('societies', { limit: 1 });
      resolvedSocietyId = societies[0]?.id || null;
    }

    let resolvedFlatId = null;
    if (requestedRole === 'resident') {
      if (!flat_id) {
        return res.status(400).json({ error: 'Residents must select a flat' });
      }
      const flat = await selectOne('flats', { id: flat_id });
      if (!flat) {
        return res.status(400).json({ error: 'Selected flat does not exist' });
      }
      resolvedFlatId = flat.id;
      resolvedSocietyId = flat.society_id;
    }

    const now = new Date().toISOString();
    let userId = crypto.randomUUID();
    let sessionToken = null;

    if (isSupabaseConfigured()) {
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password: String(password),
        email_confirm: true,
        user_metadata: { full_name: cleanName, role: requestedRole },
      });
      if (createErr) {
        return res.status(400).json({ error: createErr.message });
      }
      userId = created.user.id;
    }

    const profile = await insertRow('profiles', {
      id: userId,
      society_id: resolvedSocietyId,
      flat_id: resolvedFlatId,
      full_name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      role: requestedRole,
      personal_qr_token: requestedRole === 'resident' ? makePersonalQrToken() : null,
      staff_specialty: requestedRole === 'staff' ? String(staff_specialty || 'General Maintenance').trim() : '',
      is_active: true,
      password_hash: isSupabaseConfigured() ? null : hashPassword(String(password)),
      created_at: now,
      updated_at: now,
    });

    if (resolvedFlatId) {
      await updateRows('flats', { id: resolvedFlatId }, { occupancy_status: 'Occupied' });
    }

    if (isSupabaseConfigured()) {
      const { data: signInData, error: signInErr } = await supabasePublic.auth.signInWithPassword({
        email: cleanEmail,
        password: String(password),
      });
      if (signInErr) {
        return res.status(400).json({ error: signInErr.message });
      }
      sessionToken = signInData.session.access_token;
    } else {
      sessionToken = signSessionToken({ userId: profile.id, role: profile.role });
    }

    setSessionCookie(req, res, sessionToken);
    const enriched = await enrichUser(profile);
    return res.status(201).json({ user: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    let profile = null;
    let sessionToken = null;

    if (isSupabaseConfigured()) {
      const { data, error } = await supabasePublic.auth.signInWithPassword({
        email: cleanEmail,
        password: String(password),
      });
      if (error || !data?.user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      profile = await selectOne('profiles', { id: data.user.id });
      sessionToken = data.session.access_token;
    } else {
      profile = await selectOne('profiles', { email: cleanEmail });
      if (!profile || !verifyPassword(String(password), profile.password_hash)) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      sessionToken = signSessionToken({ userId: profile.id, role: profile.role });
    }

    if (!profile) {
      return res.status(404).json({ error: 'User profile not found' });
    }
    if (!profile.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact society admin.' });
    }

    setSessionCookie(req, res, sessionToken);
    const enriched = await enrichUser(profile);
    return res.json({ user: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Logout
router.post('/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

// Current authenticated user
router.get('/me', async (req, res) => {
  try {
    const user = await resolveUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const enriched = await enrichUser(user);
    return res.json({ user: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Update own profile
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { full_name, phone, current_password, new_password } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };

    if (full_name && String(full_name).trim().length >= 2) {
      updates.full_name = String(full_name).trim();
    }
    if (phone !== undefined) {
      updates.phone = String(phone).trim();
    }

    if (new_password) {
      if (String(new_password).length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
      }
      if (isSupabaseConfigured()) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
          password: String(new_password),
        });
        if (error) return res.status(400).json({ error: error.message });
      } else {
        const currentProfile = await selectOne('profiles', { id: req.user.id });
        if (!current_password || !verifyPassword(String(current_password), currentProfile.password_hash)) {
          return res.status(400).json({ error: 'Current password is incorrect' });
        }
        updates.password_hash = hashPassword(String(new_password));
      }
    }

    const updated = await updateRows('profiles', { id: req.user.id }, updates);
    const enriched = await enrichUser(updated[0]);
    return res.json({ user: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Regenerate personal Resident QR token & get QR Data URL
router.post('/regenerate-qr', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'resident') {
      return res.status(403).json({ error: 'Only residents have a personal gate QR pass' });
    }
    const newToken = makePersonalQrToken();
    const updated = await updateRows(
      'profiles',
      { id: req.user.id },
      { personal_qr_token: newToken, updated_at: new Date().toISOString() }
    );
    const qrDataUrl = await QRCode.toDataURL(newToken, { width: 280, margin: 2 });
    const enriched = await enrichUser(updated[0]);
    return res.json({ user: enriched, qrDataUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Render QR code PNG data URL for any authorized token
router.get('/qr-image', requireAuth, async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).json({ error: 'QR token required' });
    const qrDataUrl = await QRCode.toDataURL(token, {
      width: 280,
      margin: 2,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });
    return res.json({ qrDataUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
