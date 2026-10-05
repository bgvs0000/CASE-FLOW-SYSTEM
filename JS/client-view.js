/* ============================================================
   CASEFLOW — CLIENT-VIEW.JS
   Public client portal page. No login/session — gated entirely
   by the URL token + the client record's access control fields
   (isLocked, accessDurationHours, shareStartedAt, requireCode).

   GATE ORDER (first failing check wins):
   1. Invalid/missing token -> stateInvalid
   2. isLocked === true -> stateLocked
   3. accessDurationHours > 0 AND now > shareStartedAt + duration -> stateExpired
   4. requireCode === true AND code not yet verified this session -> stateCodeRequired
   5. Otherwise -> render real portal content

   Depends on: storage.js, modal.js (loaded before this)
   ============================================================ */

let portalClient = null;
let portalToken = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('portalCurrentYear').textContent = new Date().getFullYear();

  portalToken = new URLSearchParams(window.location.search).get('token');
  runAccessGate();

  document.getElementById('portalCodeForm').addEventListener('submit', handleCodeSubmit);
  document.getElementById('closePortalDocViewModal').addEventListener('click', () => closeModal('portalDocViewModalOverlay'));
  enableClickOutsideClose('portalDocViewModalOverlay');

  document.getElementById('portalCasesList').addEventListener('click', (e) => {
    const viewDocBtn = e.target.closest('[data-view-portal-doc]');
    const downloadDocBtn = e.target.closest('[data-download-portal-doc]');
    const progressImg = e.target.closest('[data-view-progress-img]');

    if (viewDocBtn) handleViewPortalDoc(viewDocBtn.dataset.viewPortalDoc);
    if (downloadDocBtn) handleDownloadPortalDoc(downloadDocBtn.dataset.downloadPortalDoc);
    if (progressImg) handleViewProgressImage(progressImg.dataset.viewProgressImg);
  });
});

/* ============================================================
   STATE SCREEN SWITCHER
   ============================================================ */
function showOnlyState(stateId) {
  ['stateInvalid', 'stateLocked', 'stateExpired', 'stateCodeRequired', 'portalContent'].forEach(id => {
    document.getElementById(id).style.display = id === stateId ? 'block' : 'none';
  });
}

/* ============================================================
   ACCESS GATE
   ============================================================ */
function runAccessGate() {
  if (!portalToken) {
    showOnlyState('stateInvalid');
    return;
  }

  const client = getClients().find(c => c.shareToken === portalToken);
  if (!client) {
    showOnlyState('stateInvalid');
    return;
  }
  portalClient = client;

  if (client.isLocked) {
    showOnlyState('stateLocked');
    return;
  }

  if (client.accessDurationHours && client.accessDurationHours > 0 && client.shareStartedAt) {
    const startedAt = new Date(client.shareStartedAt).getTime();
    const expiresAt = startedAt + (client.accessDurationHours * 3600000);
    if (Date.now() > expiresAt) {
      showOnlyState('stateExpired');
      return;
    }
  }

  if (client.requireCode) {
    const sessionKey = `portal_code_verified_${client.id}`;
    const alreadyVerified = sessionStorage.getItem(sessionKey) === 'true';
    if (!alreadyVerified) {
      showOnlyState('stateCodeRequired');
      return;
    }
  }

  renderPortalContent(client);
  showOnlyState('portalContent');
}

/* ============================================================
   ROTATING 6-DIGIT ACCESS CODE (must match clients.js exactly)
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

function handleCodeSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('portalCodeError');
  errorEl.textContent = '';
  errorEl.classList.remove('active');

  const entered = document.getElementById('portalCodeInput').value.trim();
  const expected = computePortalCode(portalToken);

  if (entered !== expected) {
    errorEl.textContent = 'Incorrect code. Please check with the firm and try again.';
    errorEl.classList.add('active');
    return;
  }

  sessionStorage.setItem(`portal_code_verified_${portalClient.id}`, 'true');
  renderPortalContent(portalClient);
  showOnlyState('portalContent');
}

/* ============================================================
   RENDER PORTAL CONTENT (real data, pulled live from LocalStorage)
   ============================================================ */
function renderPortalContent(client) {
  document.getElementById('portalClientAvatar').textContent = getInitials(client.name);
  document.getElementById('portalClientName').textContent = client.name;
  document.getElementById('portalClientMeta').textContent = `Client since ${formatDate(client.createdAt)}`;

  document.getElementById('portalClientContact').textContent = client.contact || '—';
  document.getElementById('portalClientEmail').textContent = client.email || '—';
  document.getElementById('portalClientAddress').textContent = client.address || '—';

  const caseInfoSection = document.getElementById('portalCaseInfoSection');
  if (client.caseInfo) {
    document.getElementById('portalCaseInfoText').textContent = client.caseInfo;
    caseInfoSection.style.display = 'block';
  } else {
    caseInfoSection.style.display = 'none';
  }

  renderPortalCases(client);
}

/* ============================================================
   CASES (unchanged logic, split into its own function)
   ============================================================ */
function renderPortalCases(client) {
  const cases = getCases().filter(c => c.clientId === client.id);
  const listEl = document.getElementById('portalCasesList');

  if (cases.length === 0) {
    listEl.innerHTML = `<p class="portal-empty-msg">No cases on file yet.</p>`;
    return;
  }

  const allHearings = getHearings();
  const allDocuments = getDocuments();
  const allProgress = getProgressEntries();

  listEl.innerHTML = cases.map(c => {
    const hearings = allHearings.filter(h => h.caseId === c.id).sort((a, b) => new Date(a.hearingDate) - new Date(b.hearingDate));
    const documents = allDocuments.filter(d => d.caseId === c.id).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    const progress = allProgress.filter(p => p.caseId === c.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return `
      <div class="portal-case-card">
        <div class="portal-case-card-header">
          <div>
            <div class="case-num">${escapeHtml(c.caseNumber)}</div>
            <h4>${escapeHtml(c.caseName)}</h4>
            <div class="portal-case-court">${escapeHtml(c.courtName || 'Court not yet set')}${c.courtAddress ? ' — ' + escapeHtml(c.courtAddress) : ''}</div>
          </div>
          <span class="badge badge-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span>
        </div>

        <div class="portal-case-body">

          <div class="portal-subsection">
            <h5><i class="fa-solid fa-calendar-days"></i> Hearings (${hearings.length})</h5>
            ${hearings.length > 0 ? hearings.map(h => `
              <div class="portal-hearing-row">
                <div>
                  <strong>${escapeHtml(h.hearingName)}</strong>
                  ${h.notes ? `<div class="text-muted" style="font-size:11.5px; margin-top:2px;">${escapeHtml(h.notes)}</div>` : ''}
                </div>
                <span class="hearing-date-badge">${formatDate(h.hearingDate)}</span>
              </div>
            `).join('') : '<p class="portal-empty-msg">No hearings scheduled yet.</p>'}
          </div>

          <div class="portal-subsection">
            <h5><i class="fa-solid fa-folder-open"></i> Documents (${documents.length})</h5>
            ${documents.length > 0 ? documents.map(d => `
              <div class="portal-doc-row">
                <i class="fa-solid ${getPortalFileIcon(d.fileType)} doc-icon"></i>
                <span class="doc-name">${escapeHtml(d.fileName)}</span>
                <span class="doc-date">${formatDate(d.uploadedAt)}</span>
                <div class="doc-actions">
                  <button class="btn-icon" title="View" data-view-portal-doc="${d.id}"><i class="fa-solid fa-eye"></i></button>
                  <button class="btn-icon" title="Download" data-download-portal-doc="${d.id}"><i class="fa-solid fa-download"></i></button>
                </div>
              </div>
            `).join('') : '<p class="portal-empty-msg">No documents uploaded yet.</p>'}
          </div>

          <div class="portal-subsection">
            <h5><i class="fa-solid fa-chart-line"></i> Case Progress (${progress.length})</h5>
            ${progress.length > 0 ? progress.map(p => `
              <div class="portal-progress-entry">
                <div class="portal-progress-marker"><i class="fa-solid fa-circle-check"></i></div>
                <div class="portal-progress-content">
                  <div class="portal-progress-title">${escapeHtml(p.title)}</div>
                  <div class="portal-progress-date">${formatDateTime(p.createdAt)}</div>
                  <div class="portal-progress-details">${escapeHtml(p.details)}</div>
                  ${p.imageDataUrl ? `<img src="${p.imageDataUrl}" class="portal-progress-image" data-view-progress-img="${escapeHtml(p.imageDataUrl)}" alt="Progress image">` : ''}
                </div>
              </div>
            `).join('') : '<p class="portal-empty-msg">No progress updates yet.</p>'}
          </div>

        </div>
      </div>
    `;
  }).join('');
}

/* ============================================================
   DOCUMENT VIEW / DOWNLOAD — CASE DOCS (read-only)
   ============================================================ */
function handleViewPortalDoc(docId) {
  const doc = getDocuments().find(d => d.id === docId);
  if (!doc) return;
  showPortalDocPreview(doc);
}

function handleDownloadPortalDoc(docId) {
  const doc = getDocuments().find(d => d.id === docId);
  if (!doc) return;
  triggerPortalDownload(doc);
}

/* ---------- SHARED PREVIEW / DOWNLOAD HELPERS ---------- */
function showPortalDocPreview(doc) {
  document.getElementById('portalDocViewName').textContent = doc.fileName;
  const body = document.getElementById('portalDocViewBody');

  if (doc.fileType.includes('image')) {
    body.innerHTML = `<img src="${doc.dataUrl}" alt="${escapeHtml(doc.fileName)}" style="max-width:100%; max-height:65vh; border-radius:8px;">`;
  } else if (doc.fileType.includes('pdf')) {
    body.innerHTML = `<iframe src="${doc.dataUrl}" style="width:100%; height:65vh; border:none; border-radius:8px;"></iframe>`;
  } else {
    body.innerHTML = `
      <div style="padding:50px 20px; color:var(--color-gray-text);">
        <i class="fa-solid fa-file" style="font-size:40px; margin-bottom:14px; color:var(--color-gold); display:block;"></i>
        <p>Preview not available for this file type.</p>
        <p class="text-muted" style="margin-top:6px;">Use Download to view "${escapeHtml(doc.fileName)}".</p>
      </div>
    `;
  }

  openModal('portalDocViewModalOverlay');
}

function triggerPortalDownload(doc) {
  const link = document.createElement('a');
  link.href = doc.dataUrl;
  link.download = doc.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function handleViewProgressImage(dataUrl) {
  document.getElementById('portalDocViewName').textContent = 'Progress Image';
  document.getElementById('portalDocViewBody').innerHTML = `<img src="${dataUrl}" style="max-width:100%; max-height:65vh; border-radius:8px;" alt="Progress image">`;
  openModal('portalDocViewModalOverlay');
}

/* ============================================================
   LOCAL HELPERS
   ============================================================ */
function getInitials(name) {
  const parts = (name || '').trim().split(/\s+/);
  const first = parts[0] ? parts[0].charAt(0) : '';
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase() || 'C';
}

function getPortalFileIcon(fileType) {
  if (!fileType) return 'fa-file';
  if (fileType.includes('pdf')) return 'fa-file-pdf';
  if (fileType.includes('image')) return 'fa-file-image';
  if (fileType.includes('word') || fileType.includes('document')) return 'fa-file-word';
  if (fileType.includes('sheet') || fileType.includes('excel')) return 'fa-file-excel';
  if (fileType.includes('zip') || fileType.includes('rar')) return 'fa-file-zipper';
  return 'fa-file';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}