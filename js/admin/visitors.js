import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  escHtml,
  formatDateTime,
  showToast,
  statusBadge,
} from '../common/helpers.js';

async function loadAdminVisitors() {
  const [passesRes, logsRes] = await Promise.all([
    apiFetch('/api/visitors/passes'),
    apiFetch('/api/visitors/logs'),
  ]);

  const passes = passesRes.passes || [];
  const passTbody = document.getElementById('admin-passes-tbody');
  passTbody.innerHTML = passes.length
    ? passes
        .map(
          (p) => `
        <tr>
          <td><strong>${escHtml(p.visitor_name)}</strong><br><small style="color:#6B7280;">${escHtml(p.visitor_phone)}</small></td>
          <td>Flat ${escHtml(p.flat_label)}<br><small style="color:#6B7280;">${escHtml(p.resident_name)}</small></td>
          <td>${escHtml(p.pass_type)} • ${escHtml(p.purpose)}</td>
          <td>${formatDateTime(p.expires_at)}</td>
          <td>${statusBadge(p.status)}</td>
          <td>
            ${
              p.status === 'Active' || p.status === 'Checked In'
                ? `<button class="btn btn-sm btn-soft-danger" data-admin-revoke="${escHtml(p.id)}">Revoke</button>`
                : '—'
            }
          </td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="empty-state">No visitor passes generated yet.</td></tr>';

  passTbody.querySelectorAll('[data-admin-revoke]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/api/visitors/passes/${encodeURIComponent(btn.getAttribute('data-admin-revoke'))}/revoke`, {
          method: 'PATCH',
        });
        showToast('Pass revoked', 'success');
        await loadAdminVisitors();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  const logs = logsRes.logs || [];
  const logsTbody = document.getElementById('admin-logs-tbody');
  logsTbody.innerHTML = logs.length
    ? logs
        .map(
          (l) => `
        <tr>
          <td><strong>${escHtml(l.visitor_name)}</strong><br><small style="color:#6B7280;">${escHtml(l.visitor_phone)}</small></td>
          <td>Flat ${escHtml(l.flat_label)}</td>
          <td>${escHtml(l.entry_method)}</td>
          <td>${escHtml(l.guard_name || 'Guard')}</td>
          <td>${formatDateTime(l.check_in_time)}</td>
          <td>${l.check_out_time ? formatDateTime(l.check_out_time) : 'Inside'}</td>
          <td>${statusBadge(l.status)}</td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="7" class="empty-state">No gate logs recorded yet.</td></tr>';
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('admin');
  if (!user) return;
  await loadAdminVisitors();
});
