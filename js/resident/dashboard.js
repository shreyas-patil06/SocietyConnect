import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  escHtml,
  formatCurrency,
  formatDateTime,
  showInlineAlert,
  showToast,
  statusBadge,
} from '../common/helpers.js';

async function loadPersonalQr(user, imgId, codeId) {
  const img = document.getElementById(imgId);
  const code = document.getElementById(codeId);
  if (!img || !code || !user.personal_qr_token) return;
  code.textContent = user.personal_qr_token;
  try {
    const { qrDataUrl } = await apiFetch(`/api/auth/qr-image?token=${encodeURIComponent(user.personal_qr_token)}`);
    img.src = qrDataUrl;
  } catch {
    // ignore
  }
}

async function initResidentDashboard(user) {
  await loadPersonalQr(user, 'resident-qr-img', 'resident-qr-token');

  document.getElementById('regen-qr-btn')?.addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/auth/regenerate-qr', { method: 'POST' });
      document.getElementById('resident-qr-img').src = res.qrDataUrl;
      document.getElementById('resident-qr-token').textContent = res.user.personal_qr_token;
      showToast('Personal Gate QR regenerated', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  try {
    const summary = await apiFetch('/api/residents/dashboard-summary');
    const k = summary.kpis || {};
    document.getElementById('kpi-active-passes').textContent = k.activePasses ?? 0;
    document.getElementById('kpi-total-visits').textContent = k.totalVisits ?? 0;
    document.getElementById('kpi-open-complaints').textContent = k.openComplaints ?? 0;
    document.getElementById('kpi-pending-dues').textContent = formatCurrency(k.pendingAmount ?? 0);
    document.getElementById('kpi-bills-sub').textContent = `${k.pendingBillsCount ?? 0} unpaid bill(s)`;
    document.getElementById('kpi-walkins-sub').textContent = `${k.pendingWalkins ?? 0} walk-in approval(s) pending`;

    // Pending walk-ins alert banner
    const walkinBanner = document.getElementById('walkin-alert-banner');
    if (walkinBanner && (k.pendingWalkins || 0) > 0) {
      walkinBanner.style.display = 'flex';
      document.getElementById('walkin-alert-text').textContent =
        `You have ${k.pendingWalkins} walk-in visitor(s) waiting for your approval at the gate.`;
    }

    // Recent visitor logs table
    const logsTbody = document.getElementById('recent-logs-tbody');
    const logs = summary.recentLogs || [];
    logsTbody.innerHTML = logs.length
      ? logs
          .map(
            (l) => `
          <tr>
            <td><strong>${escHtml(l.visitor_name)}</strong><br><small style="color:#6B7280;">${escHtml(l.visitor_phone)}</small></td>
            <td>${escHtml(l.entry_method)}</td>
            <td>${formatDateTime(l.check_in_time)}</td>
            <td>${l.check_out_time ? formatDateTime(l.check_out_time) : 'Inside'}</td>
            <td>${statusBadge(l.status)}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="empty-state">No visitor logs yet.</td></tr>';

    // Recent complaints table
    const compTbody = document.getElementById('recent-complaints-tbody');
    const comps = summary.recentComplaints || [];
    compTbody.innerHTML = comps.length
      ? comps
          .map(
            (c) => `
          <tr>
            <td><strong>${escHtml(c.title)}</strong></td>
            <td>${escHtml(c.category)}</td>
            <td>${statusBadge(c.priority)}</td>
            <td>${statusBadge(c.status)}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="4" class="empty-state">No complaints submitted yet.</td></tr>';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function initProfilePage(user) {
  document.getElementById('prof-name').value = user.full_name || '';
  document.getElementById('prof-email').value = user.email || '';
  document.getElementById('prof-phone').value = user.phone || '';
  document.getElementById('prof-society').value = user.society_name || '';
  document.getElementById('prof-flat').value = user.flat_label || 'Unassigned';

  await loadPersonalQr(user, 'profile-qr-img', 'profile-qr-token');

  document.getElementById('profile-regen-qr-btn')?.addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/auth/regenerate-qr', { method: 'POST' });
      document.getElementById('profile-qr-img').src = res.qrDataUrl;
      document.getElementById('profile-qr-token').textContent = res.user.personal_qr_token;
      showToast('Personal QR code regenerated', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('profile-update-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('profile-alert', '');
    try {
      await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: document.getElementById('prof-name').value.trim(),
          phone: document.getElementById('prof-phone').value.trim(),
        }),
      });
      showInlineAlert('profile-alert', 'Profile details updated successfully.', 'success');
      showToast('Profile saved', 'success');
    } catch (err) {
      showInlineAlert('profile-alert', err.message, 'error');
    }
  });

  document.getElementById('password-update-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('password-alert', '');
    try {
      await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          current_password: document.getElementById('curr-password').value,
          new_password: document.getElementById('new-password').value,
        }),
      });
      e.target.reset();
      showInlineAlert('password-alert', 'Password updated successfully.', 'success');
      showToast('Password changed', 'success');
    } catch (err) {
      showInlineAlert('password-alert', err.message, 'error');
    }
  });
}

async function initEmergencyPage() {
  async function loadAlerts() {
    try {
      const { alerts } = await apiFetch('/api/emergency');
      const tbody = document.getElementById('emergency-history-tbody');
      tbody.innerHTML = alerts.length
        ? alerts
            .map(
              (a) => `
            <tr>
              <td><strong>${escHtml(a.emergency_type)}</strong><br><small style="color:#6B7280;">${escHtml(a.details)}</small></td>
              <td>${statusBadge(a.severity)}</td>
              <td>${statusBadge(a.status)}</td>
              <td>${escHtml(a.acknowledged_by_name || 'Awaiting Guard/Admin')}${a.response_notes ? `<br><small style="color:#6B7280;">${escHtml(a.response_notes)}</small>` : ''}</td>
              <td>${formatDateTime(a.created_at)}</td>
            </tr>`
            )
            .join('')
        : '<tr><td colspan="5" class="empty-state">No emergency alerts triggered.</td></tr>';
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  await loadAlerts();

  document.getElementById('emergency-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showInlineAlert('emergency-alert', '');
    const btn = document.getElementById('emergency-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Sending Alert...';
    try {
      await apiFetch('/api/emergency', {
        method: 'POST',
        body: JSON.stringify({
          emergency_type: document.getElementById('em-type').value,
          severity: document.getElementById('em-severity').value,
          details: document.getElementById('em-details').value.trim(),
        }),
      });
      e.target.reset();
      showInlineAlert(
        'emergency-alert',
        'Emergency alert dispatched to all Security Guards and Admins!',
        'success'
      );
      showToast('Emergency Alert Sent!', 'success');
      await loadAlerts();
    } catch (err) {
      showInlineAlert('emergency-alert', err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Trigger Emergency Alert';
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('resident');
  if (!user) return;
  const page = document.body.getAttribute('data-page');
  if (page === 'resident-dashboard') await initResidentDashboard(user);
  if (page === 'resident-profile') await initProfilePage(user);
  if (page === 'resident-emergency') await initEmergencyPage();
});
