/* ============================================================
   CASEFLOW — ACCOUNT-MANAGER.JS
   Attorney-only account management inside the Control Panel.
   (Public Register + Forgot Password were removed from the login
   page — every account is now created and managed here.)

   Adds to the Control Panel:
     • "Add Account" button (page heading) → full form:
       first/last name, username, email, role, password
       (Generate + show), approved immediately, then shows a
       credentials box with Copy so Atty can hand it over.
     • "Edit Info" button on the selected account → first/last
       name, username, email (duplicate checks).
     • "Reset Password" button on the selected account → set a
       new password (Generate / Copy), user gets a notification.
   Everything is written to the Activity Log.

   Load AFTER control-panel.js on control-panel.html.
   Depends on: storage.js, auth.js, modal.js, navigation.js,
               control-panel.js
   ============================================================ */

const AM_ROLES = [
  { value: 'attorney', label: 'Attorney' },
  { value: 'head', label: 'Head' },
  { value: 'it', label: 'IT Staff' },
  { value: 'employee', label: 'Employee / Paralegal' }
];

let _amEditingUserId = null;
let _amResetUserId = null;

document.addEventListener('DOMContentLoaded', () => {
  // wait for control-panel.js to finish (it may redirect non-attorneys)
  setTimeout(amInit, 0);
});

function amInit() {
  const me = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!me || me.role !== 'attorney') return;
  if (!document.querySelector('.cp-shell')) return;

  amInjectStyles();
  amInjectModals();
  amInjectButtons();
  amAttachEvents();
}

/* ============================================================
   BUTTONS
   ============================================================ */
function amInjectButtons() {
  // Add Account — page heading
  const heading = document.querySelector('.page-heading');
  if (heading && !document.getElementById('amAddBtn')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary';
    btn.id = 'amAddBtn';
    btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Add Account';
    heading.appendChild(btn);
  }

  // Edit Info + Reset Password — selected account's action row
  const actions = document.querySelector('.cp-profile-actions');
  if (actions && !document.getElementById('amEditBtn')) {
    actions.insertAdjacentHTML('afterbegin', `
      <button type="button" class="btn-outline" id="amEditBtn"><i class="fa-solid fa-pen-to-square"></i> Edit Info</button>
      <button type="button" class="btn-outline" id="amResetBtn"><i class="fa-solid fa-key"></i> Reset Password</button>
    `);
  }
}

/* ============================================================
   MODALS
   ============================================================ */
function amRoleOptions(selected) {
  return AM_ROLES.map(r => `<option value="${r.value}" ${r.value === selected ? 'selected' : ''}>${r.label}</option>`).join('');
}

function amPwField(id, label, placeholder) {
  return `
    <label class="field-label" for="${id}">${label}</label>
    <div class="input-group">
      <i class="fa-solid fa-lock"></i>
      <input type="password" id="${id}" autocomplete="new-password" placeholder="${placeholder || ''}">
      <button type="button" class="am-eye" data-am-eye="${id}" title="Show / hide"><i class="fa-solid fa-eye"></i></button>
    </div>
  `;
}

function amInjectModals() {
  if (document.getElementById('amAddModalOverlay')) return;

  const html = `
    <!-- ================= ADD ACCOUNT ================= -->
    <div class="modal-overlay" id="amAddModalOverlay">
      <div class="modal-box glass am-modal">
        <div class="modal-header">
          <h2><i class="fa-solid fa-user-plus"></i> Add Account</h2>
          <button type="button" class="modal-close" data-am-close="amAddModalOverlay">&times;</button>
        </div>
        <div class="modal-body">

          <form id="amAddForm" autocomplete="off" novalidate>
            <div class="form-row">
              <div class="am-col">
                <label class="field-label" for="amAddFirst">First name</label>
                <div class="input-group"><i class="fa-solid fa-user"></i><input type="text" id="amAddFirst" maxlength="50"></div>
              </div>
              <div class="am-col">
                <label class="field-label" for="amAddLast">Last name</label>
                <div class="input-group"><i class="fa-solid fa-user"></i><input type="text" id="amAddLast" maxlength="50"></div>
              </div>
            </div>

            <div class="form-row">
              <div class="am-col">
                <label class="field-label" for="amAddUsername">Username</label>
                <div class="input-group"><i class="fa-solid fa-at"></i><input type="text" id="amAddUsername" maxlength="30"></div>
              </div>
              <div class="am-col">
                <label class="field-label" for="amAddRole">Role</label>
                <div class="input-group"><i class="fa-solid fa-user-tag"></i>
                  <select id="amAddRole">${amRoleOptions('employee')}</select>
                </div>
              </div>
            </div>

            <label class="field-label" for="amAddEmail">Email</label>
            <div class="input-group"><i class="fa-solid fa-envelope"></i><input type="email" id="amAddEmail" maxlength="100"></div>

            <div class="am-pw-head">
              <span><i class="fa-solid fa-key"></i> Password</span>
              <button type="button" class="am-link-btn" data-am-generate="amAddPw,amAddPw2"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button>
            </div>
            <div class="form-row">
              <div class="am-col">${amPwField('amAddPw', 'Password', 'At least 6 characters')}</div>
              <div class="am-col">${amPwField('amAddPw2', 'Confirm password')}</div>
            </div>

            <p class="am-note"><i class="fa-solid fa-circle-check"></i> The account is <b>approved right away</b> and can log in immediately.</p>
            <div id="amAddError" class="form-error"></div>

            <button type="submit" class="btn-primary full-width"><i class="fa-solid fa-user-plus"></i> Create Account</button>
          </form>

          <!-- shown after creating -->
          <div id="amAddDone" style="display:none;"></div>
        </div>
      </div>
    </div>

    <!-- ================= EDIT INFO ================= -->
    <div class="modal-overlay" id="amEditModalOverlay">
      <div class="modal-box glass am-modal">
        <div class="modal-header">
          <h2><i class="fa-solid fa-pen-to-square"></i> Edit Account Info</h2>
          <button type="button" class="modal-close" data-am-close="amEditModalOverlay">&times;</button>
        </div>
        <div class="modal-body">
          <form id="amEditForm" autocomplete="off" novalidate>
            <div class="am-who" id="amEditWho"></div>

            <div class="form-row">
              <div class="am-col">
                <label class="field-label" for="amEditFirst">First name</label>
                <div class="input-group"><i class="fa-solid fa-user"></i><input type="text" id="amEditFirst" maxlength="50"></div>
              </div>
              <div class="am-col">
                <label class="field-label" for="amEditLast">Last name</label>
                <div class="input-group"><i class="fa-solid fa-user"></i><input type="text" id="amEditLast" maxlength="50"></div>
              </div>
            </div>

            <label class="field-label" for="amEditUsername">Username</label>
            <div class="input-group"><i class="fa-solid fa-at"></i><input type="text" id="amEditUsername" maxlength="30"></div>

            <label class="field-label" for="amEditEmail">Email</label>
            <div class="input-group"><i class="fa-solid fa-envelope"></i><input type="email" id="amEditEmail" maxlength="100"></div>

            <p class="am-note"><i class="fa-solid fa-circle-info"></i> Use <b>Change Role</b> below the profile to change the role, and <b>Reset Password</b> for the password.</p>
            <div id="amEditError" class="form-error"></div>

            <button type="submit" class="btn-primary full-width"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
          </form>
        </div>
      </div>
    </div>

    <!-- ================= RESET PASSWORD ================= -->
    <div class="modal-overlay" id="amResetModalOverlay">
      <div class="modal-box glass am-modal">
        <div class="modal-header">
          <h2><i class="fa-solid fa-key"></i> Reset Password</h2>
          <button type="button" class="modal-close" data-am-close="amResetModalOverlay">&times;</button>
        </div>
        <div class="modal-body">
          <form id="amResetForm" autocomplete="off" novalidate>
            <div class="am-who" id="amResetWho"></div>

            <div class="am-pw-head">
              <span><i class="fa-solid fa-key"></i> New password</span>
              <button type="button" class="am-link-btn" data-am-generate="amResetPw,amResetPw2"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button>
            </div>
            ${amPwField('amResetPw', 'New password', 'At least 6 characters')}
            ${amPwField('amResetPw2', 'Confirm new password')}

            <p class="am-note"><i class="fa-solid fa-bell"></i> The user will be notified that their password was changed by the administrator.</p>
            <div id="amResetError" class="form-error"></div>

            <button type="submit" class="btn-primary full-width"><i class="fa-solid fa-key"></i> Set New Password</button>
          </form>

          <div id="amResetDone" style="display:none;"></div>
        </div>
      </div>
    </div>
  `;

  const wrap = document.createElement('div');
  wrap.id = 'amModals';
  wrap.innerHTML = html;
  document.body.appendChild(wrap);

  ['amAddModalOverlay', 'amEditModalOverlay', 'amResetModalOverlay'].forEach(id => {
    if (typeof enableClickOutsideClose === 'function') enableClickOutsideClose(id);
  });
}

/* ============================================================
   EVENTS
   ============================================================ */
function amAttachEvents() {
  document.getElementById('amAddBtn').addEventListener('click', amOpenAdd);

  const editBtn = document.getElementById('amEditBtn');
  const resetBtn = document.getElementById('amResetBtn');
  if (editBtn) editBtn.addEventListener('click', () => amOpenEdit(amSelectedId()));
  if (resetBtn) resetBtn.addEventListener('click', () => amOpenReset(amSelectedId()));

  document.getElementById('amAddForm').addEventListener('submit', amHandleAdd);
  document.getElementById('amEditForm').addEventListener('submit', amHandleEdit);
  document.getElementById('amResetForm').addEventListener('submit', amHandleReset);

  document.getElementById('amModals').addEventListener('click', (e) => {
    const close = e.target.closest('[data-am-close]');
    if (close) closeModal(close.dataset.amClose);

    const eye = e.target.closest('[data-am-eye]');
    if (eye) amToggleEye(eye);

    const gen = e.target.closest('[data-am-generate]');
    if (gen) {
      const pw = amGeneratePassword();
      gen.dataset.amGenerate.split(',').forEach(id => {
        const input = document.getElementById(id);
        if (input) { input.value = pw; input.type = 'text'; }
      });
      document.querySelectorAll(`#amModals [data-am-eye]`).forEach(b => {
        const input = document.getElementById(b.dataset.amEye);
        if (input && input.type === 'text') b.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
      });
    }

    const copy = e.target.closest('[data-am-copy]');
    if (copy) amCopy(copy.dataset.amCopy, copy);

    const again = e.target.closest('[data-am-add-another]');
    if (again) amOpenAdd();

    const view = e.target.closest('[data-am-view]');
    if (view) {
      closeModal('amAddModalOverlay');
      if (typeof selectAccount === 'function') selectAccount(view.dataset.amView);
    }
  });
}

function amSelectedId() {
  try { return typeof cpSelectedAccountId !== 'undefined' ? cpSelectedAccountId : null; } catch (e) { return null; }
}

/* ============================================================
   ADD ACCOUNT
   ============================================================ */
function amOpenAdd() {
  const form = document.getElementById('amAddForm');
  form.reset();
  form.style.display = '';
  document.getElementById('amAddRole').value = 'employee';
  document.getElementById('amAddDone').style.display = 'none';
  document.getElementById('amAddDone').innerHTML = '';
  amResetEyes(['amAddPw', 'amAddPw2']);
  amError('amAddError', '');
  openModal('amAddModalOverlay');
  setTimeout(() => document.getElementById('amAddFirst').focus(), 150);
}

function amHandleAdd(e) {
  e.preventDefault();
  amError('amAddError', '');

  const data = {
    firstName: amVal('amAddFirst'),
    lastName: amVal('amAddLast'),
    username: amVal('amAddUsername'),
    email: amVal('amAddEmail'),
    role: document.getElementById('amAddRole').value
  };
  const pw = document.getElementById('amAddPw').value;
  const pw2 = document.getElementById('amAddPw2').value;

  const err = amValidateInfo(data, null) || amValidatePassword(pw, pw2);
  if (err) return amError('amAddError', err);
  if (!AM_ROLES.some(r => r.value === data.role)) return amError('amAddError', 'Please choose a valid role.');

  const me = getCurrentUser();
  const newUser = {
    id: generateId('USER'),
    firstName: data.firstName,
    lastName: data.lastName,
    username: data.username,
    email: data.email,
    passwordHash: hashPassword(pw),
    role: data.role,
    isLocked: false,
    isApproved: true,
    approvedAt: nowISO(),
    approvedBy: me ? me.id : null,
    createdBy: me ? me.id : null,
    createdAt: nowISO()
  };

  const users = getUsers();
  users.push(newUser);
  if (saveUsers(users) === false) return amError('amAddError', 'Could not save — browser storage is full.');

  if (me && typeof logActivity === 'function') {
    logActivity(me.id, 'account-create', `Created account for ${newUser.firstName} ${newUser.lastName} (@${newUser.username}, ${amRoleLabel(newUser.role)}).`);
  }

  if (typeof renderAccountList === 'function') renderAccountList();

  // show credentials
  const creds = `Name: ${newUser.firstName} ${newUser.lastName}\nUsername: ${newUser.username}\nPassword: ${pw}\nRole: ${amRoleLabel(newUser.role)}`;
  document.getElementById('amAddForm').style.display = 'none';
  const done = document.getElementById('amAddDone');
  done.innerHTML = `
    <div class="am-success">
      <i class="fa-solid fa-circle-check"></i>
      <h3>Account created</h3>
      <p>Give these login details to <b>${amEsc(newUser.firstName)}</b>. The password is shown only now.</p>
    </div>
    <div class="am-creds">
      <div><span>Username</span><b>${amEsc(newUser.username)}</b></div>
      <div><span>Password</span><b>${amEsc(pw)}</b></div>
      <div><span>Role</span><b>${amEsc(amRoleLabel(newUser.role))}</b></div>
    </div>
    <div class="am-done-actions">
      <button type="button" class="btn-outline" data-am-copy="${amEsc(creds)}"><i class="fa-solid fa-copy"></i> Copy details</button>
      <button type="button" class="btn-outline" data-am-add-another="1"><i class="fa-solid fa-user-plus"></i> Add another</button>
      <button type="button" class="btn-primary" data-am-view="${newUser.id}"><i class="fa-solid fa-arrow-right"></i> Open account</button>
    </div>
  `;
  done.style.display = '';
  showToast('Account created.', 'success');
}

/* ============================================================
   EDIT INFO
   ============================================================ */
function amOpenEdit(userId) {
  const user = userId ? findUserById(userId) : null;
  if (!user) return showToast('Select an account first.', 'error');

  _amEditingUserId = user.id;
  document.getElementById('amEditWho').innerHTML = amWhoHtml(user);
  document.getElementById('amEditFirst').value = user.firstName || '';
  document.getElementById('amEditLast').value = user.lastName || '';
  document.getElementById('amEditUsername').value = user.username || '';
  document.getElementById('amEditEmail').value = user.email || '';
  amError('amEditError', '');
  openModal('amEditModalOverlay');
}

function amHandleEdit(e) {
  e.preventDefault();
  amError('amEditError', '');

  const users = getUsers();
  const idx = users.findIndex(u => u.id === _amEditingUserId);
  if (idx === -1) return amError('amEditError', 'Account not found.');

  const data = {
    firstName: amVal('amEditFirst'),
    lastName: amVal('amEditLast'),
    username: amVal('amEditUsername'),
    email: amVal('amEditEmail')
  };
  const err = amValidateInfo(data, _amEditingUserId);
  if (err) return amError('amEditError', err);

  const before = users[idx];
  const changes = [];
  if (before.firstName !== data.firstName || before.lastName !== data.lastName) changes.push('name');
  if (before.username !== data.username) changes.push('username');
  if ((before.email || '') !== data.email) changes.push('email');

  if (!changes.length) {
    closeModal('amEditModalOverlay');
    return showToast('No changes to save.', 'info');
  }

  users[idx] = { ...before, ...data, updatedAt: nowISO() };
  if (saveUsers(users) === false) return amError('amEditError', 'Could not save — browser storage is full.');

  const me = getCurrentUser();

  // editing your own account → keep the session + sidebar in sync
  if (me && me.id === before.id) {
    const s = getSession();
    if (s) saveSession({ ...s, username: data.username, firstName: data.firstName, lastName: data.lastName });
    const nameEl = document.querySelector('.sidebar-profile .profile-name');
    if (nameEl) nameEl.textContent = `${data.firstName} ${data.lastName}`;
  } else if (typeof createNotification === 'function') {
    createNotification(before.id, 'account-updated', 'Account details updated',
      `The administrator updated your ${changes.join(', ')}.`);
  }

  if (me && typeof logActivity === 'function') {
    logActivity(me.id, 'account-edit', `Edited ${data.firstName} ${data.lastName}'s account (${changes.join(', ')}).`);
  }

  closeModal('amEditModalOverlay');
  if (typeof renderAccountList === 'function') renderAccountList();
  if (typeof renderAccountDetail === 'function') renderAccountDetail(before.id);
  showToast('Account info updated.', 'success');
}

/* ============================================================
   RESET PASSWORD
   ============================================================ */
function amOpenReset(userId) {
  const user = userId ? findUserById(userId) : null;
  if (!user) return showToast('Select an account first.', 'error');

  _amResetUserId = user.id;
  const form = document.getElementById('amResetForm');
  form.reset();
  form.style.display = '';
  document.getElementById('amResetWho').innerHTML = amWhoHtml(user);
  document.getElementById('amResetDone').style.display = 'none';
  document.getElementById('amResetDone').innerHTML = '';
  amResetEyes(['amResetPw', 'amResetPw2']);
  amError('amResetError', '');
  openModal('amResetModalOverlay');
}

function amHandleReset(e) {
  e.preventDefault();
  amError('amResetError', '');

  const pw = document.getElementById('amResetPw').value;
  const pw2 = document.getElementById('amResetPw2').value;
  const err = amValidatePassword(pw, pw2);
  if (err) return amError('amResetError', err);

  const users = getUsers();
  const idx = users.findIndex(u => u.id === _amResetUserId);
  if (idx === -1) return amError('amResetError', 'Account not found.');

  const user = users[idx];
  users[idx] = { ...user, passwordHash: hashPassword(pw), passwordChangedAt: nowISO(), updatedAt: nowISO() };
  if (saveUsers(users) === false) return amError('amResetError', 'Could not save — browser storage is full.');

  const me = getCurrentUser();
  if (me && typeof logActivity === 'function') {
    logActivity(me.id, 'password-reset', `Reset the password of ${user.firstName} ${user.lastName} (@${user.username}).`);
  }
  if (me && me.id !== user.id && typeof createNotification === 'function') {
    createNotification(user.id, 'password-reset', 'Password changed',
      'Your password was changed by the firm administrator. Please use the new password the next time you log in.');
  }

  const creds = `Username: ${user.username}\nNew password: ${pw}`;
  document.getElementById('amResetForm').style.display = 'none';
  const done = document.getElementById('amResetDone');
  done.innerHTML = `
    <div class="am-success">
      <i class="fa-solid fa-circle-check"></i>
      <h3>Password updated</h3>
      <p>Give the new password to <b>${amEsc(user.firstName)}</b>. It is shown only now.</p>
    </div>
    <div class="am-creds">
      <div><span>Username</span><b>${amEsc(user.username)}</b></div>
      <div><span>New password</span><b>${amEsc(pw)}</b></div>
    </div>
    <div class="am-done-actions">
      <button type="button" class="btn-outline" data-am-copy="${amEsc(creds)}"><i class="fa-solid fa-copy"></i> Copy details</button>
      <button type="button" class="btn-primary" data-am-close="amResetModalOverlay"><i class="fa-solid fa-check"></i> Done</button>
    </div>
  `;
  done.style.display = '';

  if (typeof renderAccountDetail === 'function') renderAccountDetail(user.id);
  showToast('Password updated.', 'success');
}

/* ============================================================
   VALIDATION
   ============================================================ */
function amValidateInfo(data, selfId) {
  if (!data.firstName || !data.lastName) return 'First name and last name are required.';
  if (!data.username) return 'Username is required.';
  if (data.username.length < 3) return 'Username must be at least 3 characters.';
  if (!/^[A-Za-z0-9._-]+$/.test(data.username)) return 'Username can only use letters, numbers, dot, dash and underscore.';
  if (!data.email) return 'Email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) return 'Please enter a valid email address.';

  const others = getUsers().filter(u => u.id !== selfId);
  const uname = data.username.toLowerCase();
  const email = data.email.toLowerCase();
  if (others.some(u => (u.username || '').toLowerCase() === uname || (u.email || '').toLowerCase() === uname)) {
    return 'That username is already taken.';
  }
  if (others.some(u => (u.email || '').toLowerCase() === email)) {
    return 'That email is already used by another account.';
  }
  return '';
}

function amValidatePassword(pw, pw2) {
  if (!pw || pw.length < 6) return 'Password must be at least 6 characters.';
  if (/\s/.test(pw)) return 'Password cannot contain spaces.';
  if (pw !== pw2) return 'Passwords do not match.';
  return '';
}

/* ============================================================
   HELPERS
   ============================================================ */
function amVal(id) {
  return document.getElementById(id).value.trim();
}

function amError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('active', !!msg);
}

function amRoleLabel(role) {
  if (typeof getRoleLabel === 'function') return getRoleLabel(role);
  const r = AM_ROLES.find(x => x.value === role);
  return r ? r.label : role;
}

function amWhoHtml(user) {
  const initials = ((user.firstName || '').charAt(0) + (user.lastName || '').charAt(0)).toUpperCase() || 'U';
  const avatar = user.profilePhoto
    ? `<img src="${user.profilePhoto}" alt="">`
    : amEsc(initials);
  return `
    <div class="am-who-avatar">${avatar}</div>
    <div>
      <strong>${amEsc(user.firstName)} ${amEsc(user.lastName)}</strong>
      <small>@${amEsc(user.username)} · ${amEsc(amRoleLabel(user.role))}</small>
    </div>
  `;
}

function amGeneratePassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const pick = (set) => set[Math.floor(Math.random() * set.length)];
  let pw = pick('ABCDEFGHJKLMNPQRSTUVWXYZ') + pick(digits) + pick(digits);
  while (pw.length < 10) pw += pick(all);
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}

function amToggleEye(btn) {
  const input = document.getElementById(btn.dataset.amEye);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = `<i class="fa-solid ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
}

function amResetEyes(ids) {
  ids.forEach(id => {
    const input = document.getElementById(id);
    if (input) input.type = 'password';
    const btn = document.querySelector(`[data-am-eye="${id}"]`);
    if (btn) btn.innerHTML = '<i class="fa-solid fa-eye"></i>';
  });
}

function amCopy(text, btn) {
  const done = () => {
    const old = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
    setTimeout(() => { btn.innerHTML = old; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => amCopyFallback(text, done));
  } else {
    amCopyFallback(text, done);
  }
}

function amCopyFallback(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { showToast('Copy failed — please copy manually.', 'error'); }
  ta.remove();
}

function amEsc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ============================================================
   STYLES
   ============================================================ */
function amInjectStyles() {
  if (document.getElementById('amStyles')) return;
  const style = document.createElement('style');
  style.id = 'amStyles';
  style.textContent = `
    .am-modal { max-width: 560px !important; }
    .am-col { flex: 1; min-width: 0; }

    .cp-profile-actions { flex-wrap: wrap; }

    .am-pw-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 4px 0 8px;
      padding-top: 12px;
      border-top: 1px solid var(--color-gray-border, #e0e0e0);
    }
    .am-pw-head span {
      font-size: 13px;
      font-weight: 700;
      color: var(--color-black, #1f2937);
    }
    .am-pw-head span i { color: var(--color-gold-dark, #a8862a); margin-right: 5px; }

    .am-link-btn {
      background: var(--primary-soft, rgba(201, 162, 39, .14));
      color: var(--color-gold-dark, #a8862a);
      font-size: 12px;
      font-weight: 700;
      padding: 5px 10px;
      border-radius: 6px;
    }
    .am-link-btn:hover { background: var(--color-gold, #c9a227); color: var(--on-accent, #1f2937); }

    .am-eye {
      background: none;
      color: var(--color-gray-text, #6b7280);
      padding: 0 12px;
      font-size: 13px;
    }
    .am-eye:hover { color: var(--color-gold-dark, #a8862a); }

    .am-note {
      font-size: 12px;
      line-height: 1.5;
      color: var(--color-gray-text, #6b7280);
      background: var(--color-gray-bg, #f6f5f1);
      border-left: 3px solid var(--color-gold, #c9a227);
      border-radius: 6px;
      padding: 8px 10px;
      margin: 2px 0 12px;
    }
    .am-note i { color: var(--color-gold-dark, #a8862a); margin-right: 4px; }

    .am-who {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      margin-bottom: 16px;
      border: 1px solid var(--color-gray-border, #e0e0e0);
      border-radius: var(--radius-sm, 8px);
      background: var(--color-gray-bg, #f6f5f1);
    }
    .am-who-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      overflow: hidden;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 14px;
      background: var(--gradient-accent, linear-gradient(135deg, #e6c75a, #a8862a));
      color: var(--on-accent, #1f2937);
    }
    .am-who-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .am-who strong { display: block; font-size: 13.5px; color: var(--color-black, #1f2937); }
    .am-who small { font-size: 11.5px; color: var(--color-gray-text, #6b7280); }

    .am-success {
      text-align: center;
      padding: 6px 0 14px;
    }
    .am-success > i {
      font-size: 40px;
      color: var(--color-success, #22a55a);
      margin-bottom: 8px;
    }
    .am-success h3 { font-size: 17px; margin-bottom: 4px; }
    .am-success p { font-size: 13px; color: var(--color-gray-text, #6b7280); }

    .am-creds {
      border: 1px dashed var(--color-gold, #c9a227);
      background: var(--primary-soft, rgba(201, 162, 39, .1));
      border-radius: var(--radius-sm, 8px);
      padding: 6px 14px;
      margin-bottom: 16px;
    }
    .am-creds div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px dashed var(--color-gray-border, #e0e0e0);
      font-size: 13px;
    }
    .am-creds div:last-child { border-bottom: none; }
    .am-creds span { color: var(--color-gray-text, #6b7280); }
    .am-creds b {
      font-family: 'Courier New', monospace;
      font-size: 14px;
      color: var(--color-black, #1f2937);
      word-break: break-all;
      text-align: right;
    }

    .am-done-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    @media (max-width: 600px) {
      .am-done-actions { flex-direction: column; }
      .am-done-actions button { width: 100%; }
    }
  `;
  document.head.appendChild(style);
}