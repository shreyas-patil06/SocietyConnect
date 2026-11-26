import { initRolePage } from '../auth/role-access.js';
import { apiFetch, escHtml, formatDateTime, showToast, statusBadge } from '../common/helpers.js';
import { markAllNotificationsRead } from '../common/notifications.js';

let allNotifications = [];

function renderList(filter) {
  const tbody = document.getElementById('notifications-tbody');
  const rows = filter === 'unread' ? allNotifications.filter((n) => !n.is_read) : allNotifications;
  tbody.innerHTML = rows.length
    ? rows
        .map(
          (n) => `
        <tr style="${n.is_read ? '' : 'background:#F8FAFF;'}">
          <td>${statusBadge(n.type.toUpperCase())}</td>
          <td><strong>${escHtml(n.title)}</strong><br><span style="color:#4B5563;">${escHtml(n.message)}</span></td>
          <td>${formatDateTime(n.created_at)}</td>
          <td>${n.is_read ? '<span class="badge badge-neutral">Read</span>' : '<span class="badge badge-info">Unread</span>'}</td>
          <td>
            ${
              n.is_read
                ? ''
                : `<button class="btn btn-sm btn-outline" data-mark-read="${escHtml(n.id)}">Mark Read</button>`
            }
          </td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="empty-state">No notifications to display.</td></tr>';

  tbody.querySelectorAll('[data-mark-read]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/api/residents/notifications/${encodeURIComponent(btn.getAttribute('data-mark-read'))}/read`, {
          method: 'PATCH',
        });
        await loadNotifications();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

async function loadNotifications() {
  const data = await apiFetch('/api/residents/notifications');
  allNotifications = data.notifications || [];
  const filter = document.getElementById('notif-filter')?.value || 'all';
  renderList(filter);
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initRolePage('resident');
  if (!user) return;

  await loadNotifications();

  document.getElementById('notif-filter')?.addEventListener('change', (e) => {
    renderList(e.target.value);
  });

  document.getElementById('mark-all-page-btn')?.addEventListener('click', async () => {
    await markAllNotificationsRead();
    await loadNotifications();
  });
});
