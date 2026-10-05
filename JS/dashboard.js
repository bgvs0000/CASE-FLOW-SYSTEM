/* ============================================================
   CASEFLOW — DASHBOARD.JS
   Case Dashboard logic: stat tiles, search/sort, add/edit/delete
   case, client dropdown sync, Documents/Progress wiring,
   Filing Cabinet, Custom Fields, and (NEW)
   notifies EVERY registered user whenever a new Case is added.

   UPDATED (AI Document Intelligence):
   - handlePendingNavTarget(): when "View File" is clicked in the
     AI Assistant on ANOTHER page, the app comes here, opens the
     right case's Document Manager and highlights the file.
   - Deleting a case now records a 'delete' movement for every
     document inside it, so the AI still knows who deleted them.

   UPDATED (AI Case Summary):
   - 🤖 button in every case row -> opens the AI Case Summary
     (case-intelligence.js): stage, na-miss, next steps,
     documents checklist, hearings.
   - handlePendingNavTarget() also handles "case:<caseId>" so
     "Buksan ang buong AI Summary" from the AI chat on another
     page lands here with the summary open.

   Depends on: storage.js, auth.js, modal.js, navigation.js,
   documents.js, progress.js, custom-fields.js
   Optional:   doc-intelligence.js, case-intelligence.js
   ============================================================ */

const CF_MODULE_CASES = 'cases';

let currentSession = null;
let currentDashboardUser = null;
let currentSort = 'newest';
let currentSearch = '';

document.addEventListener('DOMContentLoaded', () => {
  currentSession = requireAuth();
  if (!currentSession) return;

  currentDashboardUser = getCurrentUser();
  initLayout('dashboard');
  injectCustomFieldsModal();
  attachCustomFieldClearHandler(document.getElementById('caseTableBody'), renderCaseTable);

  populateClientDropdown();
  renderDashboard();
  attachDashboardEvents();

  // AI Assistant "View File" / "AI Summary" clicked on another page ->
  // open the right modal here
  handlePendingNavTarget();
});

/* ============================================================
   PENDING NAV TARGET (from AI Assistant / notifications)
   - "doc:<docId>"   -> open that case's Document Manager and
                        highlight the file (doc-intelligence.js)
   - "case:<caseId>" -> open the AI Case Summary
                        (case-intelligence.js)
   - anything else is put back untouched so other pages that
     own that target can still read it
   Also called by navigation.js when a notification is clicked
   while already on this page.
   ============================================================ */
function handlePendingNavTarget() {
  if (typeof consumePendingNavTarget !== 'function') return;
  const target = consumePendingNavTarget();
  if (!target) return;

  if (String(target).startsWith('doc:') && typeof docAiHandleNavTarget === 'function') {
    docAiHandleNavTarget(target);
    return;
  }

  if (String(target).startsWith('case:') && typeof caseAiHandleNavTarget === 'function') {
    caseAiHandleNavTarget(target);
    return;
  }

  // not ours -> restore it
  if (typeof setPendingNavTarget === 'function') setPendingNavTarget(target);
}

/* ============================================================
   RENDER: STAT TILES
   ============================================================ */
function renderStatTiles(cases) {
  const total = cases.length;
  const active = cases.filter(c => c.status === 'active').length;
  const pending = cases.filter(c => c.status === 'pending').length;
  const completed = cases.filter(c => c.status === 'completed').length;

  document.getElementById('tileTotalCases').textContent = total;
  document.getElementById('tileActiveCases').textContent = active;
  document.getElementById('tilePendingCases').textContent = pending;
  document.getElementById('tileCompletedCases').textContent = completed;
}

/* ============================================================
   RENDER: CASE TABLE
   ============================================================ */
function getFilteredSortedCases() {
  let cases = getCases();

  if (currentSearch.trim()) {
    const q = currentSearch.trim().toLowerCase();
    cases = cases.filter(c => {
      const client = findClientById(c.clientId);
      const clientName = client ? client.name.toLowerCase() : '';
      return (
        c.caseNumber.toLowerCase().includes(q) ||
        c.caseName.toLowerCase().includes(q) ||
        clientName.includes(q) ||
        (c.courtName || '').toLowerCase().includes(q)
      );
    });
  }

  switch (currentSort) {
    case 'az':
      cases.sort((a, b) => a.caseName.localeCompare(b.caseName));
      break;
    case 'za':
      cases.sort((a, b) => b.caseName.localeCompare(a.caseName));
      break;
    case 'newest':
      cases.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;
    case 'oldest':
      cases.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      break;
    case 'status':
      cases.sort((a, b) => a.status.localeCompare(b.status));
      break;
  }

  return cases;
}

function renderCaseCustomFieldHeaders() {
  const headerCell = document.getElementById('caseCustomFieldHeaders');
  if (!headerCell) return;

  const temp = document.createElement('tr');
  temp.innerHTML = renderCustomFieldHeaders(CF_MODULE_CASES);
  const newCells = Array.from(temp.children);

  const parentRow = headerCell.parentElement;
  const placeholderIndex = Array.from(parentRow.children).indexOf(headerCell);
  headerCell.remove();
  newCells.reverse().forEach(cell => {
    parentRow.insertBefore(cell, parentRow.children[placeholderIndex] || null);
  });
  newCells[newCells.length - 1].id = 'caseCustomFieldHeaders';
}

function renderCaseTable() {
  const cases = getFilteredSortedCases();
  const tbody = document.getElementById('caseTableBody');

  renderStatTiles(getCases());
  renderCaseCustomFieldHeaders();

  const totalCols = 11 + getCustomFieldColspan(CF_MODULE_CASES);

  if (cases.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${totalCols}">No cases found.</td></tr>`;
    return;
  }

  const documents = getDocuments();
  const progressEntries = getProgressEntries();
  const hasCaseAi = typeof openCaseSummaryModal === 'function';

  tbody.innerHTML = cases.map(c => {
    const client = findClientById(c.clientId);
    const clientName = client ? client.name : '<span class="text-muted">Unknown Client</span>';
    const docCount = documents.filter(d => d.caseId === c.id).length;
    const progressCount = progressEntries.filter(p => p.caseId === c.id).length;

    const hearingCell = c.hearingDate
      ? `<div class="hearing-date-cell"><i class="fa-solid fa-calendar-day"></i> ${formatDate(c.hearingDate)}</div>`
      : `<div class="hearing-date-cell none">No hearing set</div>`;

    const drawerCell = c.drawerNumber
      ? `<div class="drawer-number-cell"><span class="drawer-number-badge"><i class="fa-solid fa-box-archive"></i> Drawer ${escapeHtml(String(c.drawerNumber))}</span></div>`
      : `<div class="drawer-number-cell"><span class="drawer-number-badge unassigned">Unassigned</span></div>`;

    const aiBtn = hasCaseAi
      ? `<button class="btn-icon caseai-row-btn" title="AI Case Summary" data-ai-case="${c.id}"><i class="fa-solid fa-robot"></i></button>`
      : '';

    return `
      <tr>
        <td class="case-number-cell">${escapeHtml(c.caseNumber)}</td>
        <td>${clientName}</td>
        <td class="case-name-cell">${escapeHtml(c.caseName)}</td>
        <td>${escapeHtml(c.courtName || '—')}</td>
        <td class="case-court-address" title="${escapeHtml(c.courtAddress || '')}">${escapeHtml(c.courtAddress || '—')}</td>
        <td>${hearingCell}</td>
        <td>${drawerCell}</td>
        <td>
          <button class="cell-action-btn" data-open-documents="${c.id}">
            <i class="fa-solid fa-folder"></i> Docs <span class="count-badge">${docCount}</span>
          </button>
        </td>
        <td>
          <button class="cell-action-btn" data-open-progress="${c.id}">
            <i class="fa-solid fa-chart-line"></i> Progress <span class="count-badge">${progressCount}</span>
          </button>
        </td>
        <td><span class="badge badge-${c.status}">${c.status}</span></td>
        ${renderCustomFieldCells(CF_MODULE_CASES, c)}
        <td>
          <div class="table-actions">
            ${aiBtn}
            <button class="btn-icon" title="Edit" data-edit-case="${c.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon danger" title="Delete" data-delete-case="${c.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderDashboard() {
  renderCaseTable();
}

/* ============================================================
   CLIENT DROPDOWN SYNC
   ============================================================ */
function populateClientDropdown() {
  const select = document.getElementById('caseClientSelect');
  const clients = getClients();

  const currentValue = select.value;
  select.innerHTML = `<option value="">-- Select a Client --</option>` +
    clients.map(cl => `<option value="${cl.id}">${escapeHtml(cl.name)}</option>`).join('');

  if (currentValue) select.value = currentValue;

  if (clients.length === 0) {
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.textContent = 'No clients yet — add one in the Clients module first';
    select.appendChild(opt);
  }
}

/* ============================================================
   ADD / EDIT CASE
   ============================================================ */
function openAddCaseModal() {
  document.getElementById('caseModalTitle').innerHTML = '<i class="fa-solid fa-folder-plus"></i> Add Case';
  document.getElementById('caseForm').reset();
  document.getElementById('caseId').value = '';
  document.getElementById('caseDrawerNumber').value = '';
  clearFormError('caseFormError');
  populateClientDropdown();
  document.getElementById('caseCustomFieldsWrap').innerHTML = renderCustomFieldFormInputs(CF_MODULE_CASES, {});
  openModal('caseModalOverlay');
}

function openEditCaseModal(caseId) {
  const caseObj = findCaseById(caseId);
  if (!caseObj) return;

  document.getElementById('caseModalTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Edit Case';
  clearFormError('caseFormError');
  populateClientDropdown();

  document.getElementById('caseId').value = caseObj.id;
  document.getElementById('caseNumber').value = caseObj.caseNumber;
  document.getElementById('caseClientSelect').value = caseObj.clientId || '';
  document.getElementById('caseName').value = caseObj.caseName;
  document.getElementById('courtName').value = caseObj.courtName || '';
  document.getElementById('courtAddress').value = caseObj.courtAddress || '';
  document.getElementById('hearingDate').value = caseObj.hearingDate || '';
  document.getElementById('caseDrawerNumber').value = caseObj.drawerNumber || '';
  document.getElementById('caseStatus').value = caseObj.status;

  document.getElementById('caseCustomFieldsWrap').innerHTML = renderCustomFieldFormInputs(CF_MODULE_CASES, caseObj.customFields || {});

  openModal('caseModalOverlay');
}

/**
 * NEW: notifies every registered user (except the person who
 * created it) whenever a new Case is added.
 */
function notifyAllUsersOfNewCase(caseObj, clientName) {
  const allUserIds = getUsers().map(u => u.id).filter(id => id !== currentDashboardUser.id);
  createNotificationForMany(
    allUserIds,
    'case-added',
    'New case added',
    `${currentDashboardUser.firstName} ${currentDashboardUser.lastName} added case "${caseObj.caseName}" (${caseObj.caseNumber}) for ${clientName}.`,
    { page: 'dashboard.html', targetId: null }
  );
}

function handleCaseFormSubmit(e) {
  e.preventDefault();
  clearFormError('caseFormError');

  const id = document.getElementById('caseId').value;
  const caseNumber = document.getElementById('caseNumber').value.trim();
  const clientId = document.getElementById('caseClientSelect').value;
  const caseName = document.getElementById('caseName').value.trim();
  const courtName = document.getElementById('courtName').value.trim();
  const courtAddress = document.getElementById('courtAddress').value.trim();
  const hearingDate = document.getElementById('hearingDate').value;
  const drawerNumberRaw = document.getElementById('caseDrawerNumber').value;
  const drawerNumber = drawerNumberRaw ? parseInt(drawerNumberRaw, 10) : null;
  const status = document.getElementById('caseStatus').value;
  const customFields = collectCustomFieldValues(CF_MODULE_CASES);

  if (!caseNumber || !clientId || !caseName || !courtName) {
    showFormError('caseFormError', 'Please fill in all required fields.');
    return;
  }

  const cases = getCases();

  const duplicate = cases.find(c => c.caseNumber.toLowerCase() === caseNumber.toLowerCase() && c.id !== id);
  if (duplicate) {
    showFormError('caseFormError', 'A case with this Case Number already exists.');
    return;
  }

  const clientObj = findClientById(clientId);
  const clientName = clientObj ? clientObj.name : 'Unknown Client';

  if (id) {
    const idx = cases.findIndex(c => c.id === id);
    if (idx === -1) {
      showFormError('caseFormError', 'Case not found.');
      return;
    }
    cases[idx] = {
      ...cases[idx],
      caseNumber, clientId, caseName, courtName, courtAddress, hearingDate, drawerNumber, status,
      customFields,
      updatedAt: nowISO()
    };
    saveCases(cases);

    if (typeof logActivity === 'function') {
      logActivity(currentDashboardUser.id, 'case-edit', `Edited case "${caseName}" (${caseNumber}).`);
    }

    showToast('Case updated successfully.', 'success');
  } else {
    const newCase = {
      id: generateId('CASE'),
      caseNumber, clientId, caseName, courtName, courtAddress, hearingDate, drawerNumber, status,
      customFields,
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
    cases.push(newCase);
    saveCases(cases);

    if (hearingDate) {
      const hearings = getHearings();
      hearings.push({
        id: generateId('HEARING'),
        caseId: newCase.id,
        hearingDate,
        hearingName: 'Initial Hearing',
        notes: '',
        createdAt: nowISO()
      });
      saveHearings(hearings);
    }

    if (typeof logActivity === 'function') {
      logActivity(currentDashboardUser.id, 'case-add', `Added new case "${caseName}" (${caseNumber}).`);
    }

    // NEW: notify everyone about the new case
    notifyAllUsersOfNewCase(newCase, clientName);

    showToast('Case added successfully.', 'success');
  }

  closeModal('caseModalOverlay');
  renderCaseTable();
  renderCabinet();
}

/* ============================================================
   DELETE CASE
   ============================================================ */
function handleDeleteCase(caseId) {
  const caseObj = findCaseById(caseId);
  if (!caseObj) return;

  confirmDelete(
    `Delete case "${caseObj.caseName}" (${caseObj.caseNumber})? This will also remove its documents, progress history, and hearings. This cannot be undone.`,
    () => {
      // Record a 'delete' movement for every file in this case BEFORE removing them,
      // so the AI can still answer "sino nag-delete ng ...".
      if (typeof logDocMovement === 'function') {
        getDocuments()
          .filter(d => d.caseId === caseId)
          .forEach(d => logDocMovement('delete', d, {
            details: `Deleted together with case "${caseObj.caseName}" (${caseObj.caseNumber})`
          }));
      }

      saveCases(getCases().filter(c => c.id !== caseId));
      saveDocuments(getDocuments().filter(d => d.caseId !== caseId));
      saveProgressEntries(getProgressEntries().filter(p => p.caseId !== caseId));
      saveHearings(getHearings().filter(h => h.caseId !== caseId));

      if (typeof logActivity === 'function') {
        logActivity(currentDashboardUser.id, 'case-edit', `Deleted case "${caseObj.caseName}" (${caseObj.caseNumber}).`);
      }

      renderCaseTable();
      renderCabinet();
      showToast('Case deleted.', 'success');
    },
    'Delete Case',
    '<i class="fa-solid fa-trash"></i> Delete Case'
  );
}

/* ============================================================
   FILING CABINET
   ============================================================ */
const CABINET_DRAWERS = [
  { number: 1, label: 'Drawer 1' },
  { number: 2, label: 'Drawer 2' },
  { number: 3, label: 'Drawer 3' }
];

let _openDrawerNumber = null;

function openDrawerCabinetModal() {
  _openDrawerNumber = null;
  renderCabinet();
  openModal('drawerCabinetModalOverlay');
}

function renderCabinet() {
  const wrapper = document.getElementById('cabinetWrapper');
  if (!wrapper) return;

  const allCases = getCases();
  const allDocuments = getDocuments();

  wrapper.innerHTML = CABINET_DRAWERS.map(drawer => {
    const drawerCases = allCases.filter(c => c.drawerNumber === drawer.number);
    const isOpen = _openDrawerNumber === drawer.number;

    const foldersHtml = drawerCases.length > 0
      ? drawerCases.map(c => {
          const client = findClientById(c.clientId);
          const docCount = allDocuments.filter(d => d.caseId === c.id).length;
          return `
            <div class="cabinet-folder" data-open-folder="${c.id}">
              <div class="cabinet-folder-icon">
                <i class="fa-solid fa-folder"></i>
                <span class="folder-doc-count">${docCount}</span>
              </div>
              <div class="cabinet-folder-name" title="${escapeHtml(c.caseName)}">${escapeHtml(client ? client.name : c.caseName)}</div>
              <div class="cabinet-folder-subname">${escapeHtml(c.caseNumber)}</div>
            </div>
          `;
        }).join('')
      : `<div class="cabinet-drawer-empty">No case files assigned to this drawer yet.</div>`;

    return `
      <div class="cabinet-drawer ${isOpen ? 'open' : ''}" data-drawer-number="${drawer.number}">
        <div class="cabinet-drawer-front" data-drawer-toggle="${drawer.number}">
          <div class="cabinet-drawer-handle"></div>
          <div class="cabinet-drawer-label">
            <h4><i class="fa-solid fa-box-archive"></i> ${drawer.label}</h4>
            <p>Click to ${isOpen ? 'close' : 'open'} this drawer</p>
          </div>
          <span class="cabinet-drawer-count">${drawerCases.length} file${drawerCases.length === 1 ? '' : 's'}</span>
          <i class="fa-solid fa-chevron-down cabinet-drawer-chevron"></i>
        </div>
        <div class="cabinet-drawer-contents">
          <div class="cabinet-folder-grid">
            ${foldersHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleDrawer(drawerNumber) {
  _openDrawerNumber = (_openDrawerNumber === drawerNumber) ? null : drawerNumber;
  renderCabinet();
}

function openFolderDestination(caseId) {
  closeModal('drawerCabinetModalOverlay');
  openDocumentsModal(caseId);
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function attachDashboardEvents() {
  document.getElementById('addCaseBtn').addEventListener('click', openAddCaseModal);
  document.getElementById('closeCaseModal').addEventListener('click', () => closeModal('caseModalOverlay'));
  document.getElementById('caseForm').addEventListener('submit', handleCaseFormSubmit);
  enableClickOutsideClose('caseModalOverlay');

  document.getElementById('caseSearchInput').addEventListener('input', (e) => {
    currentSearch = e.target.value;
    renderCaseTable();
  });

  document.getElementById('caseSortSelect').addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderCaseTable();
  });

  document.getElementById('caseTableBody').addEventListener('click', (e) => {
    const aiBtn = e.target.closest('[data-ai-case]');
    const editBtn = e.target.closest('[data-edit-case]');
    const deleteBtn = e.target.closest('[data-delete-case]');
    const docsBtn = e.target.closest('[data-open-documents]');
    const progressBtn = e.target.closest('[data-open-progress]');

    if (aiBtn && typeof openCaseSummaryModal === 'function') openCaseSummaryModal(aiBtn.dataset.aiCase);
    if (editBtn) openEditCaseModal(editBtn.dataset.editCase);
    if (deleteBtn) handleDeleteCase(deleteBtn.dataset.deleteCase);
    if (docsBtn) openDocumentsModal(docsBtn.dataset.openDocuments);
    if (progressBtn) openProgressModal(progressBtn.dataset.openProgress);
  });

  document.getElementById('drawerCabinetTriggerBtn').addEventListener('click', openDrawerCabinetModal);
  document.getElementById('closeDrawerCabinetModal').addEventListener('click', () => closeModal('drawerCabinetModalOverlay'));
  enableClickOutsideClose('drawerCabinetModalOverlay');

  document.getElementById('cabinetWrapper').addEventListener('click', (e) => {
    const drawerToggle = e.target.closest('[data-drawer-toggle]');
    const folder = e.target.closest('[data-open-folder]');

    if (folder) {
      openFolderDestination(folder.dataset.openFolder);
    } else if (drawerToggle) {
      toggleDrawer(parseInt(drawerToggle.dataset.drawerToggle, 10));
    }
  });

  document.getElementById('caseTableBody').closest('table').querySelector('thead').addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-cf-open-manager]');
    if (openBtn) {
      openCustomFieldsManager(CF_MODULE_CASES, 'Case Dashboard', renderCaseTable);
    }
  });
}

/* ============================================================
   SHARED SMALL HELPERS
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

function refreshDashboardTable() {
  renderCaseTable();
}