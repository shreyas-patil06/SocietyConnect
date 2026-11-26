import express from 'express';
import crypto from 'node:crypto';
import {
  isSupabaseConfigured,
  supabaseAdmin,
} from '../config/supabaseAdmin.js';
import {
  insertRow,
  selectOne,
  selectRows,
  updateRows,
} from '../config/db.js';
import {
  hashPassword,
  requireAuth,
  requireRole,
  sanitizeProfile,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// Societies & flats directory (for authenticated dashboards & guard flat lookup)
router.get('/directory', requireAuth, async (req, res) => {
  try {
    const societies = await selectRows('societies', { orderBy: 'name', ascending: true });
    const flats = await selectRows('flats', {
      filters: req.user.society_id ? { society_id: req.user.society_id } : {},
      orderBy: 'flat_number',
      ascending: true,
    });
    const profiles = await selectRows('profiles', {
      filters: req.user.society_id ? { society_id: req.user.society_id } : {},
    });

    const residentByFlat = new Map();
    for (const p of profiles) {
      if (p.role === 'resident' && p.flat_id && p.is_active) {
        if (!residentByFlat.has(p.flat_id)) residentByFlat.set(p.flat_id, []);
        residentByFlat.get(p.flat_id).push({
          id: p.id,
          full_name: p.full_name,
          phone: p.phone,
        });
      }
    }

    const enrichedFlats = flats.map((f) => ({
      ...f,
      label: `${f.wing}-${f.flat_number}`,
      residents: residentByFlat.get(f.id) || [],
    }));

    res.json({ societies, flats: enrichedFlats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin creates a flat
router.post('/flats', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { society_id, wing = 'A', flat_number, floor = 1, area_sqft = 1200 } = req.body || {};
    const resolvedSocietyId = society_id || req.user.society_id || (await selectRows('societies', { limit: 1 }))[0]?.id;
    if (!resolvedSocietyId) return res.status(400).json({ error: 'Society ID required' });
    const cleanFlatNum = String(flat_number || '').trim();
    const cleanWing = String(wing || 'A').trim().toUpperCase();
    if (!cleanFlatNum) return res.status(400).json({ error: 'Flat number is required' });

    const existing = await selectOne('flats', {
      society_id: resolvedSocietyId,
      wing: cleanWing,
      flat_number: cleanFlatNum,
    });
    if (existing) {
      return res.status(409).json({ error: `Flat ${cleanWing}-${cleanFlatNum} already exists` });
    }

    const flat = await insertRow('flats', {
      society_id: resolvedSocietyId,
      wing: cleanWing,
      flat_number: cleanFlatNum,
      floor: Number(floor) || 1,
      area_sqft: Number(area_sqft) || 1200,
      occupancy_status: 'Vacant',
      created_at: new Date().toISOString(),
    });
    res.status(201).json({ flat });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin updates a flat
router.patch('/flats/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const flat = await selectOne('flats', { id: req.params.id });
    if (!flat) return res.status(404).json({ error: 'Flat not found' });
    const { wing, flat_number, floor, area_sqft, occupancy_status } = req.body || {};
    const updates = {};
    if (wing) updates.wing = String(wing).trim().toUpperCase();
    if (flat_number) updates.flat_number = String(flat_number).trim();
    if (floor !== undefined) updates.floor = Number(floor) || flat.floor;
    if (area_sqft !== undefined) updates.area_sqft = Number(area_sqft) || flat.area_sqft;
    if (['Occupied', 'Vacant'].includes(occupancy_status)) updates.occupancy_status = occupancy_status;

    const updated = await updateRows('flats', { id: flat.id }, updates);
    res.json({ flat: updated[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin lists users (or filters by role)
router.get('/users', requireAuth, requireRole('admin', 'guard'), async (req, res) => {
  try {
    const roleFilter = req.query.role ? String(req.query.role).trim() : null;
    if (req.user.role === 'guard' && roleFilter !== 'resident') {
      return res.status(403).json({ error: 'Guards can only view resident flat directory' });
    }

    const filters = {};
    if (req.user.society_id) filters.society_id = req.user.society_id;
    if (roleFilter) filters.role = roleFilter;

    const [users, flats] = await Promise.all([
      selectRows('profiles', { filters, orderBy: 'created_at', ascending: false }),
      selectRows('flats'),
    ]);
    const flatMap = new Map(flats.map((f) => [f.id, f]));

    const safeUsers = users.map((u) => {
      const safe = sanitizeProfile(u);
      const flat = safe.flat_id ? flatMap.get(safe.flat_id) : null;
      return {
        ...safe,
        flat_label: flat ? `${flat.wing}-${flat.flat_number}` : '',
      };
    });

    res.json({ users: safeUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin creates a user (Resident, Guard, Maintenance Staff, or Admin)
router.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { full_name, email, phone, password, role, flat_id, staff_specialty } = req.body || {};
    const cleanName = String(full_name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanRole = String(role || '').trim().toLowerCase();

    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!['resident', 'guard', 'staff', 'admin'].includes(cleanRole)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const existing = await selectOne('profiles', { email: cleanEmail });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const societyId = req.user.society_id || (await selectRows('societies', { limit: 1 }))[0]?.id;
    let resolvedFlatId = null;
    if (cleanRole === 'resident') {
      if (!flat_id) return res.status(400).json({ error: 'Flat is required for resident accounts' });
      const flat = await selectOne('flats', { id: flat_id });
      if (!flat) return res.status(404).json({ error: 'Flat not found' });
      resolvedFlatId = flat.id;
    }

    let userId = crypto.randomUUID();
    if (isSupabaseConfigured()) {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password: String(password),
        email_confirm: true,
        user_metadata: { full_name: cleanName, role: cleanRole },
      });
      if (error) return res.status(400).json({ error: error.message });
      userId = created.user.id;
    }

    const now = new Date().toISOString();
    const createdProfile = await insertRow('profiles', {
      id: userId,
      society_id: societyId,
      flat_id: resolvedFlatId,
      full_name: cleanName,
      email: cleanEmail,
      phone: String(phone || '').trim(),
      role: cleanRole,
      personal_qr_token:
        cleanRole === 'resident' ? `SC-RES-${crypto.randomBytes(12).toString('hex').toUpperCase()}` : null,
      staff_specialty: cleanRole === 'staff' ? String(staff_specialty || 'General Maintenance').trim() : '',
      is_active: true,
      password_hash: isSupabaseConfigured() ? null : hashPassword(String(password)),
      created_at: now,
      updated_at: now,
    });

    if (resolvedFlatId) {
      await updateRows('flats', { id: resolvedFlatId }, { occupancy_status: 'Occupied' });
    }

    res.status(201).json({ user: sanitizeProfile(createdProfile) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin updates user (flat, active status, specialty, role)
router.patch('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const target = await selectOne('profiles', { id: req.params.id });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const { full_name, phone, flat_id, is_active, staff_specialty, role } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };
    if (full_name) updates.full_name = String(full_name).trim();
    if (phone !== undefined) updates.phone = String(phone).trim();
    if (flat_id !== undefined) updates.flat_id = flat_id || null;
    if (is_active !== undefined) updates.is_active = Boolean(is_active);
    if (staff_specialty !== undefined) updates.staff_specialty = String(staff_specialty).trim();
    if (role && ['resident', 'guard', 'staff', 'admin'].includes(role)) updates.role = role;

    const updated = await updateRows('profiles', { id: target.id }, updates);
    if (updates.flat_id) {
      await updateRows('flats', { id: updates.flat_id }, { occupancy_status: 'Occupied' });
    }
    res.json({ user: sanitizeProfile(updated[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Notifications for current user
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const notifications = await selectRows('notifications', {
      filters: { user_id: req.user.id },
      orderBy: 'created_at',
      ascending: false,
      limit: 100,
    });
    const unreadCount = notifications.filter((n) => !n.is_read).length;
    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const notif = await selectOne('notifications', { id: req.params.id, user_id: req.user.id });
    if (!notif) return res.status(404).json({ error: 'Notification not found' });
    const updated = await updateRows('notifications', { id: notif.id }, { is_read: true });
    res.json({ notification: updated[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await updateRows('notifications', { user_id: req.user.id, is_read: false }, { is_read: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Role-specific live dashboard summary metrics & chart series
router.get('/dashboard-summary', requireAuth, async (req, res) => {
  try {
    const role = req.user.role;
    const societyFilter = req.user.society_id ? { society_id: req.user.society_id } : {};

    if (role === 'resident') {
      const flatFilter = req.user.flat_id ? { flat_id: req.user.flat_id } : { resident_id: req.user.id };
      const [passes, logs, complaints, bills, walkins, alerts] = await Promise.all([
        selectRows('visitor_passes', { filters: flatFilter }),
        selectRows('visitor_logs', { filters: flatFilter, orderBy: 'check_in_time', ascending: false }),
        selectRows('complaints', { filters: { resident_id: req.user.id } }),
        selectRows('maintenance_bills', { filters: flatFilter }),
        selectRows('walkin_requests', { filters: flatFilter }),
        selectRows('emergency_alerts', { filters: { resident_id: req.user.id } }),
      ]);

      const activePasses = passes.filter((p) => ['Active', 'Checked In'].includes(p.status));
      const pendingWalkins = walkins.filter((w) => w.approval_status === 'Pending');
      const openComplaints = complaints.filter((c) => !['Resolved', 'Rejected'].includes(c.status));
      const pendingBills = bills.filter((b) => ['Unpaid', 'Rejected'].includes(b.status));
      const pendingAmount = pendingBills.reduce((s, b) => s + Number(b.amount || 0), 0);

      return res.json({
        role,
        kpis: {
          activePasses: activePasses.length,
          totalVisits: logs.length,
          openComplaints: openComplaints.length,
          pendingBillsCount: pendingBills.length,
          pendingAmount,
          pendingWalkins: pendingWalkins.length,
          activeAlerts: alerts.filter((a) => a.status !== 'Resolved').length,
        },
        recentLogs: logs.slice(0, 6),
        pendingWalkins,
        recentComplaints: complaints.slice(0, 5),
      });
    }

    if (role === 'guard') {
      const [logs, passes, walkins, alerts] = await Promise.all([
        selectRows('visitor_logs', { filters: societyFilter, orderBy: 'check_in_time', ascending: false }),
        selectRows('visitor_passes', { filters: societyFilter }),
        selectRows('walkin_requests', { filters: societyFilter, orderBy: 'created_at', ascending: false }),
        selectRows('emergency_alerts', { filters: societyFilter, orderBy: 'created_at', ascending: false }),
      ]);
      const checkedInNow = logs.filter((l) => l.status === 'Checked In');
      const todayPrefix = new Date().toISOString().slice(0, 10);
      const todayLogs = logs.filter((l) => String(l.check_in_time).startsWith(todayPrefix));
      const pendingWalkins = walkins.filter((w) => !w.entry_allowed && w.approval_status !== 'Rejected');
      const activeAlerts = alerts.filter((a) => a.status !== 'Resolved');

      return res.json({
        role,
        kpis: {
          checkedInNow: checkedInNow.length,
          todayEntries: todayLogs.length,
          activePasses: passes.filter((p) => ['Active', 'Checked In'].includes(p.status)).length,
          pendingWalkins: pendingWalkins.length,
          activeAlerts: activeAlerts.length,
        },
        activeAlerts,
        recentLogs: logs.slice(0, 8),
      });
    }

    if (role === 'staff') {
      const assignments = await selectRows('complaint_assignments', { filters: { staff_id: req.user.id } });
      const ids = [...new Set(assignments.map((a) => a.complaint_id))];
      const complaints = ids.length
        ? await selectRows('complaints', { filters: { id: ids }, orderBy: 'updated_at', ascending: false })
        : [];
      return res.json({
        role,
        kpis: {
          assignedTotal: complaints.length,
          pendingAcceptance: complaints.filter((c) => c.status === 'Assigned').length,
          inProgress: complaints.filter((c) => c.status === 'In Progress').length,
          resolved: complaints.filter((c) => c.status === 'Resolved').length,
          urgentCount: complaints.filter((c) => ['High', 'Urgent'].includes(c.priority) && c.status !== 'Resolved').length,
        },
        complaints: complaints.slice(0, 8),
      });
    }

    // Admin summary
    const [profiles, flats, logs, complaints, bills, receipts, alerts] = await Promise.all([
      selectRows('profiles', { filters: societyFilter }),
      selectRows('flats', { filters: societyFilter }),
      selectRows('visitor_logs', { filters: societyFilter, orderBy: 'check_in_time', ascending: false }),
      selectRows('complaints', { filters: societyFilter, orderBy: 'created_at', ascending: false }),
      selectRows('maintenance_bills', { filters: societyFilter }),
      selectRows('payment_receipts', { filters: societyFilter }),
      selectRows('emergency_alerts', { filters: societyFilter, orderBy: 'created_at', ascending: false }),
    ]);

    const residents = profiles.filter((p) => p.role === 'resident' && p.is_active);
    const staff = profiles.filter((p) => p.role === 'staff' && p.is_active);
    const guards = profiles.filter((p) => p.role === 'guard' && p.is_active);
    const occupiedFlats = flats.filter((f) => f.occupancy_status === 'Occupied');

    const totalCollected = bills
      .filter((b) => b.status === 'Verified')
      .reduce((s, b) => s + Number(b.amount || 0), 0);
    const totalPending = bills
      .filter((b) => b.status !== 'Verified')
      .reduce((s, b) => s + Number(b.amount || 0), 0);

    const resolvedComplaints = complaints.filter((c) => c.status === 'Resolved').length;
    const resolutionRate = complaints.length
      ? Math.round((resolvedComplaints / complaints.length) * 100)
      : 100;

    // 7-day visitor traffic series
    const dayCounts = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const isoDay = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { weekday: 'short' });
      const count = logs.filter((l) => String(l.check_in_time).startsWith(isoDay)).length;
      dayCounts.push({ day: label, date: isoDay, count });
    }

    res.json({
      role,
      kpis: {
        totalResidents: residents.length,
        totalFlats: flats.length,
        occupiedFlats: occupiedFlats.length,
        staffCount: staff.length,
        guardCount: guards.length,
        checkedInVisitors: logs.filter((l) => l.status === 'Checked In').length,
        totalVisitorLogs: logs.length,
        openComplaints: complaints.filter((c) => !['Resolved', 'Rejected'].includes(c.status)).length,
        totalComplaints: complaints.length,
        resolutionRate,
        totalCollected,
        totalPending,
        pendingReceipts: receipts.filter((r) => r.verification_status === 'Payment Submitted').length,
        activeEmergencies: alerts.filter((a) => a.status !== 'Resolved').length,
      },
      dayCounts,
      recentComplaints: complaints.slice(0, 5),
      activeEmergencies: alerts.filter((a) => a.status !== 'Resolved'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
