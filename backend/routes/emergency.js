import express from 'express';
import {
  insertRow,
  selectOne,
  selectRows,
  updateRows,
} from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';
import { createNotification, notifyRole } from '../services/notificationService.js';

const router = express.Router();

const VALID_TYPES = ['Medical', 'Fire', 'Security Threat', 'Lift Stuck', 'Gas Leak', 'Other'];
const VALID_STATUSES = ['Active', 'Acknowledged', 'Dispatched', 'Resolved'];

async function enrichAlerts(alerts) {
  const [flats, profiles] = await Promise.all([
    selectRows('flats'),
    selectRows('profiles'),
  ]);
  const flatMap = new Map(flats.map((f) => [f.id, f]));
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  return alerts.map((a) => {
    const flat = flatMap.get(a.flat_id);
    const resident = profileMap.get(a.resident_id);
    const responder = a.acknowledged_by ? profileMap.get(a.acknowledged_by) : null;
    return {
      ...a,
      flat_label: flat ? `${flat.wing}-${flat.flat_number}` : '',
      resident_name: resident?.full_name || '',
      resident_phone: resident?.phone || '',
      acknowledged_by_name: responder?.full_name || '',
    };
  });
}

// List emergency alerts (Resident: own; Guard/Admin: society-wide)
router.get('/', requireAuth, async (req, res) => {
  try {
    let alerts = [];
    if (req.user.role === 'resident') {
      alerts = await selectRows('emergency_alerts', {
        filters: { resident_id: req.user.id },
        orderBy: 'created_at',
        ascending: false,
      });
    } else if (['guard', 'admin'].includes(req.user.role)) {
      alerts = await selectRows('emergency_alerts', {
        filters: req.user.society_id ? { society_id: req.user.society_id } : {},
        orderBy: 'created_at',
        ascending: false,
      });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    const enriched = await enrichAlerts(alerts);
    res.json({ alerts: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resident triggers an emergency alert
router.post('/', requireAuth, requireRole('resident', 'admin'), async (req, res) => {
  try {
    const { emergency_type, severity = 'Critical', details, flat_id: bodyFlatId } = req.body || {};
    if (!VALID_TYPES.includes(emergency_type)) {
      return res.status(400).json({ error: 'Please select a valid emergency type' });
    }
    const cleanDetails = String(details || '').trim();
    if (!cleanDetails || cleanDetails.length < 3) {
      return res.status(400).json({ error: 'Please enter brief emergency details or location' });
    }

    const targetFlatId = req.user.role === 'admin' && bodyFlatId ? bodyFlatId : req.user.flat_id;
    if (!targetFlatId) {
      return res.status(400).json({ error: 'Flat information is required to dispatch help' });
    }
    const flat = await selectOne('flats', { id: targetFlatId });
    if (!flat) return res.status(404).json({ error: 'Flat not found' });

    const now = new Date().toISOString();
    const alert = await insertRow('emergency_alerts', {
      society_id: flat.society_id,
      flat_id: flat.id,
      resident_id: req.user.id,
      emergency_type,
      severity: severity === 'High' ? 'High' : 'Critical',
      details: cleanDetails,
      status: 'Active',
      response_notes: '',
      created_at: now,
    });

    const msg = `EMERGENCY (${emergency_type}) from ${req.user.full_name} at Flat ${flat.wing}-${flat.flat_number}: ${cleanDetails}`;

    await Promise.all([
      notifyRole({
        societyId: flat.society_id,
        role: 'guard',
        title: `URGENT: ${emergency_type} Alert`,
        message: msg,
        type: 'emergency',
        referenceId: alert.id,
      }),
      notifyRole({
        societyId: flat.society_id,
        role: 'admin',
        title: `URGENT: ${emergency_type} Alert`,
        message: msg,
        type: 'emergency',
        referenceId: alert.id,
      }),
    ]);

    const [enriched] = await enrichAlerts([alert]);
    res.status(201).json({ alert: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Guard or Admin acknowledges / updates emergency status
router.patch('/:id/status', requireAuth, requireRole('guard', 'admin'), async (req, res) => {
  try {
    const alert = await selectOne('emergency_alerts', { id: req.params.id });
    if (!alert) return res.status(404).json({ error: 'Emergency alert not found' });

    const { status, response_notes } = req.body || {};
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid emergency status' });
    }

    const now = new Date().toISOString();
    const updates = {
      status,
      acknowledged_by: alert.acknowledged_by || req.user.id,
      acknowledged_at: alert.acknowledged_at || now,
    };
    if (response_notes !== undefined) {
      updates.response_notes = String(response_notes).trim();
    }
    if (status === 'Resolved') {
      updates.resolved_at = now;
    }

    const updated = await updateRows('emergency_alerts', { id: alert.id }, updates);

    await createNotification({
      userId: alert.resident_id,
      societyId: alert.society_id,
      title: `Emergency Alert ${status}`,
      message: `${req.user.full_name} (${req.user.role}) marked your ${alert.emergency_type} alert as ${status}.${updates.response_notes ? ` Note: ${updates.response_notes}` : ''}`,
      type: 'emergency',
      referenceId: alert.id,
    });

    const [enriched] = await enrichAlerts(updated);
    res.json({ alert: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
