export function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  if (s.startsWith('/') || s.startsWith('https://') || s.startsWith('http://') || s.startsWith('data:image/')) {
    return s;
  }
  return '';
}

export async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'SocietyConnect');
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCurrency(amount) {
  const num = Number(amount || 0);
  return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function statusBadge(status) {
  const s = String(status || '').trim();
  const map = {
    Active: 'badge-info',
    Approved: 'badge-success',
    Verified: 'badge-success',
    Resolved: 'badge-success',
    'Checked Out': 'badge-neutral',
    'Checked In': 'badge-success',
    'In Progress': 'badge-info',
    Accepted: 'badge-info',
    Assigned: 'badge-warning',
    Pending: 'badge-warning',
    'Payment Submitted': 'badge-info',
    Unpaid: 'badge-warning',
    Acknowledged: 'badge-warning',
    Dispatched: 'badge-info',
    Rejected: 'badge-danger',
    Revoked: 'badge-danger',
    Expired: 'badge-neutral',
    Critical: 'badge-danger',
    High: 'badge-danger',
    Urgent: 'badge-danger',
    Medium: 'badge-warning',
    Low: 'badge-neutral',
    Occupied: 'badge-success',
    Vacant: 'badge-neutral',
  };
  const cls = map[s] || 'badge-neutral';
  return `<span class="badge ${cls}">${escHtml(s)}</span>`;
}

export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

export function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add('open');
}

export function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('open');
}

export function bindModalDismiss(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  el.addEventListener('click', (e) => {
    if (e.target === el) closeModal(modalId);
  });
}

export function showInlineAlert(containerId, message, type = 'error') {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!message) {
    el.innerHTML = '';
    return;
  }
  const cls = type === 'success' ? 'alert-success' : type === 'info' ? 'alert-info' : 'alert-error';
  el.innerHTML = `<div class="alert-box ${cls}">${escHtml(message)}</div>`;
}
