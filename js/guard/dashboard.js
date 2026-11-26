import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  escHtml,
  formatDateTime,
  showToast,
  statusBadge,
} from '../common/helpers.js';

async function initGuardDashboard() {
  try {
    const summary = await apiFetch('/api/residents/dashboard-summary');
    const k = summary.kpis || {};
    document.getElementById('kpi-checked-in').textContent = k.checkedInNow ?? 0;
    document.getElementById('kpi-today-entries').textContent = k.todayEntries ?? 0;
    document.getElementById('kpi-active-passes').textContent = k.activePasses ?? 0;
    document.getElementById('kpi-pending-walkins').textContent = k.pendingWalkins ?? 0;

    const strip = document.getElementById('guard-emergency-strip');
    if (strip && (k.activeAlerts || 0) > 0) {
      strip.style.display = 'flex';
      document.getElementById('guard-emergency-text').textContent =
        `ALERT: ${k.activeAlerts} active emergency alert(s) require guard attention!`;
    }

    const tbody = document.getElementById('guard-recent-logs-tbody');
    const logs = summary.recentLogs || [];
    tbody.innerHTML = logs.length
      ? logs
          .map(
            (l) => `
          <tr>
            <td><strong>${escHtml(l.visitor_name)}</strong><br><small style="color:#6B7280;">${escHtml(l.visitor_phone)}</small></td>
            <td>${escHtml(l.entry_method)}</td>
            <td>${formatDateTime(l.check_in_time)}</td>
            <td>${statusBadge(l.status)}</td>
            <td>
              ${
                l.status === 'Checked In'
                  ? `<button class="btn btn-sm btn-outline" data-checkout-log="${escHtml(l.id)}">Check Out</button>`
                  : formatDateTime(l.check_out_time)
              }
            </td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="empty-state">No gate activity recorded today.</td></tr>';

    tbody.querySelectorAll('[data-checkout-log]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch('/api/visitors/check-out', {
            method: 'POST',
            body: JSON.stringify({ log_id: btn.getAttribute('data-checkout-log') }),
          });
          showToast('Visitor checked out', 'success');
          await initGuardDashboard();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function initGuardEmergencyPage() {
  async function loadEmergencies() {
    const { alerts } = await apiFetch('/api/emergency');
    const tbody = document.getElementById('guard-emergencies-tbody');
    tbody.innerHTML = alerts.length
      ? alerts
          .map(
            (a) => `
          <tr>
            <td><strong>${escHtml(a.resident_name)}</strong><br><small style="color:#6B7280;">Flat ${escHtml(a.flat_label)} • ${escHtml(a.resident_phone)}</small></td>
            <td><strong>${escHtml(a.emergency_type)}</strong><br><small style="color:#6B7280;">${escHtml(a.details)}</small></td>
            <td>${statusBadge(a.severity)}</td>
            <td>${statusBadge(a.status)}</td>
            <td>${formatDateTime(a.created_at)}</td>
            <td>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${
                  a.status === 'Active'
                    ? `<button class="btn btn-sm btn-primary" data-em-id="${escHtml(a.id)}" data-em-status="Acknowledged">Acknowledge</button>`
                    : ''
                }
                ${
                  a.status === 'Acknowledged' || a.status === 'Active'
                    ? `<button class="btn btn-sm btn-outline" data-em-id="${escHtml(a.id)}" data-em-status="Dispatched">Dispatched</button>`
                    : ''
                }
                ${
                  a.status !== 'Resolved'
                    ? `<button class="btn btn-sm btn-success" data-em-id="${escHtml(a.id)}" data-em-status="Resolved">Resolve</button>`
                    : escHtml(a.response_notes || 'Resolved')
                }
              </div>
            </td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="empty-state">No emergency alerts recorded.</td></tr>';

    tbody.querySelectorAll('[data-em-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-em-id');
        const status = btn.getAttribute('data-em-status');
        try {
          await apiFetch(`/api/emergency/${encodeURIComponent(id)}/status`, {
            method: 'PATCH',
            body: JSON.stringify({
              status,
              response_notes: `Updated to ${status} by Gate Security`,
            }),
          });
          showToast(`Emergency marked ${status}`, 'success');
          await loadEmergencies();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  await loadEmergencies();
  setInterval(loadEmergencies, 15000);
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('guard');
  if (!user) return;
  const page = document.body.getAttribute('data-page');
  if (page === 'guard-dashboard') await initGuardDashboard();
  if (page === 'guard-emergency') await initGuardEmergencyPage();
});
