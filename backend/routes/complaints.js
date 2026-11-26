import express from 'express';
import {
  insertRow,
  selectOne,
  selectRows,
  updateRows,
} from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';
import { saveUploadedFile, uploadMiddleware } from '../services/storageService.js';
import { createNotification, notifyRole } from '../services/notificationService.js';

const router = express.Router();

const VALID_CATEGORIES = ['Plumbing', 'Electrical', 'Security', 'Cleaning', 'Lift', 'Parking', 'Other'];
const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const VALID_STATUSES = ['Pending', 'Assigned', 'In Progress', 'Resolved', 'Rejected'];

async function enrichComplaints(complaints) {
  const [flats, profiles, assignments] = await Promise.all([
    selectRows('flats'),
    selectRows('profiles'),
    selectRows('complaint_assignments', { orderBy: 'assigned_at', ascending: false }),
  ]);

  const flatMap = new Map(flats.map((f) => [f.id, f]));
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const assignmentByComplaint = new Map();
  for (const a of assignments) {
    if (!assignmentByComplaint.has(a.complaint_id)) {
      assignmentByComplaint.set(a.complaint_id, a);
    }
  }

  return complaints.map((c) => {
    const flat = flatMap.get(c.flat_id);
    const resident = profileMap.get(c.resident_id);
    const assignment = assignmentByComplaint.get(c.id) || null;
    const staff = assignment ? profileMap.get(assignment.staff_id) : null;
    return {
      ...c,
      flat_label: flat ? `${flat.wing}-${flat.flat_number}` : '',
      resident_name: resident?.full_name || '',
      resident_phone: resident?.phone || '',
      assignment,
      assigned_staff_id: assignment?.staff_id || null,
      assigned_staff_name: staff?.full_name || '',
      staff_status: assignment?.staff_status || '',
      progress_notes: assignment?.progress_notes || '',
    };
  });
}

// List complaints by role
router.get('/', requireAuth, async (req, res) => {
  try {
    let complaints = [];
    if (req.user.role === 'resident') {
      complaints = await selectRows('complaints', {
        filters: { resident_id: req.user.id },
        orderBy: 'created_at',
        ascending: false,
      });
    } else if (req.user.role === 'staff') {
      const assignments = await selectRows('complaint_assignments', {
        filters: { staff_id: req.user.id },
      });
      const ids = [...new Set(assignments.map((a) => a.complaint_id))];
      if (ids.length > 0) {
        complaints = await selectRows('complaints', {
          filters: { id: ids },
          orderBy: 'updated_at',
          ascending: false,
        });
      }
    } else if (req.user.role === 'admin') {
      complaints = await selectRows('complaints', {
        filters: req.user.society_id ? { society_id: req.user.society_id } : {},
        orderBy: 'created_at',
        ascending: false,
      });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    const enriched = await enrichComplaints(complaints);
    res.json({ complaints: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single complaint details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const complaint = await selectOne('complaints', { id: req.params.id });
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    if (req.user.role === 'resident' && complaint.resident_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user.role === 'staff') {
      const assignment = await selectOne('complaint_assignments', {
        complaint_id: complaint.id,
        staff_id: req.user.id,
      });
      if (!assignment) return res.status(403).json({ error: 'Not assigned to you' });
    } else if (!['resident', 'staff', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [enriched] = await enrichComplaints([complaint]);
    res.json({ complaint: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit complaint (Resident)
router.post('/', requireAuth, requireRole('resident', 'admin'), uploadMiddleware.single('image'), async (req, res) => {
  try {
    const { title, category, description, priority = 'Medium', flat_id: bodyFlatId } = req.body || {};
    const cleanTitle = String(title || '').trim();
    const cleanDesc = String(description || '').trim();
    const targetFlatId = req.user.role === 'admin' && bodyFlatId ? bodyFlatId : req.user.flat_id;

    if (!cleanTitle || cleanTitle.length < 3) {
      return res.status(400).json({ error: 'Complaint title must be at least 3 characters' });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid complaint category' });
    }
    if (!cleanDesc || cleanDesc.length < 5) {
      return res.status(400).json({ error: 'Please provide a clear description' });
    }
    if (!targetFlatId) {
      return res.status(400).json({ error: 'Resident flat is required' });
    }

    const flat = await selectOne('flats', { id: targetFlatId });
    if (!flat) return res.status(404).json({ error: 'Flat not found' });

    let imageUrl = '';
    if (req.file) {
      imageUrl = await saveUploadedFile(req.file, 'complaints');
    }

    const now = new Date().toISOString();
    const complaint = await insertRow('complaints', {
      society_id: flat.society_id,
      flat_id: flat.id,
      resident_id: req.user.id,
      title: cleanTitle,
      category,
      description: cleanDesc,
      image_url: imageUrl,
      priority: VALID_PRIORITIES.includes(priority) ? priority : 'Medium',
      status: 'Pending',
      resolution_notes: '',
      created_at: now,
      updated_at: now,
    });

    await notifyRole({
      societyId: flat.society_id,
      role: 'admin',
      title: 'New Resident Complaint',
      message: `Flat ${flat.wing}-${flat.flat_number} submitted "${cleanTitle}" (${category}).`,
      type: 'complaint',
      referenceId: complaint.id,
    });

    const [enriched] = await enrichComplaints([complaint]);
    res.status(201).json({ complaint: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin assigns complaint to maintenance staff & updates priority
router.patch('/:id/assign', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const complaint = await selectOne('complaints', { id: req.params.id });
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    const { staff_id, priority, progress_notes = '' } = req.body || {};
    if (!staff_id) return res.status(400).json({ error: 'Maintenance staff member is required' });

    const staff = await selectOne('profiles', { id: staff_id, role: 'staff', is_active: true });
    if (!staff) return res.status(404).json({ error: 'Active maintenance staff member not found' });

    const now = new Date().toISOString();
    const existingAssignment = await selectOne('complaint_assignments', { complaint_id: complaint.id });

    if (existingAssignment) {
      await updateRows(
        'complaint_assignments',
        { id: existingAssignment.id },
        {
          staff_id: staff.id,
          assigned_by: req.user.id,
          staff_status: 'Assigned',
          progress_notes: String(progress_notes || existingAssignment.progress_notes || '').trim(),
          assigned_at: now,
          updated_at: now,
        }
      );
    } else {
      await insertRow('complaint_assignments', {
        complaint_id: complaint.id,
        staff_id: staff.id,
        assigned_by: req.user.id,
        staff_status: 'Assigned',
        progress_notes: String(progress_notes || '').trim(),
        assigned_at: now,
        updated_at: now,
      });
    }

    await updateRows(
      'complaints',
      { id: complaint.id },
      {
        priority: VALID_PRIORITIES.includes(priority) ? priority : complaint.priority,
        status: 'Assigned',
        updated_at: now,
      }
    );

    await createNotification({
      userId: staff.id,
      societyId: complaint.society_id,
      title: 'New Complaint Assigned',
      message: `You were assigned "${complaint.title}" (${complaint.category}).`,
      type: 'complaint',
      referenceId: complaint.id,
    });

    await createNotification({
      userId: complaint.resident_id,
      societyId: complaint.society_id,
      title: 'Complaint Assigned to Staff',
      message: `Your complaint "${complaint.title}" has been assigned to ${staff.full_name}.`,
      type: 'complaint',
      referenceId: complaint.id,
    });

    const updated = await selectOne('complaints', { id: complaint.id });
    const [enriched] = await enrichComplaints([updated]);
    res.json({ complaint: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Staff or Admin updates complaint progress / status
router.patch('/:id/status', requireAuth, requireRole('staff', 'admin'), async (req, res) => {
  try {
    const complaint = await selectOne('complaints', { id: req.params.id });
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    const { status, priority, progress_notes, resolution_notes } = req.body || {};
    const now = new Date().toISOString();

    if (req.user.role === 'staff') {
      const assignment = await selectOne('complaint_assignments', {
        complaint_id: complaint.id,
        staff_id: req.user.id,
      });
      if (!assignment) {
        return res.status(403).json({ error: 'You are not assigned to this complaint' });
      }
      if (!['Accepted', 'In Progress', 'Resolved'].includes(status)) {
        return res.status(400).json({ error: 'Staff can set status to Accepted, In Progress, or Resolved' });
      }

      const mappedComplaintStatus = status === 'Accepted' ? 'In Progress' : status;
      await updateRows(
        'complaint_assignments',
        { id: assignment.id },
        {
          staff_status: status,
          progress_notes:
            progress_notes !== undefined ? String(progress_notes).trim() : assignment.progress_notes,
          updated_at: now,
        }
      );

      await updateRows(
        'complaints',
        { id: complaint.id },
        {
          status: mappedComplaintStatus,
          resolution_notes:
            resolution_notes !== undefined
              ? String(resolution_notes).trim()
              : progress_notes !== undefined
              ? String(progress_notes).trim()
              : complaint.resolution_notes,
          updated_at: now,
        }
      );

      await createNotification({
        userId: complaint.resident_id,
        societyId: complaint.society_id,
        title: `Complaint ${mappedComplaintStatus}`,
        message: `${req.user.full_name} updated "${complaint.title}" to ${mappedComplaintStatus}.`,
        type: 'complaint',
        referenceId: complaint.id,
      });

      if (mappedComplaintStatus === 'Resolved') {
        await notifyRole({
          societyId: complaint.society_id,
          role: 'admin',
          title: 'Complaint Resolved by Staff',
          message: `"${complaint.title}" was marked Resolved by ${req.user.full_name}.`,
          type: 'complaint',
          referenceId: complaint.id,
        });
      }
    } else {
      // Admin update
      const updates = { updated_at: now };
      if (status && VALID_STATUSES.includes(status)) updates.status = status;
      if (priority && VALID_PRIORITIES.includes(priority)) updates.priority = priority;
      if (resolution_notes !== undefined) updates.resolution_notes = String(resolution_notes).trim();

      await updateRows('complaints', { id: complaint.id }, updates);

      if (updates.status) {
        await createNotification({
          userId: complaint.resident_id,
          societyId: complaint.society_id,
          title: `Complaint ${updates.status}`,
          message: `Admin updated your complaint "${complaint.title}" to ${updates.status}.`,
          type: 'complaint',
          referenceId: complaint.id,
        });
      }
    }

    const updated = await selectOne('complaints', { id: complaint.id });
    const [enriched] = await enrichComplaints([updated]);
    res.json({ complaint: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
