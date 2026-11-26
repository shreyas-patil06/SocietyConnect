import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  bindModalDismiss,
  closeModal,
  escHtml,
  formatCurrency,
  formatDate,
  formatDateTime,
  openModal,
  safeUrl,
  showInlineAlert,
  showToast,
  statusBadge,
} from '../common/helpers.js';
import { bindFilePreview } from '../common/upload.js';

async function initBillsPage() {
  async function loadUpiAndFlats() {
    const [upi, dir] = await Promise.all([
      apiFetch('/api/payments/society-upi'),
      apiFetch('/api/residents/directory'),
    ]);

    document.getElementById('upi-id-input').value = upi.upi_id || '';
    const img = document.getElementById('upi-current-img');
    if (upi.upi_qr_url) {
      img.src = safeUrl(upi.upi_qr_url);
      img.style.display = 'block';
    } else {
      img.style.display = 'none';
    }

    const flatSel = document.getElementById('bill-flat-select');
    const flats = dir.flats || [];
    flatSel.innerHTML =
      '<option value="ALL_OCCUPIED">All Occupied Flats (Bulk Generate)</option>' +
      flats
        .map(
          (f) =>
            `<option value="${escHtml(f.id)}">Wing ${escHtml(f.wing)}-${escHtml(f.flat_number)} (${escHtml(f.occupancy_status)})</option>`
        )
        .join('');
  }

  async function loadBills() {
    const { bills } = await apiFetch('/api/payments/bills');
    const tbody = document.getElementById('admin-bills-tbody');
    tbody.innerHTML = bills.length
      ? bills
          .map((b) => {
            const doc = safeUrl(b.bill_document_url)
              ? `<a href="${escHtml(safeUrl(b.bill_document_url))}" target="_blank" rel="noopener" class="btn btn-sm btn-outline">Doc</a>`
              : '';
            const del =
              b.status !== 'Verified'
                ? `<button class="btn btn-sm btn-soft-danger" data-del-bill="${escHtml(b.id)}">Delete</button>`
                : '';
            return `
              <tr>
                <td><strong>Flat ${escHtml(b.flat_label)}</strong><br><small style="color:#6B7280;">${escHtml(b.resident_names || 'No resident')}</small></td>
                <td><strong>${escHtml(b.title)}</strong><br><small style="color:#6B7280;">${escHtml(b.billing_period)}</small></td>
                <td><strong>${formatCurrency(b.amount)}</strong></td>
                <td>${formatDate(b.due_date)}</td>
                <td>${statusBadge(b.status)}</td>
                <td><div style="display:flex;gap:6px;">${doc}${del}</div></td>
              </tr>`;
          })
          .join('')
      : '<tr><td colspan="6" class="empty-state">No maintenance bills created yet.</td></tr>';

    tbody.querySelectorAll('[data-del-bill]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch(`/api/payments/bills/${encodeURIComponent(btn.getAttribute('data-del-bill'))}`, {
            method: 'DELETE',
          });
          showToast('Bill deleted', 'success');
          await loadBills();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  bindFilePreview('upi-qr-file', 'upi-qr-preview');
  bindFilePreview('bill-doc-file', 'bill-doc-preview');
  await Promise.all([loadUpiAndFlats(), loadBills()]);

  document.getElementById('upi-config-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('upi-alert', '');
    const fd = new FormData();
    fd.append('upi_id', document.getElementById('upi-id-input').value.trim());
    const file = document.getElementById('upi-qr-file').files?.[0];
    if (file) fd.append('upi_qr', file);

    try {
      await apiFetch('/api/payments/society-upi', { method: 'PATCH', body: fd });
      showToast('Society UPI settings updated!', 'success');
      document.getElementById('upi-qr-preview').innerHTML = '';
      await loadUpiAndFlats();
    } catch (err) {
      showInlineAlert('upi-alert', err.message, 'error');
    }
  });

  document.getElementById('create-bill-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('bill-alert', '');
    const targetVal = document.getElementById('bill-flat-select').value;
    const fd = new FormData();
    if (targetVal === 'ALL_OCCUPIED') {
      fd.append('target', 'all_occupied');
    } else {
      fd.append('target', 'single');
      fd.append('flat_id', targetVal);
    }
    fd.append('title', document.getElementById('bill-title').value.trim());
    fd.append('billing_period', document.getElementById('bill-period').value.trim());
    fd.append('amount', document.getElementById('bill-amount').value);
    fd.append('due_date', document.getElementById('bill-due').value);
    fd.append('description', document.getElementById('bill-desc').value.trim());
    const doc = document.getElementById('bill-doc-file').files?.[0];
    if (doc) fd.append('bill_document', doc);

    try {
      const res = await apiFetch('/api/payments/bills', { method: 'POST', body: fd });
      e.target.reset();
      document.getElementById('bill-doc-preview').innerHTML = '';
      showToast(`Issued ${res.count} maintenance bill(s)!`, 'success');
      await loadBills();
    } catch (err) {
      showInlineAlert('bill-alert', err.message, 'error');
    }
  });
}

async function initPaymentsVerificationPage() {
  bindModalDismiss('verify-receipt-modal');
  document.getElementById('close-verify-modal')?.addEventListener('click', () => closeModal('verify-receipt-modal'));

  async function loadReceipts() {
    const { receipts } = await apiFetch('/api/payments/receipts');
    const filter = document.getElementById('payment-status-filter')?.value || 'all';
    const rows = filter === 'all' ? receipts : receipts.filter((r) => r.verification_status === filter);

    const tbody = document.getElementById('admin-receipts-tbody');
    tbody.innerHTML = rows.length
      ? rows
          .map(
            (r) => `
          <tr>
            <td><strong>${escHtml(r.resident_name)}</strong><br><small style="color:#6B7280;">Flat ${escHtml(r.flat_label)}</small></td>
            <td><strong>${escHtml(r.bill_title)}</strong><br><small style="color:#6B7280;">${escHtml(r.billing_period)}</small></td>
            <td>${escHtml(r.transaction_ref)}</td>
            <td><strong>${formatCurrency(r.amount_paid)}</strong></td>
            <td>${statusBadge(r.verification_status)}</td>
            <td>${formatDateTime(r.submitted_at)}</td>
            <td>
              <button class="btn btn-sm btn-primary" data-inspect-receipt="${escHtml(r.id)}">
                ${r.verification_status === 'Payment Submitted' ? 'Inspect & Verify' : 'View Details'}
              </button>
            </td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="7" class="empty-state">No payment receipts found.</td></tr>';

    const receiptMap = new Map(receipts.map((r) => [r.id, r]));
    tbody.querySelectorAll('[data-inspect-receipt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = receiptMap.get(btn.getAttribute('data-inspect-receipt'));
        if (!r) return;
        document.getElementById('ver-receipt-id').value = r.id;
        document.getElementById('ver-meta').textContent = `${r.resident_name} (Flat ${r.flat_label}) • ${r.bill_title} • Ref: ${r.transaction_ref} • ${formatCurrency(r.amount_paid)}`;
        const img = document.getElementById('ver-receipt-img');
        const link = document.getElementById('ver-receipt-link');
        const url = safeUrl(r.receipt_image_url);
        img.src = url;
        link.href = url;
        document.getElementById('ver-remarks').value = r.admin_remarks || '';
        const actionRow = document.getElementById('ver-action-buttons');
        actionRow.style.display = r.verification_status === 'Payment Submitted' ? 'flex' : 'none';
        showInlineAlert('ver-modal-alert', '');
        openModal('verify-receipt-modal');
      });
    });
  }

  await loadReceipts();
  document.getElementById('payment-status-filter')?.addEventListener('change', loadReceipts);

  async function submitDecision(decision) {
    const id = document.getElementById('ver-receipt-id').value;
    const remarks = document.getElementById('ver-remarks').value.trim();
    try {
      await apiFetch(`/api/payments/receipts/${encodeURIComponent(id)}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ decision, admin_remarks: remarks }),
      });
      closeModal('verify-receipt-modal');
      showToast(`Payment receipt ${decision.toLowerCase()}!`, 'success');
      await loadReceipts();
    } catch (err) {
      showInlineAlert('ver-modal-alert', err.message, 'error');
    }
  }

  document.getElementById('ver-approve-btn')?.addEventListener('click', () => submitDecision('Verified'));
  document.getElementById('ver-reject-btn')?.addEventListener('click', () => submitDecision('Rejected'));
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('admin');
  if (!user) return;
  const page = document.body.getAttribute('data-page');
  if (page === 'admin-bills') await initBillsPage();
  if (page === 'admin-payments') await initPaymentsVerificationPage();
});
