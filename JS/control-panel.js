/* ============================================================
   CASEFLOW — CONTROL-PANEL.JS
   Attorney-only admin page: account list (now with Online dots),
   profile box (now with Online status + Role Switcher), per-user
   nav access control, activity log viewer, account lock/unlock,
   account deletion, and Pending Account Approvals with View modal.

   NEW: Role Switcher — Attorney can change any non-Attorney
   account's role to Head / IT / Employee. Attorney accounts are
   fully excluded from this (cannot be switched TO or FROM), and
   the box is hidden entirely when viewing your own account,
   mirroring the same self-protection pattern as Lock/Delete.

   HONEST LIMITATION (Online status): scoped to this browser's
   LocalStorage only — reflects activity recorded here, not true
   cross-device presence. See earlier notes when this was proposed.

   Depends on: storage.js, auth.js, modal.js, navigation.js
   ============================================================ */

let currentCpUser = null;
let cpSearchTerm = '';
let cpSelectedAccountId = null;
let cpActiveTab = 'access';
let cpViewingPendingUserId = null;
let _cpOnlineStatusInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  const session = requireAuth();
  if (!session) return;

  currentCpUser = getCurrentUser();

  if (currentCpUser.role !== 'attorney') {
    showToast('Access denied. Control Panel is restricted to Attorney accounts.', 'error');
    window.location.href = 'dashboard.html';
    return;
  }

  initLayout('control-panel');
  renderPendingApprovals();
  renderAccountList();
  attachControlPanelEvents();
  handlePendingNavTarget();

  // NEW: refresh online dots every 30s so status doesn't feel stale
  // while Atty is sitting on this page reviewing accounts.
  _cpOnlineStatusInterval = setInterval(() => {
    renderAccountList();
    if (cpSelectedAccountId) renderOnlineStatus(findUserById(cpSelectedAccountId));
  }, 30000);
});

/* ============================================================
   PENDING NAV TARGET (bell click-to-jump)
   ============================================================ */
function handlePendingNavTarget() {
  const target = consumePendingNavTarget();
  if (!target) return;

  const [type, id] = target.split(':');
  if (type === 'pending' && id) {
    const panel = document.getElementById('cpPendingPanel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    openViewPendingModal(id);
  }
}

/* ============================================================
   PENDING ACCOUNT APPROVALS
   ============================================================ */
function renderPendingApprovals() {
  const panel = document.getElementById('cpPendingPanel');
  const list = document.getElementById('cpPendingList');
  const countBadge = document.getElementById('cpPendingCountBadge');

  const pendingUsers = getPendingApprovalUsers();

  if (pendingUsers.length === 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  countBadge.textContent = pendingUsers.length;

  list.innerHTML = pendingUsers.map(u => `
    <div class="cp-pending-row" data-view-pending="${u.id}">
      <div class="cp-pending-avatar">${getCpInitials(u)}</div>
      <div class="cp-pending-info">
        <div class="pending-name">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)} <span class="text-muted">(@${escapeHtml(u.username)})</span></div>
        <div class="pending-meta">${getRoleLabel(u.role)} &middot; registered ${formatTimeAgo(u.createdAt)}</div>
      </div>
      <button class="btn-outline" data-view-pending-btn="${u.id}"><i class="fa-solid fa-eye"></i> View</button>
    </div>
  `).join('');
}

/* ============================================================
   VIEW PENDING ACCOUNT MODAL
   ============================================================ */
function openViewPendingModal(userId) {
  const user = findUserById(userId);
  if (!user) return;

  cpViewingPendingUserId = userId;

  document.getElementById('cpViewPendingUserId').value = userId;
  document.getElementById('cpViewPendingAvatar').textContent = getCpInitials(user);
  document.getElementById('cpViewPendingName').textContent = `${user.firstName} ${user.lastName}`;
  document.getElementById('cpViewPendingUsername').textContent = `@${user.username}`;
  document.getElementById('cpViewPendingEmail').textContent = user.email || '—';
  document.getElementById('cpViewPendingRole').textContent = getRoleLabel(user.role);
  document.getElementById('cpViewPendingRegistered').textContent = formatDateTime(user.createdAt);

  openModal('cpViewPendingModalOverlay');
}

function handleApprovePendingAccount(userId) {
  const user = findUserById(userId);
  if (!user) return;

  confirmDelete(
    `Approve ${user.firstName} ${user.lastName}'s account? They will be able to log in immediately.`,
    () => {
      const users = getUsers();
      const idx = users.findIndex(u => u.id === userId);
      if (idx === -1) return;

      users[idx].isApproved = true;
      users[idx].approvedBy = currentCpUser.id;
      users[idx].approvedAt = nowISO();
      saveUsers(users);

      createNotification(
        userId, 'account-approved', 'Account approved!',
        'Your account has been approved. You can now log in.'
      );

      if (typeof logActivity === 'function') {
        logActivity(currentCpUser.id, 'account-approval', `Approved account "${user.firstName} ${user.lastName}" (@${user.username}).`);
      }

      showToast('Account approved.', 'success');
      closeModal('cpViewPendingModalOverlay');
      renderPendingApprovals();
      renderAccountList();
    },
    'Approve Account',
    '<i class="fa-solid fa-check"></i> Approve',
    'fa-user-check'
  );
}

function handleRejectPendingAccount(userId) {
  const user = findUserById(userId);
  if (!user) return;

  confirmDelete(
    `Reject and permanently remove ${user.firstName} ${user.lastName}'s registration? This cannot be undone — they will need to register again if this was a mistake.`,
    () => {
      saveUsers(getUsers().filter(u => u.id !== userId));

      if (typeof logActivity === 'function') {
        logActivity(currentCpUser.id, 'account-approval', `Rejected registration for "${user.firstName} ${user.lastName}" (@${user.username}).`);
      }

      showToast('Registration rejected and removed.', 'success');
      closeModal('cpViewPendingModalOverlay');
      renderPendingApprovals();
      renderAccountList();
    },
    'Reject Registration',
    '<i class="fa-solid fa-xmark"></i> Reject',
    'fa-xmark'
  );
}

/* ============================================================
   ACCOUNT LIST (now shows an Online/last-seen dot per row)
   ============================================================ */
function getFilteredAccounts() {
  let accounts = getUsers().filter(u => isAccountApproved(u));

  if (cpSearchTerm.trim()) {
    const q = cpSearchTerm.trim().toLowerCase();
    accounts = accounts.filter(u =>
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  }

  return accounts.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
}

function getCpInitials(user) {
  return ((user.firstName || '').charAt(0) + (user.lastName || '').charAt(0)).toUpperCase() || 'U';
}

function renderAccountList() {
  const accounts = getFilteredAccounts();
  const container = document.getElementById('cpAccountItems');

  if (accounts.length === 0) {
    container.innerHTML = `<div class="cp-activity-empty" style="padding:30px 16px;"><p>No accounts found.</p></div>`;
    return;
  }

  container.innerHTML = accounts.map(u => {
    const isActive = u.id === cpSelectedAccountId;
    const isLocked = !!u.isLocked;
    const online = isUserOnline(u);

    return `
      <div class="cp-account-item ${isActive ? 'active' : ''}" data-select-account="${u.id}">
        <div class="cp-account-avatar-wrap">
          <div class="cp-account-avatar ${isLocked ? 'locked' : ''}">${getCpInitials(u)}</div>
          <span class="cp-online-dot-sm ${online ? 'online' : ''}" title="${escapeHtml(getLastActiveLabel(u))}"></span>
        </div>
        <div class="cp-account-info">
          <div class="cp-account-name">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</div>
          <div class="cp-account-role">${getRoleLabel(u.role)}</div>
        </div>
        ${isLocked ? '<i class="fa-solid fa-lock cp-lock-indicator" title="Locked"></i>' : ''}
      </div>
    `;
  }).join('');
}

/* ============================================================
   ACCOUNT DETAIL — PROFILE BOX
   ============================================================ */
function selectAccount(userId) {
  cpSelectedAccountId = userId;
  cpActiveTab = 'access';

  renderAccountList();
  renderAccountDetail(userId);

  document.getElementById('cpEmptyState').style.display = 'none';
  document.getElementById('cpDetailContent').style.display = 'block';
}

function renderOnlineStatus(user) {
  if (!user) return;
  const online = isUserOnline(user);

  const dot = document.getElementById('cpOnlineDot');
  dot.classList.toggle('online', online);
  dot.title = getLastActiveLabel(user);

  const label = document.getElementById('cpOnlineLabel');
  label.textContent = getLastActiveLabel(user);
  label.classList.toggle('online', online);
}

/**
 * Role Switcher visibility rule: hidden entirely for Attorney
 * accounts (whether it's Atty's own account, or — since only
 * Attorney accounts exist with role 'attorney' — any other
 * Attorney). This is the "cannot switch TO or FROM Attorney"
 * requirement enforced at the UI level, not just validation.
 */
function renderRoleSwitcher(user) {
  const box = document.getElementById('cpRoleSwitchBox');

  if (user.role === 'attorney') {
    box.style.display = 'none';
    return;
  }

  box.style.display = 'block';
  document.getElementById('cpRoleSelect').value = user.role;
}

function renderAccountDetail(userId) {
  const user = findUserById(userId);
  if (!user) return;

  const isSelf = user.id === currentCpUser.id;
  const isLocked = !!user.isLocked;

  document.getElementById('cpProfileAvatar').textContent = getCpInitials(user);
  document.getElementById('cpProfileName').textContent = `${user.firstName} ${user.lastName}`;
  document.getElementById('cpProfileUsername').textContent = `@${user.username}`;

  const roleBadge = document.getElementById('cpProfileRoleBadge');
  roleBadge.textContent = getRoleLabel(user.role);
  roleBadge.className = 'badge badge-active';

  const statusBadge = document.getElementById('cpProfileStatusBadge');
  statusBadge.textContent = isLocked ? 'Locked' : 'Active';
  statusBadge.className = `badge ${isLocked ? 'badge-cancelled' : 'badge-completed'}`;

  document.getElementById('cpProfileEmail').textContent = user.email || '—';
  document.getElementById('cpProfileJoined').textContent = formatDateTime(user.createdAt);

  renderOnlineStatus(user);
  renderRoleSwitcher(user);

  const lockBtn = document.getElementById('cpLockToggleBtn');
  const deleteBtn = document.getElementById('cpDeleteAccountBtn');

  if (isSelf) {
    lockBtn.style.display = 'none';
    deleteBtn.style.display = 'none';
  } else {
    lockBtn.style.display = 'inline-flex';
    deleteBtn.style.display = 'inline-flex';
    lockBtn.classList.toggle('is-locked', isLocked);
    lockBtn.innerHTML = isLocked
      ? '<i class="fa-solid fa-lock-open"></i> Unlock Account'
      : '<i class="fa-solid fa-lock"></i> Lock Account';
  }

  renderAccessChecklist(user);
  renderActivityLog(user);
  switchCpTab(cpActiveTab);
}

/* ============================================================
   ROLE SWITCHER (NEW)
   ============================================================ */
function handleSaveRole() {
  if (!cpSelectedAccountId) return;

  const user = findUserById(cpSelectedAccountId);
  if (!user) return;

  // Safety guard: never allow switching an Attorney account's role,
  // and never allow switching TO 'attorney' (the dropdown itself has
  // no Attorney option, but this double-checks against tampering).
  if (user.role === 'attorney') {
    showToast('Attorney accounts cannot have their role changed.', 'error');
    return;
  }

  const newRole = document.getElementById('cpRoleSelect').value;
  if (newRole === 'attorney') {
    showToast('Accounts cannot be changed to Attorney.', 'error');
    return;
  }

  if (newRole === user.role) {
    showToast('This account already has that role.', 'info');
    return;
  }

  const oldRoleLabel = getRoleLabel(user.role);
  const newRoleLabel = getRoleLabel(newRole);

  confirmDelete(
    `Change ${user.firstName} ${user.lastName}'s role from ${oldRoleLabel} to ${newRoleLabel}? Their sidebar and available features will update on their next page load.`,
    () => {
      const users = getUsers();
      const idx = users.findIndex(u => u.id === user.id);
      if (idx === -1) return;

      users[idx].role = newRole;
      saveUsers(users);

      createNotification(
        user.id, 'account-role-changed', 'Your role was updated',
        `Your account role was changed from ${oldRoleLabel} to ${newRoleLabel}.`
      );

      if (typeof logActivity === 'function') {
        logActivity(currentCpUser.id, 'account-approval', `Changed role for "${user.firstName} ${user.lastName}" from ${oldRoleLabel} to ${newRoleLabel}.`);
      }

      showToast(`Role updated to ${newRoleLabel}.`, 'success');
      renderAccountList();
      renderAccountDetail(user.id);
    },
    'Change Role',
    '<i class="fa-solid fa-user-gear"></i> Change Role',
    'fa-user-gear'
  );
}

/* ============================================================
   ACCESS CONTROL CHECKLIST
   ============================================================ */
const CP_ACCESS_NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high' },
  { key: 'clients',   label: 'Clients',   icon: 'fa-users' },
  { key: 'calendar',  label: 'Calendar',  icon: 'fa-calendar-days' },
  { key: 'chat',      label: 'Chat',      icon: 'fa-comments' },
  { key: 'analytics', label: 'Analytics', icon: 'fa-chart-pie' }
];

function renderAccessChecklist(user) {
  const override = getAccessOverrideForUser(user.id);
  const allowedKeys = override ? override.allowedNavKeys : CP_ACCESS_NAV_ITEMS.map(i => i.key);

  const container = document.getElementById('cpAccessChecklist');
  container.innerHTML = CP_ACCESS_NAV_ITEMS.map(item => {
    const isChecked = allowedKeys.includes(item.key);
    return `
      <div class="cp-access-item ${isChecked ? 'checked' : ''}" data-access-item="${item.key}">
        <input type="checkbox" id="cpAccess_${item.key}" value="${item.key}" ${isChecked ? 'checked' : ''}>
        <i class="fa-solid ${item.icon}"></i>
        <label for="cpAccess_${item.key}">${item.label}</label>
      </div>
    `;
  }).join('');
}

function handleSaveAccessSettings() {
  if (!cpSelectedAccountId) return;

  const checked = Array.from(document.querySelectorAll('#cpAccessChecklist input[type="checkbox"]:checked')).map(cb => cb.value);

  if (checked.length === 0) {
    showToast('An account must have access to at least one page.', 'error');
    return;
  }

  setAccessOverrideForUser(cpSelectedAccountId, checked);
  showToast('Access settings saved. Changes apply on their next page load.', 'success');
}

function handleResetAccessToDefault() {
  if (!cpSelectedAccountId) return;

  confirmDelete(
    'Reset this account to default access (all pages visible)? This removes any custom restrictions.',
    () => {
      clearAccessOverrideForUser(cpSelectedAccountId);
      renderAccessChecklist(findUserById(cpSelectedAccountId));
      showToast('Access reset to default.', 'success');
    },
    'Reset Access',
    '<i class="fa-solid fa-rotate-left"></i> Reset',
    'fa-rotate-left'
  );
}

/* ============================================================
   ACTIVITY LOG
   ============================================================ */
const CP_ACTIVITY_ICONS = {
  'login': 'fa-right-to-bracket',
  'logout': 'fa-right-from-bracket',
  'case-add': 'fa-folder-plus',
  'case-edit': 'fa-pen',
  'lbc-add': 'fa-truck-fast',
  'lbc-edit': 'fa-pen',
  'bill-add': 'fa-file-invoice-dollar',
  'bill-edit': 'fa-pen',
  'task-action': 'fa-list-check',
  'doc-upload': 'fa-upload',
  'chat-message': 'fa-comment',
  'account-approval': 'fa-user-shield'
};

function renderActivityLog(user) {
  const entries = getActivityLogForUser(user.id);
  const container = document.getElementById('cpActivityList');

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="cp-activity-empty">
        <i class="fa-solid fa-clock-rotate-left"></i>
        <p>No recorded activity for this account yet.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = entries.map(a => `
    <div class="cp-activity-item">
      <div class="cp-activity-icon"><i class="fa-solid ${CP_ACTIVITY_ICONS[a.action] || 'fa-circle-info'}"></i></div>
      <div class="cp-activity-content">
        <div class="cp-activity-desc">${escapeHtml(a.description)}</div>
        <div class="cp-activity-time">${formatDateTime(a.createdAt)}</div>
      </div>
    </div>
  `).join('');
}

/* ============================================================
   TABS
   ============================================================ */
function switchCpTab(tabKey) {
  cpActiveTab = tabKey;

  document.querySelectorAll('.cp-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cpTab === tabKey);
  });

  document.getElementById('cpTabAccess').style.display = tabKey === 'access' ? 'block' : 'none';
  document.getElementById('cpTabActivity').style.display = tabKey === 'activity' ? 'block' : 'none';
}

/* ============================================================
   LOCK / UNLOCK ACCOUNT
   ============================================================ */
function handleToggleLock() {
  const user = findUserById(cpSelectedAccountId);
  if (!user || user.id === currentCpUser.id) return;

  const willLock = !user.isLocked;

  confirmDelete(
    willLock
      ? `Lock ${user.firstName} ${user.lastName}'s account? They will not be able to log in until you unlock it.`
      : `Unlock ${user.firstName} ${user.lastName}'s account? They will be able to log in again.`,
    () => {
      const users = getUsers();
      const idx = users.findIndex(u => u.id === user.id);
      if (idx === -1) return;

      users[idx].isLocked = willLock;
      saveUsers(users);

      if (willLock) {
        createNotification(
          user.id, 'account-locked', 'Account locked',
          'Your account has been locked by the firm administrator.'
        );
      }

      showToast(`Account ${willLock ? 'locked' : 'unlocked'}.`, 'success');
      renderAccountList();
      renderAccountDetail(user.id);
    },
    willLock ? 'Lock Account' : 'Unlock Account',
    `<i class="fa-solid fa-lock${willLock ? '' : '-open'}"></i> ${willLock ? 'Lock' : 'Unlock'}`,
    willLock ? 'fa-lock' : 'fa-lock-open'
  );
}

/* ============================================================
   DELETE ACCOUNT
   ============================================================ */
function handleDeleteAccount() {
  const user = findUserById(cpSelectedAccountId);
  if (!user || user.id === currentCpUser.id) return;

  confirmDelete(
    `Permanently delete ${user.firstName} ${user.lastName}'s account? This cannot be undone. Their existing cases, documents, and other records will remain in the system but will no longer be linked to a valid user account.`,
    () => {
      saveUsers(getUsers().filter(u => u.id !== user.id));
      clearAccessOverrideForUser(user.id);

      cpSelectedAccountId = null;
      document.getElementById('cpDetailContent').style.display = 'none';
      document.getElementById('cpEmptyState').style.display = 'flex';

      renderAccountList();
      showToast('Account deleted.', 'success');
    },
    'Delete Account',
    '<i class="fa-solid fa-trash"></i> Delete Account'
  );
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function attachControlPanelEvents() {
  document.getElementById('cpAccountSearchInput').addEventListener('input', (e) => {
    cpSearchTerm = e.target.value;
    renderAccountList();
  });

  document.getElementById('cpAccountItems').addEventListener('click', (e) => {
    const item = e.target.closest('[data-select-account]');
    if (item) selectAccount(item.dataset.selectAccount);
  });

  document.querySelectorAll('.cp-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchCpTab(btn.dataset.cpTab));
  });

  document.getElementById('cpAccessChecklist').addEventListener('change', (e) => {
    const row = e.target.closest('.cp-access-item');
    if (row) row.classList.toggle('checked', e.target.checked);
  });

  document.getElementById('cpSaveAccessBtn').addEventListener('click', handleSaveAccessSettings);
  document.getElementById('cpResetAccessBtn').addEventListener('click', handleResetAccessToDefault);

  document.getElementById('cpLockToggleBtn').addEventListener('click', handleToggleLock);
  document.getElementById('cpDeleteAccountBtn').addEventListener('click', handleDeleteAccount);

  // NEW: Role Switcher
  document.getElementById('cpSaveRoleBtn').addEventListener('click', handleSaveRole);

  document.getElementById('cpPendingList').addEventListener('click', (e) => {
    const viewBtn = e.target.closest('[data-view-pending-btn]');
    const row = e.target.closest('[data-view-pending]');

    if (viewBtn) {
      openViewPendingModal(viewBtn.dataset.viewPendingBtn);
    } else if (row) {
      openViewPendingModal(row.dataset.viewPending);
    }
  });

  document.getElementById('cpCloseViewPendingModal').addEventListener('click', () => closeModal('cpViewPendingModalOverlay'));
  enableClickOutsideClose('cpViewPendingModalOverlay');

  document.getElementById('cpViewPendingApproveBtn').addEventListener('click', () => {
    if (cpViewingPendingUserId) handleApprovePendingAccount(cpViewingPendingUserId);
  });

  document.getElementById('cpViewPendingRejectBtn').addEventListener('click', () => {
    if (cpViewingPendingUserId) handleRejectPendingAccount(cpViewingPendingUserId);
  });
}

/* ============================================================
   LOCAL HELPERS
   ============================================================ */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}