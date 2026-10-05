/* ============================================================
   ABANTO LAW FIRM — LBC-BULK.JS
   Adds two things to the LBC Tracker without touching lbc.js:

   1. BULK DELETE
      - Checkbox on every shipment row + "Select all" in the header
      - Gold action bar shows "N selected · Clear · Delete Selected"
      - Selection stays while you search / sort; deleted rows drop out

   2. STATUS DROPDOWN OPTIONS (add / delete)
      - "Manage options" link beside the Status label in the
        Add/Edit Shipment modal
      - Add your own status (e.g. "Returned", "For Pickup")
      - Delete custom statuses (built-in Pending / In Transit /
        Delivered are locked). Shipments using a deleted status
        go back to Pending.
      - Custom statuses also work in the Excel import.

   Load AFTER lbc.js and lbc-import.js.
   Depends on: storage.js, modal.js, lbc.js
   ============================================================ */

const LBC_BULK = { selected: new Set() };

const LBC_STATUS_KEY = 'abanto_lbc_status_options';
const LBC_BUILTIN_STATUS = [
  { value: 'pending', label: 'Pending' },
  { value: 'in-transit', label: 'In Transit' },
  { value: 'delivered', label: 'Delivered' }
];

document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('shipmentTableBody');
  if (!tbody) return;

  lbcBulkInjectStyles();

  // ---- 1. BULK DELETE ----
  lbcBulkInjectBar();
  lbcBulkEnhanceTable();
  new MutationObserver(lbcBulkEnhanceTable).observe(tbody, { childList: true });
  lbcBulkAttachEvents();

  // ---- 2. STATUS OPTIONS ----
  lbcStatusPatchLabels();
  lbcStatusFillSelect();
  lbcStatusInjectManageLink();
  lbcStatusInjectModal();
  if (typeof renderShipmentTable === 'function') renderShipmentTable();
});

/* ============================================================
   1. BULK DELETE
   ============================================================ */
function lbcBulkInjectBar() {
  if (document.getElementById('lbcBulkBar')) return;
  const wrapper = document.getElementById('shipmentTableBody').closest('.table-wrapper');
  if (!wrapper) return;

  const bar = document.createElement('div');
  bar.className = 'lbcb-bar';
  bar.id = 'lbcBulkBar';
  bar.innerHTML = `
    <div class="lbcb-bar-info">
      <span class="lbcb-count" id="lbcBulkCount">0</span>
      <span id="lbcBulkCountLabel">shipment selected</span>
    </div>
    <div class="lbcb-bar-actions">
      <button type="button" class="lbcb-btn lbcb-btn-ghost" id="lbcBulkClearBtn">
        <i class="fa-solid fa-xmark"></i> Clear
      </button>
      <button type="button" class="lbcb-btn lbcb-btn-danger" id="lbcBulkDeleteBtn">
        <i class="fa-solid fa-trash"></i> Delete Selected
      </button>
    </div>
  `;
  wrapper.parentNode.insertBefore(bar, wrapper);
}

/** Runs after every table render — adds the checkbox column */
function lbcBulkEnhanceTable() {
  const tbody = document.getElementById('shipmentTableBody');
  if (!tbody) return;
  const headRow = tbody.closest('table').querySelector('thead tr');

  if (headRow && !headRow.querySelector('.lbcb-th')) {
    const th = document.createElement('th');
    th.className = 'lbcb-th';
    th.innerHTML = '<input type="checkbox" id="lbcBulkSelectAll" class="lbcb-check" title="Select all shown">';
    headRow.insertBefore(th, headRow.firstChild);
  }

  // forget ids that no longer exist (deleted one by one, etc.)
  const existing = new Set(getShipments().map(s => s.id));
  LBC_BULK.selected.forEach(id => { if (!existing.has(id)) LBC_BULK.selected.delete(id); });

  tbody.querySelectorAll('tr').forEach(tr => {
    if (tr.querySelector('.lbcb-td')) return;

    if (tr.classList.contains('empty-row')) {
      const td = tr.querySelector('td');
      if (td && !td.dataset.lbcbFixed) {
        td.colSpan = (td.colSpan || 1) + 1;
        td.dataset.lbcbFixed = '1';
      }
      return;
    }

    const editBtn = tr.querySelector('[data-edit-shipment]');
    if (!editBtn) return;
    const id = editBtn.dataset.editShipment;
    const isSel = LBC_BULK.selected.has(id);

    const td = document.createElement('td');
    td.className = 'lbcb-td';
    td.dataset.label = 'Select';
    td.innerHTML = `<input type="checkbox" class="lbcb-check" data-lbcb-id="${id}" ${isSel ? 'checked' : ''}>`;
    tr.insertBefore(td, tr.firstChild);
    tr.classList.toggle('lbcb-selected', isSel);
  });

  lbcBulkRefreshUi();
}

function lbcBulkAttachEvents() {
  const table = document.getElementById('shipmentTableBody').closest('table');

  table.addEventListener('change', (e) => {
    const t = e.target;

    if (t.id === 'lbcBulkSelectAll') {
      table.querySelectorAll('tbody [data-lbcb-id]').forEach(cb => {
        cb.checked = t.checked;
        lbcBulkSet(cb.dataset.lbcbId, t.checked, cb.closest('tr'));
      });
      lbcBulkRefreshUi();
    } else if (t.matches('[data-lbcb-id]')) {
      lbcBulkSet(t.dataset.lbcbId, t.checked, t.closest('tr'));
      lbcBulkRefreshUi();
    }
  });

  // click anywhere on the checkbox cell toggles it
  table.addEventListener('click', (e) => {
    const cell = e.target.closest('.lbcb-td');
    if (!cell || e.target.matches('input')) return;
    const cb = cell.querySelector('input');
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });

  document.getElementById('lbcBulkClearBtn').addEventListener('click', lbcBulkClear);
  document.getElementById('lbcBulkDeleteBtn').addEventListener('click', lbcBulkDelete);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && LBC_BULK.selected.size && !document.querySelector('.modal-overlay.active, .modal-overlay.show, .modal-overlay.open')) {
      lbcBulkClear();
    }
  });
}

function lbcBulkSet(id, on, tr) {
  if (on) LBC_BULK.selected.add(id); else LBC_BULK.selected.delete(id);
  if (tr) tr.classList.toggle('lbcb-selected', on);
}

function lbcBulkClear() {
  LBC_BULK.selected.clear();
  document.querySelectorAll('#shipmentTableBody [data-lbcb-id]').forEach(cb => {
    cb.checked = false;
    cb.closest('tr').classList.remove('lbcb-selected');
  });
  lbcBulkRefreshUi();
}

function lbcBulkRefreshUi() {
  const n = LBC_BULK.selected.size;
  const bar = document.getElementById('lbcBulkBar');
  if (bar) bar.classList.toggle('show', n > 0);

  const count = document.getElementById('lbcBulkCount');
  const label = document.getElementById('lbcBulkCountLabel');
  if (count) count.textContent = n;
  if (label) label.textContent = n === 1 ? 'shipment selected' : 'shipments selected';

  const all = document.getElementById('lbcBulkSelectAll');
  if (all) {
    const boxes = Array.from(document.querySelectorAll('#shipmentTableBody [data-lbcb-id]'));
    const checked = boxes.filter(b => b.checked).length;
    all.checked = boxes.length > 0 && checked === boxes.length;
    all.indeterminate = checked > 0 && checked < boxes.length;
  }
}

function lbcBulkDelete() {
  const targets = getShipments().filter(s => LBC_BULK.selected.has(s.id));
  if (!targets.length) return;

  const docCount = targets.reduce((sum, s) => sum + (s.documents || []).length, 0);
  const n = targets.length;
  const message = `Delete ${n} shipment${n > 1 ? 's' : ''}?` +
    (docCount ? ` This will also delete ${docCount} uploaded document(s).` : '') +
    ' This cannot be undone.';

  confirmDelete(
    message,
    () => {
      const ids = new Set(targets.map(s => s.id));
      saveShipments(getShipments().filter(s => !ids.has(s.id)));

      const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
      if (user && typeof logActivity === 'function') {
        const list = targets.slice(0, 5).map(s => s.trackingNumber).join(', ');
        logActivity(user.id, 'lbc-edit', `Deleted ${n} LBC shipment(s): ${list}${n > 5 ? '…' : ''}.`);
      }

      LBC_BULK.selected.clear();
      renderShipmentTable();
      showToast(`${n} shipment${n > 1 ? 's' : ''} deleted.`, 'success');
    },
    'Delete Selected Shipments',
    `<i class="fa-solid fa-trash"></i> Delete ${n}`
  );
}

/* ============================================================
   2. STATUS DROPDOWN OPTIONS
   ============================================================ */
function lbcStatusGetCustom() {
  try {
    const list = JSON.parse(localStorage.getItem(LBC_STATUS_KEY));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function lbcStatusSaveCustom(list) {
  try {
    localStorage.setItem(LBC_STATUS_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    showToast('Could not save — browser storage is full.', 'error');
    return false;
  }
}

function lbcStatusAll() {
  return LBC_BUILTIN_STATUS.concat(lbcStatusGetCustom());
}

/** Custom statuses show their real label in the table + import */
function lbcStatusPatchLabels() {
  if (typeof getStatusLabel === 'function' && !getStatusLabel._lbcPatched) {
    const orig = getStatusLabel;
    const patched = function (status) {
      const c = lbcStatusGetCustom().find(o => o.value === status);
      return c ? c.label : orig(status);
    };
    patched._lbcPatched = true;
    window.getStatusLabel = patched;
  }

  if (typeof lbcImportStatusWord === 'function' && !lbcImportStatusWord._lbcPatched) {
    const origWord = lbcImportStatusWord;
    const patchedWord = function (text) {
      const t = String(text || '').trim().toLowerCase();
      const c = lbcStatusGetCustom().find(o => o.label.toLowerCase() === t);
      return c ? c.value : origWord(text);
    };
    patchedWord._lbcPatched = true;
    window.lbcImportStatusWord = patchedWord;
  }

  if (typeof lbcImportStatusLabel === 'function' && !lbcImportStatusLabel._lbcPatched) {
    const origLabel = lbcImportStatusLabel;
    const patchedLabel = function (status) {
      const c = lbcStatusGetCustom().find(o => o.value === status);
      return c ? c.label : origLabel(status);
    };
    patchedLabel._lbcPatched = true;
    window.lbcImportStatusLabel = patchedLabel;
  }
}

function lbcStatusFillSelect() {
  const sel = document.getElementById('shipmentStatus');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = lbcStatusAll()
    .map(o => `<option value="${lbcBulkEsc(o.value)}">${lbcBulkEsc(o.label)}</option>`)
    .join('');
  if (lbcStatusAll().some(o => o.value === current)) sel.value = current;
}

function lbcStatusInjectManageLink() {
  const sel = document.getElementById('shipmentStatus');
  if (!sel) return;
  const group = sel.closest('.input-group');
  const label = group && group.previousElementSibling;
  if (!label || !label.classList.contains('field-label') || label.querySelector('.lbcs-manage-link')) return;

  label.classList.add('lbcs-label');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lbcs-manage-link';
  btn.innerHTML = '<i class="fa-solid fa-sliders"></i> Manage options';
  btn.addEventListener('click', lbcStatusOpenManager);
  label.appendChild(btn);
}

function lbcStatusInjectModal() {
  if (document.getElementById('lbcStatusModalOverlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'lbcStatusModalOverlay';
  overlay.innerHTML = `
    <div class="modal-box glass lbcs-modal">
      <div class="modal-header">
        <h2><i class="fa-solid fa-list-check"></i> Status Options</h2>
        <button type="button" class="modal-close" id="lbcStatusCloseBtn">&times;</button>
      </div>
      <div class="modal-body">
        <label class="field-label">Current Options</label>
        <div class="lbcs-list" id="lbcStatusList"></div>

        <label class="field-label">Add New Option</label>
        <form id="lbcStatusAddForm" class="lbcs-add" autocomplete="off">
          <div class="input-group">
            <i class="fa-solid fa-tag"></i>
            <input type="text" id="lbcStatusNewLabel" maxlength="30" placeholder="e.g. Returned, For Pickup" required>
          </div>
          <button type="submit" class="btn-primary"><i class="fa-solid fa-plus"></i> Add</button>
        </form>
        <div class="lbcs-hint">
          <i class="fa-solid fa-lock"></i> Pending, In Transit and Delivered are built-in and cannot be deleted.
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('lbcStatusCloseBtn').addEventListener('click', () => closeModal('lbcStatusModalOverlay'));
  if (typeof enableClickOutsideClose === 'function') enableClickOutsideClose('lbcStatusModalOverlay');

  document.getElementById('lbcStatusAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    lbcStatusAdd();
  });

  // delete flow is inline (no second modal on top of this one)
  document.getElementById('lbcStatusList').addEventListener('click', (e) => {
    const row = e.target.closest('.lbcs-row');
    if (!row) return;
    if (e.target.closest('[data-lbcs-ask]')) row.classList.add('confirming');
    else if (e.target.closest('[data-lbcs-cancel]')) row.classList.remove('confirming');
    else if (e.target.closest('[data-lbcs-confirm]')) lbcStatusDelete(row.dataset.value);
  });
}

function lbcStatusOpenManager() {
  lbcStatusRenderList();
  document.getElementById('lbcStatusNewLabel').value = '';
  openModal('lbcStatusModalOverlay');
}

function lbcStatusRenderList() {
  const box = document.getElementById('lbcStatusList');
  if (!box) return;
  const usage = {};
  getShipments().forEach(s => { usage[s.status] = (usage[s.status] || 0) + 1; });
  const esc = lbcBulkEsc;

  box.innerHTML = lbcStatusAll().map(o => {
    const builtIn = LBC_BUILTIN_STATUS.some(b => b.value === o.value);
    const used = usage[o.value] || 0;
    return `
      <div class="lbcs-row" data-value="${esc(o.value)}">
        <span class="badge badge-${esc(o.value)}">${esc(o.label)}</span>
        <span class="lbcs-usage">${used} shipment${used === 1 ? '' : 's'}</span>
        ${builtIn
          ? '<span class="lbcs-lock" title="Built-in"><i class="fa-solid fa-lock"></i></span>'
          : `<div class="lbcs-actions">
               <button type="button" class="lbcs-del" data-lbcs-ask title="Delete option"><i class="fa-solid fa-trash"></i></button>
               <div class="lbcs-confirm">
                 <small>${used ? `${used} will be set to Pending.` : 'Delete?'}</small>
                 <button type="button" class="lbcs-yes" data-lbcs-confirm>Delete</button>
                 <button type="button" class="lbcs-no" data-lbcs-cancel>Cancel</button>
               </div>
             </div>`}
      </div>
    `;
  }).join('');
}

function lbcStatusAdd() {
  const input = document.getElementById('lbcStatusNewLabel');
  const label = input.value.replace(/\s+/g, ' ').trim();
  if (!label) return;

  if (lbcStatusAll().some(o => o.label.toLowerCase() === label.toLowerCase())) {
    showToast(`"${label}" already exists.`, 'error');
    return;
  }

  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'status';
  const list = lbcStatusGetCustom();
  list.push({ value: `lbcs-${slug}-${Date.now().toString(36)}`, label });
  if (!lbcStatusSaveCustom(list)) return;

  input.value = '';
  lbcStatusFillSelect();
  lbcStatusRenderList();
  showToast(`Status "${label}" added.`, 'success');
}

function lbcStatusDelete(value) {
  const list = lbcStatusGetCustom();
  const item = list.find(o => o.value === value);
  if (!item) return;

  if (!lbcStatusSaveCustom(list.filter(o => o.value !== value))) return;

  let moved = 0;
  const shipments = getShipments().map(s => {
    if (s.status !== value) return s;
    moved++;
    return { ...s, status: 'pending', updatedAt: typeof nowISO === 'function' ? nowISO() : s.updatedAt };
  });
  if (moved) saveShipments(shipments);

  lbcStatusFillSelect();
  lbcStatusRenderList();
  if (typeof renderShipmentTable === 'function') renderShipmentTable();
  showToast(`Status "${item.label}" deleted${moved ? ` — ${moved} shipment(s) set to Pending` : ''}.`, 'success');
}

/* ============================================================
   HELPERS
   ============================================================ */
function lbcBulkEsc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   STYLES (theme variables — Light / Dark ready)
   ============================================================ */
function lbcBulkInjectStyles() {
  if (document.getElementById('lbcBulkStyles')) return;
  const style = document.createElement('style');
  style.id = 'lbcBulkStyles';
  style.textContent = `
    /* ---------- checkbox column ---------- */
    .lbcb-th, .lbcb-td { width: 44px; text-align: center !important; cursor: pointer; }
    .lbcb-check {
      width: 17px; height: 17px; cursor: pointer; vertical-align: middle;
      accent-color: var(--color-gold, #EAB52A);
    }
    #shipmentTableBody tr.lbcb-selected td { background: var(--row-hover, #FDF6E3); }
    #shipmentTableBody tr.lbcb-selected td:first-child { box-shadow: inset 4px 0 0 var(--color-gold, #EAB52A); }

    /* ---------- bulk action bar ---------- */
    .lbcb-bar {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
      max-height: 0; opacity: 0; overflow: hidden; margin-bottom: 0; padding: 0 16px;
      border-radius: var(--radius-md, 12px);
      background: var(--color-black, #130D1D); color: #fff;
      transform: translateY(-6px);
      transition: max-height .3s var(--ease-out, ease), opacity .25s ease, transform .3s var(--ease-out, ease),
                  padding .3s ease, margin .3s ease;
    }
    .lbcb-bar.show {
      max-height: 90px; opacity: 1; padding: 10px 16px; margin-bottom: 14px; transform: none;
      box-shadow: 0 10px 24px rgba(19,13,29,.18);
    }
    .lbcb-bar-info { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; }
    .lbcb-count {
      min-width: 30px; height: 30px; padding: 0 8px; border-radius: 999px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tile-orange, #EAB52A); color: #fff; font-weight: 800; font-size: 13px;
    }
    .lbcb-bar-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .lbcb-btn {
      display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; cursor: pointer;
      border-radius: 999px; font-size: 12.5px; font-weight: 700; border: 1px solid transparent;
      transition: background .2s ease, color .2s ease, border-color .2s ease;
    }
    .lbcb-btn-ghost { background: transparent; color: #fff; border-color: rgba(255,255,255,.25); }
    .lbcb-btn-ghost:hover { border-color: var(--color-gold, #EAB52A); color: var(--color-gold, #EAB52A); }
    .lbcb-btn-danger { background: var(--color-danger, #D9534F); color: #fff; }
    .lbcb-btn-danger:hover { background: #b93f3b; }

    /* ---------- status manage link ---------- */
    .field-label.lbcs-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .lbcs-manage-link {
      display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; cursor: pointer;
      border-radius: 999px; border: 1px solid var(--color-gray-border, #E8E4DA);
      background: var(--card-bg, #fff); color: var(--color-gold-dark, #A17421);
      font-size: 11px; font-weight: 700; text-transform: none; letter-spacing: 0;
      transition: background .2s ease, color .2s ease, border-color .2s ease;
    }
    .lbcs-manage-link:hover { background: var(--tile-orange, #EAB52A); border-color: transparent; color: #fff; }

    /* ---------- status manager modal ---------- */
    .lbcs-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
    .lbcs-row {
      display: flex; align-items: center; gap: 10px; padding: 10px 12px;
      border: 1px solid var(--color-gray-border, #E8E4DA); border-radius: var(--radius-md, 12px);
      background: var(--card-bg, #fff);
      transition: border-color .2s ease, background .2s ease;
    }
    .lbcs-row:hover { border-color: var(--primary-soft-2, rgba(234,181,42,.24)); }
    .lbcs-row.confirming { border-color: var(--color-danger, #D9534F); background: rgba(217,83,79,.06); }
    .lbcs-usage { flex: 1; font-size: 11.5px; color: var(--color-gray-text, #6A6377); }
    .lbcs-lock { color: var(--color-gray-text, #6A6377); font-size: 12px; opacity: .7; }
    .lbcs-actions { display: flex; align-items: center; gap: 6px; }
    .lbcs-del {
      width: 30px; height: 30px; border-radius: 50%; cursor: pointer; border: none;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; color: var(--color-danger, #D9534F); font-size: 12.5px;
      transition: background .2s ease, color .2s ease;
    }
    .lbcs-del:hover { background: var(--color-danger, #D9534F); color: #fff; }
    .lbcs-confirm { display: none; align-items: center; gap: 6px; }
    .lbcs-confirm small { font-size: 11px; color: var(--color-danger, #D9534F); font-weight: 600; }
    .lbcs-row.confirming .lbcs-del { display: none; }
    .lbcs-row.confirming .lbcs-confirm { display: flex; }
    .lbcs-yes, .lbcs-no {
      padding: 5px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 700; cursor: pointer;
      border: 1px solid transparent;
    }
    .lbcs-yes { background: var(--color-danger, #D9534F); color: #fff; }
    .lbcs-no { background: transparent; color: var(--color-gray-text, #6A6377); border-color: var(--color-gray-border, #E8E4DA); }

    .lbcs-add { display: flex; gap: 8px; align-items: stretch; }
    .lbcs-add .input-group { flex: 1; margin-bottom: 0; }
    .lbcs-add .btn-primary { flex-shrink: 0; white-space: nowrap; }
    .lbcs-hint { margin-top: 12px; font-size: 11.5px; color: var(--color-gray-text, #6A6377); }
    .lbcs-hint i { color: var(--color-gold-dark, #A17421); margin-right: 4px; }

    /* custom status badge (khaki) */
    .badge[class*="badge-lbcs-"] {
      background: rgba(182,165,123,.22); color: #7A6A42; border: 1px solid rgba(182,165,123,.45);
    }
    html[data-theme="dark"] .badge[class*="badge-lbcs-"] { color: #D8C99E; }

    @media (max-width: 600px) {
      .lbcb-bar.show { max-height: 160px; }
      .lbcb-bar-actions, .lbcb-btn { width: 100%; }
      .lbcb-btn { justify-content: center; flex: 1; }
      .lbcs-add { flex-direction: column; }
      .lbcs-row { flex-wrap: wrap; }
    }
  `;
  document.head.appendChild(style);
}