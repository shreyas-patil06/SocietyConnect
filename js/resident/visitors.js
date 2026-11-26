import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  bindModalDismiss,
  closeModal,
  escHtml,
  formatDateTime,
  openModal,
  safeUrl,
  showInlineAlert,
  showToast,
  statusBadge,
} from '../common/helpers.js';

async function loadResidentQr(user) {
  const img = document.getElementById('personal-qr-img');
  const code = document.getElementById('personal-qr-token');
  if (!img || !code || !user.personal_qr_token) return;
  code.textContent = user.personal_qr_token;
  const { qrDataUrl } = await apiFetch(`/api/auth/qr-image?token=${encodeURIComponent(user.personal_qr_token)}`);
  img.src = qrDataUrl;
}

async function loadAllVisitorData() {
  const [passesRes, walkinsRes, logsRes] = await Promise.all([
    apiFetch('/api/visitors/passes'),
    apiFetch('/api/visitors/walkin'),
    apiFetch('/api/visitors/logs'),
  ]);

  // 1. Walk-in approval requests
  const walkinTbody = document.getElementById('walkin-requests-tbody');
  const requests = walkinsRes.requests || [];
  walkinTbody.innerHTML = requests.length
    ? requests
        .map(
          (r) => `
        <tr>
          <td><strong>${escHtml(r.visitor_name)}</strong><br><small style="color:#6B7280;">${escHtml(r.visitor_phone)}</small></td>
          <td>${escHtml(r.purpose)}</td>
          <td>${escHtml(r.guard_name || 'Gate Guard')}</td>
          <td>${statusBadge(r.approval_status)} ${r.otp_verified ? '<span class="badge badge-success">OTP Verified</span>' : '<span class="badge badge-neutral">OTP Pending</span>'}</td>
          <td>${formatDateTime(r.created_at)}</td>
          <td>
            ${
              r.approval_status === 'Pending'
                ? `<div style="display:flex;gap:6px;">
                    <button class="btn btn-sm btn-success" data-walkin-approve="${escHtml(r.id)}">Approve</button>
                    <button class="btn btn-sm btn-soft-danger" data-walkin-reject="${escHtml(r.id)}">Reject</button>
                   </div>`
                : escHtml(r.resident_note || 'Responded')
            }
          </td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="empty-state">No walk-in visitor requests.</td></tr>';

  walkinTbody.querySelectorAll('[data-walkin-approve]').forEach((btn) => {
    btn.addEventListener('click', () => respondWalkin(btn.getAttribute('data-walkin-approve'), 'Approved'));
  });
  walkinTbody.querySelectorAll('[data-walkin-reject]').forEach((btn) => {
    btn.addEventListener('click', () => respondWalkin(btn.getAttribute('data-walkin-reject'), 'Rejected'));
  });

  // 2. Guest passes
  const passesTbody = document.getElementById('guest-passes-tbody');
  const passes = passesRes.passes || [];
  passesTbody.innerHTML = passes.length
    ? passes
        .map(
          (p) => `
        <tr>
          <td><strong>${escHtml(p.visitor_name)}</strong><br><small style="color:#6B7280;">${escHtml(p.visitor_phone)}</small></td>
          <td>${escHtml(p.visitor_type)} • ${escHtml(p.pass_type)}</td>
          <td>${escHtml(p.purpose)}</td>
          <td>${formatDateTime(p.expires_at)}</td>
          <td>${statusBadge(p.status)}</td>
          <td>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-sm btn-outline" data-view-qr="${escHtml(p.id)}">View QR</button>
              ${
                p.status === 'Active' || p.status === 'Checked In'
                  ? `<button class="btn btn-sm btn-soft-danger" data-revoke-pass="${escHtml(p.id)}">Revoke</button>`
                  : ''
              }
            </div>
          </td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="empty-state">No guest invitations created yet.</td></tr>';

  const passById = new Map(passes.map((p) => [p.id, p]));
  passesTbody.querySelectorAll('[data-view-qr]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = passById.get(btn.getAttribute('data-view-qr'));
      if (!p) return;
      document.getElementById('modal-qr-title').textContent = `Guest Pass: ${p.visitor_name}`;
      document.getElementById('modal-qr-img').src = safeUrl(p.qr_data_url);
      document.getElementById('modal-qr-token').textContent = p.qr_token;
      document.getElementById('modal-qr-meta').textContent = `${p.pass_type} • Valid until ${formatDateTime(p.expires_at)}`;
      document.getElementById('modal-qr-download').href = safeUrl(p.qr_data_url);
      openModal('guest-qr-modal');
    });
  });

  passesTbody.querySelectorAll('[data-revoke-pass]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/api/visitors/passes/${encodeURIComponent(btn.getAttribute('data-revoke-pass'))}/revoke`, {
          method: 'PATCH',
        });
        showToast('Guest pass revoked', 'success');
        await loadAllVisitorData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // 3. Visitor check-in / check-out history
  const logsTbody = document.getElementById('visitor-history-tbody');
  const logs = logsRes.logs || [];
  logsTbody.innerHTML = logs.length
    ? logs
        .map(
          (l) => `
        <tr>
          <td><strong>${escHtml(l.visitor_name)}</strong><br><small style="color:#6B7280;">${escHtml(l.visitor_phone)}</small></td>
          <td>${escHtml(l.entry_method)}</td>
          <td>${formatDateTime(l.check_in_time)}</td>
          <td>${l.check_out_time ? formatDateTime(l.check_out_time) : 'Still Inside'}</td>
          <td>${statusBadge(l.status)}</td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="empty-state">No visitor entry/exit history recorded yet.</td></tr>';
}

async function respondWalkin(id, decision) {
  try {
    await apiFetch(`/api/visitors/walkin/${encodeURIComponent(id)}/respond`, {
      method: 'PATCH',
      body: JSON.stringify({ decision }),
    });
    showToast(`Walk-in visitor ${decision.toLowerCase()}`, 'success');
    await loadAllVisitorData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('resident');
  if (!user) return;

  bindModalDismiss('guest-qr-modal');
  document.getElementById('close-qr-modal-btn')?.addEventListener('click', () => closeModal('guest-qr-modal'));

  await loadResidentQr(user);
  await loadAllVisitorData();

  document.getElementById('regen-personal-qr-btn')?.addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/auth/regenerate-qr', { method: 'POST' });
      document.getElementById('personal-qr-img').src = res.qrDataUrl;
      document.getElementById('personal-qr-token').textContent = res.user.personal_qr_token;
      showToast('Personal QR regenerated', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('invite-guest-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('invite-alert', '');
    const btn = document.getElementById('invite-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Generating QR...';

    try {
      const { pass } = await apiFetch('/api/visitors/passes', {
        method: 'POST',
        body: JSON.stringify({
          visitor_name: document.getElementById('guest-name').value.trim(),
          visitor_phone: document.getElementById('guest-phone').value.trim(),
          visitor_type: document.getElementById('guest-type').value,
          pass_type: document.getElementById('guest-pass-type').value,
          valid_hours: Number(document.getElementById('guest-hours').value),
          purpose: document.getElementById('guest-purpose').value.trim(),
        }),
      });
      e.target.reset();
      showToast('Unique Guest QR pass generated!', 'success');
      await loadAllVisitorData();

      document.getElementById('modal-qr-title').textContent = `Guest Pass: ${pass.visitor_name}`;
      document.getElementById('modal-qr-img').src = safeUrl(pass.qr_data_url);
      document.getElementById('modal-qr-token').textContent = pass.qr_token;
      document.getElementById('modal-qr-meta').textContent = `${pass.pass_type} • Valid until ${formatDateTime(pass.expires_at)}`;
      document.getElementById('modal-qr-download').href = safeUrl(pass.qr_data_url);
      openModal('guest-qr-modal');
    } catch (err) {
      showInlineAlert('invite-alert', err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate Guest QR Pass';
    }
  });
});
