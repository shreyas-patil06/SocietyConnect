import { apiFetch, escHtml, showToast } from '../common/helpers.js';
import { markAllNotificationsRead, refreshHeaderNotifications } from '../common/notifications.js';

const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  visitors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3z"/><path d="M17 17h4v4h-4z"/><path d="M14 20h2"/></svg>',
  complaints: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  bills: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
  emergency: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
};

const ROLE_NAV = {
  resident: {
    main: [
      { label: 'Dashboard', href: '/pages/resident/dashboard.html', icon: 'dashboard' },
      { label: 'Visitors & QR', href: '/pages/resident/visitors.html', icon: 'qr' },
      { label: 'Complaints', href: '/pages/resident/complaints.html', icon: 'complaints' },
      { label: 'Maintenance Bills', href: '/pages/resident/maintenance-bills.html', icon: 'bills' },
      { label: 'Emergency SOS', href: '/pages/resident/emergency.html', icon: 'emergency' },
    ],
    account: [
      { label: 'Notifications', href: '/pages/resident/notifications.html', icon: 'bell' },
      { label: 'My Profile', href: '/pages/resident/profile.html', icon: 'user' },
    ],
    promo: {
      title: 'Emergency SOS Ready',
      desc: 'Alert gate security and society admins instantly in an urgent situation.',
      cta: 'Trigger Emergency',
      href: '/pages/resident/emergency.html',
    },
  },
  guard: {
    main: [
      { label: 'Gate Dashboard', href: '/pages/guard/dashboard.html', icon: 'dashboard' },
      { label: 'QR Scanner', href: '/pages/guard/qr-scanner.html', icon: 'qr' },
      { label: 'Visitor Entry', href: '/pages/guard/visitor-entry.html', icon: 'visitors' },
      { label: 'Walk-In OTP Gate', href: '/pages/guard/walk-in-verification.html', icon: 'shield' },
      { label: 'Visitor History', href: '/pages/guard/visitor-history.html', icon: 'chart' },
      { label: 'Emergency Alerts', href: '/pages/guard/emergency-alerts.html', icon: 'emergency' },
    ],
    account: [],
    promo: {
      title: 'Main Gate Security',
      desc: 'Scan resident/guest QR passes or verify walk-in visitors via resident approval & OTP.',
      cta: 'Open QR Scanner',
      href: '/pages/guard/qr-scanner.html',
    },
  },
  staff: {
    main: [
      { label: 'Staff Dashboard', href: '/pages/staff/dashboard.html', icon: 'dashboard' },
      { label: 'Assigned Tasks', href: '/pages/staff/assigned-complaints.html', icon: 'complaints' },
    ],
    account: [],
    promo: {
      title: 'Maintenance Queue',
      desc: 'Accept assigned complaints, log repair progress, and resolve resident tickets.',
      cta: 'View Assigned Tasks',
      href: '/pages/staff/assigned-complaints.html',
    },
  },
  admin: {
    main: [
      { label: 'Dashboard', href: '/pages/admin/dashboard.html', icon: 'dashboard' },
      { label: 'Residents & Flats', href: '/pages/admin/residents.html', icon: 'user' },
      { label: 'Visitors & Logs', href: '/pages/admin/visitors.html', icon: 'visitors' },
      { label: 'Complaints', href: '/pages/admin/complaints.html', icon: 'complaints' },
      { label: 'Staff & Guards', href: '/pages/admin/staff-management.html', icon: 'shield' },
      { label: 'Maintenance Bills', href: '/pages/admin/maintenance-bills.html', icon: 'bills' },
      { label: 'Payment Receipts', href: '/pages/admin/payments.html', icon: 'qr' },
      { label: 'Emergency Alerts', href: '/pages/admin/emergency-alerts.html', icon: 'emergency' },
      { label: 'Reports', href: '/pages/admin/reports.html', icon: 'chart' },
    ],
    account: [],
    promo: {
      title: 'Society Control',
      desc: 'Review payment receipts, assign maintenance tickets, and monitor gate security.',
      cta: 'Verify Payments',
      href: '/pages/admin/payments.html',
    },
  },
};

function renderShell(user) {
  const navConfig = ROLE_NAV[user.role];
  const currentPath = window.location.pathname;

  const sidebarEl = document.getElementById('app-sidebar');
  if (sidebarEl) {
    const mainLinks = navConfig.main
      .map((item) => {
        const active = currentPath === item.href ? 'active' : '';
        return `
          <a href="${item.href}" class="nav-item ${active}">
            <span class="nav-item-left">
              ${ICONS[item.icon] || ''}
              <span>${escHtml(item.label)}</span>
            </span>
          </a>`;
      })
      .join('');

    const accountLinks = navConfig.account.length
      ? `<div class="sidebar-section-label">Account</div>` +
        navConfig.account
          .map((item) => {
            const active = currentPath === item.href ? 'active' : '';
            return `
              <a href="${item.href}" class="nav-item ${active}">
                <span class="nav-item-left">
                  ${ICONS[item.icon] || ''}
                  <span>${escHtml(item.label)}</span>
                </span>
              </a>`;
          })
          .join('')
      : '';

    sidebarEl.innerHTML = `
      <div>
        <div class="sidebar-brand-row">
          <a href="/pages/${escHtml(user.role)}/dashboard.html" class="sidebar-brand">
            <span class="sidebar-logo">S</span>
            <span>SocietyConnect</span>
          </a>
        </div>
        <div class="sidebar-section-label">${escHtml(user.role.toUpperCase())} PORTAL</div>
        <nav class="sidebar-nav">${mainLinks}</nav>
        ${accountLinks}
      </div>
      <div>
        <div class="sidebar-promo-card">
          <div class="sidebar-promo-icon">✦</div>
          <div class="sidebar-promo-title">${escHtml(navConfig.promo.title)}</div>
          <div class="sidebar-promo-desc">${escHtml(navConfig.promo.desc)}</div>
          <a href="${navConfig.promo.href}" class="sidebar-promo-btn">${escHtml(navConfig.promo.cta)}</a>
        </div>
        <button id="sidebar-logout-btn" class="nav-item" style="width:100%;border:none;background:transparent;cursor:pointer;margin-top:10px;color:#DC2626;">
          <span class="nav-item-left">
            <span>Sign Out</span>
          </span>
        </button>
      </div>
    `;
  }

  const topbarEl = document.getElementById('app-topbar');
  if (topbarEl) {
    const initials = (user.full_name || 'U')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('');

    topbarEl.innerHTML = `
      <div class="topbar-left">
        <button id="mobile-menu-toggle" class="mobile-menu-btn" aria-label="Toggle Menu">☰</button>
        <div class="search-box">
          <span style="color:#9CA3AF;">⌕</span>
          <input id="global-table-search" type="search" placeholder="Search table or records..." />
          <span class="search-kbd">⌘K</span>
        </div>
      </div>
      <div class="topbar-right">
        <div style="position:relative;">
          <button id="notif-bell-btn" class="icon-btn" title="Notifications">
            ${ICONS.bell}
            <span id="notif-unread-dot" class="notif-dot"></span>
          </button>
          <div id="notif-dropdown" class="notif-dropdown">
            <div class="notif-dd-head">
              <span>Notifications</span>
              <button id="notif-mark-all-btn" class="btn btn-sm btn-outline">Mark all read</button>
            </div>
            <div id="notif-dropdown-list">
              <div class="empty-state" style="padding:20px;">Loading...</div>
            </div>
          </div>
        </div>
        <div class="user-chip">
          <div class="user-avatar">${escHtml(initials)}</div>
          <div class="user-chip-meta">
            <span class="user-chip-name">${escHtml(user.full_name)}</span>
            <span class="user-chip-role">${escHtml(user.role)}${user.flat_label ? ` • ${escHtml(user.flat_label)}` : ''}</span>
          </div>
        </div>
        <button id="topbar-logout-btn" class="btn btn-sm btn-outline">Sign Out</button>
      </div>
    `;
  }

  // Bind mobile drawer
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  if (toggleBtn && sidebarEl) {
    toggleBtn.addEventListener('click', () => {
      sidebarEl.classList.toggle('open');
    });
  }

  // Bind notification dropdown
  const bellBtn = document.getElementById('notif-bell-btn');
  const dropdown = document.getElementById('notif-dropdown');
  if (bellBtn && dropdown) {
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
      refreshHeaderNotifications();
    });
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && e.target !== bellBtn) {
        dropdown.classList.remove('open');
      }
    });
  }

  const markAllBtn = document.getElementById('notif-mark-all-btn');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      markAllNotificationsRead();
    });
  }

  // Global search filter across visible table rows
  const searchInput = document.getElementById('global-table-search');
  if (searchInput) {
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput.focus();
      }
    });
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      document.querySelectorAll('.data-table tbody tr').forEach((tr) => {
        const txt = tr.textContent.toLowerCase();
        tr.style.display = !q || txt.includes(q) ? '' : 'none';
      });
    });
  }

  // Bind logout buttons
  async function doLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    window.location.href = '/login.html';
  }
  document.getElementById('sidebar-logout-btn')?.addEventListener('click', doLogout);
  document.getElementById('topbar-logout-btn')?.addEventListener('click', doLogout);
}

export async function initRolePage(expectedRole) {
  try {
    const { user } = await apiFetch('/api/auth/me');
    if (!user) {
      window.location.href = '/login.html';
      return null;
    }
    if (expectedRole && user.role !== expectedRole) {
      showToast(`Redirecting to your ${user.role} dashboard`, 'info');
      window.location.href = `/pages/${user.role}/dashboard.html`;
      return null;
    }
    renderShell(user);
    refreshHeaderNotifications();
    setInterval(refreshHeaderNotifications, 20000);
    return user;
  } catch {
    window.location.href = '/login.html';
    return null;
  }
}
