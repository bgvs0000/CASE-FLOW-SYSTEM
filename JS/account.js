/* ============================================================
   CASEFLOW — ACCOUNT.JS
   "My Account" for the logged-in user.

   • Sidebar profile card (bottom-left: photo, name, role) becomes
     clickable → opens the My Account window.
   • Account information — READ-ONLY (full name, username, email,
     role, member since, last login, status).
   • Profile photo — the only thing you can change here
     (upload with auto square-crop + resize, or remove).
   • Appearance — Light / Dark / System; applies instantly on every
     page and syncs across open tabs.

   Self-contained: injects its own modal + styles + dark theme.
   Load it as the LAST script on every page after login.
   Depends on: storage.js, auth.js, modal.js, navigation.js
   ============================================================ */

const ACCOUNT_THEME_KEY = 'caseflow_ui_theme';
const ACCOUNT_PHOTO_SIZE = 256;          // px (square)
const ACCOUNT_PHOTO_MAX_MB = 5;

let _accPendingPhoto;                    // undefined = unchanged, '' = removed, dataURL = new photo

/* ============================================================
   THEME — runs immediately so the page paints in the right mode
   ============================================================ */
function accGetThemePref() {
  try { return localStorage.getItem(ACCOUNT_THEME_KEY) || 'light'; } catch (e) { return 'light'; }
}

function accResolveTheme(pref) {
  if (pref === 'system') {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref === 'dark' ? 'dark' : 'light';
}

function accApplyTheme(pref) {
  const p = pref || accGetThemePref();
  document.documentElement.setAttribute('data-theme', accResolveTheme(p));
  document.documentElement.setAttribute('data-theme-pref', p);
}

function accSetTheme(pref) {
  try { localStorage.setItem(ACCOUNT_THEME_KEY, pref); } catch (e) { /* ignore */ }
  accApplyTheme(pref);
  accSyncThemeButtons();
}

accInjectStyles();
accApplyTheme();

if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemChange = () => { if (accGetThemePref() === 'system') accApplyTheme('system'); };
  if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
  else if (mq.addListener) mq.addListener(onSystemChange);
}

window.addEventListener('storage', (e) => {
  if (e.key === ACCOUNT_THEME_KEY) {
    accApplyTheme();
    accSyncThemeButtons();
  }
});

/* ============================================================
   INIT (after the page has built the sidebar)
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(accInitSidebar, 0);   // runs after every page's own init
});

function accUser() {
  return typeof getCurrentUser === 'function' ? getCurrentUser() : null;
}

function accInitSidebar() {
  const user = accUser();
  const card = document.querySelector('.sidebar-profile');
  if (!user || !card || card.dataset.accReady) return;

  card.dataset.accReady = '1';
  card.classList.add('acc-clickable');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('title', 'My account & appearance');
  card.insertAdjacentHTML('beforeend', '<i class="fa-solid fa-gear acc-edit-hint"></i>');

  card.addEventListener('click', accOpenModal);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      accOpenModal();
    }
  });

  accInjectModal();
  accRefreshSidebar(user);
}

/* ---------- sidebar photo / name / role ---------- */
function accInitials(user) {
  if (typeof getUserInitials === 'function') return getUserInitials(user);
  return ((user.firstName || '').charAt(0) + (user.lastName || '').charAt(0)).toUpperCase() || 'U';
}

function accRoleLabel(role) {
  if (typeof getRoleLabel === 'function') return getRoleLabel(role);
  return role || '';
}

function accRenderAvatar(el, photo, user) {
  if (!el) return;
  if (photo) {
    el.innerHTML = `<img src="${photo}" alt="Profile photo">`;
    el.classList.add('has-photo');
  } else {
    el.textContent = accInitials(user);
    el.classList.remove('has-photo');
  }
}

function accRefreshSidebar(user) {
  const card = document.querySelector('.sidebar-profile');
  if (!card || !user) return;
  accRenderAvatar(card.querySelector('.sidebar-profile-pic'), user.profilePhoto, user);
}

/* ============================================================
   MODAL
   ============================================================ */
function accInjectModal() {
  if (document.getElementById('accModalOverlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'accModalOverlay';
  overlay.innerHTML = `
    <div class="modal-box modal-lg glass acc-modal">
      <div class="modal-header">
        <h2><i class="fa-solid fa-user-gear"></i> My Account</h2>
        <button type="button" class="modal-close" id="accCloseBtn">&times;</button>
      </div>

      <div class="modal-body">
        <div class="acc-layout">

          <!-- LEFT: PHOTO -->
          <aside class="acc-side">
            <div class="acc-avatar" id="accAvatar"></div>
            <div class="acc-side-name" id="accSideName"></div>
            <span class="acc-role-badge" id="accSideRole"></span>

            <div class="acc-photo-actions">
              <label class="btn-outline acc-btn-sm" for="accPhotoInput">
                <i class="fa-solid fa-camera"></i> Change photo
              </label>
              <button type="button" class="acc-link-btn" id="accPhotoRemove">
                <i class="fa-solid fa-trash"></i> Remove photo
              </button>
            </div>
            <input type="file" id="accPhotoInput" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
            <p class="acc-hint">JPG, PNG or WEBP up to ${ACCOUNT_PHOTO_MAX_MB} MB. It is cropped to a square automatically.</p>
            <p class="acc-pending" id="accPendingNote" hidden><i class="fa-solid fa-circle-info"></i> Click <b>Save photo</b> to keep this change.</p>
          </aside>

          <!-- RIGHT: INFO + APPEARANCE -->
          <div class="acc-main">

            <section class="acc-section">
              <h3><i class="fa-solid fa-id-card"></i> Account information</h3>
              <div class="acc-info-grid" id="accInfoGrid"></div>
              <p class="acc-hint"><i class="fa-solid fa-lock"></i> Account details can only be changed by the firm administrator.</p>
            </section>

            <section class="acc-section">
              <h3><i class="fa-solid fa-circle-half-stroke"></i> Appearance <small>applies right away</small></h3>
              <div class="acc-theme-grid">
                <button type="button" class="acc-theme-opt" data-acc-theme="light">
                  <span class="acc-theme-preview light"><i></i><i></i><i></i></span>
                  <b><i class="fa-solid fa-sun"></i> Light</b>
                </button>
                <button type="button" class="acc-theme-opt" data-acc-theme="dark">
                  <span class="acc-theme-preview dark"><i></i><i></i><i></i></span>
                  <b><i class="fa-solid fa-moon"></i> Dark</b>
                </button>
                <button type="button" class="acc-theme-opt" data-acc-theme="system">
                  <span class="acc-theme-preview system"><i></i><i></i><i></i></span>
                  <b><i class="fa-solid fa-desktop"></i> System</b>
                </button>
              </div>
            </section>

            <div id="accError" class="form-error"></div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn-outline" id="accCancelBtn">Close</button>
        <button type="button" class="btn-primary" id="accSaveBtn" disabled>
          <i class="fa-solid fa-floppy-disk"></i> Save photo
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('accCloseBtn').addEventListener('click', accCloseModal);
  document.getElementById('accCancelBtn').addEventListener('click', accCloseModal);
  document.getElementById('accSaveBtn').addEventListener('click', accSavePhoto);
  if (typeof enableClickOutsideClose === 'function') enableClickOutsideClose('accModalOverlay');

  document.getElementById('accPhotoInput').addEventListener('change', accHandlePhotoPick);
  document.getElementById('accPhotoRemove').addEventListener('click', () => {
    _accPendingPhoto = '';
    accRenderAvatar(document.getElementById('accAvatar'), '', accUser());
    accUpdatePhotoState();
  });

  overlay.addEventListener('click', (e) => {
    const themeBtn = e.target.closest('[data-acc-theme]');
    if (themeBtn) accSetTheme(themeBtn.dataset.accTheme);
  });
}

function accOpenModal() {
  const user = accUser();
  if (!user) return;
  accInjectModal();

  // close the mobile sidebar if it is open
  const sb = document.getElementById('appSidebar');
  const ov = document.getElementById('sidebarOverlay');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('active');

  _accPendingPhoto = undefined;

  document.getElementById('accSideName').textContent = `${user.firstName} ${user.lastName}`;
  document.getElementById('accSideRole').textContent = accRoleLabel(user.role);
  accRenderAvatar(document.getElementById('accAvatar'), user.profilePhoto, user);
  accUpdatePhotoState();
  accRenderInfo(user);
  accSyncThemeButtons();
  accShowError('');

  openModal('accModalOverlay');
}

function accCloseModal() {
  closeModal('accModalOverlay');
  _accPendingPhoto = undefined;
}

function accRenderInfo(user) {
  const session = typeof getSession === 'function' ? getSession() : null;
  const fmtDate = (v) => (v ? (typeof formatDate === 'function' ? formatDate(v) : new Date(v).toLocaleDateString()) : '—');
  const fmtDateTime = (v) => (v ? (typeof formatDateTime === 'function' ? formatDateTime(v) : new Date(v).toLocaleString()) : '—');

  const items = [
    { icon: 'fa-user', label: 'Full name', value: `${user.firstName || ''} ${user.lastName || ''}`.trim() || '—' },
    { icon: 'fa-at', label: 'Username', value: user.username || '—' },
    { icon: 'fa-envelope', label: 'Email', value: user.email || '—' },
    { icon: 'fa-user-tag', label: 'Role', value: accRoleLabel(user.role) },
    { icon: 'fa-calendar-plus', label: 'Member since', value: fmtDate(user.createdAt) },
    { icon: 'fa-clock-rotate-left', label: 'Last login', value: fmtDateTime(session && session.loginAt) },
    { icon: 'fa-shield-halved', label: 'Status', value: user.isLocked ? 'Locked' : 'Active', ok: !user.isLocked }
  ];

  document.getElementById('accInfoGrid').innerHTML = items.map(i => `
    <div class="acc-info">
      <i class="fa-solid ${i.icon}"></i>
      <div>
        <span>${i.label}</span>
        <strong class="${i.ok ? 'acc-ok' : ''}" title="${accEsc(i.value)}">${accEsc(i.value)}</strong>
      </div>
    </div>
  `).join('');
}

function accSyncThemeButtons() {
  const pref = accGetThemePref();
  document.querySelectorAll('[data-acc-theme]').forEach(btn => {
    const on = btn.dataset.accTheme === pref;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/* ============================================================
   PHOTO
   ============================================================ */
function accCurrentUserPhoto() {
  const u = accUser();
  return u && u.profilePhoto ? u.profilePhoto : '';
}

function accShownPhoto() {
  return _accPendingPhoto !== undefined ? _accPendingPhoto : accCurrentUserPhoto();
}

function accUpdatePhotoState() {
  const removeBtn = document.getElementById('accPhotoRemove');
  const saveBtn = document.getElementById('accSaveBtn');
  const note = document.getElementById('accPendingNote');
  const changed = _accPendingPhoto !== undefined && _accPendingPhoto !== accCurrentUserPhoto();

  if (removeBtn) removeBtn.style.display = accShownPhoto() ? '' : 'none';
  if (saveBtn) saveBtn.disabled = !changed;
  if (note) note.hidden = !changed;
}

async function accHandlePhotoPick(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;

  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
    accShowError('Please choose a JPG, PNG, WEBP or GIF image.');
    return;
  }
  if (file.size > ACCOUNT_PHOTO_MAX_MB * 1024 * 1024) {
    accShowError(`Photo is too large. Maximum is ${ACCOUNT_PHOTO_MAX_MB} MB.`);
    return;
  }

  try {
    const dataUrl = await accResizePhoto(file);
    _accPendingPhoto = dataUrl;
    accRenderAvatar(document.getElementById('accAvatar'), dataUrl, accUser());
    accUpdatePhotoState();
    accShowError('');
  } catch (err) {
    console.error('[account.js] Photo failed:', err);
    accShowError('Could not read this image. Try another photo.');
  }
}

/** Square center-crop + resize to ACCOUNT_PHOTO_SIZE, returns a small JPEG data URL */
function accResizePhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unreadable image'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = ACCOUNT_PHOTO_SIZE;
        canvas.height = ACCOUNT_PHOTO_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function accSavePhoto() {
  if (_accPendingPhoto === undefined) return;

  const me = accUser();
  if (!me) return;

  const users = getUsers();
  const idx = users.findIndex(u => u.id === me.id);
  if (idx === -1) return accShowError('Account not found. Please log in again.');

  const updated = { ...users[idx], updatedAt: nowISO() };
  if (_accPendingPhoto) updated.profilePhoto = _accPendingPhoto;
  else delete updated.profilePhoto;

  users[idx] = updated;
  if (saveUsers(users) === false) {
    return accShowError('Could not save — browser storage is full. Try a smaller photo.');
  }

  if (typeof logActivity === 'function') {
    logActivity(me.id, 'account-edit',
      `${me.firstName} ${me.lastName} ${_accPendingPhoto ? 'changed' : 'removed'} their profile photo.`);
  }

  const removed = !_accPendingPhoto;
  accRefreshSidebar(updated);
  accCloseModal();
  if (typeof showToast === 'function') {
    showToast(removed ? 'Profile photo removed.' : 'Profile photo updated.', 'success');
  }
}

/* ============================================================
   HELPERS
   ============================================================ */
function accShowError(msg) {
  const el = document.getElementById('accError');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('active', !!msg);
}

function accEsc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ============================================================
   STYLES — account window, clickable sidebar card, DARK THEME
   ============================================================ */
function accInjectStyles() {
  if (document.getElementById('accStyles')) return;
  const style = document.createElement('style');
  style.id = 'accStyles';
  style.textContent = `
    /* ---------- clickable sidebar profile ---------- */
    .sidebar-profile.acc-clickable {
      position: relative;
      cursor: pointer;
      transition: border-color .15s ease, background .15s ease, transform .15s ease;
    }
    .sidebar-profile.acc-clickable:hover,
    .sidebar-profile.acc-clickable:focus-visible {
      border-color: var(--color-gold, #c9a227);
      background: var(--row-hover, #fdf8ea);
      outline: none;
    }
    .sidebar-profile.acc-clickable:active { transform: scale(.98); }
    .acc-edit-hint {
      margin-left: auto;
      flex-shrink: 0;
      font-size: 12px;
      color: var(--color-gray-text, #6b7280);
      transition: transform .3s ease, color .15s ease;
    }
    .sidebar-profile.acc-clickable:hover .acc-edit-hint {
      color: var(--color-gold-dark, #a8862a);
      transform: rotate(60deg);
    }
    .sidebar-profile-pic.has-photo,
    .acc-avatar.has-photo {
      background: none !important;
      padding: 0;
      overflow: hidden;
    }
    .sidebar-profile-pic img,
    .acc-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
      display: block;
    }

    /* ---------- modal layout ---------- */
    .acc-modal { max-width: 860px !important; }
    .acc-layout {
      display: grid;
      grid-template-columns: 230px 1fr;
      gap: 22px;
      align-items: start;
    }

    .acc-side {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 8px;
      padding: 20px 16px;
      border: 1px solid var(--color-gray-border, #e0e0e0);
      border-radius: var(--radius-md, 12px);
      background: var(--color-gray-bg, #f6f5f1);
    }
    .acc-avatar {
      width: 112px;
      height: 112px;
      border-radius: 50%;
      background: var(--gradient-accent, linear-gradient(135deg, #e6c75a, #a8862a));
      color: var(--on-accent, #1f2937);
      font-size: 38px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 0 4px var(--card-bg, #fff), 0 0 0 6px var(--color-gold, #c9a227);
      margin-bottom: 6px;
    }
    .acc-side-name {
      font-size: 15px;
      font-weight: 800;
      color: var(--color-black, #1f2937);
      word-break: break-word;
    }
    .acc-role-badge {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .5px;
      padding: 3px 10px;
      border-radius: 999px;
      background: var(--primary-soft, rgba(201, 162, 39, .14));
      color: var(--color-gold-dark, #a8862a);
    }
    .acc-photo-actions {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      width: 100%;
      margin-top: 8px;
    }
    .acc-btn-sm {
      width: 100%;
      padding: 8px 12px !important;
      font-size: 12.5px !important;
      cursor: pointer;
    }
    .acc-link-btn {
      background: none;
      font-size: 12px;
      font-weight: 600;
      color: var(--color-danger, #ef4444);
      padding: 4px 6px;
    }
    .acc-link-btn:hover { text-decoration: underline; }

    .acc-hint {
      font-size: 11.5px;
      line-height: 1.5;
      color: var(--color-gray-text, #6b7280);
      margin-top: 4px;
    }
    .acc-hint i { margin-right: 4px; }
    .acc-pending {
      width: 100%;
      font-size: 11.5px;
      line-height: 1.45;
      padding: 7px 9px;
      border-radius: 7px;
      background: var(--primary-soft, rgba(201, 162, 39, .14));
      color: var(--color-gold-dark, #a8862a);
    }
    .acc-pending[hidden] { display: none; }

    .acc-main { min-width: 0; }
    .acc-section {
      padding-bottom: 16px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--color-gray-border, #e0e0e0);
    }
    .acc-section:last-of-type { border-bottom: none; margin-bottom: 6px; }
    .acc-section h3 {
      font-size: 13.5px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .acc-section h3 > i { color: var(--color-gold-dark, #a8862a); }
    .acc-section h3 small {
      font-size: 11px;
      font-weight: 500;
      color: var(--color-gray-text, #6b7280);
    }

    /* read-only info */
    .acc-info-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .acc-info {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 11px;
      border: 1px solid var(--color-gray-border, #e0e0e0);
      border-radius: var(--radius-sm, 8px);
      background: var(--color-gray-bg, #f6f5f1);
      min-width: 0;
    }
    .acc-info > i {
      width: 28px;
      height: 28px;
      flex-shrink: 0;
      border-radius: 7px;
      background: var(--primary-soft, rgba(201, 162, 39, .14));
      color: var(--color-gold-dark, #a8862a);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
    }
    .acc-info div { min-width: 0; display: flex; flex-direction: column; }
    .acc-info span {
      font-size: 10.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .4px;
      color: var(--color-gray-text, #6b7280);
    }
    .acc-info strong {
      font-size: 12.5px;
      color: var(--color-black, #1f2937);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .acc-info strong.acc-ok { color: var(--color-success, #22a55a); }

    /* appearance */
    .acc-theme-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .acc-theme-opt {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      padding: 8px;
      border: 2px solid var(--color-gray-border, #e0e0e0);
      border-radius: var(--radius-md, 12px);
      background: var(--card-bg, #fff);
      color: var(--color-black, #1f2937);
      transition: border-color .15s ease, transform .15s ease;
    }
    .acc-theme-opt:hover { border-color: var(--color-gold-light, #e6c75a); transform: translateY(-1px); }
    .acc-theme-opt.active {
      border-color: var(--color-gold, #c9a227);
      box-shadow: 0 0 0 3px var(--primary-soft, rgba(201, 162, 39, .14));
    }
    .acc-theme-opt b {
      font-size: 12.5px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .acc-theme-opt.active b { color: var(--color-gold-dark, #a8862a); }
    .acc-theme-preview {
      position: relative;
      height: 56px;
      border-radius: 8px;
      overflow: hidden;
      display: block;
      border: 1px solid rgba(0, 0, 0, .08);
    }
    .acc-theme-preview i { position: absolute; display: block; border-radius: 3px; }
    .acc-theme-preview i:nth-child(1) { left: 0; top: 0; bottom: 0; width: 26%; }
    .acc-theme-preview i:nth-child(2) { left: 34%; top: 10px; right: 10px; height: 10px; }
    .acc-theme-preview i:nth-child(3) { left: 34%; top: 26px; width: 36%; height: 20px; background: #c9a227 !important; }
    .acc-theme-preview.light { background: #f6f5f1; }
    .acc-theme-preview.light i:nth-child(1) { background: #ffffff; }
    .acc-theme-preview.light i:nth-child(2) { background: #e3dfd4; }
    .acc-theme-preview.dark { background: #111318; }
    .acc-theme-preview.dark i:nth-child(1) { background: #1b1e25; }
    .acc-theme-preview.dark i:nth-child(2) { background: #2f3440; }
    .acc-theme-preview.system { background: linear-gradient(90deg, #f6f5f1 50%, #111318 50%); }
    .acc-theme-preview.system i:nth-child(1) { background: #ffffff; }
    .acc-theme-preview.system i:nth-child(2) { background: linear-gradient(90deg, #e3dfd4 50%, #2f3440 50%); }

    @media (max-width: 760px) {
      .acc-layout { grid-template-columns: 1fr; }
      .acc-info-grid { grid-template-columns: 1fr; }
      .acc-theme-grid { gap: 6px; }
      .acc-theme-preview { height: 44px; }
    }

    /* ============================================================
       DARK THEME — html[data-theme="dark"]
       ============================================================ */
    html[data-theme="dark"] {
      color-scheme: dark;
      --color-white: #1b1e25;
      --card-bg: #1b1e25;
      --page-bg: #111318;
      --color-gray-bg: #22262f;
      --color-gray-border: #2f3440;
      --color-gray-text: #98a1b0;
      --text-soft: #c9ced8;
      --color-black: #e9ecf1;
      --color-black-soft: #2c313c;
      --row-hover: #2a2619;
      --primary-soft: rgba(201, 162, 39, .16);
      --primary-soft-2: rgba(201, 162, 39, .26);
      --surface: rgba(27, 30, 37, .82);
      --surface-strong: rgba(27, 30, 37, .94);
      --surface-outline: rgba(255, 255, 255, .06);
      --shadow-soft: 0 1px 2px rgba(0, 0, 0, .4), 0 6px 18px rgba(0, 0, 0, .35);
      --shadow-medium: 0 16px 40px rgba(0, 0, 0, .55);
    }
    html[data-theme="dark"] body {
      background: var(--page-bg) !important;
      color: var(--color-black);
    }

    /* hard-coded light surfaces in the theme files */
    html[data-theme="dark"] .topnav { background: rgba(21, 23, 29, .92) !important; }
    html[data-theme="dark"] thead,
    html[data-theme="dark"] .an-table thead th { background: #1f232b !important; }
    html[data-theme="dark"] tbody tr:nth-child(even) { background: #1e2129; }
    html[data-theme="dark"] tbody tr:hover { background: var(--row-hover); }
    html[data-theme="dark"] tbody td { border-bottom-color: #262a33; color: var(--text-soft); }
    html[data-theme="dark"] .modal-footer { background: #181b21; }
    html[data-theme="dark"] .glass { background: var(--card-bg); border-color: var(--color-gray-border); }
    html[data-theme="dark"] .modal-overlay { background: rgba(0, 0, 0, .6); }
    html[data-theme="dark"] option { background: #1b1e25; color: #e9ecf1; }
    html[data-theme="dark"] input::placeholder,
    html[data-theme="dark"] textarea::placeholder { color: #6b7385; }
    html[data-theme="dark"] ::-webkit-scrollbar-thumb { background: #3a404d; }
    html[data-theme="dark"] ::-webkit-scrollbar-thumb:hover { background: var(--color-gold); }
    html[data-theme="dark"] .lbcimp-loading { background: rgba(17, 19, 24, .88); }

    /* text that must stay white on colored backgrounds */
    html[data-theme="dark"] .tile,
    html[data-theme="dark"] .tile-info h3,
    html[data-theme="dark"] .tile-info p,
    html[data-theme="dark"] .tile-icon,
    html[data-theme="dark"] .btn-danger,
    html[data-theme="dark"] .nav-item-badge,
    html[data-theme="dark"] .notif-badge,
    html[data-theme="dark"] .an-health,
    html[data-theme="dark"] .caseai-health,
    html[data-theme="dark"] .caseai-chat-health,
    html[data-theme="dark"] .caseai-level,
    html[data-theme="dark"] .caseai-stage-done .caseai-stage-dot,
    html[data-theme="dark"] .btn-icon.danger:hover,
    html[data-theme="dark"] .btn-icon.caseai-row-btn:hover { color: #fff; }

    html[data-theme="dark"] .btn-secondary { background: #2f3542; color: #fff; }
    html[data-theme="dark"] .btn-secondary:hover { background: #3a4150; }
    html[data-theme="dark"] .notif-badge,
    html[data-theme="dark"] .nav-item-badge-top { border-color: var(--card-bg); }

    /* common dark-grey text used in page CSS */
    html[data-theme="dark"] .task-detail-block p,
    html[data-theme="dark"] .daily-log-view-field p,
    html[data-theme="dark"] #viewLogRowsBody td,
    html[data-theme="dark"] .task-date-cell,
    html[data-theme="dark"] .date-sent-cell,
    html[data-theme="dark"] .cf-value-cell,
    html[data-theme="dark"] .docai-meta,
    html[data-theme="dark"] .caseai-overview p,
    html[data-theme="dark"] .caseai-past,
    html[data-theme="dark"] .lbcimp-tip,
    html[data-theme="dark"] .lbcimp-autofill { color: var(--text-soft) !important; }

    html[data-theme="dark"] .acc-avatar {
      box-shadow: 0 0 0 4px var(--card-bg), 0 0 0 6px var(--color-gold);
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}
/* ============================================================
   SIDEBAR COLLAPSE — logo + icons only (desktop)
   Toggle button on the sidebar edge; choice is remembered.
   ============================================================ */
(function () {
  const SB_KEY = 'caseflow_sb_collapsed';

  function sbIsCollapsed() {
    try { return localStorage.getItem(SB_KEY) === '1'; } catch (e) { return false; }
  }

  function sbApply(collapsed) {
    document.documentElement.classList.toggle('sb-collapsed', collapsed);
    const btn = document.getElementById('sbCollapseBtn');
    if (btn) {
      btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
  }

  // apply right away so the page doesn't jump
  sbApply(sbIsCollapsed());

  function sbInit() {
    if (!document.querySelector('.sidebar') || document.getElementById('sbCollapseBtn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'sbCollapseBtn';
    btn.className = 'sb-collapse-btn';
    btn.innerHTML = '<i class="fa-solid fa-angle-left"></i>';
    document.body.appendChild(btn);

    btn.addEventListener('click', () => {
      const collapsed = !document.documentElement.classList.contains('sb-collapsed');
      try { localStorage.setItem(SB_KEY, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
      sbApply(collapsed);
    });

    // tooltips for icon-only mode
    document.querySelectorAll('.sidebar-nav a').forEach(a => {
      const label = a.querySelector('span:not(.nav-item-badge)');
      if (label && !a.title) a.title = label.textContent.trim();
    });
    const logout = document.getElementById('sidebarLogoutBtn');
    if (logout && !logout.title) logout.title = 'Logout';

    sbApply(sbIsCollapsed());
  }

  document.addEventListener('DOMContentLoaded', () => setTimeout(sbInit, 0));

  // keep other open tabs in sync
  window.addEventListener('storage', (e) => {
    if (e.key === SB_KEY) sbApply(sbIsCollapsed());
  });
})();
/* ============================================================
   MOBILE TABLE LABELS
   Copies each table header into its cells as data-label so the
   mobile "card" layout shows "Client: Juan", "Status: Active"...
   Works on every table, including rows re-drawn later.
   ============================================================ */
(function () {
  function mtLabelTable(table) {
    const heads = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.replace(/\s+/g, ' ').trim());
    if (!heads.length) return;

    table.querySelectorAll('tbody tr').forEach(tr => {
      let col = 0;
      Array.from(tr.children).forEach(td => {
        if (td.tagName !== 'TD') return;
        if (!td.hasAttribute('data-label')) td.setAttribute('data-label', heads[col] || '');
        if (td.querySelector('.table-actions') && !td.classList.contains('table-actions-cell')) {
          td.classList.add('table-actions-cell');
        }
        col += Number(td.getAttribute('colspan')) || 1;
      });
    });
  }

  function mtLabelAll() {
    document.querySelectorAll('table').forEach(mtLabelTable);
  }

  let mtQueued = false;
  function mtSchedule() {
    if (mtQueued) return;
    mtQueued = true;
    requestAnimationFrame(() => {
      mtQueued = false;
      mtLabelAll();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      mtLabelAll();
      new MutationObserver(mtSchedule).observe(document.body, { childList: true, subtree: true });
    }, 0);
  });
})();