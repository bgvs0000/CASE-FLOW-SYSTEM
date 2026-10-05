/* ============================================================
   CASEFLOW — NAVIGATION.JS
   Dynamically injects the sidebar + top navigation into every
   protected page, filters menu items by PER-USER access control
   (falls back to role defaults), highlights the active page,
   wires up logout + mobile toggle, notification bell + sound,
   the unread-count badge on "Chat", and a heartbeat that updates
   user.lastActiveAt every ~60s for the Control Panel's Online /
   "last seen" indicator.

   Depends on: storage.js, auth.js, modal.js (loaded before this)
   Every protected page must call initLayout('pageKey') on load,
   AFTER requireAuth() has confirmed a valid session.
   ============================================================ */

/* ---------- NAV CONFIG ---------- */
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high', href: 'dashboard.html', inTopNav: true },
  { key: 'clients',   label: 'Clients',   icon: 'fa-users',      href: 'clients.html',   inTopNav: false },
  { key: 'calendar',  label: 'Calendar',  icon: 'fa-calendar-days', href: 'calendar.html', inTopNav: true },
  { key: 'chat',      label: 'Chat',      icon: 'fa-comments',   href: 'chat.html',      inTopNav: true },
  { key: 'analytics', label: 'Analytics', icon: 'fa-chart-pie',  href: 'analytics.html', inTopNav: true }
];

const CONTROL_PANEL_ITEM = { key: 'control-panel', label: 'Control Panel', icon: 'fa-user-shield', href: 'control-panel.html', inTopNav: false };

function getVisibleNavItemsForUser(user) {
  const override = getAccessOverrideForUser(user.id);
  let items;

  if (override && Array.isArray(override.allowedNavKeys)) {
    items = NAV_ITEMS.filter(item => override.allowedNavKeys.includes(item.key));
  } else {
    items = NAV_ITEMS;
  }

  if (user.role === 'attorney') {
    items = [...items, CONTROL_PANEL_ITEM];
  }

  return items;
}

/* ---------- INITIALS / ROLE LABEL HELPERS ---------- */
function getUserInitials(user) {
  const f = (user.firstName || '').charAt(0);
  const l = (user.lastName || '').charAt(0);
  return (f + l).toUpperCase() || 'U';
}

function getRoleLabel(role) {
  const labels = { attorney: 'Attorney', head: 'Head', it: 'IT Staff', employee: 'Employee' };
  return labels[role] || role;
}

/* ============================================================
   CHAT UNREAD COUNT
   ============================================================ */
function getTotalChatUnreadCount(userId) {
  const messages = (typeof getMessages === 'function') ? getMessages() : [];
  const groups = (typeof getGroups === 'function') ? getGroups() : [];
  const myGroupIds = groups.filter(g => g.memberIds.includes(userId)).map(g => g.id);

  const unreadDirect = messages.filter(m => m.receiverId === userId && !m.read).length;
  const unreadGroup = messages.filter(m =>
    m.groupId && myGroupIds.includes(m.groupId) &&
    m.senderId !== userId &&
    !(m.readBy || []).includes(userId)
  ).length;

  return unreadDirect + unreadGroup;
}

/* ---------- BUILD SIDEBAR HTML ---------- */
function buildSidebarHtml(user, activeKey) {
  const items = getVisibleNavItemsForUser(user);
  const chatUnread = getTotalChatUnreadCount(user.id);

  const linksHtml = items.map(item => {
    const badge = (item.key === 'chat' && chatUnread > 0)
      ? `<span class="nav-item-badge" data-nav-badge="chat">${chatUnread > 99 ? '99+' : chatUnread}</span>`
      : '';
    return `
      <a href="${item.href}" class="${item.key === activeKey ? 'active' : ''}" data-nav-key="${item.key}">
        <i class="fa-solid ${item.icon}"></i>
        <span>${item.label}</span>
        ${badge}
      </a>
    `;
  }).join('');

  return `
    <aside class="sidebar" id="appSidebar">
      <button class="sidebar-close-btn" id="sidebarCloseBtn"><i class="fa-solid fa-xmark"></i></button>

      <div class="sidebar-header">
                <img src="IMG/logo.jpg" alt="CaseFlow" class="sidebar-logo" style="background:none;box-shadow:none;padding:0;object-fit:contain;display:block;">
        <h2>CaseFlow<span>Legal Case Management</span></h2>
      </div>

      <div class="sidebar-profile">
        <div class="sidebar-profile-pic">${getUserInitials(user)}</div>
        <div class="sidebar-profile-info">
          <div class="profile-name">${user.firstName} ${user.lastName}</div>
          <div class="profile-role">${getRoleLabel(user.role)}</div>
        </div>
      </div>

      <nav class="sidebar-nav">
        ${linksHtml}
      </nav>

      <div class="sidebar-footer">
        <button id="sidebarLogoutBtn">
          <i class="fa-solid fa-right-from-bracket"></i>
          <span>Logout</span>
        </button>
      </div>
    </aside>
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
  `;
}

/* ---------- BUILD TOP NAV HTML ---------- */
function buildTopNavHtml(user, activeKey, pageTitleText, pageTitleIcon) {
  const items = getVisibleNavItemsForUser(user).filter(i => i.inTopNav);
  const chatUnread = getTotalChatUnreadCount(user.id);

  const linksHtml = items.map(item => {
    const badge = (item.key === 'chat' && chatUnread > 0)
      ? `<span class="nav-item-badge nav-item-badge-top" data-nav-badge="chat-top">${chatUnread > 99 ? '99+' : chatUnread}</span>`
      : '';
    return `
      <a href="${item.href}" class="${item.key === activeKey ? 'active' : ''}" data-nav-key="${item.key}" style="position:relative;">
        <i class="fa-solid ${item.icon}"></i>
        <span class="link-label">${item.label}</span>
        ${badge}
      </a>
    `;
  }).join('');

  const soundOn = isNotifSoundEnabled();

  return `
    <header class="topnav" id="appTopnav">
      <div class="topnav-left">
        <button class="sidebar-toggle-btn" id="sidebarToggleBtn">
          <i class="fa-solid fa-bars"></i>
        </button>
        <div class="topnav-title">
          <i class="fa-solid ${pageTitleIcon || 'fa-gauge-high'}"></i> ${pageTitleText || ''}
        </div>
      </div>

      <nav class="topnav-links">
        ${linksHtml}
      </nav>

      <div class="topnav-right">
        <button class="notif-sound-toggle-btn" id="notifSoundToggleBtn" title="${soundOn ? 'Mute notification sound' : 'Unmute notification sound'}">
          <i class="fa-solid ${soundOn ? 'fa-volume-high' : 'fa-volume-xmark'}"></i>
        </button>

        <div class="notif-bell-wrap">
          <button class="notif-bell-trigger" id="notifBellTrigger" title="Notifications">
            <i class="fa-solid fa-bell"></i>
            <span class="notif-badge" id="notifBadge" style="display:none;">0</span>
          </button>

          <div class="notif-dropdown" id="notifDropdown">
            <div class="notif-dropdown-header">
              <h4>Notifications</h4>
              <button id="markAllReadBtn">Mark all read</button>
            </div>
            <div class="notif-dropdown-list" id="notifDropdownList">
              <!-- Injected by navigation.js -->
            </div>
          </div>
        </div>

        <button class="ai-fab-trigger" id="aiAssistantTrigger" title="AI Assistant">
          <i class="fa-solid fa-robot"></i>
        </button>
      </div>
    </header>
  `;
}

/* ---------- MAIN INIT FUNCTION ---------- */
function initLayout(activeKey) {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  if (user.isLocked) {
    clearSession();
    window.location.href = 'index.html';
    return;
  }

  const visibleItems = getVisibleNavItemsForUser(user);
  const stillAllowed = visibleItems.some(i => i.key === activeKey);
  if (!stillAllowed && visibleItems.length > 0) {
    window.location.href = visibleItems[0].href;
    return;
  }

  const allItemsForTitle = [...NAV_ITEMS, CONTROL_PANEL_ITEM];
  const activeItem = allItemsForTitle.find(i => i.key === activeKey);
  const pageTitleText = activeItem ? activeItem.label : '';
  const pageTitleIcon = activeItem ? activeItem.icon : '';

  const sidebarMount = document.getElementById('sidebarMount');
  const topnavMount = document.getElementById('topnavMount');

  if (sidebarMount) sidebarMount.outerHTML = buildSidebarHtml(user, activeKey);
  if (topnavMount) topnavMount.outerHTML = buildTopNavHtml(user, activeKey, pageTitleText, pageTitleIcon);

  attachLayoutEvents();
  injectConfirmModal();

  if (typeof injectAiAssistantPanel === 'function') {
    injectAiAssistantPanel();
  }

  _lastKnownUnreadCount = getUnreadNotificationCount(user.id);

  renderNotifDropdown(user.id);
  updateNotifBadge(user.id);
  startNotifPolling(user.id);
  startChatBadgePolling(user.id);

  touchUserHeartbeat(user.id);
  startHeartbeat(user.id);
}

/* ============================================================
   HEARTBEAT
   ============================================================ */
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
let _heartbeatInterval = null;

function startHeartbeat(userId) {
  if (_heartbeatInterval) clearInterval(_heartbeatInterval);
  _heartbeatInterval = setInterval(() => {
    touchUserHeartbeat(userId);
  }, HEARTBEAT_INTERVAL_MS);
}

/* ---------- EVENTS ---------- */
function attachLayoutEvents() {
  const logoutBtn = document.getElementById('sidebarLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      confirmDelete(
        'Are you sure you want to logout?',
        () => logoutUser(),
        'Logout',
        '<i class="fa-solid fa-right-from-bracket"></i> Logout',
        'fa-right-from-bracket'
      );
    });
  }

  const toggleBtn = document.getElementById('sidebarToggleBtn');
  const closeBtn = document.getElementById('sidebarCloseBtn');
  const sidebar = document.getElementById('appSidebar');
  const overlay = document.getElementById('sidebarOverlay');

  function openSidebar() { sidebar.classList.add('open'); overlay.classList.add('active'); }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('active'); }

  if (toggleBtn) toggleBtn.addEventListener('click', openSidebar);
  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);

  const aiTrigger = document.getElementById('aiAssistantTrigger');
  if (aiTrigger) {
    aiTrigger.addEventListener('click', () => {
      if (typeof toggleAiAssistantPanel === 'function') {
        toggleAiAssistantPanel();
      } else {
        showToast('AI Assistant coming soon.', 'info');
      }
    });
  }

  const soundToggleBtn = document.getElementById('notifSoundToggleBtn');
  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
      const newState = !isNotifSoundEnabled();
      setNotifSoundEnabled(newState);

      const icon = soundToggleBtn.querySelector('i');
      icon.className = `fa-solid ${newState ? 'fa-volume-high' : 'fa-volume-xmark'}`;
      soundToggleBtn.title = newState ? 'Mute notification sound' : 'Unmute notification sound';

      if (newState) playNotifSound();
    });
  }

  const bellTrigger = document.getElementById('notifBellTrigger');
  const dropdown = document.getElementById('notifDropdown');

  bellTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (dropdown.classList.contains('open') && !dropdown.contains(e.target) && e.target !== bellTrigger) {
      dropdown.classList.remove('open');
    }
  });

  document.getElementById('markAllReadBtn').addEventListener('click', () => {
    const user = getCurrentUser();
    if (!user) return;
    markAllNotificationsRead(user.id);
    renderNotifDropdown(user.id);
    updateNotifBadge(user.id);
  });

  document.getElementById('notifDropdownList').addEventListener('click', (e) => {
    const item = e.target.closest('[data-notif-id]');
    if (!item) return;

    const notifId = item.dataset.notifId;
    const page = item.dataset.link;
    const targetId = item.dataset.target;

    markNotificationRead(notifId);

    const user = getCurrentUser();
    if (user) {
      renderNotifDropdown(user.id);
      updateNotifBadge(user.id);
    }

    if (page) {
      if (targetId) setPendingNavTarget(targetId);
      if (window.location.pathname.endsWith(page)) {
        dropdown.classList.remove('open');
        if (typeof handlePendingNavTarget === 'function') handlePendingNavTarget();
      } else {
        window.location.href = page;
      }
    }
  });
}

/* ============================================================
   CHAT NAV BADGE POLLING
   ============================================================ */
let _chatBadgePollInterval = null;

function updateChatNavBadges(userId) {
  const count = getTotalChatUnreadCount(userId);
  const displayValue = count > 99 ? '99+' : String(count);

  document.querySelectorAll('[data-nav-key="chat"]').forEach(link => {
    let badge = link.querySelector('.nav-item-badge');

    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = link.closest('.topnav-links') ? 'nav-item-badge nav-item-badge-top' : 'nav-item-badge';
        link.appendChild(badge);
      }
      badge.textContent = displayValue;
    } else if (badge) {
      badge.remove();
    }
  });
}

function startChatBadgePolling(userId) {
  if (_chatBadgePollInterval) clearInterval(_chatBadgePollInterval);
  _chatBadgePollInterval = setInterval(() => {
    updateChatNavBadges(userId);
  }, 4000);
}

/* ============================================================
   NOTIFICATION SOUND
   ============================================================ */
const NOTIF_SOUND_PREF_KEY = 'caseflow_notif_sound_enabled';

function isNotifSoundEnabled() {
  const stored = localStorage.getItem(NOTIF_SOUND_PREF_KEY);
  return stored === null ? true : stored === 'true';
}

function setNotifSoundEnabled(enabled) {
  localStorage.setItem(NOTIF_SOUND_PREF_KEY, enabled ? 'true' : 'false');
}

let _audioCtx = null;

function playNotifSound() {
  if (!isNotifSoundEnabled()) return;

  try {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_audioCtx.state === 'suspended') _audioCtx.resume();

    const now = _audioCtx.currentTime;
    playTone(_audioCtx, 740, now, 0.22);
  } catch (err) {
    console.warn('[navigation.js] Notification sound failed to play:', err);
  }
}

function playTone(ctx, frequency, startTime, duration) {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(0.18, startTime + 0.015);
  gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

/* ============================================================
   NOTIFICATION DROPDOWN RENDERING
   ============================================================ */
const NOTIF_ICONS = {
  'task-assigned': 'fa-list-check',
  'task-submitted': 'fa-clipboard-check',
  'task-approved': 'fa-check-double',
  'task-redo': 'fa-rotate-left',
  'task-rejected': 'fa-xmark',
  'chat-message': 'fa-comment',
  'group-message': 'fa-comments',
  'group-added': 'fa-users',
  'daily-log-submitted': 'fa-clipboard-list',
  'account-locked': 'fa-lock',
  'account-pending-approval': 'fa-user-clock',
  'account-approved': 'fa-user-check',
  'account-role-changed': 'fa-user-gear',
  'bill-due': 'fa-file-invoice-dollar',
  'case-added': 'fa-folder-plus',
  'shipment-added': 'fa-truck-fast',
  'bill-added': 'fa-file-invoice-dollar'
};

function renderNotifDropdown(userId) {
  const list = document.getElementById('notifDropdownList');
  if (!list) return;

  const notifications = getNotificationsForUser(userId).slice(0, 25);

  if (notifications.length === 0) {
    list.innerHTML = `<div class="notif-empty"><i class="fa-solid fa-bell-slash"></i><p>No notifications yet.</p></div>`;
    return;
  }

  list.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.isRead ? '' : 'unread'}" data-notif-id="${n.id}"
         ${n.link ? `data-link="${n.link.page}" data-target="${n.link.targetId || ''}"` : ''}>
      <div class="notif-item-icon"><i class="fa-solid ${NOTIF_ICONS[n.type] || 'fa-bell'}"></i></div>
      <div class="notif-item-body">
        <div class="notif-item-title">${escapeHtmlNav(n.title)}</div>
        <div class="notif-item-message">${escapeHtmlNav(n.message)}</div>
        <div class="notif-item-time">${formatTimeAgo(n.createdAt)}</div>
      </div>
      ${!n.isRead ? '<div class="notif-item-dot"></div>' : ''}
    </div>
  `).join('');
}

function updateNotifBadge(userId) {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;

  const count = getUnreadNotificationCount(userId);
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

/* ============================================================
   POLLING
   ============================================================ */
let _notifPollInterval = null;
let _lastKnownUnreadCount = 0;

function startNotifPolling(userId) {
  if (_notifPollInterval) clearInterval(_notifPollInterval);

  _notifPollInterval = setInterval(() => {
    const currentCount = getUnreadNotificationCount(userId);

    if (currentCount > _lastKnownUnreadCount) {
      playNotifSound();
    }
    _lastKnownUnreadCount = currentCount;

    updateNotifBadge(userId);
    const dropdown = document.getElementById('notifDropdown');
    if (dropdown && dropdown.classList.contains('open')) {
      renderNotifDropdown(userId);
    }
  }, 4000);
}

function escapeHtmlNav(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}