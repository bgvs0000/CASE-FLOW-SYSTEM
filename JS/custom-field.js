/* ============================================================
   CASEFLOW — CUSTOM-FIELDS.JS
   Shared "+" add-column engine used by Cases (dashboard.js),
   Clients (clients.js), and
   Documents (documents.js).

   UPDATED: each custom field VALUE cell now shows a small "×"
   button (visible only when the cell has a value) that clears
   just that one value for that one record — does NOT delete the
   field/column definition itself (that's what the manager modal's
   trash icon still does). Clearing a value requires each calling
   module to implement clearCustomFieldValue(module, recordId) —
   see the wiring note at the bottom of this file.

   Depends on: storage.js, modal.js (loaded before this file)
   ============================================================ */

let _cfModalInjected = false;
let _cfCurrentModule = null;
let _cfOnChangeCallback = null;

/* ============================================================
   PUBLIC: RENDER HELPERS
   ============================================================ */

function renderCustomFieldHeaders(module) {
  const fields = getCustomFieldsForModule(module);
  const fieldHeaders = fields.map(f => `<th>${escapeHtmlCF(f.fieldLabel)}</th>`).join('');
  return `${fieldHeaders}<th class="cf-add-column-th"><button type="button" class="cf-add-column-btn" data-cf-open-manager="${module}" title="Add/manage custom fields"><i class="fa-solid fa-plus"></i></button></th>`;
}

/**
 * UPDATED: now takes the record's id (recordId) so the per-value
 * clear button knows exactly which record + field to clear.
 * Each value cell shows a small "×" only when it has a value.
 */
function renderCustomFieldCells(module, record) {
  const fields = getCustomFieldsForModule(module);
  const values = record.customFields || {};
  const cells = fields.map(f => {
    const val = values[f.fieldKey];
    const hasValue = val !== undefined && val !== null && val !== '';
    return `
      <td class="cf-value-cell">
        ${hasValue
          ? `<span class="cf-value-text">${escapeHtmlCF(String(val))}</span>
             <button type="button" class="cf-clear-value-btn" data-cf-clear-value data-cf-module="${module}" data-cf-record-id="${record.id}" data-cf-field-key="${f.fieldKey}" title="Clear this value">
               <i class="fa-solid fa-xmark"></i>
             </button>`
          : '<span class="text-muted">—</span>'
        }
      </td>
    `;
  }).join('');
  return `${cells}<td></td>`;
}

function getCustomFieldColspan(module) {
  return getCustomFieldsForModule(module).length + 1;
}

function renderCustomFieldFormInputs(module, existingValues = {}) {
  const fields = getCustomFieldsForModule(module);
  if (fields.length === 0) return '';

  return `
    <div class="cf-form-section">
      <label class="field-label"><i class="fa-solid fa-list"></i> Custom Fields</label>
      ${fields.map(f => `
        <div class="input-group">
          <i class="fa-solid fa-tag"></i>
          <input type="${f.fieldType === 'number' ? 'number' : f.fieldType === 'date' ? 'date' : 'text'}"
                 id="cfInput_${f.fieldKey}" data-cf-key="${f.fieldKey}"
                 placeholder="${escapeHtmlCF(f.fieldLabel)}"
                 value="${existingValues[f.fieldKey] !== undefined ? escapeHtmlCF(String(existingValues[f.fieldKey])) : ''}">
        </div>
      `).join('')}
    </div>
  `;
}

function collectCustomFieldValues(module) {
  const fields = getCustomFieldsForModule(module);
  const values = {};
  fields.forEach(f => {
    const input = document.getElementById(`cfInput_${f.fieldKey}`);
    if (input) values[f.fieldKey] = input.value.trim();
  });
  return values;
}

/* ============================================================
   NEW: GENERIC PER-VALUE CLEAR HANDLER
   Works across ALL modules by reading/writing the correct
   storage collection based on `module`, using each module's
   already-existing getX()/saveX() functions from storage.js.
   This is the ONE place this logic lives — no module file needs
   its own copy.
   ============================================================ */
const CF_MODULE_STORAGE_MAP = {
  cases:     { get: () => getCases(),     save: (v) => saveCases(v) },
  clients:   { get: () => getClients(),   save: (v) => saveClients(v) },
  documents: { get: () => getDocuments(), save: (v) => saveDocuments(v) }
};

/**
 * Clears one custom field's value on one record, then calls the
 * provided re-render callback so the table reflects the change
 * immediately. Each module wires this once (see instructions
 * below) — the logic itself never needs duplicating.
 */
function clearCustomFieldValue(module, recordId, fieldKey, onDoneCallback) {
  const mapEntry = CF_MODULE_STORAGE_MAP[module];
  if (!mapEntry) {
    console.error(`[custom-fields.js] Unknown module "${module}" — cannot clear value.`);
    return;
  }

  const records = mapEntry.get();
  const idx = records.findIndex(r => r.id === recordId);
  if (idx === -1) return;

  if (!records[idx].customFields) return;

  delete records[idx].customFields[fieldKey];
  mapEntry.save(records);

  if (typeof onDoneCallback === 'function') onDoneCallback();
  if (typeof showToast === 'function') showToast('Value cleared.', 'success');
}

/**
 * Attaches ONE delegated click listener on a table's <tbody> (or
 * any container) that catches clicks on the "×" clear buttons
 * rendered by renderCustomFieldCells(), and clears the value via
 * clearCustomFieldValue() automatically. Call this once per page,
 * passing the container element and the table's own re-render
 * function. This means each module adds exactly ONE line to wire
 * this up — no per-module clear logic needed.
 */
function attachCustomFieldClearHandler(containerEl, rerenderCallback) {
  if (!containerEl) return;
  containerEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cf-clear-value]');
    if (!btn) return;

    const module = btn.dataset.cfModule;
    const recordId = btn.dataset.cfRecordId;
    const fieldKey = btn.dataset.cfFieldKey;

    clearCustomFieldValue(module, recordId, fieldKey, rerenderCallback);
  });
}

/* ============================================================
   MANAGE FIELDS MODAL (self-injected, shared across all modules)
   ============================================================ */
function injectCustomFieldsModal() {
  if (_cfModalInjected || document.getElementById('cfManagerModalOverlay')) return;
  _cfModalInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .cf-add-column-th { width: 44px; text-align: center !important; }
    .cf-add-column-btn {
      width: 26px; height: 26px; border-radius: 50%;
      background: rgba(255,255,255,0.15); color: var(--color-white);
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px; transition: all 0.15s ease;
    }
    .cf-add-column-btn:hover { background: var(--color-gold); color: var(--color-black); }
    .cf-value-cell { font-size: 13px; color: #444; display: flex; align-items: center; gap: 6px; }
    .cf-value-text { flex: 1; }
    .cf-clear-value-btn {
      width: 18px; height: 18px; border-radius: 50%; background: transparent;
      color: var(--color-gray-text); font-size: 9px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all 0.15s ease; opacity: 0.5;
    }
    .cf-clear-value-btn:hover { background: var(--color-danger); color: var(--color-white); opacity: 1; }
    .cf-form-section { margin: 6px 0 16px; padding: 14px; background: var(--color-gray-bg); border-radius: 8px; }
    .cf-existing-list { margin-bottom: 16px; }
    .cf-existing-row {
      display: flex; align-items: center; gap: 10px; padding: 10px 12px;
      background: var(--color-gray-bg); border-radius: 8px; margin-bottom: 8px;
    }
    .cf-existing-row .cf-field-name { flex: 1; font-size: 13px; font-weight: 600; }
    .cf-existing-row .cf-field-type { font-size: 11px; color: var(--color-gray-text); text-transform: uppercase; }
    .cf-existing-row .cf-delete-field-btn {
      width: 26px; height: 26px; border-radius: 50%; background: transparent;
      color: var(--color-danger); display: flex; align-items: center; justify-content: center;
    }
    .cf-existing-row .cf-delete-field-btn:hover { background: var(--color-danger); color: var(--color-white); }
    .cf-empty-msg { text-align: center; padding: 16px; color: var(--color-gray-text); font-size: 12.5px; }
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'cfManagerModalOverlay';
  modal.innerHTML = `
    <div class="modal-box glass">
      <div class="modal-header">
        <h2><i class="fa-solid fa-table-columns"></i> Custom Fields — <span id="cfModuleLabel"></span></h2>
        <button class="modal-close" id="cfCloseManagerModal">&times;</button>
      </div>
      <div class="modal-body">
        <label class="field-label">Existing Fields</label>
        <div class="cf-existing-list" id="cfExistingList"></div>

        <hr class="task-divider">

        <label class="field-label">Add New Field</label>
        <form id="cfAddFieldForm" autocomplete="off">
          <div class="input-group">
            <i class="fa-solid fa-heading"></i>
            <input type="text" id="cfNewFieldLabel" placeholder="Field name, e.g. Reference Number" required>
          </div>
          <div class="input-group">
            <i class="fa-solid fa-list-check"></i>
            <select id="cfNewFieldType">
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
            </select>
          </div>
          <button type="submit" class="btn-primary full-width"><i class="fa-solid fa-plus"></i> Add Field</button>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('cfCloseManagerModal').addEventListener('click', () => closeModal('cfManagerModalOverlay'));
  enableClickOutsideClose('cfManagerModalOverlay');

  document.getElementById('cfAddFieldForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const label = document.getElementById('cfNewFieldLabel').value.trim();
    const type = document.getElementById('cfNewFieldType').value;
    if (!label || !_cfCurrentModule) return;

    addCustomFieldDefinition(_cfCurrentModule, label, type);
    document.getElementById('cfAddFieldForm').reset();
    renderCfExistingList();
    if (typeof _cfOnChangeCallback === 'function') _cfOnChangeCallback();
    showToast('Custom field added.', 'success');
  });

  document.getElementById('cfExistingList').addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-cf-delete-field]');
    if (!delBtn) return;

    const fieldId = delBtn.dataset.cfDeleteField;
    const field = getCustomFieldDefinitions().find(f => f.id === fieldId);
    if (!field) return;

    confirmDelete(
      `Remove the custom field "${field.fieldLabel}"? Existing values already entered for it will no longer be shown.`,
      () => {
        deleteCustomFieldDefinition(fieldId);
        renderCfExistingList();
        if (typeof _cfOnChangeCallback === 'function') _cfOnChangeCallback();
        showToast('Custom field removed.', 'success');
      },
      'Remove Field',
      '<i class="fa-solid fa-trash"></i> Remove Field'
    );
  });
}

function renderCfExistingList() {
  const fields = getCustomFieldsForModule(_cfCurrentModule);
  const container = document.getElementById('cfExistingList');

  if (fields.length === 0) {
    container.innerHTML = `<div class="cf-empty-msg">No custom fields added yet for this table.</div>`;
    return;
  }

  container.innerHTML = fields.map(f => `
    <div class="cf-existing-row">
      <div>
        <div class="cf-field-name">${escapeHtmlCF(f.fieldLabel)}</div>
        <div class="cf-field-type">${f.fieldType}</div>
      </div>
      <button type="button" class="cf-delete-field-btn" data-cf-delete-field="${f.id}" title="Remove field">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `).join('');
}

function openCustomFieldsManager(module, moduleLabel, onChangeCallback) {
  injectCustomFieldsModal();
  _cfCurrentModule = module;
  _cfOnChangeCallback = onChangeCallback;

  document.getElementById('cfModuleLabel').textContent = moduleLabel;
  renderCfExistingList();
  openModal('cfManagerModalOverlay');
}

/* ============================================================
   LOCAL ESCAPE HELPER (scoped name, avoids collisions)
   ============================================================ */
function escapeHtmlCF(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}