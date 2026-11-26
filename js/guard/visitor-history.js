import { initRolePage } from '../auth/role-access.js';
import {
  apiFetch,
  escHtml,
  formatDateTime,
  showToast,
  statusBadge,
} from '../common/helpers.js';

async function initVisitorEntryPage() {
  const [passesRes, logsRes] = await Promise.all([
    apiFetch('/api/visitors/passes'),
    apiFetch('/api/visitors/logs'),
  ]);

  const activePasses = (passesRes.passes || []).filter((p) => p.status === 'Active');
  const passesTbody = document.getElementById('expected-passes-tbody');
  passesTbody.innerHTML = activePasses.length
    ? activePasses
        .map(
          (p) => `
        <tr>
          <td><strong>${escHtml(p.visitor_name)}</strong><br><small style="color:#6B7280;">${escHtml(p.visitor_phone)}</small></td>
          <td>Flat ${escHtml(p.flat_label)}<br><small style="color:#6B7280;">Host: ${escHtml(p.resident_name)}</small></td>
          <td>${escHtml(p.purpose)}</td>
          <td>${formatDateTime(p.expires_at)}</td>
          <td>${statusBadge(p.status)}</td>
          <td><button class="btn btn-sm btn-success" data-checkin-pass="${escHtml(p.id)}">Check In</button></td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="empty-state">No expected visitors waiting to check in.</td></tr>';

  passesTbody.querySelectorAll('[data-checkin-pass]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch('/api/visitors/check-in', {
          method: 'POST',
          body: JSON.stringify({ pass_id: btn.getAttribute('data-checkin-pass') }),
        });
        showToast('Expected visitor checked in!', 'success');
        await initVisitorEntryPage();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  const insideLogs = (logsRes.logs || []).filter((l) => l.status === 'Checked In');
  const insideTbody = document.getElementById('currently-inside-tbody');
  insideTbody.innerHTML = insideLogs.length
    ? insideLogs
        .map(
          (l) => `
        <tr>
          <td><strong>${escHtml(l.visitor_name)}</strong><br><small style="color:#6B7280;">${escHtml(l.visitor_phone)}</small></td>
          <td>Flat ${escHtml(l.flat_label)}</td>
          <td>${escHtml(l.entry_method)}</td>
          <td>${formatDateTime(l.check_in_time)}</td>
          <td><button class="btn btn-sm btn-danger" data-checkout-id="${escHtml(l.id)}">Record Check-Out</button></td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="empty-state">No visitors currently inside the society.</td></tr>';

  insideTbody.querySelectorAll('[data-checkout-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch('/api/visitors/check-out', {
          method: 'POST',
          body: JSON.stringify({ log_id: btn.getAttribute('data-checkout-id') }),
        });
        showToast('Check-out recorded!', 'success');
        await initVisitorEntryPage();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

async function initVisitorHistoryPage() {
  const { logs } = await apiFetch('/api/visitors/logs');
  const filterSelect = document.getElementById('history-status-filter');

  function render() {
    const val = filterSelect?.value || 'all';
    const filtered = val === 'all' ? logs : logs.filter((l) => l.status === val);
    const tbody = document.getElementById('guard-history-tbody');
    tbody.innerHTML = filtered.length
      ? filtered
          .map(
            (l) => `
          <tr>
            <td><strong>${escHtml(l.visitor_name)}</strong><br><small style="color:#6B7280;">${escHtml(l.visitor_phone)}</small></td>
            <td>Flat ${escHtml(l.flat_label)}<br><small style="color:#6B7280;">${escHtml(l.resident_name)}</small></td>
            <td>${escHtml(l.entry_method)}</td>
            <td>${formatDateTime(l.check_in_time)}</td>
            <td>${l.check_out_time ? formatDateTime(l.check_out_time) : 'Inside'}</td>
            <td>${statusBadge(l.status)}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="empty-state">No matching visitor records found.</td></tr>';
  }

  render();
  filterSelect?.addEventListener('change', render);
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('guard');
  if (!user) return;
  const page = document.body.getAttribute('data-page');
  if (page === 'guard-entry') await initVisitorEntryPage();
  if (page === 'guard-history') await initVisitorHistoryPage();
});
