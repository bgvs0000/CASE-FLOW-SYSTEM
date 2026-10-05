/* ============================================================
   CASEFLOW — CHAT-AVATARS.JS  (v2 — robust)
   Shows each user's PROFILE PHOTO (set in My Account) in Chat:
     • People list (left panel)
     • Conversation header (top of the open chat)
     • Group Info member list
   Falls back to initials when a user has no photo.

   Two layers so it works with any version of chat.js:
     1. Wraps getInitials(user) (used by chat.js to build avatars)
     2. Watches the page — whenever chat.js re-draws a list or
        header, the avatars are swapped for photos.
   Load AFTER chat.js on chat.html.
   Depends on: storage.js, chat.js
   ============================================================ */

(function () {

  /* ---------- helpers ---------- */
  function caUsers() {
    try { return typeof getUsers === 'function' ? getUsers() : []; } catch (e) { return []; }
  }

  function caFindUser(id) {
    if (!id) return null;
    return caUsers().find(u => u.id === id) || null;
  }

  function caPhotoOf(user) {
    if (!user) return '';
    const photo = user.profilePhoto || ((caFindUser(user.id) || {}).profilePhoto) || '';
    return /^data:image\//.test(photo) ? photo : '';
  }

  function caImg(photo, user) {
    const name = `${(user && user.firstName) || ''} ${(user && user.lastName) || ''}`.trim().replace(/"/g, '&quot;');
    return `<img class="chat-avatar-img" src="${photo}" alt="${name}">`;
  }

  /** Put the photo inside an avatar element (no-op if already done / no photo) */
  function caApply(el, user) {
    if (!el || !user) return;
    const photo = caPhotoOf(user);
    const img = el.querySelector('img.chat-avatar-img');

    if (!photo) {
      // photo was removed → go back to initials
      if (img) {
        el.textContent = ((user.firstName || '').charAt(0) + (user.lastName || '').charAt(0)).toUpperCase() || 'U';
      }
      return;
    }
    if (img && img.getAttribute('src') === photo) return;
    el.innerHTML = caImg(photo, user);
  }

  /* ---------- layer 1: wrap getInitials ---------- */
  if (typeof getInitials === 'function' && !getInitials._withPhoto) {
    const originalGetInitials = getInitials;
    const wrapped = function (user) {
      const photo = caPhotoOf(user);
      return photo ? caImg(photo, user) : originalGetInitials(user);
    };
    wrapped._withPhoto = true;
    try { window.getInitials = wrapped; } catch (e) { /* ignore */ }
  }

  /* ---------- layer 2: patch whatever is on screen ---------- */
  function caPatchAll() {
    const users = caUsers();
    if (!users.length) return;

    // People list: <div class="chat-user-item" data-open-conv="user:ID"> <div class="chat-user-avatar">
    document.querySelectorAll('[data-open-conv^="user:"]').forEach(item => {
      const id = item.getAttribute('data-open-conv').slice(5);
      caApply(item.querySelector('.chat-user-avatar'), users.find(u => u.id === id));
    });

    // Conversation header
    const conv = document.getElementById('chatConvAvatar');
    if (conv && !conv.classList.contains('group-avatar')) {
      let user = null;
      try {
        if (typeof currentConversation !== 'undefined' && currentConversation && currentConversation.type === 'user') {
          user = users.find(u => u.id === currentConversation.id);
        }
      } catch (e) { /* ignore */ }
      if (!user) {
        const nameEl = document.getElementById('chatConvName');
        const name = nameEl ? nameEl.textContent.trim().toLowerCase() : '';
        user = users.find(u => `${u.firstName} ${u.lastName}`.trim().toLowerCase() === name);
      }
      caApply(conv, user);
    }

    // Group Info member list: match by the name shown next to the avatar
    document.querySelectorAll('.group-member-list-row').forEach(row => {
      const avatar = row.querySelector('.member-avatar-sm');
      const nameEl = row.querySelector('span');
      if (!avatar || !nameEl) return;
      const name = nameEl.textContent.trim().toLowerCase();
      caApply(avatar, users.find(u => `${u.firstName} ${u.lastName}`.trim().toLowerCase() === name));
    });
  }

  let caQueued = false;
  function caSchedule() {
    if (caQueued) return;
    caQueued = true;
    requestAnimationFrame(() => {
      caQueued = false;
      caPatchAll();
    });
  }

  function caStart() {
    caPatchAll();
    const observer = new MutationObserver(caSchedule);
    observer.observe(document.body, { childList: true, subtree: true });

    // another tab / account changed a photo
    window.addEventListener('storage', (e) => {
      if (e.key === 'caseflow_users') caSchedule();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(caStart, 0));
  } else {
    setTimeout(caStart, 0);
  }

  /* ---------- styles ---------- */
  if (!document.getElementById('chatAvatarStyles')) {
    const style = document.createElement('style');
    style.id = 'chatAvatarStyles';
    style.textContent = `
      .chat-user-avatar,
      .chat-conv-avatar,
      .member-avatar-sm {
        overflow: hidden;
      }
      .chat-avatar-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        display: block;
      }
      .chat-user-avatar:has(.chat-avatar-img),
      .chat-conv-avatar:has(.chat-avatar-img),
      .member-avatar-sm:has(.chat-avatar-img) {
        background: var(--color-gray-bg, #f0eee8) !important;
        box-shadow: 0 0 0 2px var(--card-bg, #fff), 0 0 0 3px var(--color-gold, #c9a227);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
})();