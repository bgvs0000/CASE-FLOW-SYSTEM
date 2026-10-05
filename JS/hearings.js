/* ============================================================
   CASEFLOW — HEARINGS.JS
   Hearing detail modal + Add Next Hearing logic.
   A case can have multiple hearings (caseflow_hearings, each
   referencing a caseId). This file renders the full hearing
   history for a case inside the Hearing Detail modal and
   handles adding new hearings.

   Depends on: storage.js, modal.js (loaded before this)
   Called from: calendar.js (openHearingDetailModal)
   ============================================================ */

let currentHearingDetailCaseId = null;

/* ============================================================
   OPEN HEARING DETAIL MODAL
   Shows full case info + hearing info for the hearing that was
   clicked, plus the complete hearing history for that case.
   ============================================================ */
function openHearingDetailModal(caseId, hearingId) {
  const caseObj = findCaseById(caseId);
  if (!caseObj) return;

  const hearing = getHearings().find(h => h.id === hearingId);
  const client = findClientById(caseObj.clientId);

  currentHearingDetailCaseId = caseId;
  document.getElementById('hearingDetailCaseId').value = caseId;
  document.getElementById('hearingDetailHearingId').value = hearingId || '';
  document.getElementById('newHearingCaseId').value = caseId;

  const allHearingsForCase = getHearings()
    .filter(h => h.caseId === caseId)
    .sort((a, b) => new Date(a.hearingDate) - new Date(b.hearingDate));

  const todayStr = new Date().toISOString().split('T')[0];

  const historyHtml = allHearingsForCase.map(h => {
    const isPast = h.hearingDate < todayStr;
    const isClicked = h.id === hearingId;
    return `
      <div class="hearing-history-item ${isPast ? 'past' : 'upcoming'}" style="${isClicked ? 'outline:2px solid var(--color-gold);' : ''}">
        <div>
          <strong>${escapeHtml(h.hearingName)}</strong><br>
          <span class="text-muted" style="font-size:11.5px;">${h.notes ? escapeHtml(h.notes) : 'No notes'}</span>
        </div>
        <span class="badge ${isPast ? 'badge-completed' : 'badge-active'}">${formatDate(h.hearingDate)}</span>
      </div>
    `;
  }).join('') || `<p class="text-muted">No hearings recorded for this case.</p>`;

  document.getElementById('hearingDetailGrid').innerHTML = `
    <div class="hearing-detail-item">
      <label>Case Number</label>
      <p>${escapeHtml(caseObj.caseNumber)}</p>
    </div>
    <div class="hearing-detail-item">
      <label>Client Name</label>
      <p>${client ? escapeHtml(client.name) : '<span class="text-muted">Unknown Client</span>'}</p>
    </div>
    <div class="hearing-detail-item full-span">
      <label>Case Name</label>
      <p>${escapeHtml(caseObj.caseName)}</p>
    </div>
    <div class="hearing-detail-item">
      <label>Court Name</label>
      <p>${escapeHtml(caseObj.courtName || '—')}</p>
    </div>
    <div class="hearing-detail-item">
      <label>Court Address</label>
      <p>${escapeHtml(caseObj.courtAddress || '—')}</p>
    </div>
    ${hearing ? `
    <div class="hearing-detail-item">
      <label>Hearing Date</label>
      <p>${formatDate(hearing.hearingDate)}</p>
    </div>
    <div class="hearing-detail-item">
      <label>Hearing Name</label>
      <p>${escapeHtml(hearing.hearingName)}</p>
    </div>
    ` : ''}
    <div class="hearing-detail-item">
      <label>Status</label>
      <p><span class="badge badge-${caseObj.status}">${caseObj.status}</span></p>
    </div>
    <div class="hearing-detail-item">
      <label>Total Hearings</label>
      <p>${allHearingsForCase.length}</p>
    </div>

    <div class="hearing-history-section">
      <h4><i class="fa-solid fa-clock-rotate-left"></i> All Hearings for This Case</h4>
      ${historyHtml}
    </div>
  `;

  openModal('hearingDetailModalOverlay');
}

/* ============================================================
   ADD NEXT HEARING
   ============================================================ */
function openAddHearingModal() {
  document.getElementById('addHearingForm').reset();
  clearFormError('addHearingError');
  // newHearingCaseId is already set by openHearingDetailModal before this opens
  openModal('addHearingModalOverlay');
}

function handleAddHearingSubmit(e) {
  e.preventDefault();
  clearFormError('addHearingError');

  const caseId = document.getElementById('newHearingCaseId').value;
  const hearingDate = document.getElementById('newHearingDate').value;
  const hearingName = document.getElementById('newHearingName').value.trim();
  const notes = document.getElementById('newHearingNotes').value.trim();

  if (!caseId) {
    showFormError('addHearingError', 'No case selected. Please close and try again.');
    return;
  }
  if (!hearingDate || !hearingName) {
    showFormError('addHearingError', 'Please fill in the Hearing Date and Hearing Name.');
    return;
  }

  const hearings = getHearings();
  hearings.push({
    id: generateId('HEARING'),
    caseId,
    hearingDate,
    hearingName,
    notes,
    createdAt: nowISO()
  });
  saveHearings(hearings);

  // Keep the parent case's main "hearingDate" field in sync with the
  // NEXT upcoming hearing, so the Dashboard table's Hearing Date column
  // always reflects the soonest upcoming hearing for that case.
  syncCaseNextHearingDate(caseId);

  closeModal('addHearingModalOverlay');
  showToast('Hearing added successfully.', 'success');

  // Refresh whichever view is currently open behind it
  if (typeof renderCalendar === 'function') renderCalendar();
  openHearingDetailModal(caseId, null); // reopen detail modal showing updated history
}

/* ============================================================
   SYNC CASE'S "NEXT HEARING" FIELD
   The Case record keeps a single hearingDate field (used by the
   Dashboard table and Add Case form). Whenever hearings change,
   recalculate it as the soonest hearing that is today or later;
   falls back to the most recent past hearing if none are upcoming.
   ============================================================ */
function syncCaseNextHearingDate(caseId) {
  const todayStr = new Date().toISOString().split('T')[0];
  const caseHearings = getHearings()
    .filter(h => h.caseId === caseId)
    .sort((a, b) => new Date(a.hearingDate) - new Date(b.hearingDate));

  if (caseHearings.length === 0) return;

  const upcoming = caseHearings.find(h => h.hearingDate >= todayStr);
  const nextDate = upcoming ? upcoming.hearingDate : caseHearings[caseHearings.length - 1].hearingDate;

  const cases = getCases();
  const idx = cases.findIndex(c => c.id === caseId);
  if (idx !== -1) {
    cases[idx].hearingDate = nextDate;
    cases[idx].updatedAt = nowISO();
    saveCases(cases);
  }
}

/* ============================================================
   EVENT WIRING (runs once on page load, alongside calendar.js)
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const closeDetailBtn = document.getElementById('closeHearingDetailModal');
  if (closeDetailBtn) closeDetailBtn.addEventListener('click', () => closeModal('hearingDetailModalOverlay'));
  enableClickOutsideClose('hearingDetailModalOverlay');

  const addNextHearingBtn = document.getElementById('addNextHearingBtn');
  if (addNextHearingBtn) addNextHearingBtn.addEventListener('click', openAddHearingModal);

  const closeAddHearingBtn = document.getElementById('closeAddHearingModal');
  if (closeAddHearingBtn) closeAddHearingBtn.addEventListener('click', () => closeModal('addHearingModalOverlay'));
  enableClickOutsideClose('addHearingModalOverlay');

  const addHearingForm = document.getElementById('addHearingForm');
  if (addHearingForm) addHearingForm.addEventListener('submit', handleAddHearingSubmit);
});

/* ============================================================
   LOCAL HELPERS (self-contained per page, same pattern as clients.js)
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