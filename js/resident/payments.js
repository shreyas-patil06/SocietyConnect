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

async function loadSocietyUpi() {
  try {
    const upi = await apiFetch('/api/payments/society-upi');
    document.getElementById('society-upi-id').textContent = upi.upi_id || 'Not configured by Admin yet';
    const img = document.getElementById('society-upi-qr-img');
    const empty = document.getElementById('society-upi-empty');
    if (upi.upi_qr_url) {
      img.src = safeUrl(upi.upi_qr_url);
      img.style.display = 'block';
      empty.style.display = 'none';
    } else {
      img.style.display = 'none';
      empty.style.display = 'block';
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadBillsAndReceipts() {
  const [billsRes, receiptsRes] = await Promise.all([
    apiFetch('/api/payments/bills'),
    apiFetch('/api/payments/receipts'),
  ]);

  const bills = billsRes.bills || [];
  const billsTbody = document.getElementById('resident-bills-tbody');

  billsTbody.innerHTML = bills.length
    ? bills
        .map((b) => {
          const canPay = b.status === 'Unpaid' || b.status === 'Rejected';
          const docLink = safeUrl(b.bill_document_url)
            ? `<a href="${escHtml(safeUrl(b.bill_document_url))}" target="_blank" rel="noopener" class="btn btn-sm btn-outline">View Bill</a>`
            : '';
          const payBtn = canPay
            ? `<button class="btn btn-sm btn-primary" data-pay-bill="${escHtml(b.id)}">Upload Receipt</button>`
            : '';
          return `
            <tr>
              <td><strong>${escHtml(b.title)}</strong><br><small style="color:#6B7280;">${escHtml(b.description || '')}</small></td>
              <td>${escHtml(b.billing_period)}</td>
              <td><strong>${formatCurrency(b.amount)}</strong></td>
              <td>${formatDate(b.due_date)}</td>
              <td>${statusBadge(b.status)}</td>
              <td><div style="display:flex;gap:6px;">${docLink}${payBtn}</div></td>
            </tr>`;
        })
        .join('')
    : '<tr><td colspan="6" class="empty-state">No maintenance bills issued for your flat yet.</td></tr>';

  const billMap = new Map(bills.map((b) => [b.id, b]));
  billsTbody.querySelectorAll('[data-pay-bill]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bill = billMap.get(btn.getAttribute('data-pay-bill'));
      if (!bill) return;
      document.getElementById('pay-bill-id').value = bill.id;
      document.getElementById('pay-bill-summary').textContent = `${bill.title} (${bill.billing_period}) — ${formatCurrency(bill.amount)}`;
      document.getElementById('pay-amount').value = bill.amount;
      showInlineAlert('receipt-modal-alert', '');
      openModal('upload-receipt-modal');
    });
  });

  const receipts = receiptsRes.receipts || [];
  const recTbody = document.getElementById('resident-receipts-tbody');
  recTbody.innerHTML = receipts.length
    ? receipts
        .map((r) => {
          const img = safeUrl(r.receipt_image_url)
            ? `<a href="${escHtml(safeUrl(r.receipt_image_url))}" target="_blank" rel="noopener" class="btn btn-sm btn-outline">View Screenshot</a>`
            : '—';
          return `
            <tr>
              <td><strong>${escHtml(r.bill_title)}</strong><br><small style="color:#6B7280;">${escHtml(r.billing_period)}</small></td>
              <td>${escHtml(r.transaction_ref)}</td>
              <td>${formatCurrency(r.amount_paid)}</td>
              <td>${statusBadge(r.verification_status)}</td>
              <td>${escHtml(r.admin_remarks || '—')}</td>
              <td>${img}</td>
              <td>${formatDateTime(r.submitted_at)}</td>
            </tr>`;
        })
        .join('')
    : '<tr><td colspan="7" class="empty-state">No payment receipts uploaded yet.</td></tr>';
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('resident');
  if (!user) return;

  bindModalDismiss('upload-receipt-modal');
  document.getElementById('close-receipt-modal')?.addEventListener('click', () => closeModal('upload-receipt-modal'));
  bindFilePreview('pay-receipt-file', 'pay-receipt-preview');

  await Promise.all([loadSocietyUpi(), loadBillsAndReceipts()]);

  document.getElementById('upload-receipt-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('receipt-modal-alert', '');
    const btn = document.getElementById('pay-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Uploading...';

    const fd = new FormData();
    fd.append('bill_id', document.getElementById('pay-bill-id').value);
    fd.append('transaction_ref', document.getElementById('pay-tx-ref').value.trim());
    fd.append('amount_paid', document.getElementById('pay-amount').value);
    const file = document.getElementById('pay-receipt-file').files?.[0];
    if (file) fd.append('receipt', file);

    try {
      await apiFetch('/api/payments/receipts', { method: 'POST', body: fd });
      e.target.reset();
      document.getElementById('pay-receipt-preview').innerHTML = '';
      closeModal('upload-receipt-modal');
      showToast('Payment receipt submitted for Admin verification', 'success');
      await loadBillsAndReceipts();
    } catch (err) {
      showInlineAlert('receipt-modal-alert', err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Receipt';
    }
  });
});
