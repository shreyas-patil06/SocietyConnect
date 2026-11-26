import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  escHtml,
  formatDateTime,
  showInlineAlert,
  showToast,
  statusBadge,
} from '../common/helpers.js';

async function loadFlatsDropdown() {
  const data = await apiFetch('/api/residents/directory');
  const select = document.getElementById('walkin-flat');
  const occupied = (data.flats || []).filter((f) => (f.residents || []).length > 0);
  if (occupied.length === 0) {
    select.innerHTML = '<option value="">No flats with registered residents</option>';
    return;
  }
  select.innerHTML = occupied
    .map(
      (f) =>
        `<option value="${escHtml(f.id)}">Wing ${escHtml(f.wing)}-${escHtml(f.flat_number)} (${escHtml(
          f.residents.map((r) => r.full_name).join(', ')
        )})</option>`
    )
    .join('');
}

async function loadWalkinQueue() {
  const { requests } = await apiFetch('/api/visitors/walkin');
  const tbody = document.getElementById('walkin-queue-tbody');

  tbody.innerHTML = requests.length
    ? requests
        .map((r) => {
          const canEnter = r.approval_status === 'Approved' && r.otp_verified && !r.entry_allowed;
          const otpCell = r.otp_verified
            ? '<span class="badge badge-success">Verified</span>'
            : r.approval_status === 'Rejected' || r.entry_allowed
            ? '<span class="badge badge-neutral">Closed</span>'
            : `<div style="display:flex;gap:6px;align-items:center;">
                <input type="text" maxlength="6" placeholder="6-digit OTP" class="form-control" style="width:110px;padding:5px 8px;" data-otp-input="${escHtml(r.id)}" />
                <button class="btn btn-sm btn-outline" data-verify-otp="${escHtml(r.id)}">Verify</button>
              </div>`;

          const actionCell = r.entry_allowed
            ? '<span class="badge badge-success">Checked In</span>'
            : r.approval_status === 'Rejected'
            ? '<span class="badge badge-danger">Denied</span>'
            : `<button class="btn btn-sm btn-primary" data-allow-entry="${escHtml(r.id)}" ${canEnter ? '' : 'disabled'}>Allow Entry</button>`;

          return `
            <tr>
              <td><strong>${escHtml(r.visitor_name)}</strong><br><small style="color:#6B7280;">${escHtml(r.visitor_phone)}</small></td>
              <td>Flat ${escHtml(r.flat_label)}<br><small style="color:#6B7280;">${escHtml(r.resident_name)}</small></td>
              <td>${escHtml(r.purpose)}</td>
              <td>${statusBadge(r.approval_status)}</td>
              <td>${otpCell}</td>
              <td>${actionCell}</td>
              <td>${formatDateTime(r.created_at)}</td>
            </tr>`;
        })
        .join('')
    : '<tr><td colspan="7" class="empty-state">No walk-in visitor requests yet.</td></tr>';

  tbody.querySelectorAll('[data-verify-otp]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-verify-otp');
      const input = tbody.querySelector(`[data-otp-input="${id}"]`);
      const otp = input?.value?.trim() || '';
      try {
        await apiFetch(`/api/visitors/walkin/${encodeURIComponent(id)}/verify-otp`, {
          method: 'POST',
          body: JSON.stringify({ otp }),
        });
        showToast('Visitor OTP verified!', 'success');
        await loadWalkinQueue();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  tbody.querySelectorAll('[data-allow-entry]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-allow-entry');
      try {
        await apiFetch(`/api/visitors/walkin/${encodeURIComponent(id)}/allow-entry`, {
          method: 'POST',
        });
        showToast('Entry allowed and visitor checked in!', 'success');
        await loadWalkinQueue();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('guard');
  if (!user) return;

  await Promise.all([loadFlatsDropdown(), loadWalkinQueue()]);
  setInterval(loadWalkinQueue, 10000);

  document.getElementById('walkin-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('walkin-alert', '');
    const btn = document.getElementById('walkin-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Sending Request...';

    try {
      const res = await apiFetch('/api/visitors/walkin', {
        method: 'POST',
        body: JSON.stringify({
          visitor_name: document.getElementById('walkin-name').value.trim(),
          visitor_phone: document.getElementById('walkin-phone').value.trim(),
          flat_id: document.getElementById('walkin-flat').value,
          purpose: document.getElementById('walkin-purpose').value.trim(),
        }),
      });
      e.target.reset();
      const otpBox = document.getElementById('generated-otp-box');
      otpBox.style.display = 'flex';
      document.getElementById('generated-otp-code').textContent = res.otp_preview;
      showToast('Approval request sent to resident & OTP generated!', 'success');
      await loadWalkinQueue();
    } catch (err) {
      showInlineAlert('walkin-alert', err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send Approval Request & Generate OTP';
    }
  });
});
