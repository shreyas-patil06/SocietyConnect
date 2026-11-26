import express from 'express';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import {
  insertRow,
  selectOne,
  selectRows,
  updateRows,
} from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';
import { generateWalkinOtp, verifyWalkinOtp } from '../services/otpService.js';
import { createNotification, notifyRole } from '../services/notificationService.js';

const router = express.Router();

async function getFlatMap() {
  const flats = await selectRows('flats');
  return new Map(flats.map((f) => [f.id, f]));
}

async function getProfileMap() {
  const profiles = await selectRows('profiles');
  return new Map(profiles.map((p) => [p.id, p]));
}

async function getVisitorMap() {
  const visitors = await selectRows('visitors');
  return new Map(visitors.map((v) => [v.id, v]));
}

async function expireStalePasses() {
  const activePasses = await selectRows('visitor_passes', { filters: { status: 'Active' } });
  const now = new Date();
  for (const pass of activePasses) {
    if (new Date(pass.expires_at) < now) {
      await updateRows('visitor_passes', { id: pass.id }, { status: 'Expired' });
    }
  }
}

// Get guest passes (Resident: own flat; Guard/Admin: society)
router.get('/passes', requireAuth, async (req, res) => {
  try {
    await expireStalePasses();
    let passes = [];
    if (req.user.role === 'resident') {
      passes = await selectRows('visitor_passes', {
        filters: req.user.flat_id ? { flat_id: req.user.flat_id } : { resident_id: req.user.id },
        orderBy: 'created_at',
        ascending: false,
      });
    } else if (['guard', 'admin'].includes(req.user.role)) {
      passes = await selectRows('visitor_passes', {
        filters: req.user.society_id ? { society_id: req.user.society_id } : {},
        orderBy: 'created_at',
        ascending: false,
      });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [flatMap, profileMap, visitorMap] = await Promise.all([
      getFlatMap(),
      getProfileMap(),
      getVisitorMap(),
    ]);

    const enriched = await Promise.all(
      passes.map(async (p) => {
        const flat = flatMap.get(p.flat_id);
        const visitor = visitorMap.get(p.visitor_id);
        const resident = profileMap.get(p.resident_id);
        const qrDataUrl = await QRCode.toDataURL(p.qr_token, { width: 220, margin: 1 });
        return {
          ...p,
          visitor_name: visitor?.full_name || 'Guest',
          visitor_phone: visitor?.phone || '',
          visitor_type: visitor?.visitor_type || 'Guest',
          flat_label: flat ? `${flat.wing}-${flat.flat_number}` : '',
          resident_name: resident?.full_name || '',
          qr_data_url: qrDataUrl,
        };
      })
    );

    res.json({ passes: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resident invites guest & generates unique cryptographic QR pass
router.post('/passes', requireAuth, requireRole('resident', 'admin'), async (req, res) => {
  try {
    const {
      visitor_name,
      visitor_phone,
      visitor_type = 'Guest',
      purpose = 'Guest Visit',
      pass_type = 'Single-Use',
      valid_hours = 24,
      vehicle_number = '',
      flat_id: bodyFlatId,
    } = req.body || {};

    const cleanName = String(visitor_name || '').trim();
    const cleanPhone = String(visitor_phone || '').trim();
    const targetFlatId = req.user.role === 'admin' && bodyFlatId ? bodyFlatId : req.user.flat_id;

    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ error: 'Guest name is required' });
    }
    if (!cleanPhone || cleanPhone.length < 7) {
      return res.status(400).json({ error: 'Valid guest mobile number is required' });
    }
    if (!targetFlatId) {
      return res.status(400).json({ error: 'No flat assigned to your profile' });
    }

    const flat = await selectOne('flats', { id: targetFlatId });
    if (!flat) return res.status(404).json({ error: 'Flat not found' });

    const hoursNum = Math.min(Math.max(Number(valid_hours) || 24, 1), 168);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + hoursNum * 60 * 60 * 1000);
    const qrToken = `SC-GST-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;

    const visitor = await insertRow('visitors', {
      society_id: flat.society_id,
      full_name: cleanName,
      phone: cleanPhone,
      visitor_type: ['Guest', 'Delivery', 'Cab', 'Service', 'Walk-in'].includes(visitor_type)
        ? visitor_type
        : 'Guest',
      vehicle_number: String(vehicle_number || '').trim(),
      created_at: now.toISOString(),
    });

    const pass = await insertRow('visitor_passes', {
      society_id: flat.society_id,
      flat_id: flat.id,
      resident_id: req.user.id,
      visitor_id: visitor.id,
      qr_token: qrToken,
      purpose: String(purpose || 'Guest Visit').trim(),
      pass_type: pass_type === 'Multi-Entry' ? 'Multi-Entry' : 'Single-Use',
      status: 'Active',
      valid_from: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
    });

    const qrDataUrl = await QRCode.toDataURL(qrToken, { width: 260, margin: 2 });

    res.status(201).json({
      pass: {
        ...pass,
        visitor_name: visitor.full_name,
        visitor_phone: visitor.phone,
        visitor_type: visitor.visitor_type,
        flat_label: `${flat.wing}-${flat.flat_number}`,
        qr_data_url: qrDataUrl,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke a guest pass
router.patch('/passes/:id/revoke', requireAuth, requireRole('resident', 'admin'), async (req, res) => {
  try {
    const pass = await selectOne('visitor_passes', { id: req.params.id });
    if (!pass) return res.status(404).json({ error: 'Visitor pass not found' });

    if (req.user.role === 'resident' && pass.resident_id !== req.user.id && pass.flat_id !== req.user.flat_id) {
      return res.status(403).json({ error: 'You can only revoke passes for your own flat' });
    }
    if (pass.status === 'Checked Out' || pass.status === 'Expired') {
      return res.status(400).json({ error: `Cannot revoke a pass that is already ${pass.status}` });
    }

    const updated = await updateRows('visitor_passes', { id: pass.id }, { status: 'Revoked' });
    res.json({ pass: updated[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify QR Code (Guard / Admin)
router.post('/verify-qr', requireAuth, requireRole('guard', 'admin'), async (req, res) => {
  try {
    await expireStalePasses();
    const token = String(req.body?.qr_token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'QR token is required' });
    }

    // 1. Check Personal Resident QR
    if (token.startsWith('SC-RES-')) {
      const resident = await selectOne('profiles', { personal_qr_token: token });
      if (!resident || !resident.is_active) {
        return res.status(404).json({ valid: false, error: 'Invalid or inactive Resident QR code' });
      }
      if (req.user.society_id && resident.society_id !== req.user.society_id) {
        return res.status(403).json({ valid: false, error: 'Resident belongs to another society' });
      }
      const flat = resident.flat_id ? await selectOne('flats', { id: resident.flat_id }) : null;
      const openLogs = await selectRows('visitor_logs', {
        filters: { resident_id: resident.id, entry_method: 'Resident QR', status: 'Checked In' },
        orderBy: 'check_in_time',
        ascending: false,
        limit: 1,
      });

      return res.json({
        valid: true,
        kind: 'resident',
        recommendedAction: openLogs.length > 0 ? 'check-out' : 'check-in',
        openLog: openLogs[0] || null,
        details: {
          resident_id: resident.id,
          full_name: resident.full_name,
          phone: resident.phone,
          flat_id: resident.flat_id,
          flat_label: flat ? `${flat.wing}-${flat.flat_number}` : 'Unassigned',
          qr_token: token,
        },
      });
    }

    // 2. Check Guest Visitor Pass QR
    const pass = await selectOne('visitor_passes', { qr_token: token });
    if (!pass) {
      return res.status(404).json({ valid: false, error: 'Unrecognized QR pass code' });
    }
    if (req.user.society_id && pass.society_id !== req.user.society_id) {
      return res.status(403).json({ valid: false, error: 'Pass belongs to another society' });
    }
    if (pass.status === 'Revoked') {
      return res.status(400).json({ valid: false, error: 'This guest pass was revoked by the resident' });
    }
    if (pass.status === 'Expired' || new Date(pass.expires_at) < new Date()) {
      await updateRows('visitor_passes', { id: pass.id }, { status: 'Expired' });
      return res.status(400).json({ valid: false, error: 'This guest pass has expired' });
    }
    if (pass.status === 'Checked Out' && pass.pass_type === 'Single-Use') {
      return res.status(400).json({ valid: false, error: 'Single-use guest pass has already been used and checked out' });
    }

    const [visitor, flat, resident, openLogs] = await Promise.all([
      selectOne('visitors', { id: pass.visitor_id }),
      selectOne('flats', { id: pass.flat_id }),
      selectOne('profiles', { id: pass.resident_id }),
      selectRows('visitor_logs', {
        filters: { pass_id: pass.id, status: 'Checked In' },
        orderBy: 'check_in_time',
        ascending: false,
        limit: 1,
      }),
    ]);

    return res.json({
      valid: true,
      kind: 'guest',
      recommendedAction: openLogs.length > 0 ? 'check-out' : 'check-in',
      openLog: openLogs[0] || null,
      pass,
      details: {
        pass_id: pass.id,
        visitor_id: pass.visitor_id,
        full_name: visitor?.full_name || 'Guest',
        phone: visitor?.phone || '',
        visitor_type: visitor?.visitor_type || 'Guest',
        purpose: pass.purpose,
        pass_type: pass.pass_type,
        flat_id: pass.flat_id,
        flat_label: flat ? `${flat.wing}-${flat.flat_number}` : '',
        resident_id: pass.resident_id,
        resident_name: resident?.full_name || '',
        expires_at: pass.expires_at,
        status: pass.status,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record Check-In via Verified QR (Resident QR or Guest Pass)
router.post('/check-in', requireAuth, requireRole('guard', 'admin'), async (req, res) => {
  try {
    await expireStalePasses();
    const { qr_token, pass_id, notes = '' } = req.body || {};

    if (qr_token && String(qr_token).startsWith('SC-RES-')) {
      const resident = await selectOne('profiles', { personal_qr_token: String(qr_token).trim() });
      if (!resident || !resident.is_active) {
        return res.status(404).json({ error: 'Invalid resident QR code' });
      }
      if (!resident.flat_id) {
        return res.status(400).json({ error: 'Resident has no flat assigned' });
      }
      const existingOpen = await selectRows('visitor_logs', {
        filters: { resident_id: resident.id, entry_method: 'Resident QR', status: 'Checked In' },
      });
      if (existingOpen.length > 0) {
        return res.status(409).json({ error: 'Resident is already checked in. Record check-out first.' });
      }
      const log = await insertRow('visitor_logs', {
        society_id: resident.society_id,
        flat_id: resident.flat_id,
        resident_id: resident.id,
        guard_id: req.user.id,
        entry_method: 'Resident QR',
        visitor_name: resident.full_name,
        visitor_phone: resident.phone,
        status: 'Checked In',
        check_in_time: new Date().toISOString(),
        notes: String(notes || 'Resident Gate Entry').trim(),
      });
      await createNotification({
        userId: resident.id,
        societyId: resident.society_id,
        title: 'Gate Check-In Recorded',
        message: 'Your personal Resident QR pass was scanned for entry at the main gate.',
        type: 'visitor',
        referenceId: log.id,
      });
      return res.status(201).json({ log });
    }

    const pass = pass_id
      ? await selectOne('visitor_passes', { id: pass_id })
      : await selectOne('visitor_passes', { qr_token: String(qr_token || '').trim() });

    if (!pass) return res.status(404).json({ error: 'Visitor pass not found' });
    if (pass.status === 'Revoked') return res.status(400).json({ error: 'Pass has been revoked' });
    if (pass.status === 'Expired' || new Date(pass.expires_at) < new Date()) {
      await updateRows('visitor_passes', { id: pass.id }, { status: 'Expired' });
      return res.status(400).json({ error: 'Pass has expired' });
    }
    if (pass.status === 'Checked Out' && pass.pass_type === 'Single-Use') {
      return res.status(400).json({ error: 'Single-use pass has already been used' });
    }

    const existingOpen = await selectRows('visitor_logs', {
      filters: { pass_id: pass.id, status: 'Checked In' },
    });
    if (existingOpen.length > 0) {
      return res.status(409).json({ error: 'Visitor is already checked in with this pass' });
    }

    const visitor = await selectOne('visitors', { id: pass.visitor_id });
    const flat = await selectOne('flats', { id: pass.flat_id });
    const now = new Date().toISOString();

    const log = await insertRow('visitor_logs', {
      society_id: pass.society_id,
      flat_id: pass.flat_id,
      visitor_id: pass.visitor_id,
      resident_id: pass.resident_id,
      pass_id: pass.id,
      guard_id: req.user.id,
      entry_method: 'Guest QR',
      visitor_name: visitor?.full_name || 'Guest',
      visitor_phone: visitor?.phone || '',
      status: 'Checked In',
      check_in_time: now,
      notes: String(notes || pass.purpose).trim(),
    });

    await updateRows('visitor_passes', { id: pass.id }, { status: 'Checked In' });

    await createNotification({
      userId: pass.resident_id,
      societyId: pass.society_id,
      title: 'Guest Checked In',
      message: `${visitor?.full_name || 'Your guest'} checked in for flat ${flat ? `${flat.wing}-${flat.flat_number}` : ''} via QR pass.`,
      type: 'visitor',
      referenceId: log.id,
    });

    res.status(201).json({ log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record Check-Out
router.post('/check-out', requireAuth, requireRole('guard', 'admin'), async (req, res) => {
  try {
    const { log_id, pass_id, qr_token } = req.body || {};
    let log = null;

    if (log_id) {
      log = await selectOne('visitor_logs', { id: log_id });
    } else if (pass_id) {
      const open = await selectRows('visitor_logs', {
        filters: { pass_id, status: 'Checked In' },
        orderBy: 'check_in_time',
        ascending: false,
        limit: 1,
      });
      log = open[0] || null;
    } else if (qr_token) {
      const token = String(qr_token).trim();
      if (token.startsWith('SC-RES-')) {
        const resident = await selectOne('profiles', { personal_qr_token: token });
        if (resident) {
          const open = await selectRows('visitor_logs', {
            filters: { resident_id: resident.id, entry_method: 'Resident QR', status: 'Checked In' },
            limit: 1,
          });
          log = open[0] || null;
        }
      } else {
        const pass = await selectOne('visitor_passes', { qr_token: token });
        if (pass) {
          const open = await selectRows('visitor_logs', {
            filters: { pass_id: pass.id, status: 'Checked In' },
            limit: 1,
          });
          log = open[0] || null;
        }
      }
    }

    if (!log) {
      return res.status(404).json({ error: 'No active check-in record found to check out' });
    }
    if (log.status === 'Checked Out') {
      return res.status(409).json({ error: 'Visitor has already been checked out' });
    }

    const now = new Date().toISOString();
    const updated = await updateRows(
      'visitor_logs',
      { id: log.id },
      { status: 'Checked Out', check_out_time: now }
    );

    if (log.pass_id) {
      const pass = await selectOne('visitor_passes', { id: log.pass_id });
      if (pass) {
        const nextStatus = pass.pass_type === 'Multi-Entry' && new Date(pass.expires_at) > new Date()
          ? 'Active'
          : 'Checked Out';
        await updateRows('visitor_passes', { id: pass.id }, { status: nextStatus });
      }
    }

    if (log.resident_id) {
      await createNotification({
        userId: log.resident_id,
        societyId: log.society_id,
        title: 'Visitor Checked Out',
        message: `${log.visitor_name} has checked out at the main gate.`,
        type: 'visitor',
        referenceId: log.id,
      });
    }

    res.json({ log: updated[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Visitor Check-in / Check-out Logs
router.get('/logs', requireAuth, async (req, res) => {
  try {
    let logs = [];
    if (req.user.role === 'resident') {
      logs = await selectRows('visitor_logs', {
        filters: req.user.flat_id ? { flat_id: req.user.flat_id } : { resident_id: req.user.id },
        orderBy: 'check_in_time',
        ascending: false,
      });
    } else if (['guard', 'admin'].includes(req.user.role)) {
      logs = await selectRows('visitor_logs', {
        filters: req.user.society_id ? { society_id: req.user.society_id } : {},
        orderBy: 'check_in_time',
        ascending: false,
      });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [flatMap, profileMap] = await Promise.all([getFlatMap(), getProfileMap()]);
    const enriched = logs.map((l) => {
      const flat = flatMap.get(l.flat_id);
      const resident = l.resident_id ? profileMap.get(l.resident_id) : null;
      const guard = profileMap.get(l.guard_id);
      return {
        ...l,
        flat_label: flat ? `${flat.wing}-${flat.flat_number}` : '',
        resident_name: resident?.full_name || '',
        guard_name: guard?.full_name || '',
      };
    });

    res.json({ logs: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Walk-in Request: List
router.get('/walkin', requireAuth, async (req, res) => {
  try {
    let requests = [];
    if (req.user.role === 'resident') {
      requests = await selectRows('walkin_requests', {
        filters: req.user.flat_id ? { flat_id: req.user.flat_id } : { resident_id: req.user.id },
        orderBy: 'created_at',
        ascending: false,
      });
    } else if (['guard', 'admin'].includes(req.user.role)) {
      requests = await selectRows('walkin_requests', {
        filters: req.user.society_id ? { society_id: req.user.society_id } : {},
        orderBy: 'created_at',
        ascending: false,
      });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [flatMap, profileMap, visitorMap] = await Promise.all([
      getFlatMap(),
      getProfileMap(),
      getVisitorMap(),
    ]);

    const enriched = requests.map((r) => {
      const flat = flatMap.get(r.flat_id);
      const visitor = visitorMap.get(r.visitor_id);
      const resident = profileMap.get(r.resident_id);
      const guard = profileMap.get(r.guard_id);
      return {
        ...r,
        visitor_name: visitor?.full_name || 'Walk-in Visitor',
        visitor_phone: visitor?.phone || '',
        flat_label: flat ? `${flat.wing}-${flat.flat_number}` : '',
        resident_name: resident?.full_name || '',
        guard_name: guard?.full_name || '',
      };
    });

    res.json({ requests: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Walk-in Request: Create by Guard & generate OTP + send Resident Approval Request
router.post('/walkin', requireAuth, requireRole('guard', 'admin'), async (req, res) => {
  try {
    const { visitor_name, visitor_phone, flat_id, purpose = 'Walk-in Visit', vehicle_number = '' } = req.body || {};
    const cleanName = String(visitor_name || '').trim();
    const cleanPhone = String(visitor_phone || '').trim();

    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ error: 'Visitor name is required' });
    }
    if (!cleanPhone || cleanPhone.length < 7) {
      return res.status(400).json({ error: 'Valid visitor mobile number is required' });
    }
    if (!flat_id) {
      return res.status(400).json({ error: 'Target flat is required' });
    }

    const flat = await selectOne('flats', { id: flat_id });
    if (!flat) return res.status(404).json({ error: 'Flat not found' });

    const flatResidents = await selectRows('profiles', {
      filters: { flat_id: flat.id, role: 'resident', is_active: true },
    });
    if (flatResidents.length === 0) {
      return res.status(400).json({ error: 'No active resident registered for this flat to approve the walk-in' });
    }

    const primaryResident = flatResidents[0];
    const now = new Date().toISOString();

    const visitor = await insertRow('visitors', {
      society_id: flat.society_id,
      full_name: cleanName,
      phone: cleanPhone,
      visitor_type: 'Walk-in',
      vehicle_number: String(vehicle_number || '').trim(),
      created_at: now,
    });

    const walkin = await insertRow('walkin_requests', {
      society_id: flat.society_id,
      flat_id: flat.id,
      resident_id: primaryResident.id,
      guard_id: req.user.id,
      visitor_id: visitor.id,
      purpose: String(purpose || 'Walk-in Visit').trim(),
      approval_status: 'Pending',
      otp_verified: false,
      entry_allowed: false,
      resident_note: '',
      created_at: now,
    });

    const otpResult = await generateWalkinOtp({
      walkinRequestId: walkin.id,
      phone: cleanPhone,
    });

    for (const resUser of flatResidents) {
      await createNotification({
        userId: resUser.id,
        societyId: flat.society_id,
        title: 'Walk-In Visitor Approval Request',
        message: `${cleanName} (${cleanPhone}) is at the gate for Flat ${flat.wing}-${flat.flat_number} (${walkin.purpose}). Please approve or reject.`,
        type: 'visitor',
        referenceId: walkin.id,
      });
    }

    res.status(201).json({
      walkin: {
        ...walkin,
        visitor_name: visitor.full_name,
        visitor_phone: visitor.phone,
        flat_label: `${flat.wing}-${flat.flat_number}`,
        resident_name: primaryResident.full_name,
      },
      otp_preview: otpResult.otp,
      otp_expires_at: otpResult.expiresAt,
      otp_max_attempts: otpResult.maxAttempts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resident Approves or Rejects Walk-In Request
router.patch('/walkin/:id/respond', requireAuth, requireRole('resident', 'admin'), async (req, res) => {
  try {
    const walkin = await selectOne('walkin_requests', { id: req.params.id });
    if (!walkin) return res.status(404).json({ error: 'Walk-in request not found' });

    if (req.user.role === 'resident' && walkin.flat_id !== req.user.flat_id && walkin.resident_id !== req.user.id) {
      return res.status(403).json({ error: 'You are not authorized to respond to this flat request' });
    }
    if (walkin.entry_allowed) {
      return res.status(400).json({ error: 'Visitor entry has already been completed' });
    }

    const decision = String(req.body?.decision || '').trim();
    if (!['Approved', 'Rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be Approved or Rejected' });
    }

    const note = String(req.body?.resident_note || '').trim();
    const updated = await updateRows(
      'walkin_requests',
      { id: walkin.id },
      {
        approval_status: decision,
        resident_note: note,
        responded_at: new Date().toISOString(),
      }
    );

    const visitor = await selectOne('visitors', { id: walkin.visitor_id });
    const flat = await selectOne('flats', { id: walkin.flat_id });

    await createNotification({
      userId: walkin.guard_id,
      societyId: walkin.society_id,
      title: `Walk-In ${decision}`,
      message: `${req.user.full_name} (Flat ${flat ? `${flat.wing}-${flat.flat_number}` : ''}) ${decision.toLowerCase()} walk-in visitor ${visitor?.full_name || ''}.`,
      type: 'visitor',
      referenceId: walkin.id,
    });

    res.json({ walkin: updated[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Guard Verifies Walk-In Visitor OTP
router.post('/walkin/:id/verify-otp', requireAuth, requireRole('guard', 'admin'), async (req, res) => {
  try {
    const walkin = await selectOne('walkin_requests', { id: req.params.id });
    if (!walkin) return res.status(404).json({ error: 'Walk-in request not found' });

    const result = await verifyWalkinOtp({
      walkinRequestId: walkin.id,
      otp: req.body?.otp,
    });

    if (!result.valid) {
      return res.status(result.status).json({ verified: false, error: result.message });
    }

    const refreshed = await selectOne('walkin_requests', { id: walkin.id });
    res.json({ verified: true, message: result.message, walkin: refreshed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Guard Allows Entry ONLY after BOTH Resident Approval & OTP Verification
router.post('/walkin/:id/allow-entry', requireAuth, requireRole('guard', 'admin'), async (req, res) => {
  try {
    const walkin = await selectOne('walkin_requests', { id: req.params.id });
    if (!walkin) return res.status(404).json({ error: 'Walk-in request not found' });

    if (walkin.approval_status !== 'Approved') {
      return res.status(403).json({ error: 'Entry blocked: Resident approval is required first' });
    }
    if (!walkin.otp_verified) {
      return res.status(403).json({ error: 'Entry blocked: Visitor OTP verification is required first' });
    }
    if (walkin.entry_allowed) {
      return res.status(409).json({ error: 'Entry has already been recorded for this walk-in request' });
    }

    const visitor = await selectOne('visitors', { id: walkin.visitor_id });
    const flat = await selectOne('flats', { id: walkin.flat_id });
    const now = new Date().toISOString();

    await updateRows('walkin_requests', { id: walkin.id }, { entry_allowed: true });

    const log = await insertRow('visitor_logs', {
      society_id: walkin.society_id,
      flat_id: walkin.flat_id,
      visitor_id: walkin.visitor_id,
      resident_id: walkin.resident_id,
      walkin_request_id: walkin.id,
      guard_id: req.user.id,
      entry_method: 'Walk-in OTP',
      visitor_name: visitor?.full_name || 'Walk-in Visitor',
      visitor_phone: visitor?.phone || '',
      status: 'Checked In',
      check_in_time: now,
      notes: walkin.purpose,
    });

    await createNotification({
      userId: walkin.resident_id,
      societyId: walkin.society_id,
      title: 'Walk-In Visitor Checked In',
      message: `${visitor?.full_name || 'Visitor'} passed OTP verification and checked in for Flat ${flat ? `${flat.wing}-${flat.flat_number}` : ''}.`,
      type: 'visitor',
      referenceId: log.id,
    });

    res.status(201).json({ log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
