/* ============================================================
   CASEFLOW — SMART-ROUTING.JS
   Smart Client Document Routing (Scan/Upload → OCR → AI reads
   → identify client → identify doc type → check duplicate →
   route to existing client's case folder → save).

   UPDATED (AI Document Intelligence):
   - OCR now uses the same blurry-image preprocessing as
     doc-intelligence.js (upscale + grayscale + contrast, and a
     2nd sharpen/threshold pass when confidence is low).
   - Document type uses the smarter detector from
     doc-intelligence.js when available (e.g. "Affidavit of Loss"
     instead of just "Affidavit"), so clean filenames are better.
   - The text already read here is saved into the document's AI
     index immediately (docAiSaveAnalysis) — searchable in the AI
     chat right away, no second scan needed.
   - Saving is recorded as a document movement ('auto-route' or
     'upload') so the AI knows who routed which file and when.
   - Warns when LocalStorage is full instead of failing silently.

   IMPORTANT — HONEST LIMITATIONS (read before relying on this):
   - "AI" here is NOT a connected LLM. It is OCR (Tesseract.js)
     + text extraction (pdf.js) + rule-based/fuzzy matching
     against your EXISTING caseflow_clients / caseflow_cases data.
     It never invents information not present in the document.
   - Documents in this system attach to a CASE (caseflow_documents
     has caseId, not clientId) — so "route to client folder"
     means: identify client -> find/confirm their case -> attach
     the document to caseflow_documents with that caseId, exactly
     like the existing manual upload in documents.js does.
   - Low-confidence documents are NOT saved until the user
     manually confirms client + case in the Routing Review modal.
   - Requires internet on first use per browser session so the
     CDN can load Tesseract.js's OCR worker + language data.

   Existing manual upload in documents.js still works on its own —
   this is an additional, separate entry point.

   Depends on: storage.js, modal.js (loaded before this).
   Optional:   doc-intelligence.js (better OCR + AI index).
   Self-injects its own modals into the page.
   ============================================================ */

/* ---------- CONFIGURATION ---------- */
const SMART_ROUTING_CONFIG = {
  HIGH_CONFIDENCE: 0.85,   // >= this: auto-route, toast only
  MEDIUM_CONFIDENCE: 0.60, // >= this (below HIGH): review required
  MAX_FILE_SIZE: 3 * 1024 * 1024, // same 3MB cap as documents.js
  OCR_LOW_CONFIDENCE: 65,  // below this, a 2nd sharpen/threshold OCR pass runs
  DOC_TYPE_KEYWORDS: {
    'Affidavit': ['affidavit', 'sworn statement', 'jurat'],
    'Contract': ['contract', 'agreement', 'memorandum of agreement', 'deed of'],
    'Court Document': ['republic of the philippines', 'regional trial court', 'metropolitan trial court',
      'order', 'resolution', 'decision', 'subpoena', 'summons', 'motion', 'pleading', 'complaint', 'petition'],
    'ID': ['identification card', 'driver\'s license', 'passport no', 'philsys', 'national id', 'sss id', 'umid'],
    'Receipt': ['official receipt', 'or no.', 'receipt no'],
    'Invoice': ['invoice', 'billing statement', 'statement of account'],
    'Letter': ['dear sir', 'dear madam', 'sincerely', 'to whom it may concern'],
    'Evidence': ['exhibit', 'evidence', 'annex']
  }
};

let _smartRoutingModalsInjected = false;
let _srCurrentFile = null;
let _srCurrentExtractedText = '';
let _srCurrentOcrConfidence = 0;
let _srCurrentExtractMethod = 'ocr';
let _srCurrentAnalysis = null;
let _srContextClientId = null; // set when scanning from inside a specific client's context
let _srContextCaseId = null;

/* ============================================================
   PUBLIC ENTRY POINT
   Called from a button in dashboard.html (Documents modal) or
   clients.html (client card). contextClientId/contextCaseId are
   optional — pass them when the scan happens from inside a
   known client/case context.
   ============================================================ */
function triggerSmartScan(contextClientId = null, contextCaseId = null) {
  _srContextClientId = contextClientId;
  _srContextCaseId = contextCaseId;

  injectSmartRoutingModals();

  const tempInput = document.createElement('input');
  tempInput.type = 'file';
  tempInput.accept = 'application/pdf,image/*';
  tempInput.style.display = 'none';

  tempInput.addEventListener('change', () => {
    const file = tempInput.files[0];
    if (file) handleScanFileSelected(file);
    tempInput.remove();
  });

  document.body.appendChild(tempInput);
  tempInput.click();
}

/* ============================================================
   MAIN PIPELINE: SCAN -> OCR -> ANALYZE -> ROUTE
   ============================================================ */
async function handleScanFileSelected(file) {
  if (file.size > SMART_ROUTING_CONFIG.MAX_FILE_SIZE) {
    showToast('File too large (3MB limit for this prototype).', 'error');
    return;
  }

  if (typeof Tesseract === 'undefined') {
    showToast('OCR engine not loaded on this page. Check your internet connection and refresh.', 'error');
    return;
  }

  _srCurrentFile = file;
  _srCurrentOcrConfidence = 0;
  _srCurrentExtractMethod = 'ocr';
  openModal('ocrProcessingModalOverlay');
  updateOcrProgress(5, 'Reading file...');

  try {
    const text = await extractTextFromFile(file, updateOcrProgress);
    _srCurrentExtractedText = text;

    updateOcrProgress(95, 'Analyzing content...');
    const analysis = analyzeExtractedText(text, file.name);
    _srCurrentAnalysis = analysis;

    updateOcrProgress(100, 'Done.');
    setTimeout(() => {
      closeModal('ocrProcessingModalOverlay');
      proceedWithRouting(file, text, analysis);
    }, 300);

  } catch (err) {
    console.error('[smart-routing.js] OCR/extraction failed:', err);
    closeModal('ocrProcessingModalOverlay');
    showToast('Could not read this document. You can still upload it manually via the regular Upload button.', 'error');
  }
}

function updateOcrProgress(percent, label) {
  const fill = document.getElementById('ocrProgressFill');
  const labelEl = document.getElementById('ocrProgressLabel');
  if (fill) fill.style.width = `${percent}%`;
  if (labelEl) labelEl.textContent = label;
}

/* ============================================================
   TEXT EXTRACTION (pdf.js for PDFs with a text layer, falls
   back to Tesseract.js OCR for images or scanned/no-text PDFs)
   ============================================================ */
async function extractTextFromFile(file, onProgress) {
  if (file.type === 'application/pdf') {
    onProgress(15, 'Reading PDF text layer...');
    const pdfText = await extractTextFromPdf(file);

    if (pdfText && pdfText.trim().length > 20) {
      _srCurrentOcrConfidence = 100;
      _srCurrentExtractMethod = 'pdf-text';
      return pdfText; // real text layer found, no OCR needed
    }

    // No usable text layer (likely a scanned PDF) -> render page 1 to canvas, OCR it
    onProgress(35, 'No text layer found — running OCR on scanned page...');
    const canvas = await renderPdfPageToCanvas(file);
    _srCurrentExtractMethod = 'pdf-ocr';
    return await runOcrOnCanvas(canvas, onProgress);
  }

  if (file.type.startsWith('image/')) {
    onProgress(20, 'Running OCR on image...');
    _srCurrentExtractMethod = 'ocr';
    return await runOcrOnImage(file, onProgress);
  }

  throw new Error('Unsupported file type for text extraction.');
}

async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  return content.items.map(item => item.str).join(' ');
}

async function renderPdfPageToCanvas(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 }); // higher scale = better OCR accuracy

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/**
 * OCR with blurry-image handling.
 * Pass 1: upscale + grayscale + contrast (doc-intelligence.js preprocessing).
 * Pass 2 (only if confidence is low): sharpen + black/white threshold.
 * Both readings are kept when the image is blurry so search has more to work with.
 * Falls back to plain Tesseract if doc-intelligence.js is not loaded.
 */
async function runOcrOnCanvas(canvas, onProgress, progressStart = 35) {
  const canPreprocess = typeof docAiPreprocess === 'function';
  const span = canPreprocess ? 30 : 55;

  const recognize = (source, start, label) => Tesseract.recognize(source, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(start + Math.round(m.progress * span), label);
      }
    }
  });

  const pass1 = await recognize(
    canPreprocess ? docAiPreprocess(canvas, 'gray') : canvas,
    progressStart,
    'Reading text...'
  );
  let text = pass1.data.text || '';
  let confidence = pass1.data.confidence || 0;

  if (canPreprocess && confidence < SMART_ROUTING_CONFIG.OCR_LOW_CONFIDENCE) {
    if (onProgress) onProgress(progressStart + span, 'Blurry document — enhancing and reading again...');
    const pass2 = await recognize(docAiPreprocess(canvas, 'sharp'), progressStart + span, 'Reading enhanced image...');
    const text2 = pass2.data.text || '';
    const conf2 = pass2.data.confidence || 0;
    text = conf2 > confidence ? `${text2}\n${text}` : `${text}\n${text2}`;
    confidence = Math.max(confidence, conf2);
  }

  _srCurrentOcrConfidence = confidence;
  return text;
}

async function runOcrOnImage(file, onProgress) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image could not be loaded.'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return await runOcrOnCanvas(canvas, onProgress, 20);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ============================================================
   TEXT ANALYSIS: client name, case number, document type
   ============================================================ */
function analyzeExtractedText(rawText, fileName = '') {
  const text = (rawText || '').trim();
  const textLower = text.toLowerCase();

  const clientMatch = matchClientFromText(text);
  const caseNumberDetected = extractCaseNumberFromText(text);

  // Prefer the smarter detector (specific types like "Affidavit of Loss")
  let documentType = 'Other';
  if (typeof docAiDetectType === 'function') {
    documentType = docAiDetectType(text, fileName).type;
  }
  if (!documentType || documentType === 'Other') {
    documentType = extractDocumentTypeFromText(textLower);
  }

  return {
    rawText: text,
    clientMatch,        // { client, score } or null
    caseNumberDetected, // string or null
    documentType        // string, defaults to 'Other'
  };
}

/**
 * Tries to find which existing client this document belongs to
 * by fuzzy-comparing every existing client's name against lines
 * of the OCR'd text. Never invents a name — only matches against
 * clients that already exist in caseflow_clients.
 */
function matchClientFromText(text) {
  const clients = getClients();
  if (clients.length === 0 || !text) return null;

  const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 2 && l.length < 60);

  let bestClient = null;
  let bestScore = 0;

  clients.forEach(client => {
    const nameLower = (client.name || '').toLowerCase().trim();
    if (!nameLower) return;

    // Direct substring match = highest confidence signal
    if (text.toLowerCase().includes(nameLower)) {
      if (1 > bestScore) {
        bestScore = 1;
        bestClient = client;
      }
      return;
    }

    // Otherwise fuzzy-compare against each candidate line
    lines.forEach(line => {
      const score = srSimilarity(line.toLowerCase(), nameLower);
      if (score > bestScore) {
        bestScore = score;
        bestClient = client;
      }
    });
  });

  if (!bestClient || bestScore < 0.5) return null;
  return { client: bestClient, score: bestScore };
}

/**
 * Looks for a case number pattern in the text. Prioritizes an
 * EXACT match against an existing case's caseNumber (most
 * reliable), falls back to a generic "Case No. XXXX" regex.
 */
function extractCaseNumberFromText(text) {
  if (!text) return null;

  const existingCases = getCases();
  for (const c of existingCases) {
    if (c.caseNumber && text.includes(c.caseNumber)) {
      return c.caseNumber;
    }
  }

  const match = text.match(/case\s*no\.?\s*[:\-]?\s*([A-Za-z0-9\-\/]{4,})/i);
  return match ? match[1] : null;
}

function extractDocumentTypeFromText(textLower) {
  for (const [type, keywords] of Object.entries(SMART_ROUTING_CONFIG.DOC_TYPE_KEYWORDS)) {
    if (keywords.some(kw => textLower.includes(kw))) {
      return type;
    }
  }
  return 'Other';
}

/* ---------- FUZZY MATCH HELPER (Levenshtein-based similarity, 0-1) ---------- */
function srLevenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
  }
  return matrix[b.length][a.length];
}

function srSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const distance = srLevenshtein(a, b);
  const longest = Math.max(a.length, b.length);
  return 1 - (distance / longest);
}

/* ============================================================
   CONFIDENCE SCORING
   ============================================================ */
function calculateConfidence(analysis) {
  let score = 0;
  if (analysis.clientMatch) score += analysis.clientMatch.score * 0.6;
  if (analysis.caseNumberDetected) score += 0.3;
  if (analysis.documentType !== 'Other') score += 0.1;
  return Math.min(1, score);
}

function getConfidenceTier(score) {
  if (score >= SMART_ROUTING_CONFIG.HIGH_CONFIDENCE) return 'high';
  if (score >= SMART_ROUTING_CONFIG.MEDIUM_CONFIDENCE) return 'medium';
  return 'low';
}

/* ============================================================
   DESTINATION RESOLUTION (which case does this document belong in)
   ============================================================ */
function resolveDestinationCase(clientId, caseNumberDetected) {
  if (!clientId) return null;
  const clientCases = getCases().filter(c => c.clientId === clientId);

  if (caseNumberDetected) {
    const exact = clientCases.find(c => c.caseNumber === caseNumberDetected);
    if (exact) return exact;
  }

  if (clientCases.length === 1) return clientCases[0];
  return null; // multiple cases, ambiguous — user must pick in review
}

/* ============================================================
   DUPLICATE CHECK (SHA-256 hash of file content, compared
   against any previously-routed document's stored hash, plus a
   filename+size fallback check against ALL existing documents)
   ============================================================ */
async function computeFileHash(file) {
  try {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    console.warn('[smart-routing.js] Hash computation unavailable, skipping hash-based duplicate check.', err);
    return null;
  }
}

function findDuplicateDocument(hash, fileName, fileSize) {
  const allDocs = getDocuments();

  if (hash) {
    const hashMatch = allDocs.find(d => d.contentHash === hash);
    if (hashMatch) return hashMatch;
  }

  // Fallback heuristic: same filename AND same size elsewhere in the system
  return allDocs.find(d => d.fileName === fileName && d.fileSize === fileSize) || null;
}

/* ============================================================
   CLEAN FILENAME GENERATION
   Example: Juan_Dela_Cruz_Affidavit_of_Loss_2026-09-21.pdf
   Only uses information actually extracted — never invents.
   ============================================================ */
function generateCleanFilename(clientName, documentType, originalFile) {
  const dateStr = new Date().toISOString().split('T')[0];
  const ext = (originalFile.name.split('.').pop() || 'pdf').toLowerCase();

  const safeClientPart = clientName
    ? clientName.trim().replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')
    : 'UnknownClient';

  const safeTypePart = (documentType || 'Document').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');

  return `${safeClientPart}_${safeTypePart}_${dateStr}.${ext}`;
}

/* ============================================================
   ROUTING DECISION FLOW
   ============================================================ */
async function proceedWithRouting(file, text, analysis) {
  const confidence = calculateConfidence(analysis);
  const tier = getConfidenceTier(confidence);
  const hash = await computeFileHash(file);
  const duplicate = findDuplicateDocument(hash, file.name, file.size);

  const detectedClient = analysis.clientMatch ? analysis.clientMatch.client : null;

  // Client-mismatch scenario: user is scanning from a specific client's
  // context, but the AI detected a DIFFERENT client with reasonable confidence.
  const isMismatch = _srContextClientId && detectedClient && detectedClient.id !== _srContextClientId && confidence >= SMART_ROUTING_CONFIG.MEDIUM_CONFIDENCE;

  // High confidence, no context conflict, no duplicate -> auto-route silently (toast only)
  if (tier === 'high' && !isMismatch && !duplicate) {
    const destClientId = detectedClient ? detectedClient.id : _srContextClientId;
    const destCase = resolveDestinationCase(destClientId, analysis.caseNumberDetected) ||
      (_srContextCaseId ? findCaseById(_srContextCaseId) : null);

    if (destCase) {
      await finalizeSaveDocument(file, hash, destCase.id, analysis, confidence, true);
      return;
    }
    // High confidence on client but ambiguous case (multiple cases) -> still needs review
  }

  // Everything else -> open the Routing Review modal for confirmation
  openRoutingReviewModal(file, analysis, confidence, tier, detectedClient, duplicate, isMismatch);
}

/* ============================================================
   SAVE (same caseflow_documents shape as documents.js, plus
   contentHash / autoRouted, plus the AI index fields written by
   docAiSaveAnalysis)
   ============================================================ */
async function finalizeSaveDocument(file, hash, caseId, analysis, confidence, autoRouted) {
  const dataUrl = await readFileAsDataUrlSR(file);
  const cleanName = generateCleanFilename(
    analysis.clientMatch ? analysis.clientMatch.client.name : null,
    analysis.documentType,
    file
  );

  const newDoc = {
    id: generateId('DOC'),
    caseId,
    fileName: cleanName,
    fileType: file.type || 'application/octet-stream',
    fileSize: file.size,
    dataUrl,
    uploadedAt: nowISO(),
    contentHash: hash,
    autoRouted,
    originalFileName: file.name
  };

  const docs = getDocuments();
  docs.push(newDoc);
  if (!saveDocuments(docs)) {
    showToast('Storage is full — the document was NOT saved. Delete some old files first.', 'error');
    return;
  }

  // Record the movement (who routed it, where, when)
  if (typeof logDocMovement === 'function') {
    logDocMovement(autoRouted ? 'auto-route' : 'upload', newDoc, {
      details: autoRouted
        ? `Auto-routed by Smart Scan (${Math.round(confidence * 100)}% confidence) from "${file.name}"`
        : `Saved via Smart Scan review from "${file.name}"`
    });
  }

  // Save the text we already read into the AI index (no second scan needed)
  if (typeof docAiSaveAnalysis === 'function') {
    try {
      docAiSaveAnalysis(newDoc.id, _srCurrentExtractedText, _srCurrentOcrConfidence, _srCurrentExtractMethod);
    } catch (err) {
      console.warn('[smart-routing.js] Could not save AI index:', err);
    }
  }

  const caseObj = findCaseById(caseId);
  const clientObj = caseObj ? findClientById(caseObj.clientId) : null;

  logAuditEntry({
    clientIdentified: clientObj ? clientObj.name : 'Unknown',
    documentType: analysis.documentType,
    caseNumberDetected: analysis.caseNumberDetected,
    destinationCaseId: caseId,
    destinationClientId: clientObj ? clientObj.id : null,
    confidence: Math.round(confidence * 100),
    userAction: autoRouted ? 'auto-routed' : 'approved',
    originalFileName: file.name,
    generatedFileName: cleanName,
    performedBy: (typeof getCurrentUser === 'function' && getCurrentUser()) ? getCurrentUser().id : null
  });

  showToast(autoRouted
    ? `Auto-routed to ${clientObj ? clientObj.name : 'client'} (${Math.round(confidence * 100)}% confidence).`
    : 'Document saved and routed.', 'success');

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('docai:updated', { detail: { docId: newDoc.id } }));
  }
  refreshWhicheverPageIsOpen();
}

function readFileAsDataUrlSR(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function refreshWhicheverPageIsOpen() {
  if (typeof refreshDashboardTable === 'function') refreshDashboardTable();
  if (typeof renderDocumentsTable === 'function') renderDocumentsTable();
  if (typeof renderClientsGrid === 'function') renderClientsGrid();
}

/* ============================================================
   ROUTING REVIEW MODAL (self-injected)
   ============================================================ */
function injectSmartRoutingModals() {
  if (_smartRoutingModalsInjected || document.getElementById('ocrProcessingModalOverlay')) return;
  _smartRoutingModalsInjected = true;

  const ocrModal = document.createElement('div');
  ocrModal.className = 'modal-overlay';
  ocrModal.id = 'ocrProcessingModalOverlay';
  ocrModal.innerHTML = `
    <div class="modal-box glass">
      <div class="modal-body">
        <div class="ocr-processing-box">
          <div class="ocr-spinner"></div>
          <h3>Reading Document...</h3>
          <p id="ocrProgressLabel">Starting...</p>
          <div class="ocr-progress-bar-track">
            <div class="ocr-progress-bar-fill" id="ocrProgressFill"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const reviewModal = document.createElement('div');
  reviewModal.className = 'modal-overlay';
  reviewModal.id = 'routingReviewModalOverlay';
  reviewModal.innerHTML = `
    <div class="modal-box modal-lg glass">
      <div class="modal-header">
        <h2><i class="fa-solid fa-robot"></i> Smart Document Routing — Review</h2>
        <button class="modal-close" id="closeRoutingReviewModal">&times;</button>
      </div>
      <div class="modal-body" id="routingReviewBody">
        <!-- Injected dynamically by openRoutingReviewModal() -->
      </div>
    </div>
  `;

  document.body.appendChild(ocrModal);
  document.body.appendChild(reviewModal);

  document.getElementById('closeRoutingReviewModal').addEventListener('click', () => {
    closeModal('routingReviewModalOverlay');
  });
  enableClickOutsideClose('routingReviewModalOverlay');
}

let _srReviewState = null;

function openRoutingReviewModal(file, analysis, confidence, tier, detectedClient, duplicate, isMismatch) {
  _srReviewState = { file, analysis, confidence, tier, detectedClient, duplicate, isMismatch };

  const confidencePct = Math.round(confidence * 100);
  const body = document.getElementById('routingReviewBody');

  let html = '';

  // ---------- MISMATCH WARNING ----------
  if (isMismatch) {
    const contextClient = findClientById(_srContextClientId);
    html += `
      <div class="client-mismatch-warning">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <div>
          <h4>⚠️ Client Mismatch</h4>
          <p>This document appears to belong to <strong>${escapeHtmlSR(detectedClient.name)}</strong>, but you are currently scanning for <strong>${escapeHtmlSR(contextClient ? contextClient.name : 'the current client')}</strong>.</p>
        </div>
      </div>
    `;
  }

  // ---------- DUPLICATE WARNING ----------
  if (duplicate) {
    html += `
      <div class="duplicate-warning-box">
        <i class="fa-solid fa-copy"></i>
        <p><strong>Possible duplicate detected.</strong> A document named "${escapeHtmlSR(duplicate.fileName)}" already exists in the system. You can still save this as a separate copy if it's genuinely different.</p>
      </div>
    `;
  }

  // ---------- LOW CONFIDENCE NOTICE ----------
  if (tier === 'low') {
    html += `
      <div class="routing-unclassified-notice">
        <i class="fa-solid fa-circle-info"></i>
        <span>The AI could not confidently identify the client. Please select the correct client and case manually below before saving — nothing has been saved yet.</span>
      </div>
    `;
  }

  // ---------- BLURRY / LOW OCR NOTICE ----------
  if (_srCurrentExtractMethod !== 'pdf-text' && _srCurrentOcrConfidence > 0 && _srCurrentOcrConfidence < SMART_ROUTING_CONFIG.OCR_LOW_CONFIDENCE) {
    html += `
      <div class="routing-unclassified-notice">
        <i class="fa-solid fa-eye-low-vision"></i>
        <span>This file looks blurry (OCR ${Math.round(_srCurrentOcrConfidence)}%). The AI enhanced it and read it twice — please double-check the details below.</span>
      </div>
    `;
  }

  // ---------- EXTRACTED FIELDS ----------
  html += `
    <div class="routing-extracted-box">
      <div class="routing-field-row">
        <label>Client Detected</label>
        <span class="${detectedClient ? '' : 'not-detected'}">${detectedClient ? escapeHtmlSR(detectedClient.name) : 'Not detected'}</span>
      </div>
      <div class="routing-field-row">
        <label>Document Type</label>
        <span>${escapeHtmlSR(analysis.documentType)}</span>
      </div>
      <div class="routing-field-row">
        <label>Case Number</label>
        <span class="${analysis.caseNumberDetected ? '' : 'not-detected'}">${analysis.caseNumberDetected ? escapeHtmlSR(analysis.caseNumberDetected) : 'Not detected'}</span>
      </div>
    </div>

    <div class="confidence-meter-wrap">
      <div class="confidence-meter-label">
        <span>Confidence</span>
        <span class="confidence-badge ${tier}">${tier}</span>
      </div>
      <div class="confidence-meter-track">
        <div class="confidence-meter-fill ${tier}" style="width:${confidencePct}%;"></div>
      </div>
    </div>
  `;

  // ---------- MANUAL OVERRIDE (client + case selects) ----------
  const clients = getClients();
  const preselectedClientId = detectedClient ? detectedClient.id : _srContextClientId;

  html += `
    <div class="routing-override-group">
      <label class="field-label">Client</label>
      <div class="input-group">
        <i class="fa-solid fa-user"></i>
        <select id="routingClientSelect">
          <option value="">-- Select Client --</option>
          ${clients.map(c => `<option value="${c.id}" ${c.id === preselectedClientId ? 'selected' : ''}>${escapeHtmlSR(c.name)}</option>`).join('')}
        </select>
      </div>

      <label class="field-label">Case</label>
      <div class="input-group">
        <i class="fa-solid fa-folder"></i>
        <select id="routingCaseSelect"></select>
      </div>
    </div>
  `;

  // ---------- ACTION BUTTONS ----------
  if (isMismatch) {
    html += `
      <div class="mismatch-action-row">
        <button type="button" class="btn-primary" id="routingMoveToDetectedBtn"><i class="fa-solid fa-arrow-right"></i> Move to Detected Client</button>
        <button type="button" class="btn-outline" id="routingKeepCurrentBtn"><i class="fa-solid fa-thumbtack"></i> Keep Current Client</button>
      </div>
    `;
  }

  html += `
    <div class="routing-final-actions">
      <button type="button" class="btn-outline" id="routingCancelBtn"><i class="fa-solid fa-xmark"></i> Cancel</button>
      <button type="button" class="btn-primary" id="routingConfirmSaveBtn"><i class="fa-solid fa-floppy-disk"></i> Confirm & Save</button>
    </div>
  `;

  body.innerHTML = html;

  populateRoutingCaseSelect(preselectedClientId);
  attachRoutingReviewEvents();

  openModal('routingReviewModalOverlay');
}

function populateRoutingCaseSelect(clientId) {
  const select = document.getElementById('routingCaseSelect');
  if (!select) return;

  const cases = clientId ? getCases().filter(c => c.clientId === clientId) : [];
  const detectedCaseNum = _srReviewState.analysis.caseNumberDetected;
  const preselected = cases.find(c => c.caseNumber === detectedCaseNum);

  select.innerHTML = cases.length > 0
    ? cases.map(c => `<option value="${c.id}" ${preselected && preselected.id === c.id ? 'selected' : ''}>${escapeHtmlSR(c.caseNumber)} — ${escapeHtmlSR(c.caseName)}</option>`).join('')
    : `<option value="">No cases for this client</option>`;
}

function attachRoutingReviewEvents() {
  document.getElementById('routingClientSelect').addEventListener('change', (e) => {
    populateRoutingCaseSelect(e.target.value);
  });

  document.getElementById('routingCancelBtn').addEventListener('click', () => {
    closeModal('routingReviewModalOverlay');
    logAuditEntry({
      clientIdentified: _srReviewState.detectedClient ? _srReviewState.detectedClient.name : 'Unknown',
      documentType: _srReviewState.analysis.documentType,
      caseNumberDetected: _srReviewState.analysis.caseNumberDetected,
      destinationCaseId: null,
      destinationClientId: null,
      confidence: Math.round(_srReviewState.confidence * 100),
      userAction: 'rejected',
      originalFileName: _srReviewState.file.name,
      generatedFileName: null,
      performedBy: (typeof getCurrentUser === 'function' && getCurrentUser()) ? getCurrentUser().id : null
    });
  });

  document.getElementById('routingConfirmSaveBtn').addEventListener('click', async () => {
    const caseId = document.getElementById('routingCaseSelect').value;
    if (!caseId) {
      showToast('Please select a client and case before saving.', 'error');
      return;
    }

    closeModal('routingReviewModalOverlay');
    await finalizeSaveDocument(
      _srReviewState.file,
      await computeFileHash(_srReviewState.file),
      caseId,
      _srReviewState.analysis,
      _srReviewState.confidence,
      false
    );
  });

  const moveBtn = document.getElementById('routingMoveToDetectedBtn');
  if (moveBtn) {
    moveBtn.addEventListener('click', () => {
      document.getElementById('routingClientSelect').value = _srReviewState.detectedClient.id;
      populateRoutingCaseSelect(_srReviewState.detectedClient.id);
      showToast('Destination updated to detected client. Confirm to save.', 'info');
    });
  }

  const keepBtn = document.getElementById('routingKeepCurrentBtn');
  if (keepBtn) {
    keepBtn.addEventListener('click', () => {
      document.getElementById('routingClientSelect').value = _srContextClientId;
      populateRoutingCaseSelect(_srContextClientId);
      showToast('Keeping current client. Confirm to save.', 'info');
    });
  }
}

/* ============================================================
   LOCAL ESCAPE HELPER (scoped name to avoid colliding with each
   page's own escapeHtml() declaration)
   ============================================================ */
function escapeHtmlSR(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}