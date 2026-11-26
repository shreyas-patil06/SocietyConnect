import express from 'express';
import QRCode from 'qrcode';
import {
  deleteRows,
  insertRow,
  selectOne,
  selectRows,
  updateRows,
} from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';
import { saveUploadedFile, uploadMiddleware } from '../services/storageService.js';
import { createNotification, notifyRole } from '../services/notificationService.js';

const router = express.Router();

// Get society UPI payment configuration & QR
router.get('/society-upi', requireAuth, async (req, res) => {
  try {
    let society = req.user.society_id
      ? await selectOne('societies', { id: req.user.society_id })
      : null;
    if (!society) {
      const list = await selectRows('societies', { limit: 1 });
      society = list[0] || null;
    }
    if (!society) return res.status(404).json({ error: 'Society not found' });

    let fallbackQr = '';
    if (!society.upi_qr_url && society.upi_id) {
      const upiUri = `upi://pay?pa=${encodeURIComponent(society.upi_id)}&pn=${encodeURIComponent(society.name)}`;
      fallbackQr = await QRCode.toDataURL(upiUri, { width: 240, margin: 2 });
    }

    res.json({
      society_id: society.id,
      society_name: society.name,
      upi_id: society.upi_id || '',
      upi_qr_url: society.upi_qr_url || fallbackQr,
      has_uploaded_qr: Boolean(society.upi_qr_url),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin updates Society UPI ID and/or uploads UPI Payment QR image
router.patch('/society-upi', requireAuth, requireRole('admin'), uploadMiddleware.single('upi_qr'), async (req, res) => {
  try {
    let societyId = req.user.society_id;
    if (!societyId) {
      const list = await selectRows('societies', { limit: 1 });
      societyId = list[0]?.id;
    }
    if (!societyId) return res.status(404).json({ error: 'Society not found' });

    const updates = { updated_at: new Date().toISOString() };
    if (req.body?.upi_id !== undefined) {
      updates.upi_id = String(req.body.upi_id).trim();
    }
    if (req.file) {
      updates.upi_qr_url = await saveUploadedFile(req.file, 'upi-qr');
    }

    const updated = await updateRows('societies', { id: societyId }, updates);
    res.json({ society: updated[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List maintenance bills (Resident: own flat; Admin: all society bills)
router.get('/bills', requireAuth, async (req, res) => {
  try {
    let bills = [];
    if (req.user.role === 'resident') {
      if (!req.user.flat_id) return res.json({ bills: [] });
      bills = await selectRows('maintenance_bills', {
        filters: { flat_id: req.user.flat_id },
        orderBy: 'created_at',
        ascending: false,
      });
    } else if (req.user.role === 'admin') {
      bills = await selectRows('maintenance_bills', {
        filters: req.user.society_id ? { society_id: req.user.society_id } : {},
        orderBy: 'created_at',
        ascending: false,
      });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [flats, receipts, profiles] = await Promise.all([
      selectRows('flats'),
      selectRows('payment_receipts', { orderBy: 'submitted_at', ascending: false }),
      selectRows('profiles'),
    ]);

    const flatMap = new Map(flats.map((f) => [f.id, f]));
    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const latestReceiptByBill = new Map();
    for (const r of receipts) {
      if (!latestReceiptByBill.has(r.bill_id)) {
        latestReceiptByBill.set(r.bill_id, r);
      }
    }

    const enriched = bills.map((b) => {
      const flat = flatMap.get(b.flat_id);
      const latestReceipt = latestReceiptByBill.get(b.id) || null;
      const flatResidents = profiles
        .filter((p) => p.flat_id === b.flat_id && p.role === 'resident')
        .map((p) => p.full_name);

      return {
        ...b,
        amount: Number(b.amount),
        flat_label: flat ? `${flat.wing}-${flat.flat_number}` : '',
        resident_names: flatResidents.join(', '),
        latest_receipt: latestReceipt
          ? {
              ...latestReceipt,
              resident_name: profileMap.get(latestReceipt.resident_id)?.full_name || '',
            }
          : null,
      };
    });

    res.json({ bills: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin creates maintenance bill (for one flat or all occupied flats)
router.post('/bills', requireAuth, requireRole('admin'), uploadMiddleware.single('bill_document'), async (req, res) => {
  try {
    const {
      flat_id,
      target = 'single',
      title,
      billing_period,
      amount,
      due_date,
      description = '',
    } = req.body || {};

    const cleanTitle = String(title || '').trim();
    const cleanPeriod = String(billing_period || '').trim();
    const numAmount = Number(amount);

    if (!cleanTitle || cleanTitle.length < 3) {
      return res.status(400).json({ error: 'Bill title is required' });
    }
    if (!cleanPeriod) {
      return res.status(400).json({ error: 'Billing period is required (e.g., Nov 2026)' });
    }
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'Bill amount must be greater than zero' });
    }
    if (!due_date) {
      return res.status(400).json({ error: 'Due date is required' });
    }

    let billDocUrl = '';
    if (req.file) {
      billDocUrl = await saveUploadedFile(req.file, 'bills');
    }

    let targetFlats = [];
    if (target === 'all_occupied') {
      const societyId = req.user.society_id || (await selectRows('societies', { limit: 1 }))[0]?.id;
      targetFlats = await selectRows('flats', {
        filters: { society_id: societyId, occupancy_status: 'Occupied' },
      });
      if (targetFlats.length === 0) {
        return res.status(400).json({ error: 'No occupied flats found to bill' });
      }
    } else {
      if (!flat_id) return res.status(400).json({ error: 'Please select a flat' });
      const flat = await selectOne('flats', { id: flat_id });
      if (!flat) return res.status(404).json({ error: 'Flat not found' });
      targetFlats = [flat];
    }

    const now = new Date().toISOString();
    const createdBills = [];
    for (const flat of targetFlats) {
      const bill = await insertRow('maintenance_bills', {
        society_id: flat.society_id,
        flat_id: flat.id,
        created_by: req.user.id,
        title: cleanTitle,
        billing_period: cleanPeriod,
        amount: numAmount,
        due_date,
        bill_document_url: billDocUrl,
        description: String(description || '').trim(),
        status: 'Unpaid',
        created_at: now,
        updated_at: now,
      });
      createdBills.push(bill);

      const residents = await selectRows('profiles', {
        filters: { flat_id: flat.id, role: 'resident', is_active: true },
      });
      for (const r of residents) {
        await createNotification({
          userId: r.id,
          societyId: flat.society_id,
          title: 'New Maintenance Bill Issued',
          message: `${cleanTitle} (${cleanPeriod}) of ₹${numAmount.toLocaleString()} is due on ${due_date} for Flat ${flat.wing}-${flat.flat_number}.`,
          type: 'billing',
          referenceId: bill.id,
        });
      }
    }

    res.status(201).json({ bills: createdBills, count: createdBills.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin deletes an unpaid bill
router.delete('/bills/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const bill = await selectOne('maintenance_bills', { id: req.params.id });
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    if (bill.status === 'Verified') {
      return res.status(400).json({ error: 'Verified paid bills cannot be deleted' });
    }
    await deleteRows('maintenance_bills', { id: bill.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List payment receipts (Resident: own; Admin: all society)
router.get('/receipts', requireAuth, async (req, res) => {
  try {
    let receipts = [];
    if (req.user.role === 'resident') {
      receipts = await selectRows('payment_receipts', {
        filters: req.user.flat_id ? { flat_id: req.user.flat_id } : { resident_id: req.user.id },
        orderBy: 'submitted_at',
        ascending: false,
      });
    } else if (req.user.role === 'admin') {
      receipts = await selectRows('payment_receipts', {
        filters: req.user.society_id ? { society_id: req.user.society_id } : {},
        orderBy: 'submitted_at',
        ascending: false,
      });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [bills, flats, profiles] = await Promise.all([
      selectRows('maintenance_bills'),
      selectRows('flats'),
      selectRows('profiles'),
    ]);

    const billMap = new Map(bills.map((b) => [b.id, b]));
    const flatMap = new Map(flats.map((f) => [f.id, f]));
    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    const enriched = receipts.map((r) => {
      const bill = billMap.get(r.bill_id);
      const flat = flatMap.get(r.flat_id);
      const resident = profileMap.get(r.resident_id);
      const verifier = r.verified_by ? profileMap.get(r.verified_by) : null;
      return {
        ...r,
        amount_paid: Number(r.amount_paid),
        bill_title: bill?.title || '',
        billing_period: bill?.billing_period || '',
        bill_amount: Number(bill?.amount || 0),
        flat_label: flat ? `${flat.wing}-${flat.flat_number}` : '',
        resident_name: resident?.full_name || '',
        resident_phone: resident?.phone || '',
        verified_by_name: verifier?.full_name || '',
      };
    });

    res.json({ receipts: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resident submits payment receipt screenshot for a bill
router.post('/receipts', requireAuth, requireRole('resident'), uploadMiddleware.single('receipt'), async (req, res) => {
  try {
    const { bill_id, transaction_ref, amount_paid } = req.body || {};
    if (!bill_id) return res.status(400).json({ error: 'Bill ID is required' });
    if (!transaction_ref || String(transaction_ref).trim().length < 3) {
      return res.status(400).json({ error: 'UPI Transaction Reference / UTR number is required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Payment receipt screenshot or document is required' });
    }

    const bill = await selectOne('maintenance_bills', { id: bill_id });
    if (!bill) return res.status(404).json({ error: 'Maintenance bill not found' });

    if (bill.flat_id !== req.user.flat_id) {
      return res.status(403).json({ error: 'You can only upload receipts for your own flat bills' });
    }
    if (!['Unpaid', 'Rejected'].includes(bill.status)) {
      return res.status(400).json({ error: `Cannot submit receipt when bill status is ${bill.status}` });
    }

    const paidAmount = Number(amount_paid) || Number(bill.amount);
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      return res.status(400).json({ error: 'Invalid payment amount' });
    }

    const receiptUrl = await saveUploadedFile(req.file, 'receipts');
    const now = new Date().toISOString();

    const receipt = await insertRow('payment_receipts', {
      bill_id: bill.id,
      society_id: bill.society_id,
      flat_id: bill.flat_id,
      resident_id: req.user.id,
      transaction_ref: String(transaction_ref).trim(),
      amount_paid: paidAmount,
      receipt_image_url: receiptUrl,
      verification_status: 'Payment Submitted',
      admin_remarks: '',
      submitted_at: now,
    });

    await updateRows(
      'maintenance_bills',
      { id: bill.id },
      { status: 'Payment Submitted', updated_at: now }
    );

    const flat = await selectOne('flats', { id: bill.flat_id });
    await notifyRole({
      societyId: bill.society_id,
      role: 'admin',
      title: 'Payment Receipt Submitted',
      message: `${req.user.full_name} (Flat ${flat ? `${flat.wing}-${flat.flat_number}` : ''}) uploaded payment receipt for ${bill.title} (Ref: ${receipt.transaction_ref}).`,
      type: 'billing',
      referenceId: receipt.id,
    });

    res.status(201).json({ receipt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin verifies or rejects payment receipt
router.patch('/receipts/:id/verify', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const receipt = await selectOne('payment_receipts', { id: req.params.id });
    if (!receipt) return res.status(404).json({ error: 'Payment receipt not found' });

    const { decision, admin_remarks = '' } = req.body || {};
    if (!['Verified', 'Rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be Verified or Rejected' });
    }
    if (decision === 'Rejected' && !String(admin_remarks).trim()) {
      return res.status(400).json({ error: 'Please provide a reason when rejecting a receipt' });
    }

    const now = new Date().toISOString();
    const updatedReceipt = await updateRows(
      'payment_receipts',
      { id: receipt.id },
      {
        verification_status: decision,
        verified_by: req.user.id,
        admin_remarks: String(admin_remarks || '').trim(),
        verified_at: now,
      }
    );

    await updateRows(
      'maintenance_bills',
      { id: receipt.bill_id },
      { status: decision, updated_at: now }
    );

    const bill = await selectOne('maintenance_bills', { id: receipt.bill_id });
    await createNotification({
      userId: receipt.resident_id,
      societyId: receipt.society_id,
      title: decision === 'Verified' ? 'Payment Verified' : 'Payment Receipt Rejected',
      message:
        decision === 'Verified'
          ? `Your payment of ₹${Number(receipt.amount_paid).toLocaleString()} for "${bill?.title || 'Maintenance Bill'}" has been verified.`
          : `Your payment receipt for "${bill?.title || 'Maintenance Bill'}" was rejected: ${String(admin_remarks).trim()}`,
      type: 'billing',
      referenceId: receipt.bill_id,
    });

    res.json({ receipt: updatedReceipt[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
