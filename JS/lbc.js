/* ============================================================
   ABANTO LAW FIRM — LBC.JS
   LBC Tracker — table follows the firm's LBC logbook:
   Tracking No. · Case Title · Case Number · Case Type ·
   Cause of Action · Sender · Recipient · Recipient's Address ·
   Title of Document · Date Sent · Delivery Status

   Stat tiles, search/sort, add/edit/delete shipment, full
   Document Manager per shipment, Custom Fields, and notifies
   EVERY registered user whenever a new Shipment is added.

   Data keys (kept compatible with dashboard / calendar / analytics):
     clientName  = Recipient
     destination = Recipient's Address
     document    = Title of Document
   New keys: caseTitle, caseNumber, caseType, causeOfAction, sender

   Depends on: storage.js, auth.js, modal.js, navigation.js,
   custom-field.js (loaded before this file)
   ============================================================ */

const CF_MODULE_LBC = 'lbc';

/* Built-in case/party fields (also used to absorb old custom columns) */
const LBC_EXTRA_FIELDS = [
  { key: 'caseTitle',     inputId: 'shipmentCaseTitle',     labels: ['case title', 'case name', 'title of case', 'caption'] },
  { key: 'caseNumber',    inputId: 'shipmentCaseNumber',    labels: ['case number', 'case no', 'docket number', 'docket no'] },
  { key: 'caseType',      inputId: 'shipmentCaseType',      labels: ['case type', 'type of case', 'nature of case'] },
  { key: 'causeOfAction', inputId: 'shipmentCauseOfAction', labels: ['cause of action', 'cause', 'offense', 'charge'] },
  { key: 'sender',        inputId: 'shipmentSender',        labels: ['sender', 'sender name', 'sent by', 'shipper'] }
];

const LBC_CASE_TYPES = [
  'Civil', 'Criminal', 'Labor', 'Administrative', 'Special Proceedings',
  'Family', 'Land Registration', 'Corporate', 'Tax', 'Election'
];

let currentLbcSession = null;
let currentLbcUser = null;
let shipmentSearchTerm = '';
let shipmentSortMode = 'newest';

let currentShipDocsShipmentId = null;
let shipDocSearchTerm = '';
let shipDocSortMode = 'newest';

document.addEventListener('DOMContentLoaded', () => {
  currentLbcSession = requireAuth();
  if (!currentLbcSession) return;

  currentLbcUser = getCurrentUser();
  initLayout('lbc');
  injectCustomFieldsModal();
  attachCustomFieldClearHandler(document.getElementById('shipmentTableBody'), renderShipmentTable);

  migrateLbcCustomColumns();
  renderShipmentTable();
  attachLbcEvents();
});

/* ============================================================
   ONE-TIME CLEANUP
   Custom columns created earlier by the Excel import (e.g.
   "CASE TITLE", "SENDER") are now real columns — move their
   values in and remove the duplicate custom column.
   ============================================================ */
function lbcNormLabel(s) {
  return String(s || '').toLowerCase()
    .replace(/['’`]s\b/g, '')
    .replace(/\bno\.?\b|\bnumber\b|\bnum\b|#/g, ' no ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function migrateLbcCustomColumns() {
  if (typeof getCustomFieldsForModule !== 'function') return;
  const defs = getCustomFieldsForModule(CF_MODULE_LBC);
  const moves = [];

  defs.forEach(def => {
    const label = lbcNormLabel(def.fieldLabel);
    const target = LBC_EXTRA_FIELDS.find(f => f.labels.some(l => lbcNormLabel(l) === label));
    if (target) moves.push({ def, key: target.key });
  });
  if (!moves.length) return;

  const shipments = getShipments().map(s => {
    const cf = { ...(s.customFields || {}) };
    moves.forEach(m => {
      const val = cf[m.def.fieldKey];
      if (val !== undefined && val !== '' && !s[m.key]) s = { ...s, [m.key]: val };
      delete cf[m.def.fieldKey];
    });
    return { ...s, customFields: cf };
  });
  saveShipments(shipments);
  moves.forEach(m => deleteCustomFieldDefinition(m.def.id));
}

/* ============================================================
   RENDER: STAT TILES
   ============================================================ */
function renderShipmentTiles(shipments) {
  const total = shipments.length;
  const inTransit = shipments.filter(s => s.status === 'in-transit').length;
  const delivered = shipments.filter(s => s.status === 'delivered').length;
  const pending = shipments.filter(s => s.status === 'pending').length;

  document.getElementById('tileTotalShipments').textContent = total;
  document.getElementById('tileInTransit').textContent = inTransit;
  document.getElementById('tileDelivered').textContent = delivered;
  document.getElementById('tilePendingShipments').textContent = pending;
}

/* ============================================================
   RENDER: SHIPMENT TABLE
   ============================================================ */
function getFilteredSortedShipments() {
  let shipments = getShipments();

  if (shipmentSearchTerm.trim()) {
    const q = shipmentSearchTerm.trim().toLowerCase();
    const keys = ['trackingNumber', 'caseTitle', 'caseNumber', 'caseType', 'causeOfAction',
      'sender', 'clientName', 'destination', 'document'];
    shipments = shipments.filter(s => keys.some(k => String(s[k] || '').toLowerCase().includes(q)));
  }

  const txt = (v) => String(v || '');
  switch (shipmentSortMode) {
    case 'newest': shipments.sort((a, b) => new Date(b.dateSent) - new Date(a.dateSent)); break;
    case 'oldest': shipments.sort((a, b) => new Date(a.dateSent) - new Date(b.dateSent)); break;
    case 'az': shipments.sort((a, b) => txt(a.clientName).localeCompare(txt(b.clientName))); break;
    case 'za': shipments.sort((a, b) => txt(b.clientName).localeCompare(txt(a.clientName))); break;
    case 'case': shipments.sort((a, b) => txt(a.caseNumber).localeCompare(txt(b.caseNumber), undefined, { numeric: true })); break;
    case 'status': shipments.sort((a, b) => txt(a.status).localeCompare(txt(b.status))); break;
  }

  return shipments;
}

function getStatusLabel(status) {
  const labels = { pending: 'Pending', 'in-transit': 'In Transit', delivered: 'Delivered' };
  return labels[status] || status;
}

function renderLbcCustomFieldHeaders() {
  const headerCell = document.getElementById('lbcCustomFieldHeaders');
  if (!headerCell) return;

  const temp = document.createElement('tr');
  temp.innerHTML = renderCustomFieldHeaders(CF_MODULE_LBC);
  const newCells = Array.from(temp.children);

  const parentRow = headerCell.parentElement;
  const placeholderIndex = Array.from(parentRow.children).indexOf(headerCell);
  headerCell.remove();
  newCells.reverse().forEach(cell => {
    parentRow.insertBefore(cell, parentRow.children[placeholderIndex] || null);
  });
  newCells[newCells.length - 1].id = 'lbcCustomFieldHeaders';
}

/** One slim cell: single line, "…" when long, full text on hover */
function lbcCell(value, cls = '', label = '') {
  const v = String(value === undefined || value === null ? '' : value).trim();
  if (!v) return `<td class="lbc-td ${cls}" data-label="${escapeHtml(label)}"><span class="lbc-empty">—</span></td>`;
  return `<td class="lbc-td ${cls}" data-label="${escapeHtml(label)}" title="${escapeHtml(v)}"><span class="lbc-clip">${escapeHtml(v)}</span></td>`;
}

function renderShipmentTable() {
  const shipments = getFilteredSortedShipments();
  const tbody = document.getElementById('shipmentTableBody');

  renderShipmentTiles(getShipments());
  renderLbcCustomFieldHeaders();

  const countLabel = document.getElementById('shipmentCountLabel');
  if (countLabel) countLabel.textContent = `${shipments.length} shipment${shipments.length === 1 ? '' : 's'}`;

  const totalCols = 13 + getCustomFieldColspan(CF_MODULE_LBC);

  if (shipments.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${totalCols}">No shipments found.</td></tr>`;
    return;
  }

  tbody.innerHTML = shipments.map(s => {
    const docCount = (s.documents || []).length;

    return `
      <tr>
        <td class="lbc-td col-tracking" data-label="Tracking No." title="${escapeHtml(s.trackingNumber)}">
          <span class="tracking-chip">${escapeHtml(s.trackingNumber)}</span>
        </td>
        ${lbcCell(s.caseTitle, 'col-case-title', 'Case Title')}
        ${lbcCell(s.caseNumber, 'col-case-no', 'Case Number')}
        ${lbcCell(s.caseType, 'col-case-type', 'Case Type')}
        ${lbcCell(s.causeOfAction, 'col-cause', 'Cause of Action')}
        ${lbcCell(s.sender, 'col-sender', 'Sender')}
        ${lbcCell(s.clientName, 'col-recipient', 'Recipient')}
        ${lbcCell(s.destination, 'col-address', "Recipient's Address")}
        ${lbcCell(s.document, 'col-doc', 'Title of Document')}
        <td class="lbc-td col-date" data-label="Date Sent">${s.dateSent ? formatDate(s.dateSent) : '<span class="lbc-empty">—</span>'}</td>
        <td class="lbc-td col-status" data-label="Delivery Status"><span class="badge badge-${escapeHtml(s.status)}">${escapeHtml(getStatusLabel(s.status))}</span></td>
        <td class="lbc-td col-files" data-label="Files">
          <button class="cell-action-btn" data-open-ship-docs="${s.id}" title="Open files">
            <i class="fa-solid fa-folder"></i> <span class="count-badge">${docCount}</span>
          </button>
        </td>
        ${renderCustomFieldCells(CF_MODULE_LBC, s)}
        <td class="lbc-td col-actions" data-label="Actions">
          <div class="table-actions">
            <button class="btn-icon" title="Edit" data-edit-shipment="${s.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon danger" title="Delete" data-delete-shipment="${s.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/* ============================================================
   FORM HELPERS (suggestions)
   ============================================================ */
function fillLbcSuggestions() {
  const shipments = getShipments();
  const uniq = (arr) => Array.from(new Set(arr.map(v => String(v || '').trim()).filter(Boolean)));

  // case numbers from the Cases module + ones already used here
  const cases = typeof getCases === 'function' ? getCases() : [];
  const caseOpts = cases.map(c => `<option value="${escapeHtml(c.caseNumber)}">${escapeHtml(c.caseName || '')}</option>`);
  uniq(shipments.map(s => s.caseNumber))
    .filter(n => !cases.some(c => c.caseNumber === n))
    .forEach(n => caseOpts.push(`<option value="${escapeHtml(n)}"></option>`));
  document.getElementById('lbcCaseNumberList').innerHTML = caseOpts.join('');

  document.getElementById('lbcCaseTypeList').innerHTML = uniq(LBC_CASE_TYPES.concat(shipments.map(s => s.caseType)))
    .map(t => `<option value="${escapeHtml(t)}"></option>`).join('');

  const me = currentLbcUser ? `${currentLbcUser.firstName} ${currentLbcUser.lastName}` : '';
  document.getElementById('lbcSenderList').innerHTML = uniq([me].concat(shipments.map(s => s.sender)))
    .map(t => `<option value="${escapeHtml(t)}"></option>`).join('');
}

/** Picking a case number from the list fills the Case Title if empty */
function handleLbcCaseNumberPick() {
  const num = document.getElementById('shipmentCaseNumber').value.trim().toLowerCase();
  if (!num || typeof getCases !== 'function') return;
  const c = getCases().find(x => String(x.caseNumber || '').toLowerCase() === num);
  const titleInput = document.getElementById('shipmentCaseTitle');
  if (c && c.caseName && !titleInput.value.trim()) titleInput.value = c.caseName;
}

/* ============================================================
   ADD / EDIT SHIPMENT
   ============================================================ */
function openAddShipmentModal() {
  document.getElementById('shipmentModalTitle').innerHTML = '<i class="fa-solid fa-truck-fast"></i> Add Shipment';
  document.getElementById('shipmentForm').reset();
  document.getElementById('shipmentId').value = '';
  const now = new Date();
  document.getElementById('shipmentDateSent').value =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  clearFormError('shipmentFormError');
  fillLbcSuggestions();
  document.getElementById('shipmentCustomFieldsWrap').innerHTML = renderCustomFieldFormInputs(CF_MODULE_LBC, {});
  openModal('shipmentModalOverlay');
}

function openEditShipmentModal(shipmentId) {
  const shipment = getShipments().find(s => s.id === shipmentId);
  if (!shipment) return;

  document.getElementById('shipmentModalTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Edit Shipment';
  clearFormError('shipmentFormError');
  fillLbcSuggestions();

  document.getElementById('shipmentId').value = shipment.id;
  document.getElementById('shipmentTrackingNumber').value = shipment.trackingNumber;
  document.getElementById('shipmentClientName').value = shipment.clientName || '';
  document.getElementById('shipmentDestination').value = shipment.destination || '';
  document.getElementById('shipmentDocument').value = shipment.document || '';
  document.getElementById('shipmentDateSent').value = shipment.dateSent || '';
  document.getElementById('shipmentStatus').value = shipment.status;
  LBC_EXTRA_FIELDS.forEach(f => {
    document.getElementById(f.inputId).value = shipment[f.key] || '';
  });

  document.getElementById('shipmentCustomFieldsWrap').innerHTML = renderCustomFieldFormInputs(CF_MODULE_LBC, shipment.customFields || {});

  openModal('shipmentModalOverlay');
}

/**
 * Notifies every registered user (except the person who
 * created it) whenever a new Shipment is added.
 */
function notifyAllUsersOfNewShipment(shipment) {
  const allUserIds = getUsers().map(u => u.id).filter(id => id !== currentLbcUser.id);
  createNotificationForMany(
    allUserIds,
    'shipment-added',
    'New LBC shipment added',
    `${currentLbcUser.firstName} ${currentLbcUser.lastName} added shipment "${shipment.trackingNumber}" to ${shipment.clientName}${shipment.caseNumber ? ` (${shipment.caseNumber})` : ''}.`,
    { page: 'lbc.html', targetId: null }
  );
}

function handleShipmentFormSubmit(e) {
  e.preventDefault();
  clearFormError('shipmentFormError');

  const id = document.getElementById('shipmentId').value;
  const trackingNumber = document.getElementById('shipmentTrackingNumber').value.trim();
  const clientName = document.getElementById('shipmentClientName').value.trim();
  const destination = document.getElementById('shipmentDestination').value.trim();
  const documentDesc = document.getElementById('shipmentDocument').value.trim();
  const dateSent = document.getElementById('shipmentDateSent').value;
  const status = document.getElementById('shipmentStatus').value;
  const customFields = collectCustomFieldValues(CF_MODULE_LBC);

  const extra = {};
  LBC_EXTRA_FIELDS.forEach(f => {
    extra[f.key] = document.getElementById(f.inputId).value.trim();
  });

  if (!trackingNumber || !clientName || !destination || !documentDesc || !dateSent) {
    showFormError('shipmentFormError', 'Please fill in all required fields (*).');
    return;
  }

  const shipments = getShipments();

  const duplicate = shipments.find(s => s.trackingNumber.toLowerCase() === trackingNumber.toLowerCase() && s.id !== id);
  if (duplicate) {
    showFormError('shipmentFormError', 'A shipment with this Tracking No. already exists.');
    return;
  }

  if (id) {
    const idx = shipments.findIndex(s => s.id === id);
    if (idx === -1) {
      showFormError('shipmentFormError', 'Shipment not found.');
      return;
    }
    shipments[idx] = {
      ...shipments[idx],
      trackingNumber, clientName, destination, document: documentDesc, dateSent, status,
      ...extra,
      customFields,
      updatedAt: nowISO()
    };
    saveShipments(shipments);

    if (typeof logActivity === 'function') {
      logActivity(currentLbcUser.id, 'lbc-edit', `Edited LBC shipment "${trackingNumber}" to ${clientName}.`);
    }

    showToast('Shipment updated successfully.', 'success');
  } else {
    const newShipment = {
      id: generateId('SHIP'),
      trackingNumber, clientName, destination, document: documentDesc, dateSent, status,
      ...extra,
      documents: [],
      customFields,
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
    shipments.push(newShipment);
    saveShipments(shipments);

    if (typeof logActivity === 'function') {
      logActivity(currentLbcUser.id, 'lbc-add', `Added LBC shipment "${trackingNumber}" to ${clientName}.`);
    }

    notifyAllUsersOfNewShipment(newShipment);

    showToast('Shipment added successfully.', 'success');
  }

  closeModal('shipmentModalOverlay');
  renderShipmentTable();
}

/* ============================================================
   DELETE SHIPMENT
   ============================================================ */
function handleDeleteShipment(shipmentId) {
  const shipment = getShipments().find(s => s.id === shipmentId);
  if (!shipment) return;

  const docCount = (shipment.documents || []).length;
  const message = docCount > 0
    ? `Delete shipment "${shipment.trackingNumber}"? This will also delete its ${docCount} uploaded document(s). This cannot be undone.`
    : `Delete shipment "${shipment.trackingNumber}"? This cannot be undone.`;

  confirmDelete(
    message,
    () => {
      saveShipments(getShipments().filter(s => s.id !== shipmentId));

      if (typeof logActivity === 'function') {
        logActivity(currentLbcUser.id, 'lbc-edit', `Deleted LBC shipment "${shipment.trackingNumber}".`);
      }

      renderShipmentTable();
      showToast('Shipment deleted.', 'success');
    },
    'Delete Shipment',
    '<i class="fa-solid fa-trash"></i> Delete Shipment'
  );
}

/* ============================================================
   SHIPMENT DOCUMENT MANAGER
   ============================================================ */
function openShipDocsModal(shipmentId) {
  const shipment = getShipments().find(s => s.id === shipmentId);
  if (!shipment) return;

  currentShipDocsShipmentId = shipmentId;
  shipDocSearchTerm = '';
  shipDocSortMode = 'newest';

  document.getElementById('shipDocsShipmentId').value = shipmentId;
  document.getElementById('shipDocsLabel').textContent = `${shipment.trackingNumber} — ${shipment.clientName || 'No recipient'}`;
  document.getElementById('shipDocSearchInput').value = '';
  document.getElementById('shipDocSortSelect').value = 'newest';

  renderShipDocsTable();
  openModal('shipDocsModalOverlay');
}

function getFilteredSortedShipDocs() {
  const shipment = getShipments().find(s => s.id === currentShipDocsShipmentId);
  let docs = shipment ? [...(shipment.documents || [])] : [];

  if (shipDocSearchTerm.trim()) {
    const q = shipDocSearchTerm.trim().toLowerCase();
    docs = docs.filter(d => d.fileName.toLowerCase().includes(q));
  }

  switch (shipDocSortMode) {
    case 'newest': docs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)); break;
    case 'oldest': docs.sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt)); break;
    case 'az': docs.sort((a, b) => a.fileName.localeCompare(b.fileName)); break;
    case 'za': docs.sort((a, b) => b.fileName.localeCompare(a.fileName)); break;
  }

  return docs;
}

function renderShipDocsTable() {
  const docs = getFilteredSortedShipDocs();
  const tbody = document.getElementById('shipDocsTableBody');

  if (docs.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No documents found.</td></tr>`;
  } else {
    tbody.innerHTML = docs.map(d => `
      <tr>
        <td>
          <div class="doc-name-cell">
            <i class="fa-solid ${getFileIcon(d.fileType)}"></i>
            <span class="doc-name-text" title="${escapeHtml(d.fileName)}">${escapeHtml(d.fileName)}</span>
          </div>
        </td>
        <td><span class="doc-type-badge">${escapeHtml(getFileExtension(d.fileName))}</span></td>
        <td>${formatDate(d.uploadedAt)}</td>
        <td>${formatFileSize(d.fileSize)}</td>
        <td>
          <div class="table-actions">
            <button class="btn-icon" title="View" data-view-ship-doc="${d.id}"><i class="fa-solid fa-eye"></i></button>
            <button class="btn-icon" title="Rename" data-rename-ship-doc="${d.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon" title="Replace" data-replace-ship-doc="${d.id}"><i class="fa-solid fa-arrows-rotate"></i></button>
            <button class="btn-icon" title="Download" data-download-ship-doc="${d.id}"><i class="fa-solid fa-download"></i></button>
            <button class="btn-icon danger" title="Delete" data-delete-ship-doc="${d.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  renderShipmentTable();
}

/* ---------- FILE HELPERS ---------- */
function getFileExtension(fileName) {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'FILE';
}

function getFileIcon(fileType) {
  if (!fileType) return 'fa-file';
  if (fileType.includes('pdf')) return 'fa-file-pdf';
  if (fileType.includes('image')) return 'fa-file-image';
  if (fileType.includes('word') || fileType.includes('msword') || fileType.includes('document')) return 'fa-file-word';
  if (fileType.includes('sheet') || fileType.includes('excel')) return 'fa-file-excel';
  if (fileType.includes('zip') || fileType.includes('rar')) return 'fa-file-zipper';
  return 'fa-file';
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ---------- UPLOAD ---------- */
async function handleShipDocUpload(fileList) {
  if (!currentShipDocsShipmentId || !fileList || fileList.length === 0) return;

  const MAX_FILE_SIZE = 3 * 1024 * 1024;
  const shipments = getShipments();
  const idx = shipments.findIndex(s => s.id === currentShipDocsShipmentId);
  if (idx === -1) return;

  if (!shipments[idx].documents) shipments[idx].documents = [];

  let uploadedCount = 0;
  let skippedCount = 0;

  for (const file of Array.from(fileList)) {
    if (file.size > MAX_FILE_SIZE) {
      skippedCount++;
      continue;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      shipments[idx].documents.push({
        id: generateId('SHIPDOC'),
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        dataUrl,
        uploadedAt: nowISO()
      });
      uploadedCount++;
    } catch (err) {
      console.error('[lbc.js] Failed to read file:', file.name, err);
      skippedCount++;
    }
  }

  saveShipments(shipments);
  renderShipDocsTable();

  if (uploadedCount > 0) showToast(`${uploadedCount} document(s) uploaded successfully.`, 'success');
  if (skippedCount > 0) showToast(`${skippedCount} file(s) skipped (too large, 3MB limit for this prototype).`, 'error');
}

/* ---------- VIEW ---------- */
function handleViewShipDoc(docId) {
  const shipment = getShipments().find(s => s.id === currentShipDocsShipmentId);
  const doc = shipment ? (shipment.documents || []).find(d => d.id === docId) : null;
  if (!doc) return;

  document.getElementById('viewShipDocName').textContent = doc.fileName;
  const body = document.getElementById('viewShipDocBody');

  if (doc.fileType.includes('image')) {
    body.innerHTML = `<img src="${doc.dataUrl}" alt="${escapeHtml(doc.fileName)}">`;
  } else if (doc.fileType.includes('pdf')) {
    body.innerHTML = `<iframe src="${doc.dataUrl}"></iframe>`;
  } else {
    body.innerHTML = `
      <div class="doc-preview-unavailable">
        <i class="fa-solid ${getFileIcon(doc.fileType)}"></i>
        <p>Preview not available for this file type.</p>
        <p class="text-muted" style="margin-top:6px;">Use Download to view "${escapeHtml(doc.fileName)}" on your device.</p>
      </div>
    `;
  }

  openModal('viewShipDocModalOverlay');
}

/* ---------- RENAME ---------- */
function handleOpenRenameShipDoc(docId) {
  const shipment = getShipments().find(s => s.id === currentShipDocsShipmentId);
  const doc = shipment ? (shipment.documents || []).find(d => d.id === docId) : null;
  if (!doc) return;

  document.getElementById('renameShipDocId').value = doc.id;
  document.getElementById('renameShipDocInput').value = doc.fileName;
  openModal('renameShipDocModalOverlay');
}

function handleRenameShipDocSubmit(e) {
  e.preventDefault();

  const docId = document.getElementById('renameShipDocId').value;
  const newName = document.getElementById('renameShipDocInput').value.trim();
  if (!newName) return;

  const shipments = getShipments();
  const shipIdx = shipments.findIndex(s => s.id === currentShipDocsShipmentId);
  if (shipIdx === -1) return;

  const docIdx = (shipments[shipIdx].documents || []).findIndex(d => d.id === docId);
  if (docIdx === -1) return;

  shipments[shipIdx].documents[docIdx].fileName = newName;
  saveShipments(shipments);

  closeModal('renameShipDocModalOverlay');
  renderShipDocsTable();
  showToast('Document renamed.', 'success');
}

/* ---------- REPLACE ---------- */
function handleReplaceShipDoc(docId) {
  const tempInput = document.createElement('input');
  tempInput.type = 'file';
  tempInput.style.display = 'none';

  tempInput.addEventListener('change', async () => {
    const file = tempInput.files[0];
    if (!file) return;

    const MAX_FILE_SIZE = 3 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      showToast('File too large (3MB limit for this prototype).', 'error');
      tempInput.remove();
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const shipments = getShipments();
      const shipIdx = shipments.findIndex(s => s.id === currentShipDocsShipmentId);
      if (shipIdx === -1) return;

      const docIdx = (shipments[shipIdx].documents || []).findIndex(d => d.id === docId);
      if (docIdx === -1) return;

      shipments[shipIdx].documents[docIdx] = {
        ...shipments[shipIdx].documents[docIdx],
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        dataUrl,
        uploadedAt: nowISO()
      };
      saveShipments(shipments);
      renderShipDocsTable();
      showToast('Document replaced successfully.', 'success');
    } catch (err) {
      console.error('[lbc.js] Replace failed:', err);
      showToast('Failed to replace document.', 'error');
    }

    tempInput.remove();
  });

  document.body.appendChild(tempInput);
  tempInput.click();
}

/* ---------- DOWNLOAD ---------- */
function handleDownloadShipDoc(docId) {
  const shipment = getShipments().find(s => s.id === currentShipDocsShipmentId);
  const doc = shipment ? (shipment.documents || []).find(d => d.id === docId) : null;
  if (!doc) return;

  const link = document.createElement('a');
  link.href = doc.dataUrl;
  link.download = doc.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/* ---------- DELETE ---------- */
function handleDeleteShipDoc(docId) {
  const shipment = getShipments().find(s => s.id === currentShipDocsShipmentId);
  const doc = shipment ? (shipment.documents || []).find(d => d.id === docId) : null;
  if (!doc) return;

  confirmDelete(
    `Delete document "${doc.fileName}"? This cannot be undone.`,
    () => {
      const shipments = getShipments();
      const shipIdx = shipments.findIndex(s => s.id === currentShipDocsShipmentId);
      if (shipIdx === -1) return;

      shipments[shipIdx].documents = (shipments[shipIdx].documents || []).filter(d => d.id !== docId);
      saveShipments(shipments);
      renderShipDocsTable();
      showToast('Document deleted.', 'success');
    },
    'Delete Document',
    '<i class="fa-solid fa-trash"></i> Delete Document'
  );
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function attachLbcEvents() {
  document.getElementById('addShipmentBtn').addEventListener('click', openAddShipmentModal);
  document.getElementById('closeShipmentModal').addEventListener('click', () => closeModal('shipmentModalOverlay'));
  document.getElementById('shipmentForm').addEventListener('submit', handleShipmentFormSubmit);
  document.getElementById('shipmentCaseNumber').addEventListener('change', handleLbcCaseNumberPick);
  enableClickOutsideClose('shipmentModalOverlay');

  document.getElementById('shipmentSearchInput').addEventListener('input', (e) => {
    shipmentSearchTerm = e.target.value;
    renderShipmentTable();
  });

  document.getElementById('shipmentSortSelect').addEventListener('change', (e) => {
    shipmentSortMode = e.target.value;
    renderShipmentTable();
  });

  document.getElementById('shipmentTableBody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-shipment]');
    const deleteBtn = e.target.closest('[data-delete-shipment]');
    const docsBtn = e.target.closest('[data-open-ship-docs]');

    if (editBtn) openEditShipmentModal(editBtn.dataset.editShipment);
    if (deleteBtn) handleDeleteShipment(deleteBtn.dataset.deleteShipment);
    if (docsBtn) openShipDocsModal(docsBtn.dataset.openShipDocs);
  });

  document.getElementById('closeShipDocsModal').addEventListener('click', () => closeModal('shipDocsModalOverlay'));
  enableClickOutsideClose('shipDocsModalOverlay');

  const uploadInput = document.getElementById('shipDocUploadInput');
  uploadInput.addEventListener('change', () => {
    handleShipDocUpload(uploadInput.files);
    uploadInput.value = '';
  });

  document.getElementById('shipDocSearchInput').addEventListener('input', (e) => {
    shipDocSearchTerm = e.target.value;
    renderShipDocsTable();
  });

  document.getElementById('shipDocSortSelect').addEventListener('change', (e) => {
    shipDocSortMode = e.target.value;
    renderShipDocsTable();
  });

  document.getElementById('shipDocsTableBody').addEventListener('click', (e) => {
    const viewBtn = e.target.closest('[data-view-ship-doc]');
    const renameBtn = e.target.closest('[data-rename-ship-doc]');
    const replaceBtn = e.target.closest('[data-replace-ship-doc]');
    const downloadBtn = e.target.closest('[data-download-ship-doc]');
    const deleteBtn = e.target.closest('[data-delete-ship-doc]');

    if (viewBtn) handleViewShipDoc(viewBtn.dataset.viewShipDoc);
    if (renameBtn) handleOpenRenameShipDoc(renameBtn.dataset.renameShipDoc);
    if (replaceBtn) handleReplaceShipDoc(replaceBtn.dataset.replaceShipDoc);
    if (downloadBtn) handleDownloadShipDoc(downloadBtn.dataset.downloadShipDoc);
    if (deleteBtn) handleDeleteShipDoc(deleteBtn.dataset.deleteShipDoc);
  });

  document.getElementById('closeRenameShipDocModal').addEventListener('click', () => closeModal('renameShipDocModalOverlay'));
  enableClickOutsideClose('renameShipDocModalOverlay');
  document.getElementById('renameShipDocForm').addEventListener('submit', handleRenameShipDocSubmit);

  document.getElementById('closeViewShipDocModal').addEventListener('click', () => closeModal('viewShipDocModalOverlay'));
  enableClickOutsideClose('viewShipDocModalOverlay');

  document.getElementById('shipmentTableBody').closest('table').querySelector('thead').addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-cf-open-manager]');
    if (openBtn) {
      openCustomFieldsManager(CF_MODULE_LBC, 'LBC Tracker', renderShipmentTable);
    }
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