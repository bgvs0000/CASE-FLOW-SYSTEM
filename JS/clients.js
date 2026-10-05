/* ============================================================
   CASEFLOW — CLIENTS.JS
   Client Module

   FEATURES:
   - Add / Edit / Delete clients
   - Render client cards (+ "PORTAL LOCKED" ribbon when locked)
   - Search / sort
   - View client details
   - Client Portal Access: Lock toggle, timed access duration,
     rotating 6-digit access code, shareable link
   - "Scan" button per client card -> Smart Client Document Routing
   - NEW: Custom Fields — a "Custom Fields" button in the page
     heading (card-grid layout has no table header to attach a
     "+" to) lets any user add extra fields (text/number/date)
     shown inside each client card, with per-value clear support.

   Depends on: storage.js, auth.js, modal.js, navigation.js,
   custom-fields.js (loaded before this file)
   ============================================================ */

const CF_MODULE_CLIENTS = 'clients';

let currentClientSession = null;
let clientSearchTerm = '';
let clientSortMode = 'az';
let currentShareClientId = null;
let _portalCodeRefreshInterval = null;

/* ============================================================
   INITIALIZATION
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  currentClientSession = requireAuth();
  if (!currentClientSession) return;

  initLayout('clients');
  injectCustomFieldsModal();
  attachCustomFieldClearHandler(document.getElementById('clientsGrid'), renderClientsGrid);

  renderClientsGrid();
  attachClientEvents();
});

/* ============================================================
   RENDER CLIENT CARDS
   ============================================================ */
function getFilteredSortedClients() {
  let clients = getClients();

  if (clientSearchTerm.trim()) {
    const q = clientSearchTerm.trim().toLowerCase();
    clients = clients.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.contact || '').toLowerCase().includes(q)
    );
  }

  switch (clientSortMode) {
    case 'az': clients.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
    case 'za': clients.sort((a, b) => (b.name || '').localeCompare(a.name || '')); break;
    case 'newest': clients.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); break;
    case 'oldest': clients.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); break;
  }

  return clients;
}

function getClientInitials(name) {
  const parts = (name || '').trim().split(/\s+/);
  const first = parts[0] ? parts[0].charAt(0) : '';
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase() || 'C';
}

/**
 * Custom fields inside a client card render as small labeled rows,
 * NOT as table cells (there's no table here) — same underlying
 * getCustomFieldsForModule() data, just a different visual wrapper.
 * The "×" clear button uses the exact same data-cf-* attributes as
 * the table version, so attachCustomFieldClearHandler() (wired to
 * #clientsGrid above) picks it up automatically — no special case
 * needed for cards vs tables.
 */
function renderClientCustomFieldRows(client) {
  const fields = getCustomFieldsForModule(CF_MODULE_CLIENTS);
  if (fields.length === 0) return '';

  const values = client.customFields || {};
  const rows = fields.map(f => {
    const val = values[f.fieldKey];
    const hasValue = val !== undefined && val !== null && val !== '';
    return `
      <div class="client-info-row cf-card-row">
        <i class="fa-solid fa-tag"></i>
        <span class="cf-card-label">${escapeHtml(f.fieldLabel)}:</span>
        ${hasValue
          ? `<span class="cf-value-text">${escapeHtml(String(val))}</span>
             <button type="button" class="cf-clear-value-btn" data-cf-clear-value data-cf-module="${CF_MODULE_CLIENTS}" data-cf-record-id="${client.id}" data-cf-field-key="${f.fieldKey}" title="Clear this value">
               <i class="fa-solid fa-xmark"></i>
             </button>`
          : '<span class="text-muted">—</span>'
        }
      </div>
    `;
  }).join('');

  return rows;
}

function renderClientsGrid() {
  const clients = getFilteredSortedClients();
  const grid = document.getElementById('clientsGrid');
  const allCases = getCases();

  if (clients.length === 0) {
    grid.innerHTML = `<p class="text-muted" id="noClientsMsg">No clients found.</p>`;
    return;
  }

  grid.innerHTML = clients.map(client => {
    const caseCount = allCases.filter(cs => cs.clientId === client.id).length;
    const lockedClass = client.isLocked ? 'portal-locked' : '';

    return `
      <div class="client-card ${lockedClass}">

        <div class="client-card-header">
          <div class="client-avatar">${getClientInitials(client.name)}</div>
          <div>
            <h3>${escapeHtml(client.name)}</h3>
            <div class="client-added-date">Added ${formatDate(client.createdAt)}</div>
          </div>
        </div>

        <div class="client-card-body">
          <div class="client-info-row">
            <i class="fa-solid fa-phone"></i>
            <span>${escapeHtml(client.contact || '—')}</span>
          </div>
          <div class="client-info-row">
            <i class="fa-solid fa-envelope"></i>
            <span>${escapeHtml(client.email || '—')}</span>
          </div>
          <div class="client-info-row">
            <i class="fa-solid fa-location-dot"></i>
            <span>${escapeHtml(client.address || '—')}</span>
          </div>
          ${renderClientCustomFieldRows(client)}
          <div class="client-case-count">
            <i class="fa-solid fa-folder"></i> ${caseCount} Case${caseCount === 1 ? '' : 's'}
          </div>
        </div>

        <div class="client-card-footer">
          <button data-view-client="${client.id}"><i class="fa-solid fa-eye"></i> View</button>
          <button data-edit-client="${client.id}"><i class="fa-solid fa-pen"></i> Edit</button>
          <button data-share-client="${client.id}"><i class="fa-solid fa-share-nodes"></i> Share</button>
          <button data-scan-client="${client.id}"><i class="fa-solid fa-robot"></i> Scan</button>
          <button class="danger" data-delete-client="${client.id}"><i class="fa-solid fa-trash"></i> Delete</button>
        </div>

      </div>
    `;
  }).join('');
}

/* ============================================================
   ADD / EDIT CLIENT MODAL
   ============================================================ */
function openAddClientModal() {
  document.getElementById('clientModalTitle').innerHTML = '<i class="fa-solid fa-user-plus"></i> Add Client';
  document.getElementById('clientForm').reset();
  document.getElementById('clientId').value = '';
  clearFormError('clientFormError');
  document.getElementById('clientCustomFieldsWrap').innerHTML = renderCustomFieldFormInputs(CF_MODULE_CLIENTS, {});
  openModal('clientModalOverlay');
}

function openEditClientModal(clientId) {
  const client = findClientById(clientId);
  if (!client) return;

  document.getElementById('clientModalTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Edit Client';
  clearFormError('clientFormError');

  document.getElementById('clientId').value = client.id;
  document.getElementById('clientName').value = client.name || '';
  document.getElementById('clientContact').value = client.contact || '';
  document.getElementById('clientEmail').value = client.email || '';
  document.getElementById('clientAddress').value = client.address || '';
  document.getElementById('clientCaseInfo').value = client.caseInfo || '';
  document.getElementById('clientNotes').value = client.notes || '';

  document.getElementById('clientCustomFieldsWrap').innerHTML = renderCustomFieldFormInputs(CF_MODULE_CLIENTS, client.customFields || {});

  openModal('clientModalOverlay');
}

function handleClientFormSubmit(e) {
  e.preventDefault();
  clearFormError('clientFormError');

  const id = document.getElementById('clientId').value;
  const name = document.getElementById('clientName').value.trim();
  const contact = document.getElementById('clientContact').value.trim();
  const email = document.getElementById('clientEmail').value.trim();
  const address = document.getElementById('clientAddress').value.trim();
  const caseInfo = document.getElementById('clientCaseInfo').value.trim();
  const notes = document.getElementById('clientNotes').value.trim();
  const customFields = collectCustomFieldValues(CF_MODULE_CLIENTS);

  if (!name || !contact) {
    showFormError('clientFormError', 'Client Name and Contact Number are required.');
    return;
  }

  const clients = getClients();

  if (id) {
    const idx = clients.findIndex(c => c.id === id);
    if (idx === -1) {
      showFormError('clientFormError', 'Client not found.');
      return;
    }
    clients[idx] = {
      ...clients[idx],
      name, contact, email, address, caseInfo, notes,
      customFields,
      updatedAt: nowISO()
    };
    saveClients(clients);
    showToast('Client updated successfully.', 'success');
  } else {
    const newClient = {
      id: generateId('CLIENT'),
      name, contact, email, address, caseInfo, notes,
      customFields,
      isLocked: false,
      accessDurationHours: 0,
      shareStartedAt: null,
      requireCode: false,
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
    clients.push(newClient);
    saveClients(clients);
    showToast('Client added successfully.', 'success');
  }

  closeModal('clientModalOverlay');
  renderClientsGrid();
}

/* ============================================================
   VIEW CLIENT DETAIL
   ============================================================ */
function openViewClientModal(clientId) {
  const client = findClientById(clientId);
  if (!client) return;

  const linkedCases = getCases().filter(c => c.clientId === clientId);

  const casesHtml = linkedCases.length > 0
    ? linkedCases.map(c => `
        <div class="client-linked-case">
          <div class="client-linked-case-info">
            <strong>${escapeHtml(c.caseName)}</strong>
            <span>${escapeHtml(c.caseNumber)} • ${escapeHtml(c.courtName || 'No court set')}</span>
          </div>
          <span class="badge badge-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span>
        </div>
      `).join('')
    : `<p class="text-muted">No cases linked to this client yet.</p>`;

  document.getElementById('clientDetailView').innerHTML = `
    <div class="client-detail-header">
      <div class="client-detail-avatar">${getClientInitials(client.name)}</div>
      <div>
        <h3>${escapeHtml(client.name)}</h3>
        <p class="text-muted" style="font-size:12px;">Added ${formatDate(client.createdAt)}</p>
      </div>
    </div>

    <div class="detail-section">
      <h4><i class="fa-solid fa-address-book"></i> Contact Information</h4>
      <p><i class="fa-solid fa-phone" style="width:14px;color:var(--color-gold-dark);"></i> ${escapeHtml(client.contact || '—')}</p>
      <p><i class="fa-solid fa-envelope" style="width:14px;color:var(--color-gold-dark);"></i> ${escapeHtml(client.email || '—')}</p>
      <p><i class="fa-solid fa-location-dot" style="width:14px;color:var(--color-gold-dark);"></i> ${escapeHtml(client.address || '—')}</p>
    </div>

    ${client.caseInfo ? `
    <div class="detail-section">
      <h4><i class="fa-solid fa-gavel"></i> Case Information</h4>
      <p>${escapeHtml(client.caseInfo)}</p>
    </div>` : ''}

    ${client.notes ? `
    <div class="detail-section">
      <h4><i class="fa-solid fa-note-sticky"></i> Notes</h4>
      <p>${escapeHtml(client.notes)}</p>
    </div>` : ''}

    <div class="detail-section">
      <h4><i class="fa-solid fa-folder"></i> Linked Cases (${linkedCases.length})</h4>
      ${casesHtml}
    </div>
  `;

  openModal('viewClientModalOverlay');
}

/* ============================================================
   SHARE TOKEN / PORTAL URL
   ============================================================ */
function generateClientShareToken() {
  if (window.crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 15);
}

function getOrCreateClientShareToken(clientId) {
  const clients = getClients();
  const index = clients.findIndex(c => c.id === clientId);
  if (index === -1) return null;

  if (clients[index].shareToken && typeof clients[index].shareToken === 'string') {
    return clients[index].shareToken;
  }

  const token = generateClientShareToken();
  clients[index] = { ...clients[index], shareToken: token, shareCreatedAt: nowISO(), updatedAt: nowISO() };
  saveClients(clients);
  return token;
}

function buildClientPortalUrl(token) {
  if (!token) return '';
  const currentUrl = new URL(window.location.href);
  currentUrl.pathname = currentUrl.pathname.substring(0, currentUrl.pathname.lastIndexOf('/') + 1) + 'client-view.html';
  currentUrl.search = '';
  currentUrl.searchParams.set('token', token);
  return currentUrl.toString();
}

/* ============================================================
   ROTATING 6-DIGIT ACCESS CODE
   ============================================================ */
function computePortalCode(token) {
  if (!token) return '000000';

  const hourBucket = Math.floor(Date.now() / 3600000);
  const seed = token + '-' + hourBucket;

  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const code = Math.abs(hash) % 1000000;
  return String(code).padStart(6, '0');
}

/* ============================================================
   OPEN SHARE / PORTAL ACCESS MODAL
   ============================================================ */
function openShareClientModal(clientId) {
  const client = findClientById(clientId);
  if (!client) return;

  const token = getOrCreateClientShareToken(clientId);
  if (!token) {
    showToast('Unable to generate client portal link.', 'error');
    return;
  }

  currentShareClientId = clientId;

  document.getElementById('shareClientName').textContent = client.name;
  document.getElementById('clientShareLink').value = buildClientPortalUrl(token);

  document.getElementById('portalLockToggle').checked = !!client.isLocked;
  document.getElementById('portalDurationSelect').value = String(client.accessDurationHours ?? 0);
  document.getElementById('portalCodeToggle').checked = !!client.requireCode;

  refreshPortalCodeDisplay(token, !!client.requireCode);
  if (_portalCodeRefreshInterval) clearInterval(_portalCodeRefreshInterval);
  _portalCodeRefreshInterval = setInterval(() => {
    const codeToggleOn = document.getElementById('portalCodeToggle').checked;
    refreshPortalCodeDisplay(token, codeToggleOn);
  }, 5000);

  openModal('shareClientModalOverlay');
}

function refreshPortalCodeDisplay(token, show) {
  const box = document.getElementById('portalCurrentCodeBox');
  const text = document.getElementById('portalCurrentCodeText');
  if (show) {
    text.textContent = computePortalCode(token);
    box.style.display = 'block';
  } else {
    box.style.display = 'none';
  }
}

/* ============================================================
   APPLY ACCESS SETTINGS
   ============================================================ */
function handleApplyPortalSettings() {
  if (!currentShareClientId) return;

  const isLocked = document.getElementById('portalLockToggle').checked;
  const accessDurationHours = parseInt(document.getElementById('portalDurationSelect').value, 10);
  const requireCode = document.getElementById('portalCodeToggle').checked;

  const clients = getClients();
  const idx = clients.findIndex(c => c.id === currentShareClientId);
  if (idx === -1) return;

  clients[idx] = {
    ...clients[idx],
    isLocked,
    accessDurationHours,
    requireCode,
    shareStartedAt: nowISO(),
    updatedAt: nowISO()
  };
  saveClients(clients);

  showToast('Portal access settings applied.', 'success');
  renderClientsGrid();
}

/* ============================================================
   COPY / OPEN / REGENERATE LINK
   ============================================================ */
async function copyClientShareLink() {
  const input = document.getElementById('clientShareLink');
  if (!input.value) return;

  try {
    await navigator.clipboard.writeText(input.value);
    showToast('Client portal link copied.', 'success');
  } catch (error) {
    input.select();
    input.setSelectionRange(0, input.value.length);
    try {
      document.execCommand('copy');
      showToast('Client portal link copied.', 'success');
    } catch (fallbackError) {
      showToast('Unable to copy link. Please copy it manually.', 'error');
    }
  }
}

function openClientShareLink() {
  const input = document.getElementById('clientShareLink');
  if (!input.value) return;
  window.open(input.value, '_blank', 'noopener,noreferrer');
}

function regenerateClientShareLink() {
  if (!currentShareClientId) return;

  const client = findClientById(currentShareClientId);
  if (!client) return;

  const confirmed = window.confirm(
    'Regenerate this client portal link?\n\nThe previous link will no longer match this client record.'
  );
  if (!confirmed) return;

  const clients = getClients();
  const index = clients.findIndex(c => c.id === currentShareClientId);
  if (index === -1) return;

  const newToken = generateClientShareToken();
  clients[index] = { ...clients[index], shareToken: newToken, shareCreatedAt: nowISO(), updatedAt: nowISO() };
  saveClients(clients);

  document.getElementById('clientShareLink').value = buildClientPortalUrl(newToken);
  refreshPortalCodeDisplay(newToken, document.getElementById('portalCodeToggle').checked);

  showToast('Client portal link regenerated.', 'success');
}

/* ============================================================
   DELETE CLIENT
   ============================================================ */
function handleDeleteClient(clientId) {
  const client = findClientById(clientId);
  if (!client) return;

  const linkedCases = getCases().filter(s => s.clientId === clientId);

  let message = `Delete client "${client.name}"? This cannot be undone.`;
  if (linkedCases.length > 0) {
    message = `"${client.name}" has ${linkedCases.length} linked case(s). Deleting this client will NOT delete those records, but they will show as "Unknown Client". Continue?`;
  }

  confirmDelete(
    message,
    () => {
      saveClients(getClients().filter(c => c.id !== clientId));
      renderClientsGrid();
      showToast('Client deleted.', 'success');
    },
    'Delete Client',
    '<i class="fa-solid fa-trash"></i> Delete Client'
  );
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function attachClientEvents() {
  document.getElementById('addClientBtn').addEventListener('click', openAddClientModal);

  document.getElementById('closeClientModal').addEventListener('click', () => closeModal('clientModalOverlay'));
  document.getElementById('clientForm').addEventListener('submit', handleClientFormSubmit);
  enableClickOutsideClose('clientModalOverlay');

  document.getElementById('closeViewClientModal').addEventListener('click', () => closeModal('viewClientModalOverlay'));
  enableClickOutsideClose('viewClientModalOverlay');

  document.getElementById('closeShareClientModal').addEventListener('click', () => {
    closeModal('shareClientModalOverlay');
    if (_portalCodeRefreshInterval) clearInterval(_portalCodeRefreshInterval);
  });
  enableClickOutsideClose('shareClientModalOverlay');

  document.getElementById('copyClientShareLink').addEventListener('click', copyClientShareLink);
  document.getElementById('openClientShareLink').addEventListener('click', openClientShareLink);
  document.getElementById('regenerateClientShareLink').addEventListener('click', regenerateClientShareLink);
  document.getElementById('applyPortalSettingsBtn').addEventListener('click', handleApplyPortalSettings);

  document.getElementById('portalCodeToggle').addEventListener('change', (e) => {
    const client = findClientById(currentShareClientId);
    const token = client ? client.shareToken : null;
    refreshPortalCodeDisplay(token, e.target.checked);
  });

  document.getElementById('clientSearchInput').addEventListener('input', e => {
    clientSearchTerm = e.target.value;
    renderClientsGrid();
  });

  document.getElementById('clientSortSelect').addEventListener('change', e => {
    clientSortMode = e.target.value;
    renderClientsGrid();
  });

  document.getElementById('clientsGrid').addEventListener('click', e => {
    const viewBtn = e.target.closest('[data-view-client]');
    const editBtn = e.target.closest('[data-edit-client]');
    const shareBtn = e.target.closest('[data-share-client]');
    const scanBtn = e.target.closest('[data-scan-client]');
    const deleteBtn = e.target.closest('[data-delete-client]');

    if (viewBtn) return openViewClientModal(viewBtn.dataset.viewClient);
    if (editBtn) return openEditClientModal(editBtn.dataset.editClient);
    if (shareBtn) return openShareClientModal(shareBtn.dataset.shareClient);
    if (scanBtn) return triggerSmartScan(scanBtn.dataset.scanClient, null);
    if (deleteBtn) return handleDeleteClient(deleteBtn.dataset.deleteClient);
  });

  // NEW: "Custom Fields" button in the page heading opens the shared manager
  document.getElementById('clientCustomFieldsBtn').addEventListener('click', () => {
    openCustomFieldsManager(CF_MODULE_CLIENTS, 'Clients', renderClientsGrid);
  });
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