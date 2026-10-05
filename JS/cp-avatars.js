/* ============================================================
   CASEFLOW — CP-AVATARS.JS
   Shows each user's PROFILE PHOTO (set in My Account) in the
   Control Panel:
     • Account list (left panel)
     • Profile box of the selected account
     • Pending Account Details modal
   Falls back to initials when a user has no photo.
   Locked accounts show the photo in grayscale.

   Works by watching the page — whenever control-panel.js
   re-draws the list or the profile, avatars are swapped for
   photos. No change to control-panel.js is needed.
   Load AFTER control-panel.js on control-panel.html.
   Depends on: storage.js, control-panel.js
   ============================================================ */

(function () {

  /* ---------- helpers ---------- */
  function cpaUsers() {
    try { return typeof getUsers === 'function' ? getUsers() : []; } catch (e) { return []; }
  }

  function cpaPhotoOf(user) {
    const photo = user && user.profilePhoto ? user.profilePhoto : '';
    return /^data:image\//.test(photo) ? photo : '';
  }

  function cpaInitials(user) {
    return ((user.firstName || '').charAt(0) + (user.lastName || '').charAt(0)).toUpperCase() || 'U';
  }

  /** Put the photo inside an avatar element (no-op if already done) */
  function cpaApply(el, user) {
    if (!el || !user) return;
    const photo = cpaPhotoOf(user);
    const img = el.querySelector('img.cpa-img');

    el.classList.toggle('cpa-locked', !!user.isLocked);

    if (!photo) {
      if (img) el.textContent = cpaInitials(user);     // photo was removed
      el.classList.remove('cpa-has-photo');
      return;
    }
    el.classList.add('cpa-has-photo');
    if (img && img.getAttribute('src') === photo) return;

    const name = `${user.firstName || ''} ${user.lastName || ''}`.trim().replace(/"/g, '&quot;');
    el.innerHTML = `<img class="cpa-img" src="${photo}" alt="${name}">`;
  }

  function cpaGlobal(name) {
    try {
      // let-variables from control-panel.js are reachable by name, not on window
      // eslint-disable-next-line no-eval
      return (0, eval)(`typeof ${name} !== 'undefined' ? ${name} : null`);
    } catch (e) {
      return null;
    }
  }

  /* ---------- patch whatever is on screen ---------- */
  function cpaPatchAll() {
    const users = cpaUsers();
    if (!users.length) return;
    const byId = (id) => users.find(u => u.id === id);

    // Account list rows
    document.querySelectorAll('[data-select-account]').forEach(row => {
      cpaApply(row.querySelector('.cp-account-avatar'), byId(row.getAttribute('data-select-account')));
    });

    // Selected account's profile box
    const profile = document.getElementById('cpProfileAvatar');
    const selectedId = cpaGlobal('cpSelectedAccountId');
    if (profile && selectedId) cpaApply(profile, byId(selectedId));

    // Pending account modal
    const pending = document.getElementById('cpViewPendingAvatar');
    const pendingIdEl = document.getElementById('cpViewPendingUserId');
    const pendingId = (pendingIdEl && pendingIdEl.value) || cpaGlobal('cpViewingPendingUserId');
    if (pending && pendingId) cpaApply(pending, byId(pendingId));

    // Pending approvals list (rows may carry data-view-pending="ID")
    document.querySelectorAll('[data-view-pending]').forEach(row => {
      const avatar = row.querySelector('[class*="avatar"]');
      cpaApply(avatar, byId(row.getAttribute('data-view-pending')));
    });
  }

  let cpaQueued = false;
  function cpaSchedule() {
    if (cpaQueued) return;
    cpaQueued = true;
    requestAnimationFrame(() => {
      cpaQueued = false;
      cpaPatchAll();
    });
  }

  function cpaStart() {
    cpaPatchAll();
    const observer = new MutationObserver(cpaSchedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // a user changed their photo in another tab
    window.addEventListener('storage', (e) => {
      if (e.key === 'caseflow_users') cpaSchedule();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(cpaStart, 0));
  } else {
    setTimeout(cpaStart, 0);
  }

  /* ---------- styles ---------- */
  if (!document.getElementById('cpAvatarStyles')) {
    const style = document.createElement('style');
    style.id = 'cpAvatarStyles';
    style.textContent = `
      .cp-account-avatar,
      .cp-profile-avatar,
      .cp-view-pending-avatar {
        overflow: hidden;
      }
      .cpa-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        display: block;
      }
      .cpa-has-photo {
        background: var(--color-gray-bg, #f0eee8) !important;
        padding: 0 !important;
        box-shadow: 0 0 0 2px var(--card-bg, #fff), 0 0 0 3px var(--color-gold, #c9a227);
      }
      .cpa-has-photo.cpa-locked {
        box-shadow: 0 0 0 2px var(--card-bg, #fff), 0 0 0 3px var(--color-danger, #ef4444);
      }
      .cpa-locked .cpa-img {
        filter: grayscale(1);
        opacity: .65;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
})();