/* ============================================================
   CASEFLOW — INDEX.JS
   Login page only.

   Public Register and Forgot Password were REMOVED. Every account
   is now created and managed by the Attorney in the Control Panel
   (Add Account, Edit Info, Reset Password, Role, Lock, Delete).
   Users who forgot their password should ask the Attorney.

   Depends on: storage.js, auth.js, modal.js (loaded before this)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ---------- IF ALREADY LOGGED IN, SKIP LOGIN PAGE ---------- */
  const existingSession = getSession();
  if (existingSession && findUserById(existingSession.userId)) {
    window.location.href = 'dashboard.html';
    return;
  }

  /* ---------- FOOTER YEAR ---------- */
  const yearEl = document.getElementById('currentYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- ELEMENTS ---------- */
  const loginForm = document.getElementById('loginForm');
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const togglePasswordIcon = document.getElementById('toggleLoginPassword');
  const loginBtn = loginForm ? loginForm.querySelector('button[type="submit"]') : null;

  if (!loginForm) return;

  /* ---------- ERROR HELPERS ---------- */
  function showError(msg) {
    if (!loginError) return;
    loginError.textContent = msg;
    loginError.classList.add('active');
  }
  function clearError() {
    if (!loginError) return;
    loginError.textContent = '';
    loginError.classList.remove('active');
  }

  /* ---------- LOGIN ---------- */
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearError();

    const username = loginUsername.value.trim();
    const password = loginPassword.value;

    if (!username || !password) {
      showError('Please enter your username and password.');
      return;
    }

    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';
    }

    const result = loginUser(username, password);

    if (!result.success) {
      showError(result.message);
      loginPassword.value = '';
      loginPassword.focus();
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> LOGIN';
      }
      return;
    }

    window.location.href = 'dashboard.html';
  });

  // clear the error as soon as the user types again
  [loginUsername, loginPassword].forEach(input => {
    if (input) input.addEventListener('input', clearError);
  });

  /* ---------- SHOW / HIDE PASSWORD ---------- */
  if (togglePasswordIcon) {
    togglePasswordIcon.addEventListener('click', () => {
      const isPassword = loginPassword.type === 'password';
      loginPassword.type = isPassword ? 'text' : 'password';
      togglePasswordIcon.classList.toggle('fa-eye');
      togglePasswordIcon.classList.toggle('fa-eye-slash');
    });
  }

  if (loginUsername) loginUsername.focus();
});