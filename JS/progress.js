/* ============================================================
   CASEFLOW — PROGRESS.JS
   Case Progress: view progress history per case, add new
   progress entries (title, details, optional image).

   Images are stored the same way as documents.js — Base64 Data
   URLs directly in the caseflow_progress LocalStorage entries.
   Same prototype limitation applies (see documents.js notes).

   Depends on: storage.js, modal.js (loaded before this)
   Called from: dashboard.js (openProgressModal), dashboard.html markup
   ============================================================ */

let currentProgressCaseId = null;
let pendingProgressImageDataUrl = null;

/* ============================================================
   OPEN PROGRESS MODAL
   ============================================================ */
function openProgressModal(caseId) {
  const caseObj = findCaseById(caseId);
  if (!caseObj) return;

  currentProgressCaseId = caseId;

  document.getElementById('progressCaseId').value = caseId;
  document.getElementById('progressCaseLabel').textContent = `${caseObj.caseNumber} — ${caseObj.caseName}`;

  renderProgressHistory();
  openModal('progressModalOverlay');
}

/* ============================================================
   RENDER PROGRESS HISTORY
   ============================================================ */
function renderProgressHistory() {
  const entries = getProgressEntries()
    .filter(p => p.caseId === currentProgressCaseId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // newest first

  const container = document.getElementById('progressHistoryList');
  const noMsg = document.getElementById('noProgressMsg');

  if (entries.length === 0) {
    container.innerHTML = `<p class="text-muted" id="noProgressMsg">No progress entries yet.</p>`;
    return;
  }

  container.innerHTML = entries.map(p => `
    <div class="progress-entry">
      <div class="progress-entry-marker"><i class="fa-solid fa-circle-check"></i></div>
      <div class="progress-entry-content">
        <div class="progress-entry-header">
          <span class="progress-entry-title">${escapeHtml(p.title)}</span>
          <span class="progress-entry-date">${formatDateTime(p.createdAt)}</span>
        </div>
        <div class="progress-entry-details">${escapeHtml(p.details)}</div>
        ${p.imageDataUrl ? `<img src="${p.imageDataUrl}" class="progress-entry-image" data-view-progress-image="${escapeHtml(p.imageDataUrl)}" alt="Progress image">` : ''}
      </div>
    </div>
  `).join('');

  // Refresh the progress count badge on the dashboard table behind the modal
  if (typeof refreshDashboardTable === 'function') refreshDashboardTable();
}

/* ============================================================
   ADD PROGRESS
   ============================================================ */
function openAddProgressModal() {
  document.getElementById('addProgressForm').reset();
  clearFormError('addProgressError');
  document.getElementById('progressImgPreviewWrap').style.display = 'none';
  document.getElementById('progressImgPreview').src = '';
  pendingProgressImageDataUrl = null;
  openModal('addProgressModalOverlay');
}

async function handleProgressImageSelect(file) {
  if (!file) {
    pendingProgressImageDataUrl = null;
    document.getElementById('progressImgPreviewWrap').style.display = 'none';
    return;
  }

  const MAX_IMAGE_SIZE = 3 * 1024 * 1024; // 3MB cap, consistent with documents.js
  if (file.size > MAX_IMAGE_SIZE) {
    showFormError('addProgressError', 'Image too large (3MB limit for this prototype).');
    pendingProgressImageDataUrl = null;
    document.getElementById('progressImageInput').value = '';
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    pendingProgressImageDataUrl = dataUrl;
    const preview = document.getElementById('progressImgPreview');
    preview.src = dataUrl;
    document.getElementById('progressImgPreviewWrap').style.display = 'block';
  } catch (err) {
    console.error('[progress.js] Failed to read image:', err);
    showFormError('addProgressError', 'Failed to read image file.');
  }
}

function handleAddProgressSubmit(e) {
  e.preventDefault();
  clearFormError('addProgressError');

  const title = document.getElementById('progressTitle').value.trim();
  const details = document.getElementById('progressDetails').value.trim();

  if (!title || !details) {
    showFormError('addProgressError', 'Please fill in both Progress Title and Details.');
    return;
  }

  if (!currentProgressCaseId) {
    showFormError('addProgressError', 'No case selected. Please close and try again.');
    return;
  }

  const entries = getProgressEntries();
  entries.push({
    id: generateId('PROG'),
    caseId: currentProgressCaseId,
    title,
    details,
    imageDataUrl: pendingProgressImageDataUrl || null,
    createdAt: nowISO()
  });
  saveProgressEntries(entries);

  closeModal('addProgressModalOverlay');
  renderProgressHistory();
  showToast('Progress added successfully.', 'success');
}

/* ============================================================
   VIEW PROGRESS IMAGE (full view, reuses Document view modal)
   ============================================================ */
function handleViewProgressImage(dataUrl) {
  document.getElementById('viewDocName').textContent = 'Progress Image';
  document.getElementById('viewDocBody').innerHTML = `<img src="${dataUrl}" alt="Progress image">`;
  openModal('viewDocModalOverlay');
}

/* ============================================================
   EVENT WIRING (runs once on page load, alongside dashboard.js)
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const closeProgressBtn = document.getElementById('closeProgressModal');
  if (closeProgressBtn) closeProgressBtn.addEventListener('click', () => closeModal('progressModalOverlay'));
  enableClickOutsideClose('progressModalOverlay');

  const addProgressBtn = document.getElementById('addProgressBtn');
  if (addProgressBtn) addProgressBtn.addEventListener('click', openAddProgressModal);

  const closeAddProgressBtn = document.getElementById('closeAddProgressModal');
  if (closeAddProgressBtn) closeAddProgressBtn.addEventListener('click', () => closeModal('addProgressModalOverlay'));
  enableClickOutsideClose('addProgressModalOverlay');

  const addProgressForm = document.getElementById('addProgressForm');
  if (addProgressForm) addProgressForm.addEventListener('submit', handleAddProgressSubmit);

  const progressImageInput = document.getElementById('progressImageInput');
  if (progressImageInput) {
    progressImageInput.addEventListener('change', () => {
      handleProgressImageSelect(progressImageInput.files[0]);
    });
  }

  // Delegated click on progress history images (open full view)
  const historyList = document.getElementById('progressHistoryList');
  if (historyList) {
    historyList.addEventListener('click', (e) => {
      const imgBtn = e.target.closest('[data-view-progress-image]');
      if (imgBtn) {
        handleViewProgressImage(imgBtn.dataset.viewProgressImage);
      }
    });
  }
});