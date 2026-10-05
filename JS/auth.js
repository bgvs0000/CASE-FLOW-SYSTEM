/* ============================================================
   CASEFLOW — AUTH.JS
   Handles: Session creation/validation, Login, Logout,
   Page-guarding.

   UPDATED: public Registration + OTP and Forgot Password + OTP
   were REMOVED. All accounts are now created and managed by the
   Attorney in the Control Panel (account-manager.js):
   Add Account, Edit Info, Reset Password, Role, Lock, Delete.

   Kept: the approval check — any old account that is still
   pending (from before this change) cannot log in until the
   Attorney approves it in the Control Panel.

   Depends on: storage.js (must be loaded before this file)
   ============================================================ */

/* ---------- SESSION HELPERS ---------- */

function createSession(user) {
  const session = {
    userId: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    loginAt: nowISO()
  };
  saveSession(session);
  return session;
}

function getCurrentUser() {
  const session = getSession();
  if (!session) return null;
  return findUserById(session.userId);
}

function logoutUser() {
  const user = getCurrentUser();
  if (user && typeof logActivity === 'function') {
    logActivity(user.id, 'logout', `${user.firstName} ${user.lastName} logged out.`);
  }
  clearSession();
  window.location.href = 'index.html';
}

/**
 * Page guard — call at the top of every page after login.
 * Sends the user back to the login page if there is no valid
 * session, the account was deleted, locked, or is not approved.
 */
function requireAuth() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }

  const user = findUserById(session.userId);
  if (!user) {
    clearSession();
    window.location.href = 'index.html';
    return null;
  }

  if (user.isLocked) {
    clearSession();
    window.location.href = 'index.html';
    return null;
  }

  if (!isAccountApproved(user)) {
    clearSession();
    window.location.href = 'index.html';
    return null;
  }

  return session;
}

/* ---------- LOGIN ---------- */

function loginUser(usernameOrEmail, password) {
  const identifier = (usernameOrEmail || '').trim();
  if (!identifier || !password) {
    return { success: false, message: 'Please enter your username and password.' };
  }

  const user = findUserByUsernameOrEmail(identifier);
  if (!user) {
    return { success: false, message: 'Account not found. Please contact the Attorney to create your account.' };
  }

  if (user.isLocked) {
    return { success: false, message: 'This account has been locked. Please contact the Attorney.' };
  }

  // old pending accounts (from before public registration was removed)
  if (!isAccountApproved(user)) {
    return { success: false, message: 'This account is not yet approved. Please contact the Attorney.' };
  }

  if (!verifyPassword(password, user.passwordHash)) {
    return { success: false, message: 'Incorrect password. If you forgot it, ask the Attorney to reset it.' };
  }

  createSession(user);

  if (typeof logActivity === 'function') {
    logActivity(user.id, 'login', `${user.firstName} ${user.lastName} logged in.`);
  }

  return { success: true, user };
}