/* ============================================================
   CASEFLOW — DOCUMENTS.JS
   Case Document Manager: upload, search, sort, view, rename,
   replace, download, delete documents attached to a case.

   UPDATED (AI Document Intelligence):
   - Every upload / replace is automatically queued for AI scan
     (doc-intelligence.js) — OCR reads the file, even blurry ones.
   - Every movement (upload, view, rename, replace, download,
     delete) is recorded via logDocMovement() in storage.js.
     Those also mirror into the Control Panel Activity Log.
   - Search now also looks INSIDE the file (AI-read text, detected
     type, names, keywords), not just the filename.
   - Each row shows the AI-detected type badge + scan status and
     a "Rescan with AI" button.
   - Rows carry data-doc-row so the AI assistant's "View File"
     can scroll to and highlight the exact file.
   - Warns when LocalStorage is full instead of failing silently.

   STORAGE NOTE: Files are read via FileReader and stored as
   Base64 Data URLs inside the caseflow_documents LocalStorage
   entries. Prototype limitation — unchanged.

   Depends on: storage.js, modal.js (loaded before this)
   Optional:   doc-intelligence.js (AI scan / badges / highlight)
   Called from: dashboard.js (openDocumentsModal), dashboard.html markup
   ============================================================ */

let currentDocsCaseId = null;
let docSearchTerm = '';
let docSortMode = 'newest';

/* ---------- small helpers for the optional AI module ---------- */
function docsAiAvailable() {
  return typeof docAiQueueScan === 'function';
}

function docsLogMove(action, doc, extra) {
  if (typeof logDocMovement === 'function') logDocMovement(action, doc, extra);
}

/* ============================================================
   OPEN DOCUMENTS MODAL
   ============================================================ */
function openDocumentsModal(caseId) {
  const caseObj = findCaseById(caseId);
  if (!caseObj) return;

  currentDocsCaseId = caseId;
  docSearchTerm = '';
  docSortMode = 'newest';

  document.getElementById('docsCaseId').value = caseId;
  document.getElementById('docsCaseLabel').textContent = `${caseObj.caseNumber} — ${caseObj.caseName}`;
  document.getElementById('docSearchInput').value = '';
  document.getElementById('docSortSelect').value = 'newest';

  renderDocumentsTable();
  openModal('documentsModalOverlay');
}

/* ============================================================
   RENDER DOCUMENTS TABLE
   ============================================================ */
function docMatchesSearch(d, q) {
  const haystack = [
    d.fileName,
    d.aiDocType,
    (d.aiPersons || []).join(' '),
    (d.aiKeywords || []).join(' '),
    (d.aiDates || []).join(' '),
    d.aiText
  ].join(' ').toLowerCase();

  // every word typed must appear somewhere (filename OR inside the file)
  return q.split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}

function getFilteredSortedDocuments() {
  let docs = getDocuments().filter(d => d.caseId === currentDocsCaseId);

  if (docSearchTerm.trim()) {
    const q = docSearchTerm.trim().toLowerCase();
    docs = docs.filter(d => docMatchesSearch(d, q));
  }

  switch (docSortMode) {
    case 'newest': docs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)); break;
    case 'oldest': docs.sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt)); break;
    case 'az': docs.sort((a, b) => a.fileName.localeCompare(b.fileName)); break;
    case 'za': docs.sort((a, b) => b.fileName.localeCompare(a.fileName)); break;
  }

  return docs;
}

function renderDocumentsTable() {
  const tbody = document.getElementById('documentsTableBody');
  if (!tbody) return;

  const docs = getFilteredSortedDocuments();

  if (docs.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No documents found.</td></tr>`;
  } else {
    tbody.innerHTML = docs.map(d => {
      const highlighted = (typeof docAiIsHighlighted === 'function' && docAiIsHighlighted(d.id)) ? 'docai-highlight' : '';
      const aiBadge = (typeof docAiStatusBadge === 'function') ? docAiStatusBadge(d) : '';
      const rescanBtn = (docsAiAvailable() && typeof docAiCanScan === 'function' && docAiCanScan())
        ? `<button class="btn-icon" title="Rescan with AI" data-rescan-doc="${d.id}"><i class="fa-solid fa-robot"></i></button>`
        : '';

      return `
      <tr data-doc-row="${d.id}" class="${highlighted}">
        <td>
          <div class="doc-name-cell">
            <i class="fa-solid ${getFileIcon(d.fileType)}"></i>
            <div class="doc-name-stack">
              <span class="doc-name-text" title="${escapeHtml(d.fileName)}">${escapeHtml(d.fileName)}</span>
              ${aiBadge ? `<div class="doc-ai-line">${aiBadge}</div>` : ''}
            </div>
          </div>
        </td>
        <td><span class="doc-type-badge">${escapeHtml(getFileExtension(d.fileName))}</span></td>
        <td>${formatDate(d.uploadedAt)}</td>
        <td>${formatFileSize(d.fileSize)}</td>
        <td>
          <div class="table-actions">
            <button class="btn-icon" title="View" data-view-doc="${d.id}"><i class="fa-solid fa-eye"></i></button>
            <button class="btn-icon" title="Rename" data-rename-doc="${d.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon" title="Replace" data-replace-doc="${d.id}"><i class="fa-solid fa-arrows-rotate"></i></button>
            ${rescanBtn}
            <button class="btn-icon" title="Download" data-download-doc="${d.id}"><i class="fa-solid fa-download"></i></button>
            <button class="btn-icon danger" title="Delete" data-delete-doc="${d.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
    }).join('');
  }

  if (typeof refreshDashboardTable === 'function') refreshDashboardTable();
}

/* ============================================================
   FILE HELPERS
   ============================================================ */
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

/* ============================================================
   UPLOAD DOCUMENT(S)
   ============================================================ */
async function handleDocumentUpload(fileList) {
  if (!currentDocsCaseId || !fileList || fileList.length === 0) return;

  const MAX_FILE_SIZE = 3 * 1024 * 1024;
  const docs = getDocuments();
  const newDocs = [];
  let skippedCount = 0;

  for (const file of Array.from(fileList)) {
    if (file.size > MAX_FILE_SIZE) {
      skippedCount++;
      continue;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const newDoc = {
        id: generateId('DOC'),
        caseId: currentDocsCaseId,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        dataUrl,
        uploadedAt: nowISO(),
        aiStatus: 'queued'
      };
      docs.push(newDoc);
      newDocs.push(newDoc);
    } catch (err) {
      console.error('[documents.js] Failed to read file:', file.name, err);
      skippedCount++;
    }
  }

  if (newDocs.length > 0) {
    const saved = saveDocuments(docs);
    if (!saved) {
      showToast('Storage is full — the file(s) were NOT saved. Delete some old files first.', 'error');
      renderDocumentsTable();
      return;
    }

    // Record movement + queue AI scan for each new file
    newDocs.forEach(d => {
      docsLogMove('upload', d, { details: `Uploaded to Document Manager (${formatFileSize(d.fileSize)})` });
      if (docsAiAvailable()) docAiQueueScan(d.id);
    });
  }

  renderDocumentsTable();

  if (newDocs.length > 0) {
    const aiNote = (docsAiAvailable() && typeof docAiCanScan === 'function' && docAiCanScan())
      ? ' AI is scanning them now.'
      : '';
    showToast(`${newDocs.length} document(s) uploaded successfully.${aiNote}`, 'success');
  }
  if (skippedCount > 0) {
    showToast(`${skippedCount} file(s) skipped (too large, 3MB limit for this prototype).`, 'error');
  }
}

/* ============================================================
   VIEW DOCUMENT
   ============================================================ */
function handleViewDocument(docId) {
  const doc = getDocuments().find(d => d.id === docId);
  if (!doc) return;

  document.getElementById('viewDocName').textContent = doc.fileName;
  const body = document.getElementById('viewDocBody');

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

  docsLogMove('view', doc, { details: 'Previewed in Document Manager' });
  openModal('viewDocModalOverlay');
}

/* ============================================================
   RENAME DOCUMENT
   ============================================================ */
function handleOpenRenameModal(docId) {
  const doc = getDocuments().find(d => d.id === docId);
  if (!doc) return;

  document.getElementById('renameDocId').value = doc.id;
  document.getElementById('renameDocInput').value = doc.fileName;
  openModal('renameDocModalOverlay');
}

function handleRenameDocSubmit(e) {
  e.preventDefault();

  const docId = document.getElementById('renameDocId').value;
  const newName = document.getElementById('renameDocInput').value.trim();
  if (!newName) return;

  const docs = getDocuments();
  const idx = docs.findIndex(d => d.id === docId);
  if (idx === -1) return;

  const oldName = docs[idx].fileName;
  if (oldName === newName) {
    closeModal('renameDocModalOverlay');
    return;
  }

  docs[idx].fileName = newName;
  if (!saveDocuments(docs)) {
    showToast('Could not rename — storage is full.', 'error');
    return;
  }

  docsLogMove('rename', docs[idx], { oldName, newName, details: `Renamed from "${oldName}"` });

  closeModal('renameDocModalOverlay');
  renderDocumentsTable();
  showToast('Document renamed.', 'success');
}

/* ============================================================
   REPLACE DOCUMENT
   ============================================================ */
function handleReplaceDocument(docId) {
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
      const docs = getDocuments();
      const idx = docs.findIndex(d => d.id === docId);
      if (idx === -1) {
        tempInput.remove();
        return;
      }

      const oldName = docs[idx].fileName;

      docs[idx] = {
        ...docs[idx],
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        dataUrl,
        uploadedAt: nowISO(),
        // old AI reading no longer applies to the new file
        aiStatus: 'queued',
        aiText: '',
        aiDocType: null,
        aiDates: [],
        aiPersons: [],
        aiClientIds: [],
        aiKeywords: [],
        aiQuality: null,
        aiIndexedAt: null
      };

      if (!saveDocuments(docs)) {
        showToast('Could not replace — storage is full.', 'error');
        tempInput.remove();
        return;
      }

      docsLogMove('replace', docs[idx], { oldName, newName: file.name, details: `Replaced "${oldName}" with "${file.name}"` });
      if (docsAiAvailable()) docAiQueueScan(docId);

      renderDocumentsTable();
      showToast('Document replaced successfully.', 'success');
    } catch (err) {
      console.error('[documents.js] Replace failed:', err);
      showToast('Failed to replace document.', 'error');
    }

    tempInput.remove();
  });

  document.body.appendChild(tempInput);
  tempInput.click();
}

/* ============================================================
   RESCAN WITH AI
   ============================================================ */
function handleRescanDocument(docId) {
  if (!docsAiAvailable() || typeof docAiCanScan !== 'function' || !docAiCanScan()) {
    showToast('AI scanner is not available on this page.', 'error');
    return;
  }
  docAiRescan(docId);
  renderDocumentsTable();
  showToast('AI is re-scanning the document...', 'success');
}

/* ============================================================
   DOWNLOAD DOCUMENT
   ============================================================ */
function handleDownloadDocument(docId) {
  const doc = getDocuments().find(d => d.id === docId);
  if (!doc) return;

  const link = document.createElement('a');
  link.href = doc.dataUrl;
  link.download = doc.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  docsLogMove('download', doc, { details: 'Downloaded to device' });
}

/* ============================================================
   DELETE DOCUMENT
   ============================================================ */
function handleDeleteDocument(docId) {
  const doc = getDocuments().find(d => d.id === docId);
  if (!doc) return;

  confirmDelete(
    `Delete document "${doc.fileName}"? This cannot be undone.`,
    () => {
      // log BEFORE deleting so the name/type/client are kept in the history
      docsLogMove('delete', doc, { details: 'Deleted from Document Manager' });

      saveDocuments(getDocuments().filter(d => d.id !== docId));
      renderDocumentsTable();
      showToast('Document deleted.', 'success');
    },
    'Delete Document',
    '<i class="fa-solid fa-trash"></i> Delete Document'
  );
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('closeDocumentsModal');
  if (closeBtn) closeBtn.addEventListener('click', () => closeModal('documentsModalOverlay'));
  enableClickOutsideClose('documentsModalOverlay');

  const uploadInput = document.getElementById('docUploadInput');
  if (uploadInput) {
    uploadInput.addEventListener('change', () => {
      handleDocumentUpload(uploadInput.files);
      uploadInput.value = '';
    });
  }

  const searchInput = document.getElementById('docSearchInput');
  if (searchInput) {
    searchInput.placeholder = 'Search name or content (e.g. affidavit of loss, Santos)...';
    searchInput.addEventListener('input', (e) => {
      docSearchTerm = e.target.value;
      renderDocumentsTable();
    });
  }

  const sortSelect = document.getElementById('docSortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      docSortMode = e.target.value;
      renderDocumentsTable();
    });
  }

  const tbody = document.getElementById('documentsTableBody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const viewBtn = e.target.closest('[data-view-doc]');
      const renameBtn = e.target.closest('[data-rename-doc]');
      const replaceBtn = e.target.closest('[data-replace-doc]');
      const rescanBtn = e.target.closest('[data-rescan-doc]');
      const downloadBtn = e.target.closest('[data-download-doc]');
      const deleteBtn = e.target.closest('[data-delete-doc]');

      if (viewBtn) handleViewDocument(viewBtn.dataset.viewDoc);
      if (renameBtn) handleOpenRenameModal(renameBtn.dataset.renameDoc);
      if (replaceBtn) handleReplaceDocument(replaceBtn.dataset.replaceDoc);
      if (rescanBtn) handleRescanDocument(rescanBtn.dataset.rescanDoc);
      if (downloadBtn) handleDownloadDocument(downloadBtn.dataset.downloadDoc);
      if (deleteBtn) handleDeleteDocument(deleteBtn.dataset.deleteDoc);
    });
  }

  const closeRenameBtn = document.getElementById('closeRenameDocModal');
  if (closeRenameBtn) closeRenameBtn.addEventListener('click', () => closeModal('renameDocModalOverlay'));
  enableClickOutsideClose('renameDocModalOverlay');

  const renameForm = document.getElementById('renameDocForm');
  if (renameForm) renameForm.addEventListener('submit', handleRenameDocSubmit);

  const closeViewBtn = document.getElementById('closeViewDocModal');
  if (closeViewBtn) closeViewBtn.addEventListener('click', () => closeModal('viewDocModalOverlay'));
  enableClickOutsideClose('viewDocModalOverlay');

  // Live-refresh the table when the AI finishes (or starts) scanning a file
  window.addEventListener('docai:updated', (e) => {
    const overlay = document.getElementById('documentsModalOverlay');
    if (!overlay || !overlay.classList.contains('active') || !currentDocsCaseId) return;

    const doc = e.detail && e.detail.docId ? getDocuments().find(d => d.id === e.detail.docId) : null;
    if (doc && doc.caseId !== currentDocsCaseId) return;

    const keepScroll = overlay.querySelector('.table-wrapper');
    const scrollTop = keepScroll ? keepScroll.scrollTop : 0;
    renderDocumentsTable();
    if (keepScroll) keepScroll.scrollTop = scrollTop;
  });
});