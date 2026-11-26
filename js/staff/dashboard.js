import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  escHtml,
  formatDateTime,
  showToast,
  statusBadge,
} from '../common/helpers.js';

async function loadStaffDashboard() {
  try {
    const [summary, compRes] = await Promise.all([
      apiFetch('/api/residents/dashboard-summary'),
      apiFetch('/api/complaints'),
    ]);

    const k = summary.kpis || {};
    document.getElementById('kpi-assigned-total').textContent = k.assignedTotal ?? 0;
    document.getElementById('kpi-awaiting').textContent = k.pendingAcceptance ?? 0;
    document.getElementById('kpi-in-progress').textContent = k.inProgress ?? 0;
    document.getElementById('kpi-resolved').textContent = k.resolved ?? 0;

    const list = compRes.complaints || [];
    const tbody = document.getElementById('staff-dashboard-tbody');
    tbody.innerHTML = list.length
      ? list
          .slice(0, 8)
          .map(
            (c) => `
          <tr>
            <td><strong>${escHtml(c.title)}</strong><br><small style="color:#6B7280;">Flat ${escHtml(c.flat_label)} • ${escHtml(c.resident_name)}</small></td>
            <td>${escHtml(c.category)}</td>
            <td>${statusBadge(c.priority)}</td>
            <td>${statusBadge(c.status)}</td>
            <td>${formatDateTime(c.updated_at)}</td>
            <td>
              <a href="/pages/staff/complaint-details.html?id=${encodeURIComponent(c.id)}" class="btn btn-sm btn-outline">Open Ticket</a>
            </td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="empty-state">No complaints assigned to you yet.</td></tr>';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('staff');
  if (!user) return;
  await loadStaffDashboard();
});
