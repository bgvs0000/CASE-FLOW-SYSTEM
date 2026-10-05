/* ============================================================
   CASEFLOW — MODAL.JS
   Reusable modal open/close helpers + a generic confirm-delete
   dialog used across every module (Clients, Cases, Documents,
   Hearings, etc).
   Depends on: shared.css (.modal-overlay / .modal-box classes)
   ============================================================ */

/* ---------- OPEN / CLOSE ---------- */

/**
 * Opens a modal overlay by its element ID.
 */
function openModal(modalId) {
  const overlay = document.getElementById(modalId);
  if (!overlay) {
    console.error(`[modal.js] Modal overlay not found: #${modalId}`);
    return;
  }
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden'; // prevent background scroll
}

/**
 * Closes a modal overlay by its element ID.
 */
function closeModal(modalId) {
  const overlay = document.getElementById(modalId);
  if (!overlay) return;
  overlay.classList.remove('active');

  // Only restore scroll if no other modal is currently active
  const anyActive = document.querySelector('.modal-overlay.active');
  if (!anyActive) {
    document.body.style.overflow = '';
  }
}

/**
 * Closes ALL currently active modals. Useful after a save action
 * that should reset the UI back to the base page.
 */
function closeAllModals() {
  document.querySelectorAll('.modal-overlay.active').forEach(el => {
    el.classList.remove('active');
  });
  document.body.style.overflow = '';
}

/* ---------- CLICK-OUTSIDE-TO-CLOSE ---------- */

/**
 * Attaches click-outside-to-close behavior to a modal overlay.
 * Clicking the dark backdrop (NOT the modal box itself) closes it.
 * Call this once per modal overlay during page init.
 */
function enableClickOutsideClose(modalId) {
  const overlay = document.getElementById(modalId);
  if (!overlay) return;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal(modalId);
    }
  });
}

/* ---------- ESC KEY TO CLOSE ---------- */

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const activeModal = document.querySelector('.modal-overlay.active');
    if (activeModal) {
      closeModal(activeModal.id);
    }
  }
});

/* ---------- GENERIC CONFIRM-DELETE MODAL ----------
   A single reusable confirm modal injected once into the page
   (see injectConfirmModal()). Any module can call
   confirmDelete(message, onConfirmCallback) to trigger it,
   instead of building a custom confirm modal per page.
------------------------------------------------------------ */

const CONFIRM_MODAL_ID = 'globalConfirmModal';
let _confirmCallback = null;

/**
 * Injects the shared confirm-delete modal markup into the page.
 * Call this once on DOMContentLoaded from each page's JS file.
 */
function injectConfirmModal() {
  if (document.getElementById(CONFIRM_MODAL_ID)) return; // already injected

  const wrapper = document.createElement('div');
  wrapper.className = 'modal-overlay';
  wrapper.id = CONFIRM_MODAL_ID;
  wrapper.style.zIndex = '1100'; // ← BAGONG LINYA — palaging nasa ibabaw ng ibang modals
  wrapper.innerHTML = `
    <div class="modal-box confirm-box glass">
      <i class="fa-solid fa-triangle-exclamation confirm-icon"></i>
      <h3 id="confirmModalTitle">Are you sure?</h3>
      <p id="confirmModalMessage">This action cannot be undone.</p>
      <div class="confirm-actions">
        <button class="btn-outline" id="confirmModalCancelBtn">Cancel</button>
        <button class="btn-danger" id="confirmModalConfirmBtn">
          <i class="fa-solid fa-trash"></i> Delete
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper);

  document.getElementById('confirmModalCancelBtn').addEventListener('click', () => {
    _confirmCallback = null;
    closeModal(CONFIRM_MODAL_ID);
  });

  document.getElementById('confirmModalConfirmBtn').addEventListener('click', () => {
    if (typeof _confirmCallback === 'function') {
      _confirmCallback();
    }
    _confirmCallback = null;
    closeModal(CONFIRM_MODAL_ID);
  });

  enableClickOutsideClose(CONFIRM_MODAL_ID);
}

/**
 * Opens the shared confirm modal with a custom message and
 * a callback to run if the user confirms.
 *
 * Example:
 *   confirmDelete('Delete client "Juan Dela Cruz"? This cannot be undone.', () => {
 *     // deletion logic here
 *   });
 *
 * Optional 4th/5th params let callers customize title + button label
 * (e.g. for non-destructive confirmations like "Logout" or "Approve").
 */
function confirmDelete(message, onConfirm, title = 'Are you sure?', confirmLabel = null, iconClass = null) {
  injectConfirmModal(); // safety net in case a page forgot to call it on load

  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalMessage').textContent = message;

  const confirmBtn = document.getElementById('confirmModalConfirmBtn');
  confirmBtn.innerHTML = confirmLabel
    ? confirmLabel
    : `<i class="fa-solid fa-trash"></i> Delete`;

  const iconEl = document.querySelector(`#${CONFIRM_MODAL_ID} .confirm-icon`);
  if (iconEl) {
    iconEl.className = `fa-solid ${iconClass || 'fa-triangle-exclamation'} confirm-icon`;
  }

  _confirmCallback = onConfirm;
  openModal(CONFIRM_MODAL_ID);
}

/* ---------- TOASTS (used alongside modals for feedback) ---------- */

/**
 * Shows a small toast notification in the bottom-right corner.
 * type: 'success' | 'error' | 'info'
 */
function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    info: 'fa-circle-info'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}