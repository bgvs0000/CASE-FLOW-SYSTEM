/* ============================================================
   CASEFLOW — CHAT.JS
   1-on-1 + Group messaging. Renders a combined list (Groups
   section on top, then all other users), unread dot per
   conversation, message bubbles (sender name shown in groups),
   Create Group + Add Members, fires notifications via
   createNotification()/createNotificationForMany(), and (NEW)
   logs activity (message sent, group created) to the Control
   Panel Activity Log.

   NAV TARGET FORMAT: "user:<userId>" or "group:<groupId>" —
   used by the notification bell's click-to-jump.

   Depends on: storage.js, auth.js, modal.js, navigation.js
   ============================================================ */

let currentChatUser = null;
let currentConversation = null;
let chatUserSearchTerm = '';
let _chatPollInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  const session = requireAuth();
  if (!session) return;

  currentChatUser = getCurrentUser();
  initLayout('chat');

  renderChatList();
  attachChatEvents();
  handlePendingNavTarget();

  _chatPollInterval = setInterval(() => {
    renderChatList();
    if (currentConversation) renderConversationMessages();
  }, 4000);
});

/* ============================================================
   PENDING NAV TARGET (bell click-to-jump)
   ============================================================ */
function handlePendingNavTarget() {
  const target = consumePendingNavTarget();
  if (!target) return;

  const [type, id] = target.split(':');
  if (type === 'user' && id) {
    openConversation('user', id);
  } else if (type === 'group' && id) {
    openConversation('group', id);
  }
}

/* ============================================================
   RENDER LEFT PANEL: GROUPS + USERS
   ============================================================ */
function getMyGroups() {
  return getGroups().filter(g => g.memberIds.includes(currentChatUser.id));
}

function getOtherUsers() {
  return getUsers().filter(u => u.id !== currentChatUser.id);
}

function getLastMessagePreview(type, id) {
  const messages = getMessages();
  let relevant;

  if (type === 'user') {
    relevant = messages.filter(m =>
      (m.senderId === currentChatUser.id && m.receiverId === id) ||
      (m.senderId === id && m.receiverId === currentChatUser.id)
    );
  } else {
    relevant = messages.filter(m => m.groupId === id);
  }

  if (relevant.length === 0) return null;
  relevant.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return relevant[0];
}

function hasUnread(type, id) {
  const messages = getMessages();

  if (type === 'user') {
    return messages.some(m => m.senderId === id && m.receiverId === currentChatUser.id && !m.read);
  } else {
    return messages.some(m => m.groupId === id && m.senderId !== currentChatUser.id && !(m.readBy || []).includes(currentChatUser.id));
  }
}

function renderChatList() {
  const container = document.getElementById('chatUserListItems');
  const q = chatUserSearchTerm.trim().toLowerCase();

  const groups = getMyGroups().filter(g => !q || g.name.toLowerCase().includes(q));
  const users = getOtherUsers().filter(u => !q || `${u.firstName} ${u.lastName}`.toLowerCase().includes(q));

  let html = '';

  if (groups.length > 0) {
    html += `<div class="chat-list-section-label">Groups</div>`;
    html += groups.map(g => {
      const lastMsg = getLastMessagePreview('group', g.id);
      const preview = lastMsg ? truncateText(lastMsg.text, 30) : 'No messages yet';
      const isActive = currentConversation && currentConversation.type === 'group' && currentConversation.id === g.id;
      const unread = hasUnread('group', g.id);

      return `
        <div class="chat-user-item ${isActive ? 'active' : ''}" data-open-conv="group:${g.id}">
          <div class="chat-user-avatar group-avatar"><i class="fa-solid fa-users"></i></div>
          <div class="chat-user-info">
            <div class="chat-user-name">${escapeHtml(g.name)}</div>
            <div class="chat-user-preview">${escapeHtml(preview)}</div>
          </div>
          ${unread ? '<div class="chat-unread-dot"></div>' : ''}
        </div>
      `;
    }).join('');
  }

  if (users.length > 0) {
    html += `<div class="chat-list-section-label">People</div>`;
    html += users.map(u => {
      const lastMsg = getLastMessagePreview('user', u.id);
      const preview = lastMsg ? truncateText(lastMsg.text, 30) : 'No messages yet';
      const isActive = currentConversation && currentConversation.type === 'user' && currentConversation.id === u.id;
      const unread = hasUnread('user', u.id);

      return `
        <div class="chat-user-item ${isActive ? 'active' : ''}" data-open-conv="user:${u.id}">
          <div class="chat-user-avatar">${getInitials(u)}</div>
          <div class="chat-user-info">
            <div class="chat-user-name">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</div>
            <div class="chat-user-preview">${escapeHtml(preview)}</div>
          </div>
          ${unread ? '<div class="chat-unread-dot"></div>' : ''}
        </div>
      `;
    }).join('');
  }

  if (groups.length === 0 && users.length === 0) {
    html = `<div class="chat-no-users-msg">No results found.</div>`;
  }

  container.innerHTML = html;

  if (typeof updateNotifBadge === 'function') updateNotifBadge(currentChatUser.id);
}

function getInitials(user) {
  return ((user.firstName || '').charAt(0) + (user.lastName || '').charAt(0)).toUpperCase() || 'U';
}

function truncateText(text, maxLen) {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

/* ============================================================
   OPEN CONVERSATION
   ============================================================ */
function openConversation(type, id) {
  currentConversation = { type, id };

  document.getElementById('chatEmptyState').style.display = 'none';
  document.getElementById('chatActiveView').style.display = 'flex';

  const avatarEl = document.getElementById('chatConvAvatar');
  const nameEl = document.getElementById('chatConvName');
  const roleEl = document.getElementById('chatConvRole');
  const groupInfoBtn = document.getElementById('chatGroupInfoBtn');

  if (type === 'user') {
    const user = findUserById(id);
    if (!user) return;
    avatarEl.className = 'chat-conv-avatar';
    avatarEl.innerHTML = getInitials(user);
    nameEl.textContent = `${user.firstName} ${user.lastName}`;
    roleEl.textContent = getRoleLabel(user.role);
    groupInfoBtn.style.display = 'none';

    const messages = getMessages();
    let changed = false;
    messages.forEach(m => {
      if (m.senderId === id && m.receiverId === currentChatUser.id && !m.read) {
        m.read = true;
        changed = true;
      }
    });
    if (changed) saveMessages(messages);

  } else {
    const group = findGroupById(id);
    if (!group) return;
    avatarEl.className = 'chat-conv-avatar group-avatar';
    avatarEl.innerHTML = '<i class="fa-solid fa-users"></i>';
    nameEl.textContent = group.name;
    roleEl.textContent = `${group.memberIds.length} member${group.memberIds.length === 1 ? '' : 's'}`;
    groupInfoBtn.style.display = 'inline-flex';

    const messages = getMessages();
    let changed = false;
    messages.forEach(m => {
      if (m.groupId === id && m.senderId !== currentChatUser.id) {
        if (!m.readBy) m.readBy = [];
        if (!m.readBy.includes(currentChatUser.id)) {
          m.readBy.push(currentChatUser.id);
          changed = true;
        }
      }
    });
    if (changed) saveMessages(messages);
  }

  renderConversationMessages();
  renderChatList();
  updateNotifBadge(currentChatUser.id);

  document.getElementById('chatUserListPanel').classList.add('hidden-mobile');
}

/* ============================================================
   RENDER MESSAGES
   ============================================================ */
function renderConversationMessages() {
  if (!currentConversation) return;

  const container = document.getElementById('chatMessagesContainer');
  let messages = getMessages();

  if (currentConversation.type === 'user') {
    messages = messages.filter(m =>
      (m.senderId === currentChatUser.id && m.receiverId === currentConversation.id) ||
      (m.senderId === currentConversation.id && m.receiverId === currentChatUser.id)
    );
  } else {
    messages = messages.filter(m => m.groupId === currentConversation.id);
  }

  messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (messages.length === 0) {
    container.innerHTML = `<p class="text-muted" style="text-align:center; margin-top:30px;">No messages yet. Say hello!</p>`;
    return;
  }

  let html = '';
  let lastDateLabel = null;

  messages.forEach(m => {
    const dateLabel = formatDate(m.createdAt);
    if (dateLabel !== lastDateLabel) {
      html += `<div class="chat-date-divider">${dateLabel}</div>`;
      lastDateLabel = dateLabel;
    }

    const isSent = m.senderId === currentChatUser.id;
    const sender = findUserById(m.senderId);
    const senderName = sender ? `${sender.firstName} ${sender.lastName}` : 'Unknown';

    html += `
      <div class="chat-bubble-row ${isSent ? 'sent' : 'received'}">
        ${(currentConversation.type === 'group' && !isSent) ? `<div class="chat-bubble-sender-name">${escapeHtml(senderName)}</div>` : ''}
        <div class="chat-bubble">
          ${escapeHtml(m.text)}
          <span class="chat-bubble-time">${formatDateTime(m.createdAt).split(', ').slice(-1)[0]}</span>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

/* ============================================================
   SEND MESSAGE — fires notifications + logs activity
   ============================================================ */
function handleSendMessage(e) {
  e.preventDefault();
  if (!currentConversation) return;

  const input = document.getElementById('chatMessageInput');
  const text = input.value.trim();
  if (!text) return;

  const messages = getMessages();

  if (currentConversation.type === 'user') {
    const newMsg = {
      id: generateId('MSG'),
      senderId: currentChatUser.id,
      receiverId: currentConversation.id,
      groupId: null,
      text,
      read: false,
      createdAt: nowISO()
    };
    messages.push(newMsg);
    saveMessages(messages);

    // Notification to the receiver
    createNotification(
      currentConversation.id,
      'chat-message',
      `New message from ${currentChatUser.firstName} ${currentChatUser.lastName}`,
      truncateText(text, 60),
      { page: 'chat.html', targetId: `user:${currentChatUser.id}` }
    );

    // NEW: activity log
    if (typeof logActivity === 'function') {
      const receiver = findUserById(currentConversation.id);
      const receiverName = receiver ? `${receiver.firstName} ${receiver.lastName}` : 'Unknown';
      logActivity(currentChatUser.id, 'chat-message', `Sent a message to ${receiverName}.`);
    }

  } else {
    const group = findGroupById(currentConversation.id);
    if (!group) return;

    const newMsg = {
      id: generateId('MSG'),
      senderId: currentChatUser.id,
      receiverId: null,
      groupId: currentConversation.id,
      text,
      readBy: [currentChatUser.id],
      createdAt: nowISO()
    };
    messages.push(newMsg);
    saveMessages(messages);

    // Notification to every OTHER member of the group
    const otherMembers = group.memberIds.filter(id => id !== currentChatUser.id);
    createNotificationForMany(
      otherMembers,
      'group-message',
      `${currentChatUser.firstName} ${currentChatUser.lastName} in ${group.name}`,
      truncateText(text, 60),
      { page: 'chat.html', targetId: `group:${group.id}` }
    );

    // NEW: activity log
    if (typeof logActivity === 'function') {
      logActivity(currentChatUser.id, 'chat-message', `Sent a message in group "${group.name}".`);
    }
  }

  input.value = '';
  renderConversationMessages();
  renderChatList();
}

/* ============================================================
   CREATE GROUP MODAL
   ============================================================ */
function openCreateGroupModal() {
  document.getElementById('createGroupForm').reset();
  clearFormError('createGroupError');

  const checklist = document.getElementById('groupMemberChecklist');
  const users = getOtherUsers();

  if (users.length === 0) {
    checklist.innerHTML = `<div class="group-empty-msg">No other registered users to add.</div>`;
  } else {
    checklist.innerHTML = users.map(u => `
      <div class="group-member-checkbox-row">
        <input type="checkbox" id="gm_${u.id}" value="${u.id}">
        <label for="gm_${u.id}">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</label>
        <span class="member-role-tag">${getRoleLabel(u.role)}</span>
      </div>
    `).join('');
  }

  openModal('createGroupModalOverlay');
}

function handleCreateGroupSubmit(e) {
  e.preventDefault();
  clearFormError('createGroupError');

  const name = document.getElementById('groupNameInput').value.trim();
  const checked = Array.from(document.querySelectorAll('#groupMemberChecklist input[type="checkbox"]:checked')).map(cb => cb.value);

  if (!name) {
    showFormError('createGroupError', 'Please enter a group name.');
    return;
  }
  if (checked.length === 0) {
    showFormError('createGroupError', 'Please select at least one member.');
    return;
  }

  const groups = getGroups();
  const newGroup = {
    id: generateId('GROUP'),
    name,
    memberIds: [currentChatUser.id, ...checked],
    createdBy: currentChatUser.id,
    createdAt: nowISO()
  };
  groups.push(newGroup);
  saveGroups(groups);

  createNotificationForMany(
    checked,
    'group-added',
    'Added to a new group',
    `${currentChatUser.firstName} ${currentChatUser.lastName} added you to "${name}"`,
    { page: 'chat.html', targetId: `group:${newGroup.id}` }
  );

  // NEW: activity log
  if (typeof logActivity === 'function') {
    logActivity(currentChatUser.id, 'chat-message', `Created group "${name}" with ${checked.length} member(s).`);
  }

  closeModal('createGroupModalOverlay');
  renderChatList();
  showToast('Group created successfully.', 'success');
  openConversation('group', newGroup.id);
}

/* ============================================================
   GROUP INFO / ADD MEMBERS MODAL
   ============================================================ */
function openGroupInfoModal() {
  if (!currentConversation || currentConversation.type !== 'group') return;

  const group = findGroupById(currentConversation.id);
  if (!group) return;

  document.getElementById('groupInfoGroupId').value = group.id;
  document.getElementById('groupInfoName').textContent = group.name;
  document.getElementById('groupInfoMemberCount').textContent = group.memberIds.length;

  const memberListEl = document.getElementById('groupInfoMemberList');
  memberListEl.innerHTML = group.memberIds.map(id => {
    const u = findUserById(id);
    if (!u) return '';
    return `
      <div class="group-member-list-row">
        <div class="member-avatar-sm">${getInitials(u)}</div>
        <span>${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</span>
        ${group.createdBy === id ? '<span class="creator-tag">Creator</span>' : ''}
      </div>
    `;
  }).join('');

  const nonMembers = getOtherUsers().filter(u => !group.memberIds.includes(u.id));
  const addChecklist = document.getElementById('groupInfoAddChecklist');

  if (nonMembers.length === 0) {
    addChecklist.innerHTML = `<div class="group-empty-msg">Everyone is already in this group.</div>`;
  } else {
    addChecklist.innerHTML = nonMembers.map(u => `
      <div class="group-member-checkbox-row">
        <input type="checkbox" id="gia_${u.id}" value="${u.id}">
        <label for="gia_${u.id}">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</label>
        <span class="member-role-tag">${getRoleLabel(u.role)}</span>
      </div>
    `).join('');
  }

  openModal('groupInfoModalOverlay');
}

function handleAddGroupMembers() {
  const groupId = document.getElementById('groupInfoGroupId').value;
  const checked = Array.from(document.querySelectorAll('#groupInfoAddChecklist input[type="checkbox"]:checked')).map(cb => cb.value);

  if (checked.length === 0) {
    showToast('Select at least one person to add.', 'error');
    return;
  }

  const groups = getGroups();
  const idx = groups.findIndex(g => g.id === groupId);
  if (idx === -1) return;

  groups[idx].memberIds = [...new Set([...groups[idx].memberIds, ...checked])];
  saveGroups(groups);

  createNotificationForMany(
    checked,
    'group-added',
    'Added to a group',
    `${currentChatUser.firstName} ${currentChatUser.lastName} added you to "${groups[idx].name}"`,
    { page: 'chat.html', targetId: `group:${groupId}` }
  );

  if (typeof logActivity === 'function') {
    logActivity(currentChatUser.id, 'chat-message', `Added ${checked.length} member(s) to group "${groups[idx].name}".`);
  }

  showToast('Members added.', 'success');
  openGroupInfoModal();
  renderChatList();

  if (currentConversation && currentConversation.type === 'group' && currentConversation.id === groupId) {
    document.getElementById('chatConvRole').textContent = `${groups[idx].memberIds.length} members`;
  }
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function attachChatEvents() {
  document.getElementById('chatUserSearchInput').addEventListener('input', (e) => {
    chatUserSearchTerm = e.target.value;
    renderChatList();
  });

  document.getElementById('chatUserListItems').addEventListener('click', (e) => {
    const item = e.target.closest('[data-open-conv]');
    if (!item) return;
    const [type, id] = item.dataset.openConv.split(':');
    openConversation(type, id);
  });

  document.getElementById('chatSendForm').addEventListener('submit', handleSendMessage);

  document.getElementById('chatBackBtn').addEventListener('click', () => {
    document.getElementById('chatUserListPanel').classList.remove('hidden-mobile');
  });

  document.getElementById('newGroupBtn').addEventListener('click', openCreateGroupModal);
  document.getElementById('closeCreateGroupModal').addEventListener('click', () => closeModal('createGroupModalOverlay'));
  enableClickOutsideClose('createGroupModalOverlay');
  document.getElementById('createGroupForm').addEventListener('submit', handleCreateGroupSubmit);

  document.getElementById('chatGroupInfoBtn').addEventListener('click', openGroupInfoModal);
  document.getElementById('closeGroupInfoModal').addEventListener('click', () => closeModal('groupInfoModalOverlay'));
  enableClickOutsideClose('groupInfoModalOverlay');
  document.getElementById('addGroupMembersBtn').addEventListener('click', handleAddGroupMembers);
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

function showFormError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.classList.add('active');
}

function clearFormError(elId) {
  const el = document.getElementById(elId);
  el.textContent = '';
  el.classList.remove('active');
}