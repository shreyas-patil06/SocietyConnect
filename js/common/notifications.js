import { apiFetch, escHtml, formatDateTime, showToast } from './helpers.js';

export async function refreshHeaderNotifications() {
  const dot = document.getElementById('notif-unread-dot');
  const listEl = document.getElementById('notif-dropdown-list');
  if (!dot || !listEl) return;

  try {
    const data = await apiFetch('/api/residents/notifications');
    const unread = data.unreadCount || 0;
    if (unread > 0) {
      dot.textContent = unread > 99 ? '99+' : String(unread);
      dot.classList.add('visible');
    } else {
      dot.classList.remove('visible');
    }

    const items = (data.notifications || []).slice(0, 8);
    if (items.length === 0) {
      listEl.innerHTML = '<div class="empty-state" style="padding:20px;">No notifications yet</div>';
      return;
    }

    listEl.innerHTML = items
      .map(
        (n) => `
        <div class="notif-dd-item ${n.is_read ? '' : 'unread'}" data-notif-id="${escHtml(n.id)}">
          <div style="font-weight:600;font-size:13px;color:#111827;">${escHtml(n.title)}</div>
          <div style="font-size:12px;color:#6B7280;margin-top:2px;">${escHtml(n.message)}</div>
          <div style="font-size:11px;color:#9CA3AF;margin-top:4px;">${formatDateTime(n.created_at)}</div>
        </div>`
      )
      .join('');

    listEl.querySelectorAll('[data-notif-id]').forEach((el) => {
      el.addEventListener('click', async () => {
        const id = el.getAttribute('data-notif-id');
        try {
          await apiFetch(`/api/residents/notifications/${encodeURIComponent(id)}/read`, {
            method: 'PATCH',
          });
          await refreshHeaderNotifications();
        } catch {
          // ignore
        }
      });
    });
  } catch {
    // ignore background polling errors
  }
}

export async function markAllNotificationsRead() {
  try {
    await apiFetch('/api/residents/notifications/read-all', { method: 'PATCH' });
    await refreshHeaderNotifications();
    showToast('All notifications marked as read', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
