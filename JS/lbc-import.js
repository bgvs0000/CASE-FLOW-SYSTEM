/* ============================================================
   ABANTO LAW FIRM — LBC-IMPORT.JS
   Excel / CSV bulk import for the LBC Tracker.

   HOW IT WORKS
   1. "Import Excel" button (auto-added beside "Add Shipment").
   2. Upload .xlsx / .xls / .csv / .ods (click or drag & drop).
   3. The system finds the HEADER ROW by itself (even if it is
      not row 1) and MATCHES each column to the LBC table —
      TRACKING NO., CASE TITLE, CASE NUMBER, CASE TYPE, Cause of
      Action, SENDER, RECIPIENT, Recipient's Address, TITLE OF
      DOCUMENT, DELIVERY STATUS, Date... typos OK.
      No header row? It guesses from the CONTENT (dates, tracking
      codes, names, addresses, status words).
   4. Each row is filled in one by one. Missing values are
      AUTO-FILLED (tracking no. generated, date = today, status =
      Pending, etc.) and highlighted so you can see what was added.
      Auto-fill can be switched off.
   5. AUTO TABLE (NEW): any Excel column that does not exist in
      the system (e.g. "Weight", "Remarks", "Contact No.") is
      turned into a NEW custom column of the LBC table on import
      — Text / Number / Date type is detected from its content.
      The preview table shows these columns live, marked "NEW".
   6. Review screen: change any column mapping, untick rows,
      duplicates are flagged and skipped. Then Import.
   Also: "Download Template" gives a ready Excel file, and
   "First Name" + "Last Name" columns are joined automatically.

   Depends on: storage.js, modal.js, custom-field.js, lbc.js
   Loads SheetJS (Excel reader) from cdnjs on first use.
   ============================================================ */

const LBC_IMPORT_CONFIG = {
  sheetJsUrl: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  module: 'lbc',
  maxRows: 1000,
  headerScanRows: 15,
  previewLimit: 300,
  acceptedExt: ['xlsx', 'xls', 'csv', 'ods'],
  autoCreateColumns: true,   // unknown Excel columns → new custom columns
  defaults: {
    clientName: 'Unnamed Client',
    destination: 'To be updated',
    document: 'Documents',
    status: 'pending'
  }
};

/* Built-in shipment fields (same order as the LBC table) + the
   header words that point to them. Keys clientName / destination /
   document keep their old names so other pages still work. */
const LBC_IMPORT_FIELDS = [
  {
    key: 'trackingNumber', label: 'Tracking No.', required: true,
    synonyms: ['tracking number', 'tracking no', 'tracking', 'tracking num', 'track no', 'tracking code',
      'awb', 'awb no', 'awb number', 'airway bill', 'airwaybill', 'waybill', 'waybill no',
      'reference no', 'reference number', 'ref no', 'lbc no', 'lbc number',
      'lbc tracking', 'control no', 'control number', 'transaction no', 'booking no']
  },
  {
    key: 'caseTitle', label: 'Case Title', required: false,
    synonyms: ['case title', 'case name', 'title of case', 'caption', 'case caption']
  },
  {
    key: 'caseNumber', label: 'Case Number', required: false,
    synonyms: ['case number', 'case no', 'docket number', 'docket no', 'civil case no', 'criminal case no',
      'cc no', 'gr no', 'g r no', 'npc no', 'nlrc no', 'is no']
  },
  {
    key: 'caseType', label: 'Case Type', required: false,
    synonyms: ['case type', 'type of case', 'nature of case', 'case category', 'case kind']
  },
  {
    key: 'causeOfAction', label: 'Cause of Action', required: false,
    synonyms: ['cause of action', 'cause', 'offense', 'offence', 'charge', 'charges', 'nature of action', 'crime']
  },
  {
    key: 'sender', label: 'Sender', required: false,
    synonyms: ['sender', 'sender name', 'sent by', 'shipper', 'from', 'nagpadala']
  },
  {
    key: 'clientName', label: 'Recipient', required: true,
    synonyms: ['recipient', 'recipient name', 'receiver', 'receiver name', 'consignee', 'consignee name',
      'addressee', 'client name', 'client', 'name', 'full name', 'fullname', 'customer', 'customer name',
      'pangalan', 'first name', 'last name', 'surname', 'middle name', 'given name', 'apelyido']
  },
  {
    key: 'destination', label: "Recipient's Address", required: true,
    synonyms: ['recipient address', 'address', 'delivery address', 'complete address', 'full address',
      'destination', 'branch', 'lbc branch', 'destination branch', 'city', 'location',
      'province', 'municipality', 'tirahan', 'deliver to', 'ship to', 'send to']
  },
  {
    key: 'document', label: 'Title of Document', required: true,
    synonyms: ['title of document', 'document title', 'document', 'documents', 'doc', 'docs', 'document type',
      'document name', 'item', 'items', 'item description', 'contents', 'content', 'description',
      'particulars', 'papers', 'dokumento', 'package', 'parcel', 'pleading']
  },
  {
    key: 'dateSent', label: 'Date Sent', required: true,
    synonyms: ['date sent', 'date', 'sent date', 'date shipped', 'ship date', 'shipped date',
      'shipping date', 'date posted', 'date mailed', 'dispatch date', 'transaction date',
      'petsa', 'date of shipment', 'date of mailing']
  },
  {
    key: 'status', label: 'Delivery Status', required: false,
    synonyms: ['delivery status', 'status', 'shipment status', 'state', 'tracking status', 'remarks status']
  }
];

/* Optional text fields copied as-is (no auto-fill) */
const LBC_IMPORT_OPTIONAL_KEYS = ['caseTitle', 'caseNumber', 'caseType', 'causeOfAction', 'sender'];

const lbcImport = {
  fileName: '',
  workbook: null,
  sheetName: '',
  rows: [],          // [{ num, cells: [] }]  (blank rows removed)
  headerRow: -1,     // index in rows[], -1 = no header row
  columns: [],       // [{ letter, header, samples: [] }]
  mapping: [],       // per column: '' | fieldKey | 'cf:<customFieldKey>' | 'new'
  newCols: {},       // colIndex → { label, type }  (for mapping 'new')
  preview: [],       // built rows
  autoFill: true,
  mapOpen: null,     // column-matching panel open? (null = decide automatically)
  truncated: 0
};

let _lbcSheetJsPromise = null;

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('addShipmentBtn')) return;
  lbcImportInjectStyles();
  lbcImportInjectModal();
  lbcImportInjectButton();
  lbcImportAttachEvents();
});

/* ============================================================
   SHEETJS LOADER
   ============================================================ */
function lbcImportLoadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_lbcSheetJsPromise) return _lbcSheetJsPromise;

  _lbcSheetJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LBC_IMPORT_CONFIG.sheetJsUrl;
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('Excel reader not available.')));
    s.onerror = () => {
      _lbcSheetJsPromise = null;
      reject(new Error('Could not load the Excel reader. Check your internet connection.'));
    };
    document.head.appendChild(s);
  });
  return _lbcSheetJsPromise;
}

/* ============================================================
   UI INJECTION
   ============================================================ */
function lbcImportInjectButton() {
  const addBtn = document.getElementById('addShipmentBtn');
  if (!addBtn || document.getElementById('lbcImportOpenBtn')) return;

  const wrap = document.createElement('div');
  wrap.className = 'lbc-heading-actions';
  addBtn.parentNode.insertBefore(wrap, addBtn);

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'btn-outline lbcimp-open-btn';
  importBtn.id = 'lbcImportOpenBtn';
  importBtn.innerHTML = '<i class="fa-solid fa-file-excel"></i> Import Excel';

  wrap.appendChild(importBtn);
  wrap.appendChild(addBtn);
}

function lbcImportInjectModal() {
  if (document.getElementById('lbcImportModalOverlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'lbcImportModalOverlay';
  overlay.innerHTML = `
    <div class="modal-box modal-xl glass lbcimp-modal">
      <div class="modal-header">
        <h2><i class="fa-solid fa-file-excel"></i> Import Shipments from Excel</h2>
        <button type="button" class="modal-close" id="lbcImportCloseBtn">&times;</button>
      </div>

      <div class="modal-body lbcimp-body">
        <input type="file" id="lbcImportFileInput" accept=".xlsx,.xls,.csv,.ods" style="display:none;">

        <!-- STEP 1: UPLOAD -->
        <div id="lbcImportStepUpload">
          <label class="lbcimp-dropzone" id="lbcImportDropzone" for="lbcImportFileInput">
            <i class="fa-solid fa-cloud-arrow-up"></i>
            <strong>Click to choose a file or drag it here</strong>
            <span>Excel (.xlsx, .xls), CSV or .ods · up to ${LBC_IMPORT_CONFIG.maxRows} rows</span>
          </label>

          <div class="lbcimp-tips">
            <div class="lbcimp-tip">
              <i class="fa-solid fa-wand-magic-sparkles"></i>
              <div><b>Same as your logbook.</b> <em>Tracking No., Case Title, Case Number, Case Type, Cause of
              Action, Sender, Recipient, Address, Title of Document, Delivery Status</em> — any order, typos OK.</div>
            </div>
            <div class="lbcimp-tip">
              <i class="fa-solid fa-table-columns"></i>
              <div><b>Auto table.</b> Other columns in your Excel (Remarks, Contact No...) are added
              to the LBC table as new columns automatically.</div>
            </div>
            <div class="lbcimp-tip">
              <i class="fa-solid fa-fill-drip"></i>
              <div><b>Auto-fill.</b> Only have names? Each row still becomes a shipment — tracking
              no., date, destination and status are filled in for you and highlighted.</div>
            </div>
          </div>
        </div>

        <!-- STEP 2: REVIEW -->
        <div id="lbcImportStepReview" style="display:none;"></div>

        <div class="lbcimp-loading" id="lbcImportLoading" style="display:none;">
          <div class="lbcimp-spinner"></div>
          <p id="lbcImportLoadingText">Reading file...</p>
        </div>
      </div>

      <div class="modal-footer lbcimp-footer">
        <button type="button" class="btn-outline" id="lbcImportTemplateBtn">
          <i class="fa-solid fa-download"></i> Download Template
        </button>
        <div class="lbcimp-footer-right">
          <button type="button" class="btn-outline" id="lbcImportCancelBtn">Cancel</button>
          <button type="button" class="btn-primary" id="lbcImportConfirmBtn" disabled>
            <i class="fa-solid fa-file-import"></i> <span id="lbcImportConfirmLabel">Import</span>
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

/* ============================================================
   EVENTS
   ============================================================ */
function lbcImportAttachEvents() {
  const overlay = document.getElementById('lbcImportModalOverlay');
  const fileInput = document.getElementById('lbcImportFileInput');
  const dropzone = document.getElementById('lbcImportDropzone');

  document.getElementById('lbcImportOpenBtn').addEventListener('click', lbcImportOpen);
  document.getElementById('lbcImportCloseBtn').addEventListener('click', lbcImportClose);
  document.getElementById('lbcImportCancelBtn').addEventListener('click', lbcImportClose);
  document.getElementById('lbcImportTemplateBtn').addEventListener('click', lbcImportDownloadTemplate);
  document.getElementById('lbcImportConfirmBtn').addEventListener('click', lbcImportConfirm);
  if (typeof enableClickOutsideClose === 'function') enableClickOutsideClose('lbcImportModalOverlay');

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) lbcImportHandleFile(file);
  });

  ['dragenter', 'dragover'].forEach(evt => dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragging');
  }));
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) lbcImportHandleFile(file);
  });

  // Review-step controls (delegated — the review HTML is re-rendered)
  overlay.addEventListener('change', (e) => {
    const t = e.target;

    if (t.matches('[data-lbcimp-map]')) {
      lbcImport.mapping[Number(t.dataset.lbcimpMap)] = t.value;
      lbcImportBuildPreview();
      lbcImportRenderReview();
    } else if (t.id === 'lbcImportAutoFill') {
      lbcImport.autoFill = t.checked;
      lbcImportBuildPreview();
      lbcImportRenderReview();
    } else if (t.id === 'lbcImportSheetSelect') {
      lbcImportUseSheet(t.value);
    } else if (t.matches('[data-lbcimp-row]')) {
      const p = lbcImport.preview[Number(t.dataset.lbcimpRow)];
      if (p) p.include = t.checked;
      lbcImportUpdateCounts();
    } else if (t.id === 'lbcImportSelectAll') {
      lbcImport.preview.forEach(p => { if (lbcImportIsImportable(p)) p.include = t.checked; });
      overlay.querySelectorAll('[data-lbcimp-row]').forEach(cb => {
        const p = lbcImport.preview[Number(cb.dataset.lbcimpRow)];
        if (p && lbcImportIsImportable(p)) cb.checked = t.checked;
      });
      lbcImportUpdateCounts();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target.closest('#lbcImportChangeFile')) fileInput.click();
  });
}

function lbcImportOpen() {
  lbcImportReset();
  lbcImportShowStep('upload');
  openModal('lbcImportModalOverlay');
  // start loading the reader in the background so it is ready
  lbcImportLoadSheetJs().catch(() => {});
}

function lbcImportClose() {
  closeModal('lbcImportModalOverlay');
  lbcImportReset();
}

function lbcImportReset() {
  Object.assign(lbcImport, {
    fileName: '', workbook: null, sheetName: '', rows: [], headerRow: -1,
    columns: [], mapping: [], newCols: {}, preview: [], autoFill: true, mapOpen: null, truncated: 0
  });
  const review = document.getElementById('lbcImportStepReview');
  if (review) review.innerHTML = '';
  lbcImportUpdateCounts();
}

function lbcImportShowStep(step) {
  document.getElementById('lbcImportStepUpload').style.display = step === 'upload' ? '' : 'none';
  document.getElementById('lbcImportStepReview').style.display = step === 'review' ? '' : 'none';
}

function lbcImportSetLoading(on, text) {
  const box = document.getElementById('lbcImportLoading');
  if (!box) return;
  box.style.display = on ? 'flex' : 'none';
  if (text) document.getElementById('lbcImportLoadingText').textContent = text;
}

/* ============================================================
   READ FILE
   ============================================================ */
async function lbcImportHandleFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!LBC_IMPORT_CONFIG.acceptedExt.includes(ext)) {
    showToast('Please upload an Excel (.xlsx, .xls), CSV or .ods file.', 'error');
    return;
  }

  lbcImportSetLoading(true, `Reading "${file.name}"...`);
  try {
    const XLSX = await lbcImportLoadSheetJs();
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });

    lbcImport.fileName = file.name;
    lbcImport.workbook = wb;

    const firstWithData = wb.SheetNames.find(n => lbcImportSheetRows(wb.Sheets[n]).length > 0);
    if (!firstWithData) {
      showToast('The file is empty — no rows found.', 'error');
      lbcImportShowStep('upload');
      return;
    }
    lbcImportUseSheet(firstWithData);
  } catch (err) {
    console.error('[lbc-import.js] Failed to read file:', err);
    showToast(err && err.message ? err.message : 'Could not read this file.', 'error');
    lbcImportShowStep('upload');
  } finally {
    lbcImportSetLoading(false);
  }
}

/** Sheet → [{ num (Excel row number), cells: [] }], blank rows removed */
function lbcImportSheetRows(ws) {
  if (!ws || !ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });

  return raw
    .map((cells, i) => ({ num: range.s.r + i + 1, cells: cells || [] }))
    .filter(r => r.cells.some(c => lbcImportCellText(c) !== ''));
}

function lbcImportUseSheet(sheetName) {
  const wb = lbcImport.workbook;
  if (!wb || !wb.Sheets[sheetName]) return;

  const ws = wb.Sheets[sheetName];
  const rows = lbcImportSheetRows(ws);
  const startCol = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.c : 0;

  lbcImport.sheetName = sheetName;
  lbcImport.mapOpen = null;
  lbcImport.rows = rows;
  lbcImport.headerRow = lbcImportDetectHeader(rows);

  // drop columns that are empty in every row
  const width = rows.reduce((m, r) => Math.max(m, r.cells.length), 0);
  const usedCols = [];
  for (let c = 0; c < width; c++) {
    if (rows.some(r => lbcImportCellText(r.cells[c]) !== '')) usedCols.push(c);
  }
  lbcImport.rows = rows.map(r => ({ num: r.num, cells: usedCols.map(c => r.cells[c]) }));

  const headerCells = lbcImport.headerRow >= 0 ? lbcImport.rows[lbcImport.headerRow].cells : [];
  const dataRows = lbcImport.rows.slice(lbcImport.headerRow + 1);

  lbcImport.columns = usedCols.map((c, i) => ({
    letter: XLSX.utils.encode_col(startCol + c),
    header: lbcImportCellText(headerCells[i]),
    samples: dataRows.slice(0, 40).map(r => r.cells[i]).filter(v => lbcImportCellText(v) !== '')
  }));

  lbcImportAutoMap();
  lbcImportPlanNewColumns();
  lbcImportBuildPreview();
  lbcImportRenderReview();
  lbcImportShowStep('review');
}

/* ============================================================
   HEADER DETECTION + COLUMN MATCHING
   ============================================================ */
function lbcImportTargets() {
  const custom = (typeof getCustomFieldsForModule === 'function')
    ? getCustomFieldsForModule(LBC_IMPORT_CONFIG.module)
    : [];
  return LBC_IMPORT_FIELDS
    .map(f => ({ key: f.key, label: f.label, synonyms: f.synonyms, custom: false }))
    .concat(custom.map(f => ({
      key: 'cf:' + f.fieldKey, label: f.fieldLabel, synonyms: [f.fieldLabel],
      custom: true, fieldType: f.fieldType
    })));
}

/** Every field this header could mean → { fieldKey: score } */
function lbcImportScoreHeader(text) {
  const h = lbcImportNorm(text);
  const scores = {};
  if (!h || /^\d+$/.test(h)) return scores;

  lbcImportTargets().forEach(t => {
    t.synonyms.forEach(syn => {
      const s = lbcImportNorm(syn);
      if (!s) return;
      let score = 0;
      if (h === s) {
        score = t.custom ? 1.05 : 1;          // exact custom label wins
      } else if (s.length >= 3 && (' ' + h + ' ').includes(' ' + s + ' ')) {
        score = 0.6 + 0.3 * (s.length / h.length);
      } else if (s.length >= 4) {
        const sim = lbcImportSimilarity(h, s);
        if (sim >= 0.8) score = 0.75 * sim;    // typo: "tracking nmber", "adress"
      }
      if (score > (scores[t.key] || 0)) scores[t.key] = score;
    });
  });
  return scores;
}

/** Best single match for a header */
function lbcImportMatchHeader(text) {
  const scores = lbcImportScoreHeader(text);
  let best = { field: '', score: 0 };
  Object.keys(scores).forEach(k => { if (scores[k] > best.score) best = { field: k, score: scores[k] }; });
  return best;
}

/** Row that looks most like a header within the first N rows, or -1 */
function lbcImportDetectHeader(rows) {
  let best = { index: -1, hits: 0 };
  rows.slice(0, LBC_IMPORT_CONFIG.headerScanRows).forEach((row, i) => {
    const texts = row.cells.map(lbcImportCellText).filter(Boolean);
    if (!texts.length) return;
    const hits = texts.filter(t => lbcImportMatchHeader(t).score >= 0.7).length;
    const wordy = texts.filter(t => /[A-Za-z]/.test(t) && !lbcImportLooksDate(t)).length / texts.length;
    // enough known headers (tables with many extra columns still count)
    const ok = (hits >= 2 && hits / texts.length >= 0.25 && wordy >= 0.7) || (hits >= 1 && texts.length <= 2);
    if (ok && hits > best.hits) best = { index: i, hits };
  });
  return best.index;
}

function lbcImportAutoMap() {
  const cols = lbcImport.columns;
  const mapping = new Array(cols.length).fill('');
  const taken = new Set();

  // 1) by header text — every (column, field) pair, best score first.
  //    If a column's best field is already taken it falls back to its
  //    next best one (e.g. "Recipient's Address" → Destination when
  //    "Recipient" already took Client Name). Name parts may share.
  if (lbcImport.headerRow >= 0) {
    const candidates = [];
    cols.forEach((c, i) => {
      const scores = lbcImportScoreHeader(c.header);
      Object.keys(scores).forEach(field => {
        if (scores[field] >= 0.6) candidates.push({ i, field, score: scores[field] });
      });
    });
    candidates.sort((a, b) => b.score - a.score).forEach(c => {
      if (mapping[c.i]) return;
      const namePart = c.field === 'clientName' && lbcImportNameRole(cols[c.i].header);
      if (!taken.has(c.field) || namePart) {
        mapping[c.i] = c.field;
        taken.add(c.field);
      }
    });

    // unknown header but the content is clearly dates → Date Sent
    cols.forEach((c, i) => {
      if (mapping[i] || taken.has('dateSent') || !c.samples.length) return;
      if (lbcImportGuessKind(c.samples) === 'date') { mapping[i] = 'dateSent'; taken.add('dateSent'); }
    });
  }

  // 2) by content — only columns with no usable header
  const textCols = [];
  cols.forEach((c, i) => {
    if (mapping[i]) return;
    if (lbcImport.headerRow >= 0 && c.header) return; // unknown header → becomes a new column (step 3)

    const kind = lbcImportGuessKind(c.samples);
    const claim = (field) => {
      if (taken.has(field)) return false;
      mapping[i] = field; taken.add(field); return true;
    };
    if (kind === 'date') claim('dateSent');
    else if (kind === 'tracking') claim('trackingNumber');
    else if (kind === 'status') claim('status');
    else if (kind === 'name') textCols.push({ i, pref: 'clientName' });
    else if (kind === 'address') textCols.push({ i, pref: 'destination' });
    else if (kind === 'text') textCols.push({ i, pref: '' });
  });

  // preferred fields first, then fill remaining text fields in order
  textCols.forEach(tc => {
    if (tc.pref && !taken.has(tc.pref)) { mapping[tc.i] = tc.pref; taken.add(tc.pref); tc.done = true; }
  });
  const order = ['clientName', 'destination', 'document'];
  textCols.filter(tc => !tc.done).forEach(tc => {
    const field = order.find(f => !taken.has(f));
    if (field) { mapping[tc.i] = field; taken.add(field); }
  });

  // 3) AUTO TABLE — every column that still has data but no match
  //    becomes a NEW custom column of the LBC table
  if (LBC_IMPORT_CONFIG.autoCreateColumns) {
    cols.forEach((c, i) => {
      if (!mapping[i] && c.samples.length && !lbcImportIsCounter(c.samples)) mapping[i] = 'new';
    });
  }

  lbcImport.mapping = mapping;
}

/** A plain row counter (1, 2, 3 ...) — left as "Ignore" by default */
function lbcImportIsCounter(samples) {
  const nums = (samples || []).map(v => Number(lbcImportCellText(v)));
  if (nums.length < 2 || nums.some(n => !Number.isInteger(n))) return false;
  return nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
}

/* ============================================================
   AUTO TABLE — plan the new custom columns (name + type)
   ============================================================ */
function lbcImportPlanNewColumns() {
  const existingLabels = new Set(
    lbcImportTargets().map(t => lbcImportNorm(t.label))
  );
  const plan = {};

  lbcImport.columns.forEach((c, i) => {
    let base = (c.header || `Column ${c.letter}`).replace(/\s+/g, ' ').trim().slice(0, 40);
    let label = base;
    let n = 2;
    while (existingLabels.has(lbcImportNorm(label))) label = `${base} (${n++})`;
    existingLabels.add(lbcImportNorm(label));

    plan[i] = { label, type: lbcImportGuessFieldType(c.samples) };
  });

  lbcImport.newCols = plan;
}

/** 'date' | 'number' | 'text' for a new custom column */
function lbcImportGuessFieldType(samples) {
  const vals = (samples || []).filter(v => lbcImportCellText(v) !== '');
  if (!vals.length) return 'text';
  if (lbcImportGuessKind(vals) === 'date') return 'date';

  const numeric = vals.every(v => {
    const t = lbcImportCellText(v).replace(/,/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(t)) return false;
    if (/^0\d/.test(t)) return false;          // 0917... phone / codes stay text
    return t.replace(/[^\d]/g, '').length < 8; // long ids stay text
  });
  return numeric ? 'number' : 'text';
}

function lbcImportNewColumnIndexes() {
  return lbcImport.mapping
    .map((m, i) => (m === 'new' ? i : -1))
    .filter(i => i >= 0);
}

function lbcImportGuessKind(samples) {
  const vals = (samples || []).filter(v => lbcImportCellText(v) !== '');
  if (!vals.length) return 'empty';
  const texts = vals.map(lbcImportCellText);
  const ratio = (fn) => vals.filter(fn).length / vals.length;

  if (ratio(v => lbcImportIsDate(v) || (typeof v === 'number' && v > 20000 && v < 80000) || lbcImportLooksDate(v)) >= 0.7) return 'date';
  if (ratio(v => /^[A-Za-z]{0,6}[\s-]?\d[\d\s-]{5,}[A-Za-z]{0,3}$/.test(lbcImportCellText(v))) >= 0.7) return 'tracking';
  if (ratio(v => lbcImportStatusWord(lbcImportCellText(v)) !== null) >= 0.8) return 'status';

  const addressLike = texts.filter(t =>
    (/,/.test(t) && t.length > 12) ||
    /\b(city|st|street|brgy|barangay|ave|avenue|road|rd|blk|lot|subd|village|province|branch|manila|quezon|cebu|davao|pampanga|cavite|laguna|bulacan|rizal)\b/i.test(t)
  ).length / texts.length;
  if (addressLike >= 0.5) return 'address';

  const nameLike = texts.filter(t =>
    /^[A-Za-zÀ-ÿñÑ.,'\-\s]+$/.test(t) && t.split(' ').length >= 2 && t.length <= 60
  ).length / texts.length;
  if (nameLike >= 0.6) return 'name';

  return 'text';
}

/** 'first' | 'middle' | 'last' | '' based on a header like "First Name" */
function lbcImportNameRole(header) {
  const h = lbcImportNorm(header);
  if (/\b(first|given)\b/.test(h)) return 'first';
  if (/\b(middle|mi)\b/.test(h)) return 'middle';
  if (/\b(last|surname|family|apelyido)\b/.test(h) || h === 'surname') return 'last';
  return '';
}

/* ============================================================
   BUILD PREVIEW (row by row, with auto-fill)
   ============================================================ */
function lbcImportBuildPreview() {
  const cfg = LBC_IMPORT_CONFIG;
  const targets = {};
  lbcImportTargets().forEach(t => { targets[t.key] = t; });

  const existing = new Set(getShipments().map(s => String(s.trackingNumber || '').toLowerCase()));
  const used = new Set(existing);
  const firstSeenAt = {};
  const today = lbcImportYmd(new Date());
  const stamp = today.replace(/-/g, '');
  let autoSeq = 1;

  const allData = lbcImport.rows.slice(lbcImport.headerRow + 1);
  lbcImport.truncated = Math.max(0, allData.length - cfg.maxRows);
  const dataRows = allData.slice(0, cfg.maxRows);

  const nextTracking = () => {
    let code;
    do { code = `LBC-IMP-${stamp}-${String(autoSeq++).padStart(3, '0')}`; }
    while (used.has(code.toLowerCase()));
    return code;
  };

  lbcImport.preview = dataRows.map(row => {
    const rec = { trackingNumber: '', clientName: '', destination: '', document: '', dateSent: '', status: '', customFields: {}, newFields: {} };
    LBC_IMPORT_OPTIONAL_KEYS.forEach(k => { rec[k] = ''; });
    const nameParts = { first: [], middle: [], last: [], other: [] };
    const auto = [];
    const notes = [];
    let badDate = false;
    let hasAny = false;

    lbcImport.mapping.forEach((field, ci) => {
      if (!field) return;
      const raw = row.cells[ci];
      const text = lbcImportCellText(raw);
      if (text === '') return;
      hasAny = true;

      if (field === 'dateSent') {
        const d = lbcImportParseDate(raw);
        if (d) rec.dateSent = d; else badDate = true;
      } else if (field === 'status') {
        rec.status = lbcImportStatusWord(text) || '';
      } else if (field === 'clientName') {
        const role = lbcImportNameRole(lbcImport.columns[ci].header) || 'other';
        nameParts[role].push(text);
      } else if (field.startsWith('cf:')) {
        const t = targets[field];
        const val = t && t.fieldType === 'date' ? (lbcImportParseDate(raw) || text) : text;
        rec.customFields[field.slice(3)] = val;
      } else if (field === 'new') {
        const plan = lbcImport.newCols[ci];
        rec.newFields[ci] = plan && plan.type === 'date' ? (lbcImportParseDate(raw) || text) : text;
      } else {
        rec[field] = rec[field] ? `${rec[field]} ${text}` : text;
      }
    });

    if (!hasAny) return null;

    rec.clientName = nameParts.first.concat(nameParts.middle, nameParts.last, nameParts.other).join(' ').trim();
    rec.trackingNumber = rec.trackingNumber.replace(/\s+/g, ' ').trim();

    // ---- fill in what is missing ----
    const missing = [];
    const fill = (key, value, note) => {
      if (rec[key]) return;
      if (lbcImport.autoFill) { rec[key] = value(); auto.push(key); if (note) notes.push(note); }
      else missing.push(key);
    };

    fill('clientName', () => cfg.defaults.clientName);
    fill('trackingNumber', nextTracking);
    fill('destination', () => cfg.defaults.destination);
    fill('document', () => cfg.defaults.document);
    fill('dateSent', () => today, badDate ? 'Unreadable date → today' : '');
    if (!rec.status) { rec.status = cfg.defaults.status; auto.push('status'); }

    // ---- state ----
    let state = auto.length ? 'auto' : 'ok';
    const key = rec.trackingNumber.toLowerCase();

    if (missing.length) {
      state = 'invalid';
      notes.unshift('Missing: ' + missing.map(k => lbcImportFieldLabel(k)).join(', '));
    } else if (existing.has(key)) {
      state = 'duplicate';
      notes.unshift('Tracking no. already exists');
    } else if (firstSeenAt[key]) {
      state = 'duplicate';
      notes.unshift(`Same tracking no. as row ${firstSeenAt[key]}`);
    } else {
      firstSeenAt[key] = row.num;
      used.add(key);
    }

    return {
      rowNum: row.num,
      record: rec,
      auto,
      state,
      note: notes.filter(Boolean).join(' · '),
      include: state === 'ok' || state === 'auto'
    };
  }).filter(Boolean);
}

function lbcImportIsImportable(p) {
  return p.state === 'ok' || p.state === 'auto';
}

/* ============================================================
   RENDER REVIEW
   ============================================================ */
function lbcImportRenderReview() {
  const box = document.getElementById('lbcImportStepReview');
  if (!box) return;

  const esc = lbcImportEsc;
  const targets = lbcImportTargets();
  const builtIn = targets.filter(t => !t.custom);
  const custom = targets.filter(t => t.custom);
  const wb = lbcImport.workbook;
  const typeLabel = { text: 'Text', number: 'Number', date: 'Date' };

  const sheetSelect = wb && wb.SheetNames.length > 1
    ? `<select id="lbcImportSheetSelect" class="lbcimp-mini-select">
         ${wb.SheetNames.map(n => `<option value="${esc(n)}" ${n === lbcImport.sheetName ? 'selected' : ''}>Sheet: ${esc(n)}</option>`).join('')}
       </select>`
    : '';

  const headerInfo = lbcImport.headerRow >= 0
    ? `Header at row ${lbcImport.rows[lbcImport.headerRow].num}`
    : `No header row — guessed from content`;

  // ---- column counts ----
  const counts = { matched: 0, fresh: 0, ignored: 0 };
  lbcImport.mapping.forEach(m => {
    if (!m) counts.ignored++;
    else if (m === 'new') counts.fresh++;
    else counts.matched++;
  });
  if (lbcImport.mapOpen === null) lbcImport.mapOpen = counts.fresh > 0 || counts.ignored > 0;

  // ---- column matching rows (compact list) ----
  const mapRows = lbcImport.columns.map((c, i) => {
    const current = lbcImport.mapping[i] || '';
    const plan = lbcImport.newCols[i] || { label: c.header || `Column ${c.letter}`, type: 'text' };
    const sample = c.samples.length ? lbcImportCellText(c.samples[0]) : '';
    const opts = [`<option value="">Ignore</option>`]
      .concat(builtIn.map(t => `<option value="${t.key}" ${current === t.key ? 'selected' : ''}>${esc(t.label)}</option>`));
    if (custom.length) {
      opts.push(`<optgroup label="Custom columns">${custom.map(t =>
        `<option value="${esc(t.key)}" ${current === t.key ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</optgroup>`);
    }
    opts.push(`<optgroup label="Auto table"><option value="new" ${current === 'new' ? 'selected' : ''}>+ New column (${typeLabel[plan.type]})</option></optgroup>`);

    const state = !current ? 'ignored' : current === 'new' ? 'new' : 'matched';
    const stateIcon = { matched: 'fa-circle-check', new: 'fa-circle-plus', ignored: 'fa-circle-minus' }[state];

    return `
      <div class="lbcimp-map-row is-${state}">
        <span class="lbcimp-col-letter">${esc(c.letter)}</span>
        <div class="lbcimp-map-src">
          <span class="lbcimp-col-name" title="${esc(c.header || '(no header)')}">${c.header ? esc(c.header) : '<i>(no header)</i>'}</span>
          <span class="lbcimp-map-sample" title="${esc(sample)}">${sample ? esc(sample) : '<i>empty</i>'}</span>
        </div>
        <i class="fa-solid ${stateIcon} lbcimp-map-state" title="${state}"></i>
        <select data-lbcimp-map="${i}" title="Where this column goes">${opts.join('')}</select>
      </div>
    `;
  }).join('');

  // ---- dynamic extra columns (existing custom + new) ----
  const extraCols = [];
  lbcImport.mapping.forEach((m, ci) => {
    if (m && m.startsWith('cf:') && !extraCols.some(x => x.key === m)) {
      const t = targets.find(x => x.key === m);
      extraCols.push({ kind: 'cf', key: m, fieldKey: m.slice(3), label: t ? t.label : m.slice(3) });
    } else if (m === 'new') {
      const plan = lbcImport.newCols[ci];
      extraCols.push({ kind: 'new', ci, label: plan ? plan.label : `Column ${lbcImport.columns[ci].letter}` });
    }
  });

  const totalCols = 3 + LBC_IMPORT_FIELDS.length + extraCols.length;
  const shown = lbcImport.preview.slice(0, LBC_IMPORT_CONFIG.previewLimit);

  const td = (value, label, cls = '') =>
    `<td data-label="${esc(label)}" class="${cls}" title="${esc(value)}">${esc(value)}</td>`;

  const extraHead = extraCols.map(x =>
    `<th class="${x.kind === 'new' ? 'lbcimp-th-new' : ''}" title="${esc(x.label)}">${esc(x.label)}${x.kind === 'new' ? '<span class="lbcimp-th-tag">NEW</span>' : ''}</th>`
  ).join('');

  const rowsHtml = shown.length ? shown.map((p, idx) => {
    const r = p.record;
    const a = (k) => (p.auto.includes(k) ? 'lbcimp-auto' : '');
    const extraCells = extraCols.map(x => {
      const v = x.kind === 'cf' ? r.customFields[x.fieldKey] : r.newFields[x.ci];
      return td(v === undefined || v === '' ? '—' : v, x.label, x.kind === 'new' ? 'lbcimp-td-new' : '');
    }).join('');

    return `
      <tr class="lbcimp-row lbcimp-row-${p.state}">
        <td data-label="Import" class="lbcimp-td-check">
          <input type="checkbox" data-lbcimp-row="${idx}" ${p.include ? 'checked' : ''} ${lbcImportIsImportable(p) ? '' : 'disabled'}>
        </td>
        <td data-label="Row" class="lbcimp-rownum">${p.rowNum}</td>
        ${LBC_IMPORT_FIELDS.map(f => {
          if (f.key === 'status') {
            return `<td data-label="${esc(f.label)}" class="${a('status')}"><span class="badge badge-${esc(r.status)}">${esc(lbcImportStatusLabel(r.status))}</span></td>`;
          }
          if (f.key === 'dateSent') return td(r.dateSent ? formatDate(r.dateSent) : '', f.label, a('dateSent'));
          if (f.key === 'trackingNumber') return td(r.trackingNumber, f.label, 'lbcimp-mono ' + a('trackingNumber'));
          const v = r[f.key];
          return td(v === '' || v === undefined ? '—' : v, f.label, a(f.key));
        }).join('')}
        ${extraCells}
        <td data-label="Note" class="lbcimp-note" title="${esc(p.note)}">${lbcImportStateBadge(p.state)}${p.note ? `<span>${esc(p.note)}</span>` : ''}</td>
      </tr>
    `;
  }).join('') : `<tr class="empty-row"><td colspan="${totalCols}">No data rows found under the header.</td></tr>`;

  const newList = extraCols.filter(x => x.kind === 'new');
  const newInfo = newList.length ? `
    <div class="lbcimp-newcols">
      <i class="fa-solid fa-table-columns"></i>
      <span><b>${newList.length} new column${newList.length > 1 ? 's' : ''}</b> will be added to the LBC table:</span>
      ${newList.map(x => `<span class="lbcimp-newcol-chip" title="${esc(x.label)}">${esc(x.label)}</span>`).join('')}
    </div>` : '';

  box.innerHTML = `
    <!-- FILE BAR -->
    <div class="lbcimp-filebar">
      <i class="fa-solid fa-file-excel lbcimp-file-icon"></i>
      <div class="lbcimp-file">
        <strong title="${esc(lbcImport.fileName)}">${esc(lbcImport.fileName)}</strong>
        <small>${headerInfo} · ${lbcImport.columns.length} column(s)</small>
      </div>
      ${sheetSelect}
      <button type="button" class="lbcimp-link-btn" id="lbcImportChangeFile"><i class="fa-solid fa-arrows-rotate"></i> Change</button>
    </div>

    <!-- COLUMN MATCHING (collapsible) -->
    <div class="lbcimp-panel ${lbcImport.mapOpen ? 'open' : ''}" id="lbcImportMapPanel">
      <button type="button" class="lbcimp-panel-head" id="lbcImportMapToggle">
        <span class="lbcimp-panel-title"><i class="fa-solid fa-diagram-project"></i> Column matching</span>
        <span class="lbcimp-pill ok">${counts.matched} matched</span>
        ${counts.fresh ? `<span class="lbcimp-pill new">${counts.fresh} new</span>` : ''}
        ${counts.ignored ? `<span class="lbcimp-pill off">${counts.ignored} ignored</span>` : ''}
        <i class="fa-solid fa-chevron-down lbcimp-chev"></i>
      </button>
      <div class="lbcimp-panel-body">
        <div class="lbcimp-map-list">${mapRows}</div>
      </div>
    </div>

    ${newInfo}

    <!-- SUMMARY + OPTIONS -->
    <div class="lbcimp-toolbar">
      <div class="lbcimp-summary" id="lbcImportSummary"></div>
      <label class="lbcimp-switch" title="Generate tracking no., today's date, default destination/document and Pending status for empty cells">
        <input type="checkbox" id="lbcImportAutoFill" ${lbcImport.autoFill ? 'checked' : ''}>
        <span class="lbcimp-switch-track"></span>
        <span>Auto-fill empty cells</span>
      </label>
    </div>

    ${lbcImport.truncated ? `<div class="lbcimp-warn"><i class="fa-solid fa-triangle-exclamation"></i> Only the first ${LBC_IMPORT_CONFIG.maxRows} rows are imported — ${lbcImport.truncated} row(s) left out.</div>` : ''}
    ${lbcImport.preview.length > LBC_IMPORT_CONFIG.previewLimit ? `<div class="lbcimp-hint">Showing the first ${LBC_IMPORT_CONFIG.previewLimit} of ${lbcImport.preview.length} rows — all selected rows will still be imported.</div>` : ''}

    <!-- PREVIEW TABLE -->
    <div class="lbcimp-table-wrap">
      <table class="lbcimp-table">
        <thead>
          <tr>
            <th class="lbcimp-td-check"><input type="checkbox" id="lbcImportSelectAll" title="Select / unselect all" checked></th>
            <th>Row</th>
            ${LBC_IMPORT_FIELDS.map(f => `<th title="${esc(f.label)}">${esc(f.label)}</th>`).join('')}
            ${extraHead}
            <th>Note</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="lbcimp-legend">
      <span><i class="lbcimp-legend-dot auto"></i> Auto-filled</span>
      <span><i class="lbcimp-legend-dot new"></i> New column</span>
      <span>Hover a cell to see the full text</span>
    </div>
  `;

  const toggle = document.getElementById('lbcImportMapToggle');
  if (toggle) toggle.addEventListener('click', () => {
    lbcImport.mapOpen = !lbcImport.mapOpen;
    document.getElementById('lbcImportMapPanel').classList.toggle('open', lbcImport.mapOpen);
  });

  lbcImportUpdateCounts();
}

function lbcImportUpdateCounts() {
  const list = lbcImport.preview;
  const selected = list.filter(p => p.include && lbcImportIsImportable(p)).length;
  const autoCount = list.filter(p => p.state === 'auto').length;
  const dupCount = list.filter(p => p.state === 'duplicate').length;
  const badCount = list.filter(p => p.state === 'invalid').length;

  const summary = document.getElementById('lbcImportSummary');
  if (summary) {
    summary.innerHTML = `
      <span class="lbcimp-chip total"><i class="fa-solid fa-list"></i> ${list.length} row(s) read</span>
      <span class="lbcimp-chip ready"><i class="fa-solid fa-check"></i> ${selected} selected</span>
      ${autoCount ? `<span class="lbcimp-chip auto"><i class="fa-solid fa-fill-drip"></i> ${autoCount} auto-filled</span>` : ''}
      ${dupCount ? `<span class="lbcimp-chip dup"><i class="fa-solid fa-clone"></i> ${dupCount} duplicate (skipped)</span>` : ''}
      ${badCount ? `<span class="lbcimp-chip bad"><i class="fa-solid fa-circle-exclamation"></i> ${badCount} incomplete (skipped)</span>` : ''}
    `;
  }

  const btn = document.getElementById('lbcImportConfirmBtn');
  const label = document.getElementById('lbcImportConfirmLabel');
  if (btn) btn.disabled = selected === 0;
  if (label) label.textContent = selected ? `Import ${selected} shipment${selected > 1 ? 's' : ''}` : 'Import';

  const all = document.getElementById('lbcImportSelectAll');
  if (all) {
    const importable = list.filter(lbcImportIsImportable);
    all.checked = importable.length > 0 && importable.every(p => p.include);
  }
}

/* ============================================================
   IMPORT
   ============================================================ */
function lbcImportConfirm() {
  const rows = lbcImport.preview.filter(p => p.include && lbcImportIsImportable(p));
  if (!rows.length) {
    showToast('No rows selected to import.', 'error');
    return;
  }

  const shipments = getShipments();
  const existing = new Set(shipments.map(s => String(s.trackingNumber || '').toLowerCase()));
  const stamp = nowISO();
  const base = Date.now();
  const added = [];

  // ---- AUTO TABLE: create the new custom columns first ----
  const newKeyByCol = {};
  const createdLabels = [];
  const newIdx = lbcImportNewColumnIndexes();
  if (newIdx.length) {
    if (typeof addCustomFieldDefinition !== 'function') {
      showToast('Custom columns are not available on this page — new columns were skipped.', 'error');
    } else {
      const current = getCustomFieldsForModule(LBC_IMPORT_CONFIG.module);
      newIdx.forEach(ci => {
        const plan = lbcImport.newCols[ci] || { label: `Column ${lbcImport.columns[ci].letter}`, type: 'text' };
        // reuse a column with the same name if it already exists
        const same = current.find(f => lbcImportNorm(f.fieldLabel) === lbcImportNorm(plan.label));
        if (same) { newKeyByCol[ci] = same.fieldKey; return; }
        const def = addCustomFieldDefinition(LBC_IMPORT_CONFIG.module, plan.label, plan.type);
        if (def && def.fieldKey) {
          newKeyByCol[ci] = def.fieldKey;
          current.push(def);
          createdLabels.push(plan.label);
        }
      });
    }
  }

  rows.forEach((p, i) => {
    const r = p.record;
    const key = r.trackingNumber.toLowerCase();
    if (existing.has(key)) return;
    existing.add(key);

    const customFields = { ...r.customFields };
    Object.keys(r.newFields || {}).forEach(ci => {
      const fk = newKeyByCol[ci];
      if (fk && r.newFields[ci] !== '') customFields[fk] = r.newFields[ci];
    });

    added.push({
      id: `SHIP-${base}-${i}-${Math.floor(Math.random() * 1000)}`,
      trackingNumber: r.trackingNumber,
      clientName: r.clientName,
      destination: r.destination,
      document: r.document,
      dateSent: r.dateSent,
      status: r.status,
      ...LBC_IMPORT_OPTIONAL_KEYS.reduce((o, k) => { o[k] = r[k] || ''; return o; }, {}),
      documents: [],
      customFields,
      importedFrom: lbcImport.fileName,
      createdAt: stamp,
      updatedAt: stamp
    });
  });

  if (!added.length) {
    if (createdLabels.length && typeof renderShipmentTable === 'function') renderShipmentTable();
    showToast('Nothing new to import — all tracking numbers already exist.', 'error');
    return;
  }

  const saved = saveShipments(shipments.concat(added));
  if (saved === false) {
    showToast('Could not save — browser storage is full.', 'error');
    return;
  }

  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const who = user ? `${user.firstName} ${user.lastName}` : 'Someone';

  if (user && typeof logActivity === 'function') {
    logActivity(user.id, 'lbc-add', `Imported ${added.length} LBC shipment(s) from "${lbcImport.fileName}".`);
  }

  if (user && typeof createNotificationForMany === 'function' && typeof getUsers === 'function') {
    const others = getUsers().map(u => u.id).filter(id => id !== user.id);
    if (others.length) {
      createNotificationForMany(
        others,
        'shipment-added',
        'LBC shipments imported',
        `${who} imported ${added.length} shipment(s) from "${lbcImport.fileName}".`,
        { page: 'lbc.html', targetId: null }
      );
    }
  }

  const autoCount = rows.filter(p => p.state === 'auto').length;
  closeModal('lbcImportModalOverlay');
  lbcImportReset();
  if (typeof renderShipmentTable === 'function') renderShipmentTable();

  const colMsg = createdLabels.length
    ? ` ${createdLabels.length} new column(s) added: ${createdLabels.join(', ')}.`
    : '';
  showToast(
    `${added.length} shipment(s) imported${autoCount ? ` (${autoCount} with auto-filled details — you can edit them anytime)` : ''}.${colMsg}`,
    'success'
  );
}

/* ============================================================
   TEMPLATE
   ============================================================ */
async function lbcImportDownloadTemplate() {
  try {
    const XLSX = await lbcImportLoadSheetJs();
    const custom = (typeof getCustomFieldsForModule === 'function')
      ? getCustomFieldsForModule(LBC_IMPORT_CONFIG.module) : [];
    const today = lbcImportYmd(new Date());

    const headers = LBC_IMPORT_FIELDS.map(f => f.label).concat(custom.map(f => f.fieldLabel));
    const blanks = custom.map(() => '');
    // same order as LBC_IMPORT_FIELDS
    const sample = [
      ['1234 5678 9012', 'People of the Philippines vs. Juan Dela Cruz', 'CR-2026-001', 'Criminal', 'Estafa',
        'Atty. Abanto', 'Juan Dela Cruz', 'Blk 5 Lot 3, Brgy. San Roque, Quezon City', 'Notice of Hearing', today, 'Pending'].concat(blanks),
      ['1234 5678 9013', 'Santos vs. Reyes', 'CV-2026-014', 'Civil', 'Collection of Sum of Money',
        'Atty. Abanto', 'Maria Santos', 'LBC Cebu City Branch', 'Court Order Copy', today, 'In Transit'].concat(blanks),
      ['', '', '', '', '', '', 'Pedro Reyes', '', '', '', ''].concat(blanks)
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers].concat(sample));
    ws['!cols'] = headers.map(h => ({ wch: Math.max(18, h.length + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Shipments');
    XLSX.writeFile(wb, 'LBC_Import_Template.xlsx');
  } catch (err) {
    console.error('[lbc-import.js] Template failed:', err);
    showToast(err && err.message ? err.message : 'Could not create the template.', 'error');
  }
}

/* ============================================================
   VALUE HELPERS
   ============================================================ */
function lbcImportIsDate(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function lbcImportCellText(v) {
  if (v === null || v === undefined) return '';
  if (lbcImportIsDate(v)) return isNaN(v) ? '' : lbcImportYmd(v);
  return String(v).replace(/\s+/g, ' ').trim();
}

function lbcImportNorm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/['’`]s\b/g, '')            // "recipient's" → "recipient"
    .replace(/#/g, ' no ')
    .replace(/\bno\.?\b|\bnumber\b|\bnum\b/g, ' no ')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lbcImportSimilarity(a, b) {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  return 1 - lbcImportLevenshtein(a, b) / max;
}

function lbcImportLevenshtein(a, b) {
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

function lbcImportStatusWord(text) {
  const s = lbcImportNorm(text);
  if (!s) return null;
  if (/(deliver|receiv|claim|complet|done|natanggap|nakuha|success)/.test(s)) return 'delivered';
  if (/(transit|shipped|on the way|otw|dispatch|en ?route|out for|papunta|picked up|sent)/.test(s)) return 'in-transit';
  if (/(pending|waiting|hold|process|prepar|not yet|hindi pa|to ship|queue|for pick ?up|new)/.test(s)) return 'pending';
  return null;
}

function lbcImportStatusLabel(status) {
  return ({ pending: 'Pending', 'in-transit': 'In Transit', delivered: 'Delivered' })[status] || status;
}

function lbcImportFieldLabel(key) {
  const f = LBC_IMPORT_FIELDS.find(x => x.key === key);
  return f ? f.label : key;
}

function lbcImportStateBadge(state) {
  const map = {
    ok: '<span class="lbcimp-state ok"><i class="fa-solid fa-check"></i> Ready</span>',
    auto: '<span class="lbcimp-state auto"><i class="fa-solid fa-fill-drip"></i> Auto-filled</span>',
    duplicate: '<span class="lbcimp-state dup"><i class="fa-solid fa-clone"></i> Duplicate</span>',
    invalid: '<span class="lbcimp-state bad"><i class="fa-solid fa-circle-exclamation"></i> Incomplete</span>'
  };
  return map[state] || '';
}

function lbcImportLooksDate(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return /^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}/.test(s) ||
    /^\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}$/.test(s) ||
    /^[A-Za-z]{3,9}\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+\d{4}$/.test(s) ||
    /^\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}$/.test(s);
}

/** Any date-ish value → 'YYYY-MM-DD' (or '' if unreadable) */
function lbcImportParseDate(v) {
  if (v === null || v === undefined || v === '') return '';

  if (lbcImportIsDate(v)) {
    if (isNaN(v)) return '';
    // +2 min guards against Excel's "23:59:xx the day before" rounding
    return lbcImportYmd(new Date(v.getTime() + 120000));
  }

  if (typeof v === 'number') {
    if (v > 20000 && v < 80000 && window.XLSX && XLSX.SSF) {
      const p = XLSX.SSF.parse_date_code(v);
      if (p) return lbcImportYmdParts(p.y, p.m, p.d);
    }
    return '';
  }

  const s = String(v).trim()
    .replace(/(\d)(st|nd|rd|th)\b/gi, '$1')
    .replace(/\bsept\b/i, 'Sep');

  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return lbcImportYmdParts(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    const [month, day] = a > 12 ? [b, a] : [a, b];   // PH/US month-first unless impossible
    return lbcImportYmdParts(y, month, day);
  }

  const t = Date.parse(s);
  if (!isNaN(t)) return lbcImportYmd(new Date(t));
  return '';
}

function lbcImportYmdParts(y, m, d) {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function lbcImportYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lbcImportEsc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   STYLES (self-contained — follows the theme's CSS variables,
   so it matches V1 / V2 / V3 automatically)
   ============================================================ */
function lbcImportInjectStyles() {
  if (document.getElementById('lbcImportStyles')) return;
  const style = document.createElement('style');
  style.id = 'lbcImportStyles';
  style.textContent = `
    .lbc-heading-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .lbcimp-open-btn i { color: #1d7a45; }

    /* ---------- modal frame: fixed size, body scrolls ---------- */
    .modal-box.lbcimp-modal { width: min(1100px, 96vw); max-width: 96vw; height: min(760px, 92vh); max-height: 92vh; }
    .lbcimp-modal .modal-header { padding: 14px 20px; }
    .lbcimp-modal .modal-header h2 { font-size: 16px; }
    .lbcimp-body {
      position: relative; flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px !important;
      background: var(--card-bg, #fff); color: var(--color-black, #130D1D);
    }
    .lbcimp-footer { padding: 12px 20px !important; justify-content: space-between !important; flex-wrap: wrap; gap: 10px; }
    .lbcimp-footer-right { display: flex; gap: 10px; }
    .lbcimp-footer .btn-outline, .lbcimp-footer .btn-primary { padding: 9px 16px; font-size: 13px; }

    /* ---------- upload step ---------- */
    .lbcimp-dropzone {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 6px; text-align: center; cursor: pointer;
      padding: 36px 20px; border-radius: var(--radius-md, 12px);
      border: 2px dashed var(--color-gray-border, #E8E4DA);
      background: var(--color-gray-bg, #F6F4EF);
      transition: border-color .2s ease, background .2s ease;
    }
    .lbcimp-dropzone i { font-size: 34px; color: var(--color-gold, #EAB52A); }
    .lbcimp-dropzone strong { font-size: 14.5px; color: var(--color-black, #130D1D); }
    .lbcimp-dropzone span { font-size: 12px; color: var(--color-gray-text, #6A6377); }
    .lbcimp-dropzone:hover, .lbcimp-dropzone.dragging {
      border-color: var(--color-gold, #EAB52A); background: var(--primary-soft, rgba(234,181,42,.13));
    }
    .lbcimp-tips { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 14px; }
    .lbcimp-tip {
      display: flex; gap: 10px; padding: 11px 13px; font-size: 12px; line-height: 1.5;
      border: 1px solid var(--color-gray-border, #E8E4DA); border-radius: var(--radius-sm, 8px);
      background: var(--card-bg, #fff); color: var(--text-soft, #3E3648);
    }
    .lbcimp-tip i { color: var(--color-gold-dark, #A17421); margin-top: 3px; }

    .lbcimp-loading {
      position: absolute; inset: 0; z-index: 5;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
      background: var(--card-bg, #fff); opacity: .94; font-size: 13px; color: var(--color-gray-text, #6A6377);
    }
    .lbcimp-spinner {
      width: 40px; height: 40px; border-radius: 50%;
      border: 4px solid var(--color-gray-border, #E8E4DA); border-top-color: var(--color-gold, #EAB52A);
      animation: lbcimpSpin .8s linear infinite;
    }
    @keyframes lbcimpSpin { to { transform: rotate(360deg); } }

    /* ---------- file bar (one slim line) ---------- */
    .lbcimp-filebar {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 9px 12px; margin-bottom: 12px; border-radius: var(--radius-sm, 8px);
      background: var(--color-gray-bg, #F6F4EF); border: 1px solid var(--color-gray-border, #E8E4DA);
    }
    .lbcimp-file-icon { font-size: 22px; color: #1d7a45; flex-shrink: 0; }
    .lbcimp-file { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .lbcimp-file strong { font-size: 13px; color: var(--color-black, #130D1D); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lbcimp-file small { font-size: 11.5px; color: var(--color-gray-text, #6A6377); }
    .lbcimp-mini-select {
      padding: 6px 8px; font-size: 12px; border-radius: 8px; cursor: pointer; max-width: 180px;
      border: 1px solid var(--color-gray-border, #E8E4DA); background: var(--card-bg, #fff); color: var(--color-black, #130D1D);
    }
    .lbcimp-link-btn {
      display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; cursor: pointer;
      border-radius: 999px; font-size: 12px; font-weight: 700;
      border: 1px solid var(--color-gray-border, #E8E4DA); background: var(--card-bg, #fff); color: var(--color-gold-dark, #A17421);
      transition: background .2s ease, color .2s ease;
    }
    .lbcimp-link-btn:hover { background: var(--tile-orange, #EAB52A); color: #fff; border-color: transparent; }

    /* ---------- column matching panel ---------- */
    .lbcimp-panel {
      border: 1px solid var(--color-gray-border, #E8E4DA); border-radius: var(--radius-md, 12px);
      background: var(--card-bg, #fff); margin-bottom: 12px; overflow: hidden;
    }
    .lbcimp-panel-head {
      width: 100%; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 10px 14px; background: transparent; border: none; cursor: pointer; text-align: left;
      color: var(--color-black, #130D1D);
    }
    .lbcimp-panel-head:hover { background: var(--row-hover, #FDF6E3); }
    .lbcimp-panel-title { font-size: 13px; font-weight: 700; margin-right: 4px; }
    .lbcimp-panel-title i { color: var(--color-gold-dark, #A17421); margin-right: 5px; }
    .lbcimp-chev { margin-left: auto; font-size: 12px; color: var(--color-gray-text, #6A6377); transition: transform .25s ease; }
    .lbcimp-panel.open .lbcimp-chev { transform: rotate(180deg); }
    .lbcimp-panel-body { display: none; border-top: 1px solid var(--color-gray-border, #E8E4DA); padding: 10px; }
    .lbcimp-panel.open .lbcimp-panel-body { display: block; }

    .lbcimp-pill {
      padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap;
    }
    .lbcimp-pill.ok  { background: rgba(62,142,79,.13); color: var(--color-success, #3E8E4F); }
    .lbcimp-pill.new { background: var(--color-black, #130D1D); color: var(--color-gold, #EAB52A); }
    .lbcimp-pill.off { background: var(--color-gray-bg, #F6F4EF); color: var(--color-gray-text, #6A6377); }

    .lbcimp-map-list {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 6px;
      max-height: 230px; overflow-y: auto; padding-right: 2px;
    }
    .lbcimp-map-row {
      display: grid; grid-template-columns: 24px minmax(0, 1fr) 16px minmax(0, 150px);
      align-items: center; gap: 8px; padding: 6px 8px;
      border: 1px solid var(--color-gray-border, #E8E4DA); border-radius: 8px;
      background: var(--card-bg, #fff);
    }
    .lbcimp-map-row.is-matched { box-shadow: inset 3px 0 0 var(--color-success, #3E8E4F); }
    .lbcimp-map-row.is-new { box-shadow: inset 3px 0 0 var(--color-gold, #EAB52A); background: var(--primary-soft, rgba(234,181,42,.13)); }
    .lbcimp-map-row.is-ignored { opacity: .65; }
    .lbcimp-col-letter {
      width: 24px; height: 24px; border-radius: 6px; font-size: 11px; font-weight: 800;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--color-black, #130D1D); color: var(--color-gold, #EAB52A);
    }
    .lbcimp-map-src { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
    .lbcimp-col-name { font-size: 12.5px; font-weight: 700; color: var(--color-black, #130D1D); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lbcimp-map-sample { font-size: 11px; color: var(--color-gray-text, #6A6377); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lbcimp-map-state { font-size: 13px; text-align: center; }
    .is-matched .lbcimp-map-state { color: var(--color-success, #3E8E4F); }
    .is-new .lbcimp-map-state { color: var(--color-gold-dark, #A17421); }
    .is-ignored .lbcimp-map-state { color: var(--color-gray-text, #6A6377); }
    .lbcimp-map-row select {
      width: 100%; padding: 6px 7px; font-size: 12px; cursor: pointer; border-radius: 7px;
      border: 1px solid var(--color-gray-border, #E8E4DA); background: var(--card-bg, #fff); color: var(--color-black, #130D1D);
    }
    .lbcimp-map-row select:focus { outline: none; border-color: var(--color-gold, #EAB52A); }

    /* ---------- new columns strip ---------- */
    .lbcimp-newcols {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      padding: 8px 12px; margin-bottom: 12px; border-radius: var(--radius-sm, 8px);
      background: var(--primary-soft, rgba(234,181,42,.13)); border: 1px dashed var(--color-gold, #EAB52A);
      font-size: 12px; color: var(--text-soft, #3E3648);
    }
    .lbcimp-newcols > i { color: var(--color-gold-dark, #A17421); }
    .lbcimp-newcols b { color: var(--color-black, #130D1D); }
    .lbcimp-newcol-chip {
      max-width: 160px; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      background: var(--card-bg, #fff); border: 1px solid var(--color-gold, #EAB52A); color: var(--color-gold-dark, #A17421);
    }

    /* ---------- summary + auto-fill switch ---------- */
    .lbcimp-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
    .lbcimp-summary { display: flex; flex-wrap: wrap; gap: 6px; }
    .lbcimp-chip {
      display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px;
      font-size: 11.5px; font-weight: 700; background: var(--color-gray-bg, #F6F4EF); color: var(--text-soft, #3E3648);
    }
    .lbcimp-chip.ready { background: rgba(62,142,79,.13); color: var(--color-success, #3E8E4F); }
    .lbcimp-chip.auto  { background: var(--primary-soft, rgba(234,181,42,.13)); color: var(--color-gold-dark, #A17421); }
    .lbcimp-chip.dup   { background: rgba(182,165,123,.22); color: #7A6A42; }
    .lbcimp-chip.bad   { background: rgba(217,83,79,.12); color: var(--color-danger, #D9534F); }

    .lbcimp-switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text-soft, #3E3648); user-select: none; }
    .lbcimp-switch input { display: none; }
    .lbcimp-switch-track {
      position: relative; width: 34px; height: 19px; border-radius: 999px; flex-shrink: 0;
      background: var(--color-gray-border, #E8E4DA); transition: background .2s ease;
    }
    .lbcimp-switch-track::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 3px rgba(19,13,29,.25); transition: transform .2s ease;
    }
    .lbcimp-switch input:checked + .lbcimp-switch-track { background: var(--color-gold, #EAB52A); }
    .lbcimp-switch input:checked + .lbcimp-switch-track::after { transform: translateX(15px); }

    .lbcimp-warn {
      padding: 8px 12px; margin-bottom: 10px; font-size: 12px; border-radius: 8px;
      background: rgba(217,83,79,.1); color: var(--color-danger, #D9534F);
    }
    .lbcimp-hint { font-size: 11.5px; color: var(--color-gray-text, #6A6377); margin-bottom: 8px; }

    /* ---------- preview table: compact + readable ---------- */
    .lbcimp-table-wrap {
      max-height: 340px; overflow: auto; border-radius: var(--radius-md, 12px);
      border: 1px solid var(--color-gray-border, #E8E4DA); background: var(--card-bg, #fff);
    }
    table.lbcimp-table {
      width: max-content; min-width: 100%;
      border-collapse: separate !important; border-spacing: 0 !important; margin: 0 !important;
    }
    .lbcimp-table thead { background: none !important; }
    .lbcimp-table thead th {
      position: sticky; top: 0; z-index: 2;
      background: var(--color-gray-bg, #F6F4EF) !important; color: var(--color-gray-text, #6A6377) !important;
      padding: 9px 10px !important; font-size: 10.5px !important; font-weight: 800;
      text-transform: uppercase; letter-spacing: .5px; white-space: nowrap;
      border-bottom: 1px solid var(--color-gray-border, #E8E4DA) !important; border-radius: 0 !important;
      max-width: 200px; overflow: hidden; text-overflow: ellipsis;
    }
    .lbcimp-th-tag {
      display: inline-block; margin-left: 5px; padding: 1px 6px; border-radius: 999px; vertical-align: 1px;
      font-size: 9px; font-weight: 800; letter-spacing: .3px;
      background: var(--color-gold, #EAB52A); color: var(--color-black, #130D1D);
    }
    .lbcimp-table tbody tr, .lbcimp-table tbody tr:hover { transform: none !important; box-shadow: none !important; }
    .lbcimp-table tbody td {
      padding: 7px 10px !important; font-size: 12.5px !important; line-height: 1.35;
      color: var(--color-black, #130D1D);
      background: var(--card-bg, #fff);
      border: none !important; border-bottom: 1px solid var(--color-gray-border, #E8E4DA) !important; border-radius: 0 !important;
      box-shadow: none !important;
      white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis;
    }
    .lbcimp-table tbody tr:hover td { background: var(--row-hover, #FDF6E3); }
    .lbcimp-table tbody tr:last-child td { border-bottom: none !important; }
    .lbcimp-table .lbcimp-td-check { width: 36px; text-align: center; }
    .lbcimp-table input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; accent-color: var(--color-gold, #EAB52A); }
    .lbcimp-rownum { color: var(--color-gray-text, #6A6377) !important; font-weight: 700; width: 44px; }
    .lbcimp-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px !important; }
    .lbcimp-table td.lbcimp-auto { background: var(--primary-soft, rgba(234,181,42,.13)) !important; font-style: italic; color: var(--color-gold-dark, #A17421); }
    .lbcimp-table td.lbcimp-td-new { background: rgba(182,165,123,.12); }
    .lbcimp-table .badge { font-size: 10.5px; padding: 3px 8px; }
    .lbcimp-row-duplicate td, .lbcimp-row-invalid td { opacity: .55; }
    .lbcimp-row-duplicate td.lbcimp-note, .lbcimp-row-invalid td.lbcimp-note { opacity: 1; }
    .lbcimp-note { max-width: 240px !important; font-size: 11.5px !important; color: var(--color-gray-text, #6A6377) !important; }
    .lbcimp-note span { margin-left: 4px; }

    .lbcimp-state {
      display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px;
      border-radius: 6px; font-size: 10.5px; font-weight: 800; white-space: nowrap; font-style: normal;
    }
    .lbcimp-state.ok   { background: rgba(62,142,79,.13); color: var(--color-success, #3E8E4F); }
    .lbcimp-state.auto { background: var(--primary-soft, rgba(234,181,42,.13)); color: var(--color-gold-dark, #A17421); }
    .lbcimp-state.dup  { background: rgba(182,165,123,.22); color: #7A6A42; }
    .lbcimp-state.bad  { background: rgba(217,83,79,.12); color: var(--color-danger, #D9534F); }

    .lbcimp-legend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px; font-size: 11px; color: var(--color-gray-text, #6A6377); }
    .lbcimp-legend span { display: inline-flex; align-items: center; gap: 5px; }
    .lbcimp-legend-dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .lbcimp-legend-dot.auto { background: var(--primary-soft-2, rgba(234,181,42,.24)); border: 1px solid var(--color-gold, #EAB52A); }
    .lbcimp-legend-dot.new { background: rgba(182,165,123,.25); border: 1px solid #B6A57B; }

    html[data-theme="dark"] .lbcimp-chip.dup,
    html[data-theme="dark"] .lbcimp-state.dup { color: #D8C99E; }

    /* ---------- mobile ---------- */
    @media (max-width: 700px) {
      .modal-box.lbcimp-modal { width: 100vw; max-width: 100vw; height: 94vh; max-height: 94vh; }
      .lbcimp-body { padding: 12px !important; }
      .lbcimp-map-list { grid-template-columns: 1fr; max-height: 260px; }
      .lbcimp-map-row { grid-template-columns: 24px minmax(0, 1fr) 16px minmax(0, 130px); }
      .lbcimp-toolbar { flex-direction: column; align-items: flex-start; }
      .lbcimp-table-wrap { max-height: 380px; }
    }
    @media (max-width: 600px) {
      .lbc-heading-actions { width: 100%; flex-direction: column; }
      .lbcimp-footer, .lbcimp-footer-right { flex-direction: column; width: 100%; }
      .lbcimp-footer .btn-outline, .lbcimp-footer .btn-primary { width: 100%; justify-content: center; }
      .lbcimp-filebar .lbcimp-mini-select { max-width: none; flex: 1; }
      .lbcimp-table tbody td { max-width: none; white-space: normal; }
    }
  `;
  document.head.appendChild(style);
}