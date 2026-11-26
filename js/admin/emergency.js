import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  escHtml,
  formatDateTime,
  showToast,
  statusBadge,
} from '../common/helpers.js';

async function loadAdminEmergencies() {
  const { alerts } = await apiFetch('/api/emergency');
  const tbody = document.getElementById('admin-emergencies-tbody');
  tbody.innerHTML = alerts.length
    ? alerts
        .map(
          (a) => `
        <tr>
          <td><strong>${escHtml(a.resident_name)}</strong><br><small style="color:#6B7280;">Flat ${escHtml(a.flat_label)} • ${escHtml(a.resident_phone)}</small></td>
          <td><strong>${escHtml(a.emergency_type)}</strong><br><small style="color:#6B7280;">${escHtml(a.details)}</small></td>
          <td>${statusBadge(a.severity)}</td>
          <td>${statusBadge(a.status)}</td>
          <td>${escHtml(a.acknowledged_by_name || 'Pending')}<br><small style="color:#6B7280;">${escHtml(a.response_notes || '')}</small></td>
          <td>${formatDateTime(a.created_at)}</td>
          <td>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${
                a.status === 'Active'
                  ? `<button class="btn btn-sm btn-primary" data-adm-em="${escHtml(a.id)}" data-adm-st="Acknowledged">Acknowledge</button>`
                  : ''
              }
              ${
                a.status !== 'Resolved'
                  ? `<button class="btn btn-sm btn-success" data-adm-em="${escHtml(a.id)}" data-adm-st="Resolved">Resolve</button>`
                  : '<span style="color:#16A34A;font-weight:600;">Completed</span>'
              }
            </div>
          </td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="7" class="empty-state">No emergency alerts recorded.</td></tr>';

  tbody.querySelectorAll('[data-adm-em]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-adm-em');
      const status = btn.getAttribute('data-adm-st');
      try {
        await apiFetch(`/api/emergency/${encodeURIComponent(id)}/status`, {
          method: 'PATCH',
          body: JSON.stringify({
            status,
            response_notes: `Marked ${status} by Society Admin`,
          }),
        });
        showToast(`Alert marked ${status}`, 'success');
        await loadAdminEmergencies();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('admin');
  if (!user) return;
  await loadAdminEmergencies();
});
