/* ============================================================
   CASEFLOW — DOC-INTELLIGENCE.JS
   AI Document Intelligence for the Case Document Manager.

   WHAT IT DOES
   1. SCAN       – every uploaded file (image / PDF / scanned PDF)
                   is read with OCR. Blurry photos are enlarged,
                   grayscaled, contrast-stretched, and if still weak,
                   sharpened + thresholded and read AGAIN.
   2. UNDERSTAND – detects document type (Affidavit of Loss, SPA,
                   Deed of Sale...), dates written inside the file,
                   names ("I, JUAN DELA CRUZ,"), matching clients and
                   top keywords. Saved on the document record.
   3. SEARCH     – typo-tolerant search used by CaseFlow AI chat:
                   "hanapin affidavit of loss ni Santos March 2026".
                   Suggests corrections when something is misspelled.
   4. OPEN       – "View File" jumps to the Document Manager and
                   highlights the file.
   5. MOVEMENTS  – who uploaded / viewed / renamed / replaced /
                   downloaded / deleted a file, and what a user did.

   HONEST LIMITS
   - Local OCR (Tesseract.js) + rules + fuzzy matching. Not a cloud LLM.
   - Scanning runs only on pages that load Tesseract.js (Dashboard).
     Searching works on every page (index lives in LocalStorage).
   - Extremely blurry files may give little/no text. They stay
     searchable by filename, case and client, marked "Low confidence".

   Depends on: storage.js, modal.js (showToast)
   Optional:   auth.js, navigation.js, documents.js, ai-assistant.js,
               Tesseract.js, pdf.js
   ============================================================ */

/* ---------- CONFIG ---------- */
const DOC_AI_CONFIG = {
  MAX_TEXT_LENGTH: 4000,     // chars of OCR text kept per file (LocalStorage is small)
  MAX_PDF_PAGES: 3,          // pages read per PDF
  TARGET_OCR_WIDTH: 2000,    // small/blurry images are upscaled to about this width
  LOW_CONFIDENCE: 65,        // below this, a 2nd sharpen+threshold OCR pass runs
  MIN_RESULT_SCORE: 25,      // minimum score for "closest match" results
  MAX_RESULTS: 5,            // cards shown in the chat
  HIGHLIGHT_MS: 8000         // how long the row stays highlighted
};

/* ---------- DOCUMENT TYPES ----------
   phrases: words that identify the type (fuzzy matched)
   family:  generic type — also matches its specific versions
   titleOnly: only trusted if found near the top/title of the file */
const DOC_AI_TYPES = [
  { type: 'Affidavit of Loss', phrases: ['affidavit of loss', 'aol'] },
  { type: 'Affidavit of Desistance', phrases: ['affidavit of desistance'] },
  { type: 'Affidavit of Support', phrases: ['affidavit of support'] },
  { type: 'Affidavit of Undertaking', phrases: ['affidavit of undertaking'] },
  { type: 'Joint Affidavit', phrases: ['joint affidavit'] },
  { type: 'Affidavit', phrases: ['affidavit', 'sworn statement', 'sinumpaang salaysay', 'salaysay'], family: true },
  { type: 'Deed of Absolute Sale', phrases: ['deed of absolute sale', 'doas'] },
  { type: 'Deed of Donation', phrases: ['deed of donation'] },
  { type: 'Deed of Sale', phrases: ['deed of sale'], family: true },
  { type: 'Special Power of Attorney', phrases: ['special power of attorney', 'spa'] },
  { type: 'General Power of Attorney', phrases: ['general power of attorney', 'gpa'] },
  { type: 'Contract of Lease', phrases: ['contract of lease', 'lease contract', 'lease agreement'] },
  { type: 'Memorandum of Agreement', phrases: ['memorandum of agreement', 'moa'] },
  { type: 'Contract', phrases: ['contract', 'agreement', 'kasunduan'], family: true, titleOnly: true },
  { type: 'Demand Letter', phrases: ['demand letter', 'final demand'] },
  { type: 'Notice of Hearing', phrases: ['notice of hearing'] },
  { type: 'Complaint', phrases: ['complaint', 'reklamo'], titleOnly: true },
  { type: 'Petition', phrases: ['petition'], titleOnly: true },
  { type: 'Motion', phrases: ['motion'], titleOnly: true },
  { type: 'Summons', phrases: ['summons'] },
  { type: 'Subpoena', phrases: ['subpoena'] },
  { type: 'Court Order', phrases: ['court order', 'order'], titleOnly: true },
  { type: 'Decision', phrases: ['decision'], titleOnly: true },
  { type: 'Resolution', phrases: ['resolution'], titleOnly: true },
  { type: 'Birth Certificate', phrases: ['certificate of live birth', 'birth certificate'] },
  { type: 'Marriage Certificate', phrases: ['certificate of marriage', 'marriage certificate', 'marriage contract'] },
  { type: 'Death Certificate', phrases: ['certificate of death', 'death certificate'] },
  { type: 'Land Title', phrases: ['transfer certificate of title', 'original certificate of title', 'land title', 'tct'] },
  { type: 'Tax Declaration', phrases: ['tax declaration'] },
  { type: 'Valid ID', phrases: ['identification card', 'drivers license', 'driver license', 'passport', 'philsys', 'national id', 'umid', 'postal id', 'valid id'] },
  { type: 'Official Receipt', phrases: ['official receipt', 'receipt', 'resibo'] },
  { type: 'Invoice', phrases: ['invoice', 'billing statement', 'statement of account'] },
  { type: 'Letter', phrases: ['to whom it may concern', 'dear sir', 'dear madam', 'letter', 'sulat'], titleOnly: true },
  { type: 'Evidence', phrases: ['exhibit', 'annex', 'evidence', 'ebidensya'], titleOnly: true }
];

/* ---------- MONTHS (English + Tagalog) ---------- */
const DOC_AI_MONTHS = {
  january: 1, jan: 1, enero: 1,
  february: 2, feb: 2, pebrero: 2,
  march: 3, mar: 3, marso: 3,
  april: 4, apr: 4, abril: 4,
  may: 5, mayo: 5,
  june: 6, jun: 6, hunyo: 6,
  july: 7, jul: 7, hulyo: 7,
  august: 8, aug: 8, agosto: 8,
  september: 9, sep: 9, sept: 9, setyembre: 9,
  october: 10, oct: 10, oktubre: 10,
  november: 11, nov: 11, nobyembre: 11,
  december: 12, dec: 12, disyembre: 12
};
const DOC_AI_MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

/* ---------- QUERY FILLER WORDS (ignored when searching) ---------- */
const DOC_AI_FILLERS = new Set([
  'hanapin', 'hanap', 'hanapan', 'pakihanap', 'paki', 'mo', 'nga', 'naman', 'yung', 'yong', 'ung', 'ang',
  'ng', 'nang', 'ni', 'si', 'kay', 'kina', 'nina', 'sa', 'na', 'po', 'pls', 'please', 'pakita', 'ipakita',
  'pakitingnan', 'show', 'find', 'search', 'look', 'for', 'me', 'the', 'a', 'an', 'of', 'file', 'files',
  'document', 'documents', 'doc', 'docs', 'dokumento', 'papel', 'copy', 'kopya', 'meron', 'mayroon', 'ba',
  'bang', 'kung', 'dated', 'date', 'petsa', 'noong', 'nung', 'on', 'at', 'in', 'with', 'yan', 'iyan', 'yun',
  'iyon', 'ito', 'may', 'lahat', 'all', 'list', 'mga', 'and', 'or', 'o', 'pa', 'din', 'rin', 'open', 'buksan',
  'view', 'tingnan', 'check', 'i', 'want', 'need', 'kailangan', 'gusto', 'ko', 'namin', 'natin', 'client',
  'kliyente', 'ano', 'what', 'where', 'saan', 'nasaan', 'asan', 'naka', 'upload', 'uploads', 'uploaded',
  'scan', 'scanned', 'folder', 'directory', 'location', 'anong', 'which', 'ilan', 'ilang', 'how', 'many',
  'count', 'bilang', 'is', 'are', 'there', 'any', 'it', 'nag', 'inupload', 'delete', 'deleted', 'binura',
  'dinelete', 'tinanggal', 'rename', 'renamed', 'replace', 'replaced', 'pinalitan', 'download', 'downloaded',
  'dinownload', 'viewed', 'tiningnan', 'binuksan', 'sino', 'who', 'history', 'galaw', 'movement', 'movements',
  'activity', 'activities', 'ginawa', 'nangyari', 'log', 'logs', 'kailan', 'when', 'latest', 'recent', 'bago',
  'newest', 'huling', 'attachment', 'nyan', 'niyan', 'non', 'nun', 'dun', 'doon', 'nito', 'that', 'this',
  'type', 'uri', 'klase', 'ai', 'caseflow'
]);

/* ---------- MOVEMENT VOCABULARY ---------- */
const DOC_AI_ACTIONS = {
  upload: ['upload', 'uploaded', 'nag upload', 'nagupload', 'inupload', 'in upload'],
  delete: ['delete', 'deleted', 'nag delete', 'binura', 'nagbura', 'tinanggal', 'dinelete'],
  rename: ['rename', 'renamed', 'nag rename', 'pinalitan ng pangalan', 'pinalitan pangalan'],
  replace: ['replace', 'replaced', 'nag replace', 'pinalitan'],
  download: ['download', 'downloaded', 'nag download', 'dinownload'],
  view: ['view', 'viewed', 'nag view', 'tiningnan', 'binuksan', 'nag open', 'opened'],
  'ai-scan': ['nascan', 'na scan', 'iniscan', 'scanned']
};
const DOC_AI_ACTION_LABELS = {
  upload: 'UPLOADED', delete: 'DELETED', rename: 'RENAMED', replace: 'REPLACED',
  download: 'DOWNLOADED', view: 'VIEWED', 'ai-scan': 'AI SCANNED', 'ai-open': 'OPENED VIA AI',
  'auto-route': 'AUTO-ROUTED'
};
const DOC_AI_ACTION_VERBS = {
  upload: 'nag-upload', delete: 'nag-delete', rename: 'nag-rename', replace: 'nag-replace',
  download: 'nag-download', view: 'huling nag-view', 'ai-scan': 'nag-scan', 'auto-route': 'nag-auto-route'
};
const DOC_AI_MOVE_TRIGGERS = ['sino', 'who', 'history', 'galaw', 'movement', 'movements', 'activity',
  'activities', 'ginawa', 'nangyari', 'logs', 'log', 'audit', 'trail', 'kailan', 'when'];
const DOC_AI_DOC_WORDS = ['file', 'files', 'document', 'documents', 'doc', 'docs', 'dokumento', 'papel',
  'kopya', 'attachment', 'upload', 'uploads', 'uploaded', 'scan', 'scanned', 'folder'];

const DOC_AI_STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'been', 'was', 'were', 'are', 'not',
  'but', 'all', 'any', 'per', 'said', 'shall', 'will', 'which', 'whom', 'who', 'their', 'there', 'herein',
  'hereby', 'thereof', 'under', 'upon', 'into', 'also', 'such', 'other', 'these', 'those', 'being', 'before',
  'after', 'city', 'republic', 'philippines', 'day', 'year', 'ang', 'mga', 'ako', 'para', 'kay', 'nang',
  'siya', 'niya', 'ito', 'iyon', 'sila', 'kami', 'namin', 'your', 'you', 'our', 'his', 'her', 'its', 'they',
  'them', 'then', 'than', 'did', 'does', 'had', 'being', 'hereto', 'whereof', 'witness'
]);

/* ---------- STATE ---------- */
const docAiContext = { lastResults: [], lastQuery: '' };
let _docAiQueue = [];
let _docAiRunning = false;
let _docAiWorker = null;
let _docAiHighlightId = null;
let _docAiHighlightUntil = 0;

/* ============================================================
   TEXT HELPERS
   ============================================================ */
function docAiEsc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function docAiNormalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Also fixes common OCR mistakes inside words: aff1davit -> affidavit, l0ss -> loss
function docAiClean(s) {
  let t = String(s || '').toLowerCase();
  t = t.replace(/([a-z])[|!1](?=[a-z])/g, '$1i')
       .replace(/([a-z])0(?=[a-z])/g, '$1o')
       .replace(/([a-z])5(?=[a-z])/g, '$1s');
  return docAiNormalize(t);
}

function docAiWords(s) {
  const c = docAiClean(s);
  return c ? c.split(' ') : [];
}

function docAiHas(q, list) {
  return list.some(w => (` ${q} `).includes(` ${w} `));
}

function docAiLev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function docAiSim(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - docAiLev(a, b) / Math.max(a.length, b.length);
}

/**
 * Best fuzzy match of `phrase` inside `words`.
 * Tries windows of n-1, n, n+1 words so "affidavit loss" still
 * matches "affidavit of loss", and "aff idavit" matches "affidavit".
 * consumed: optional Set of word indexes to skip.
 */
function docAiPhraseScore(words, phrase, consumed) {
  const target = String(phrase || '');
  const n = target.split(' ').length;
  let best = { score: 0, index: -1, len: 0 };
  if (!words || !words.length || !target) return best;

  for (let len = Math.max(1, n - 1); len <= n + 1; len++) {
    for (let i = 0; i + len <= words.length; i++) {
      if (consumed && consumed.size) {
        let skip = false;
        for (let k = i; k < i + len; k++) if (consumed.has(k)) { skip = true; break; }
        if (skip) continue;
      }
      const win = words.slice(i, i + len).join(' ');
      if (Math.abs(win.length - target.length) > Math.max(2, target.length * 0.4)) continue;
      const s = docAiSim(win, target);
      if (s > best.score) {
        best = { score: s, index: i, len };
        if (s === 1) return best;
      }
    }
  }
  return best;
}

function docAiPad(n) { return String(n).padStart(2, '0'); }

function docAiLocalIso(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return `${d.getFullYear()}-${docAiPad(d.getMonth() + 1)}-${docAiPad(d.getDate())}`;
}

function docAiValidIso(y, m, d) {
  y = +y; m = +m; d = +d;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return docAiLocalIso(dt);
}

function docAiFmtDay(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function docAiTitle(s) {
  return String(s || '').toLowerCase().replace(/\b[a-zñ]/g, c => c.toUpperCase()).trim();
}

function docAiIcon(fileType) {
  const t = fileType || '';
  if (t.includes('pdf')) return 'fa-file-pdf';
  if (t.includes('image')) return 'fa-file-image';
  if (t.includes('word') || t.includes('document')) return 'fa-file-word';
  if (t.includes('sheet') || t.includes('excel')) return 'fa-file-excel';
  return 'fa-file';
}

/* ============================================================
   EXTRACTION (type, dates, names, clients, keywords)
   ============================================================ */
function docAiDetectType(text, fileName) {
  const titleWords = docAiWords(String(text || '').slice(0, 500));
  const bodyWords = docAiWords(text);
  const nameWords = docAiWords(String(fileName || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_\-]+/g, ' '));
  let best = { type: 'Other', score: 0 };

  DOC_AI_TYPES.forEach(t => {
    t.phrases.forEach(p => {
      const n = p.split(' ').length;
      const isAbbr = p.replace(/ /g, '').length <= 4;
      let s = 0;

      if (isAbbr) {
        // abbreviations (spa, aol, tct) trusted only in the filename, exact
        if (docAiPhraseScore(nameWords, p).score === 1) s = 55 + 30 + n * 3;
      } else {
        const minSim = n === 1 ? 0.85 : 0.8;
        const inTitle = docAiPhraseScore(titleWords, p).score;
        const inName = docAiPhraseScore(nameWords, p).score;
        const inBody = t.titleOnly ? 0 : docAiPhraseScore(bodyWords, p).score;
        if (inTitle >= minSim) s = Math.max(s, 60 + inTitle * 30 + n * 3);
        if (inName >= minSim) s = Math.max(s, 55 + inName * 30 + n * 3);
        if (inBody >= minSim) s = Math.max(s, 30 + inBody * 30 + n * 3);
      }
      if (s > best.score) best = { type: t.type, score: s };
    });
  });
  return best;
}

function docAiTypeMatches(docType, wanted) {
  if (!docType || !wanted) return false;
  if (docType === wanted) return true;
  const def = DOC_AI_TYPES.find(t => t.type === wanted);
  if (!def || !def.family) return false;
  const root = wanted.toLowerCase().split(' ')[0];
  return docType.toLowerCase().includes(root);
}

function docAiExtractDates(rawText) {
  const out = new Set();
  const raw = String(rawText || '');
  const add = (y, m, d) => { const iso = docAiValidIso(y, m, d); if (iso) out.add(iso); };

  for (const m of raw.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) add(m[1], m[2], m[3]);
  for (const m of raw.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/g)) add(m[3], m[1], m[2]);

  const t = docAiClean(raw);
  const alt = Object.keys(DOC_AI_MONTHS).sort((a, b) => b.length - a.length).join('|');
  const reA = new RegExp(`\\b(${alt})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(\\d{4})\\b`, 'g');
  const reB = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:day\\s+of\\s+)?(${alt})\\s+(\\d{4})\\b`, 'g');
  for (const m of t.matchAll(reA)) add(m[3], DOC_AI_MONTHS[m[1]], m[2]);
  for (const m of t.matchAll(reB)) add(m[3], DOC_AI_MONTHS[m[2]], m[1]);

  return [...out].slice(0, 10);
}

function docAiExtractPersons(rawText) {
  const raw = String(rawText || '');
  const out = [];
  const name = '([A-ZÑ][A-Za-zÑñ.\\-]+(?:\\s+[A-ZÑ][A-Za-zÑñ.\\-]+){1,4})';
  const patterns = [
    new RegExp(`\\bI,\\s*${name}\\s*,`, 'g'),
    new RegExp(`\\bAKO,\\s*${name}\\s*,`, 'g'),
    new RegExp(`\\b(?:AFFIANT|Affiant|NAME|Name|PANGALAN|Pangalan|COMPLAINANT|Complainant|PETITIONER|Petitioner|RESPONDENT|Respondent|PLAINTIFF|Plaintiff|DEFENDANT|Defendant)\\s*[:\\-]\\s*${name}`, 'g')
  ];
  patterns.forEach(re => {
    for (const m of raw.matchAll(re)) {
      const p = docAiTitle(m[1].replace(/\s+/g, ' '));
      if (p.length >= 5 && !out.includes(p)) out.push(p);
    }
  });
  return out.slice(0, 5);
}

function docAiFindClientsInText(text, clients) {
  const words = docAiWords(text);
  if (!words.length) return [];
  return (clients || getClients()).filter(c => {
    const full = docAiNormalize(c.name);
    if (!full) return false;
    if (docAiPhraseScore(words, full).score >= 0.82) return true;
    const toks = full.split(' ').filter(t => t.length >= 3);
    if (toks.length < 2) return false;
    const hits = toks.filter(t => docAiPhraseScore(words, t).score >= 0.85).length;
    return hits >= 2 && hits / toks.length >= 0.66;
  }).map(c => c.id);
}

function docAiTopKeywords(text) {
  const counts = {};
  docAiWords(text).forEach(w => {
    if (w.length < 4 || /^\d+$/.test(w) || DOC_AI_STOPWORDS.has(w)) return;
    counts[w] = (counts[w] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(e => e[0]);
}

/* ============================================================
   SAVE ANALYSIS ON THE DOCUMENT RECORD
   ============================================================ */
function docAiUpdateDoc(docId, patch) {
  const docs = getDocuments();
  const idx = docs.findIndex(d => d.id === docId);
  if (idx === -1) return false;
  Object.assign(docs[idx], patch);
  let ok = saveDocuments(docs);
  if (!ok && patch.aiText) {
    // Storage almost full — keep a shorter text so the file is still searchable
    docs[idx].aiText = String(patch.aiText).slice(0, 800);
    ok = saveDocuments(docs);
  }
  return ok;
}

/**
 * Public: stores the AI reading of a document.
 * Also used by smart-routing.js (it already has the OCR text).
 * method: 'pdf-text' | 'pdf-ocr' | 'ocr' | 'filename-only'
 */
function docAiSaveAnalysis(docId, text, confidence = 0, method = 'ocr') {
  const doc = findDocumentById(docId);
  if (!doc) return null;

  const clean = String(text || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  const typeInfo = docAiDetectType(clean, doc.fileName);
  const dates = docAiExtractDates(clean);
  const persons = docAiExtractPersons(clean);
  const clientIds = docAiFindClientsInText(clean);
  const keywords = docAiTopKeywords(clean);

  let quality = 'none';
  if (method !== 'filename-only') {
    if (clean.replace(/\s/g, '').length < 20) quality = 'low';
    else quality = confidence >= 80 ? 'high' : (confidence >= DOC_AI_CONFIG.LOW_CONFIDENCE ? 'medium' : 'low');
  }

  docAiUpdateDoc(docId, {
    aiStatus: 'done',
    aiText: clean.slice(0, DOC_AI_CONFIG.MAX_TEXT_LENGTH),
    aiDocType: typeInfo.type,
    aiTypeScore: Math.round(typeInfo.score),
    aiDates: dates,
    aiPersons: persons,
    aiClientIds: clientIds,
    aiKeywords: keywords,
    aiConfidence: Math.round(confidence || 0),
    aiQuality: quality,
    aiMethod: method,
    aiIndexedAt: nowISO(),
    aiError: null
  });

  const updated = findDocumentById(docId);
  if (updated && typeof logDocMovement === 'function') {
    logDocMovement('ai-scan', updated, {
      details: `Detected: ${typeInfo.type}${dates[0] ? `, date ${dates[0]}` : ''} (${quality} quality)`
    });
  }
  return updated;
}

/* ============================================================
   OCR ENGINE (with blurry-image preprocessing)
   ============================================================ */
function docAiCanScan() {
  return typeof Tesseract !== 'undefined';
}

async function docAiGetWorker() {
  if (_docAiWorker) return _docAiWorker;
  _docAiWorker = await Tesseract.createWorker('eng');
  return _docAiWorker;
}

function docAiOtsu(arr) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < arr.length; i++) hist[arr[i]]++;
  const total = arr.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, max = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; threshold = t; }
  }
  return threshold;
}

/**
 * mode 'gray'  : upscale + grayscale + contrast stretch
 * mode 'sharp' : same + sharpen + black/white threshold (for blurry photos)
 */
function docAiPreprocess(src, mode = 'gray') {
  let scale = 1;
  if (src.width < DOC_AI_CONFIG.TARGET_OCR_WIDTH) scale = Math.min(3, DOC_AI_CONFIG.TARGET_OCR_WIDTH / src.width);
  if (src.width * scale > 3500) scale = 3500 / src.width;

  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }

  // contrast stretch (ignore darkest/lightest 2%)
  const hist = new Array(256).fill(0);
  for (let j = 0; j < gray.length; j++) hist[gray[j]]++;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= gray.length * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= gray.length * 0.02) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let j = 0; j < gray.length; j++) gray[j] = ((gray[j] - lo) * 255) / range;

  let out = gray;
  if (mode === 'sharp') {
    out = new Uint8ClampedArray(gray.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { out[i] = gray[i]; continue; }
        out[i] = 5 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      }
    }
    const t = docAiOtsu(out);
    for (let j = 0; j < out.length; j++) out[j] = out[j] > t ? 255 : 0;
  }

  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    d[i] = d[i + 1] = d[i + 2] = out[j];
    d[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return c;
}

async function docAiOcrSmart(canvas) {
  const worker = await docAiGetWorker();
  const pass1 = await worker.recognize(docAiPreprocess(canvas, 'gray'));
  let best = { text: pass1.data.text || '', confidence: pass1.data.confidence || 0 };

  if (best.confidence < DOC_AI_CONFIG.LOW_CONFIDENCE) {
    const pass2 = await worker.recognize(docAiPreprocess(canvas, 'sharp'));
    const second = { text: pass2.data.text || '', confidence: pass2.data.confidence || 0 };
    // blurry file: keep BOTH readings so search has more chances to hit
    best = second.confidence > best.confidence
      ? { text: `${second.text}\n${best.text}`, confidence: second.confidence }
      : { text: `${best.text}\n${second.text}`, confidence: best.confidence };
  }
  return best;
}

function docAiLoadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image could not be loaded.'));
    img.src = src;
  });
}

function docAiImageToCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

function docAiDataUrlToBytes(dataUrl) {
  const b64 = String(dataUrl || '').split(',')[1] || '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function docAiReadPdf(dataUrl) {
  if (typeof pdfjsLib === 'undefined') return { text: '', confidence: 0, method: 'filename-only' };

  const pdf = await pdfjsLib.getDocument({ data: docAiDataUrlToBytes(dataUrl) }).promise;
  const pages = Math.min(pdf.numPages, DOC_AI_CONFIG.MAX_PDF_PAGES);

  let text = '';
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map(i => i.str).join(' ') + '\n';
  }
  if (text.replace(/\s/g, '').length > 40) return { text, confidence: 100, method: 'pdf-text' };

  // scanned PDF (no text layer) -> render each page and OCR it
  let ocrText = '', confSum = 0;
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const r = await docAiOcrSmart(canvas);
    ocrText += r.text + '\n';
    confSum += r.confidence;
  }
  return { text: ocrText, confidence: confSum / pages, method: 'pdf-ocr' };
}

async function docAiIndexDocument(docId) {
  const doc = findDocumentById(docId);
  if (!doc) return;

  docAiUpdateDoc(docId, { aiStatus: 'scanning' });
  window.dispatchEvent(new CustomEvent('docai:updated', { detail: { docId } }));

  const type = doc.fileType || '';
  let result = { text: '', confidence: 0, method: 'filename-only' };

  if (type.includes('pdf')) {
    result = await docAiReadPdf(doc.dataUrl);
  } else if (type.startsWith('image/')) {
    const img = await docAiLoadImage(doc.dataUrl);
    const r = await docAiOcrSmart(docAiImageToCanvas(img));
    result = { text: r.text, confidence: r.confidence, method: 'ocr' };
  }

  docAiSaveAnalysis(docId, result.text, result.confidence, result.method);
}

/* ---------- SCAN QUEUE (one file at a time, in the background) ---------- */
function docAiQueueScan(docId) {
  if (!docId) return;
  const doc = findDocumentById(docId);
  if (!doc) return;
  if (!_docAiQueue.includes(docId)) _docAiQueue.push(docId);
  if (doc.aiStatus !== 'scanning') docAiUpdateDoc(docId, { aiStatus: 'queued' });
  window.dispatchEvent(new CustomEvent('docai:updated', { detail: { docId } }));
  docAiRunQueue();
}

function docAiRescan(docId) {
  docAiUpdateDoc(docId, { aiStatus: 'queued' });
  docAiQueueScan(docId);
}

async function docAiRunQueue() {
  if (_docAiRunning || !docAiCanScan()) return;
  _docAiRunning = true;
  try {
    while (_docAiQueue.length) {
      const id = _docAiQueue.shift();
      try {
        await docAiIndexDocument(id);
      } catch (err) {
        console.error('[doc-intelligence.js] Scan failed:', id, err);
        docAiUpdateDoc(id, { aiStatus: 'failed', aiError: String((err && err.message) || err) });
      }
      window.dispatchEvent(new CustomEvent('docai:updated', { detail: { docId: id } }));
    }
  } finally {
    _docAiRunning = false;
    if (_docAiWorker) {
      try { await _docAiWorker.terminate(); } catch (e) { /* ignore */ }
      _docAiWorker = null;
    }
  }
}

function docAiScanAllPending() {
  if (!docAiCanScan()) return;
  getDocuments()
    .filter(d => !d.aiStatus || d.aiStatus === 'queued' || d.aiStatus === 'scanning')
    .forEach(d => docAiQueueScan(d.id));
}

/* ---------- STATUS BADGE (used by documents.js table) ---------- */
function docAiStatusBadge(doc) {
  if (!doc) return '';
  const s = doc.aiStatus;
  if (s === 'done') {
    const q = doc.aiQuality || 'medium';
    let html = `<span class="docai-badge docai-q-${q}" title="AI detected type (${docAiEsc(q)} quality)">${docAiEsc(doc.aiDocType || 'Other')}</span>`;
    if (q === 'low') html += ` <span class="docai-badge docai-q-low" title="Blurry / hard to read">Low confidence</span>`;
    if (q === 'none') html += ` <span class="docai-badge docai-pending" title="Not an image/PDF — detected from filename">Filename only</span>`;
    return html;
  }
  if (s === 'scanning') return `<span class="docai-badge docai-scanning"><i class="fa-solid fa-spinner fa-spin"></i> Scanning…</span>`;
  if (s === 'failed') return `<span class="docai-badge docai-failed" title="${docAiEsc(doc.aiError || '')}">Scan failed</span>`;
  return `<span class="docai-badge docai-pending">Pending scan</span>`;
}

/* ============================================================
   QUERY UNDERSTANDING
   ============================================================ */
function docAiMonthFromWord(w, prev, next) {
  if (!w || /\d/.test(w)) return null;
  const numAdj = /^\d/.test(prev || '') || /^\d/.test(next || '');
  if (w.length <= 3) {
    // "may", "mar", "jan"... only a month if a number is next to it
    return (DOC_AI_MONTHS[w] && numAdj) ? { month: DOC_AI_MONTHS[w], exact: true } : null;
  }
  if (DOC_AI_MONTHS[w]) return { month: DOC_AI_MONTHS[w], exact: true };

  let best = null, bs = 0;
  Object.entries(DOC_AI_MONTHS).forEach(([name, num]) => {
    if (name.length < 5) return;
    const s = docAiSim(w, name);
    if (s > bs) { bs = s; best = num; }
  });
  if (bs >= 0.85 || (bs >= 0.75 && numAdj)) return { month: best, exact: false };
  return null;
}

function docAiFindSeq(words, seq) {
  for (let i = 0; i + seq.length <= words.length; i++) {
    if (seq.every((s, k) => words[i + k] === s)) return i;
  }
  return -1;
}

function docAiParseQueryDate(words) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const iso = d => docAiLocalIso(d);
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const joined = words.join(' ');

  const rel = [
    { re: /\b(today|ngayong araw|ngayon)\b/, fn: () => ({ from: iso(today), to: iso(today), label: 'Today' }) },
    { re: /\b(kahapon|yesterday)\b/, fn: () => { const y = addDays(today, -1); return { from: iso(y), to: iso(y), label: 'Yesterday' }; } },
    { re: /\b(this week|ngayong linggo|ngayong week)\b/, fn: () => ({ from: iso(monday), to: iso(today), label: 'This week' }) },
    { re: /\b(last week|nakaraang linggo|noong isang linggo|nakaraang week)\b/, fn: () => { const s = addDays(monday, -7); return { from: iso(s), to: iso(addDays(s, 6)), label: 'Last week' }; } },
    { re: /\b(this month|ngayong buwan)\b/, fn: () => ({ from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today), label: 'This month' }) },
    { re: /\b(last month|nakaraang buwan|noong isang buwan)\b/, fn: () => ({ from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: iso(new Date(today.getFullYear(), today.getMonth(), 0)), label: 'Last month' }) }
  ];
  for (const r of rel) {
    const m = joined.match(r.re);
    if (m) {
      const seq = m[1].split(' ');
      const idx = docAiFindSeq(words, seq);
      return { ...r.fn(), indexes: idx >= 0 ? seq.map((_, k) => idx + k) : [] };
    }
  }

  const isDay = w => /^\d{1,2}(st|nd|rd|th)?$/.test(w || '') && parseInt(w, 10) >= 1 && parseInt(w, 10) <= 31;
  const isYear = w => /^(19|20)\d{2}$/.test(w || '');

  for (let i = 0; i < words.length; i++) {
    const mo = docAiMonthFromWord(words[i], words[i - 1], words[i + 1]);
    if (!mo) continue;

    const idx = [i];
    let day = null, year = null;
    if (isDay(words[i + 1])) {
      day = parseInt(words[i + 1], 10); idx.push(i + 1);
      if (isYear(words[i + 2])) { year = +words[i + 2]; idx.push(i + 2); }
    } else if (isYear(words[i + 1])) {
      year = +words[i + 1]; idx.push(i + 1);
    }
    if (day === null && isDay(words[i - 1])) { day = parseInt(words[i - 1], 10); idx.push(i - 1); }
    if (!year) year = today.getFullYear();

    const note = mo.exact ? null
      : `Na-correct ko ang "<b>${docAiEsc(words[i])}</b>" → "<b>${docAiTitle(DOC_AI_MONTH_NAMES[mo.month - 1])}</b>".`;

    if (day) {
      const one = docAiValidIso(year, mo.month, day);
      if (one) return { from: one, to: one, label: docAiFmtDay(one), indexes: idx, note };
    }
    const s = new Date(year, mo.month - 1, 1), e = new Date(year, mo.month, 0);
    return { from: iso(s), to: iso(e), label: `${docAiTitle(DOC_AI_MONTH_NAMES[mo.month - 1])} ${year}`, indexes: idx, note };
  }

  // year alone — only when clearly used as a date ("noong 2025", "year 2025")
  for (let i = 1; i < words.length; i++) {
    if (isYear(words[i]) && ['noong', 'nung', 'year', 'taon', 'in', 'nitong'].includes(words[i - 1])) {
      const y = +words[i];
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Year ${y}`, indexes: [i - 1, i] };
    }
  }
  return null;
}

function docAiGetPeopleCandidates(docs, clients) {
  const list = (clients || getClients()).map(c => ({ kind: 'client', id: c.id, name: c.name }));
  const seen = new Set(list.map(x => docAiNormalize(x.name)));
  (docs || getDocuments()).forEach(d => (d.aiPersons || []).forEach(p => {
    const k = docAiNormalize(p);
    if (k && !seen.has(k)) { seen.add(k); list.push({ kind: 'person', id: null, name: p }); }
  }));
  return list.filter(x => x.name);
}

function docAiParseQuery(rawQuery, docs, clients) {
  let raw = String(rawQuery || '');
  // turn 3/5/2026 or 2026-03-05 into "march 5 2026" so one parser handles all
  raw = raw
    .replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m, y, mo, d) => DOC_AI_MONTH_NAMES[+mo - 1] ? `${DOC_AI_MONTH_NAMES[+mo - 1]} ${+d} ${y}` : m)
    .replace(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/g, (m, mo, d, y) => DOC_AI_MONTH_NAMES[+mo - 1] ? `${DOC_AI_MONTH_NAMES[+mo - 1]} ${+d} ${y}` : m);

  const q = docAiClean(raw);
  const words = q ? q.split(' ') : [];
  const consumed = new Set();
  const notes = [];

  // 1) DATE
  const date = docAiParseQueryDate(words);
  if (date) {
    date.indexes.forEach(i => consumed.add(i));
    if (date.note) notes.push(date.note);
  }

  // 2) DOCUMENT TYPE (typo tolerant)
  let type = null;
  let best = { rank: 0 };
  DOC_AI_TYPES.forEach(t => t.phrases.forEach(p => {
    const n = p.split(' ').length;
    const min = p.replace(/ /g, '').length <= 4 ? 1 : (n === 1 ? 0.8 : 0.75);
    const r = docAiPhraseScore(words, p, consumed);
    if (r.score >= min) {
      const rank = r.score + n * 0.05;
      if (rank > best.rank) best = { ...r, rank, type: t.type };
    }
  }));
  if (best.type) {
    type = best.type;
    for (let k = best.index; k < best.index + best.len; k++) consumed.add(k);
    const typed = words.slice(best.index, best.index + best.len).join(' ');
    if (best.score < 1) notes.push(`Na-correct ko ang "<b>${docAiEsc(typed)}</b>" → "<b>${docAiEsc(type)}</b>".`);
  }

  // 3) PERSON / CLIENT (typo tolerant)
  const freeWords = [];
  words.forEach((w, i) => {
    if (!consumed.has(i) && !DOC_AI_FILLERS.has(w) && w.length >= 2) freeWords.push(w);
  });

  let persons = [];
  const usedFree = new Set();
  if (freeWords.length) {
    const scored = [];
    docAiGetPeopleCandidates(docs, clients).forEach(c => {
      const full = docAiNormalize(c.name);
      if (!full) return;
      let hit = docAiPhraseScore(freeWords, full);
      full.split(' ').filter(t => t.length >= 3).forEach(tok => {
        const r = docAiPhraseScore(freeWords, tok);
        if (r.score * 0.96 > hit.score) hit = { ...r, score: r.score * 0.96 };
      });
      if (hit.score >= 0.78) scored.push({ c, hit });
    });

    if (scored.length) {
      scored.sort((a, b) => b.hit.score - a.hit.score);
      const top = scored[0].hit.score;
      persons = scored
        .filter(x => x.hit.score >= top - 0.02)
        .slice(0, 5)
        .map(x => ({ kind: x.c.kind, id: x.c.id, name: x.c.name, score: x.hit.score }));

      const h = scored[0].hit;
      for (let k = h.index; k < h.index + h.len; k++) usedFree.add(k);
      const typed = freeWords.slice(h.index, h.index + h.len).join(' ');
      if (top < 0.95) notes.push(`Walang eksaktong "<b>${docAiEsc(typed)}</b>" — ang pinakamalapit ay <b>${docAiEsc(persons[0].name)}</b>.`);
      if (persons.length > 1) notes.push(`May ${persons.length} na tugma sa "<b>${docAiEsc(typed)}</b>": ${persons.map(p => docAiEsc(p.name)).join(', ')}.`);
    }
  }

  // 4) LEFTOVER KEYWORDS
  const keywords = freeWords.filter((w, k) => !usedFree.has(k) && w.length >= 3 && !/^\d{1,2}$/.test(w));

  return { q, words, type, date, persons, keywords, freeWords, notes };
}

/* ============================================================
   SEARCH
   ============================================================ */
function docAiSearchParsed(parsed, docsIn) {
  const docs = docsIn || getDocuments();
  const cases = getCases();
  const clients = getClients();
  const hasCriteria = !!(parsed.type || parsed.persons.length || parsed.date || parsed.keywords.length);
  const byNewest = (a, b) => new Date(b.doc.uploadedAt) - new Date(a.doc.uploadedAt);

  const scored = docs.map(doc => {
    const caseObj = cases.find(c => c.id === doc.caseId) || null;
    const clientObj = caseObj ? (clients.find(c => c.id === caseObj.clientId) || null) : null;
    const hayWords = docAiWords([
      doc.fileName, doc.aiDocType, (doc.aiPersons || []).join(' '),
      caseObj ? `${caseObj.caseName} ${caseObj.caseNumber}` : '',
      clientObj ? clientObj.name : '', doc.aiText || ''
    ].join(' '));

    let score = 0, misses = 0;
    const reasons = [];

    if (parsed.type) {
      const dt = doc.aiDocType || docAiDetectType('', doc.fileName).type;
      if (docAiTypeMatches(dt, parsed.type)) { score += 40; reasons.push('type'); }
      else if (docAiPhraseScore(hayWords, parsed.type.toLowerCase()).score >= 0.85) { score += 25; reasons.push('type-text'); }
      else misses++;
    }

    if (parsed.persons.length) {
      let best = 0;
      parsed.persons.forEach(p => {
        if (p.kind === 'client' && clientObj && clientObj.id === p.id) best = Math.max(best, 40);
        else if (p.kind === 'client' && (doc.aiClientIds || []).includes(p.id)) best = Math.max(best, 35);
        else if (docAiPhraseScore(hayWords, docAiNormalize(p.name)).score >= 0.8) best = Math.max(best, 30);
      });
      if (best) { score += best; reasons.push('person'); } else misses++;
    }

    if (parsed.date) {
      const inDoc = (doc.aiDates || []).some(d => d >= parsed.date.from && d <= parsed.date.to);
      const up = doc.uploadedAt ? docAiLocalIso(new Date(doc.uploadedAt)) : '';
      if (inDoc) { score += 25; reasons.push('date-in-doc'); }
      else if (up && up >= parsed.date.from && up <= parsed.date.to) { score += 15; reasons.push('upload-date'); }
      else misses++;
    }

    let kwHit = false;
    parsed.keywords.forEach(k => {
      const s = docAiPhraseScore(hayWords, k).score;
      if (s >= 0.8) { score += Math.round(10 * s); kwHit = true; }
    });
    if (kwHit) reasons.push('keyword');
    if (parsed.keywords.length && !kwHit && !parsed.type && !parsed.persons.length && !parsed.date) misses++;

    return { doc, caseObj, clientObj, score, misses, reasons };
  });

  if (!hasCriteria) return { results: scored.sort(byNewest), exact: true, hasCriteria };

  const sortFn = (a, b) => (b.score - a.score) || byNewest(a, b);
  const exact = scored.filter(r => r.misses === 0 && r.score > 0).sort(sortFn);
  if (exact.length) return { results: exact, exact: true, hasCriteria };

  const close = scored.filter(r => r.misses <= 1 && r.score >= DOC_AI_CONFIG.MIN_RESULT_SCORE).sort(sortFn);
  return { results: close, exact: false, hasCriteria };
}

// Public helper: simple search from anywhere
function docAiSearch(rawQuery) {
  const docs = getDocuments();
  return docAiSearchParsed(docAiParseQuery(rawQuery, docs), docs);
}

function docAiSuggestWords(parsed, docs) {
  const vocab = new Set();
  docs.forEach(d => {
    docAiWords(d.fileName).forEach(w => vocab.add(w));
    (d.aiKeywords || []).forEach(w => vocab.add(w));
    docAiWords(d.aiDocType).forEach(w => vocab.add(w));
    (d.aiPersons || []).forEach(p => docAiWords(p).forEach(w => vocab.add(w)));
  });
  getClients().forEach(c => docAiWords(c.name).forEach(w => vocab.add(w)));

  const out = [];
  parsed.keywords.forEach(k => {
    let best = null, bs = 0;
    vocab.forEach(v => {
      if (v.length < 3) return;
      const s = docAiSim(k, v);
      if (s > bs) { bs = s; best = v; }
    });
    if (best && bs >= 0.7 && bs < 1 && !out.includes(best)) out.push(best);
  });
  return out.slice(0, 5);
}

/* ============================================================
   CHAT REPLIES (HTML)
   ============================================================ */
function docAiCriteriaHtml(parsed) {
  const chips = [];
  if (parsed.type) chips.push(`<span class="docai-chip"><i class="fa-solid fa-file-lines"></i> ${docAiEsc(parsed.type)}</span>`);
  if (parsed.persons.length) chips.push(`<span class="docai-chip"><i class="fa-solid fa-user"></i> ${docAiEsc(parsed.persons.map(p => p.name).join(' / '))}</span>`);
  if (parsed.date) chips.push(`<span class="docai-chip"><i class="fa-solid fa-calendar-day"></i> ${docAiEsc(parsed.date.label)}</span>`);
  if (parsed.keywords.length) chips.push(`<span class="docai-chip"><i class="fa-solid fa-key"></i> ${docAiEsc(parsed.keywords.join(', '))}</span>`);
  return chips.length ? `<div class="docai-criteria">${chips.join('')}</div>` : '';
}

function docAiNotesHtml(notes) {
  return (notes || []).map(n => `<div class="docai-note"><i class="fa-solid fa-wand-magic-sparkles"></i> ${n}</div>`).join('');
}

function docAiPendingNotice(docs) {
  const pending = docs.filter(d => d.aiStatus !== 'done').length;
  if (!pending) return '';
  const where = docAiCanScan()
    ? 'Sina-scan na sila ngayon sa background.'
    : 'Buksan ang <b>Dashboard</b> para ma-scan sila.';
  return `<div class="docai-note docai-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${pending} file ang hindi pa na-scan ng AI (filename lang ang nabasa). ${where}</div>`;
}

function docAiSnippet(doc, parsed) {
  const text = String(doc.aiText || '').replace(/\s+/g, ' ');
  if (!text) return '';
  const lower = text.toLowerCase();

  const terms = [];
  if (parsed.type) terms.push(parsed.type.toLowerCase());
  parsed.persons.forEach(p => docAiNormalize(p.name).split(' ').filter(t => t.length >= 3).forEach(t => terms.push(t)));
  parsed.keywords.forEach(k => terms.push(k));

  let pos = -1;
  for (const t of terms) { pos = lower.indexOf(t); if (pos !== -1) break; }
  const start = pos === -1 ? 0 : Math.max(0, pos - 70);
  let snip = text.slice(start, start + 170);

  let html = docAiEsc(snip);
  terms.filter(t => t.length >= 3).forEach(t => {
    const safe = docAiEsc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(${safe})`, 'gi'), '<mark>$1</mark>');
  });
  return `${start > 0 ? '…' : ''}${html}${start + 170 < text.length ? '…' : ''}`;
}

function docAiRenderCard(r, idx, parsed) {
  const { doc, caseObj, clientObj } = r;
  const moves = (typeof getDocMovementsForDoc === 'function') ? getDocMovementsForDoc(doc.id) : [];
  const uploadMove = moves.filter(m => m.action === 'upload' || m.action === 'auto-route').pop();

  const path = ['Dashboard', 'Cases',
    caseObj ? `${caseObj.caseNumber} — ${caseObj.caseName}` : 'Unknown case',
    'Documents'].map(docAiEsc).join(' <span class="docai-sep">›</span> ');

  const meta = [];
  meta.push(`<b>Client:</b> ${docAiEsc(clientObj ? clientObj.name : '—')}`);
  if (doc.aiDates && doc.aiDates.length) meta.push(`<b>Petsa sa file:</b> ${docAiEsc(doc.aiDates.slice(0, 2).map(docAiFmtDay).join(', '))}`);
  meta.push(`<b>Uploaded:</b> ${docAiEsc(formatDate(doc.uploadedAt))}${uploadMove ? ` ni ${docAiEsc(uploadMove.userName)}` : ''}`);

  const quality = doc.aiStatus === 'done' && doc.aiQuality === 'low'
    ? `<span class="docai-badge docai-q-low">Low confidence</span>` : '';
  const snippet = docAiSnippet(doc, parsed);

  return `
    <div class="docai-card">
      <div class="docai-card-head">
        <span class="docai-rank">${idx + 1}</span>
        <i class="fa-solid ${docAiIcon(doc.fileType)} docai-file-icon"></i>
        <div class="docai-card-title">
          <strong title="${docAiEsc(doc.fileName)}">${docAiEsc(doc.fileName)}</strong>
          <div>${doc.aiStatus === 'done' ? `<span class="docai-badge docai-q-${docAiEsc(doc.aiQuality || 'medium')}">${docAiEsc(doc.aiDocType || 'Other')}</span>` : '<span class="docai-badge docai-pending">Pending scan</span>'} ${quality}</div>
        </div>
      </div>
      <div class="docai-path"><i class="fa-solid fa-folder-tree"></i> ${path}</div>
      <div class="docai-meta">${meta.join(' · ')}</div>
      ${snippet ? `<div class="docai-snippet">${snippet}</div>` : ''}
      <div class="docai-actions">
        <button type="button" class="docai-view-btn" data-docai-open="${docAiEsc(doc.id)}"><i class="fa-solid fa-eye"></i> View File</button>
        <button type="button" class="docai-history-btn" data-docai-history="${docAiEsc(doc.id)}"><i class="fa-solid fa-clock-rotate-left"></i> History</button>
      </div>
    </div>`;
}

function docAiBuildSearchReply(parsed, docs, options = {}) {
  const { results, exact, hasCriteria } = docAiSearchParsed(parsed, docs);
  const shown = results.slice(0, DOC_AI_CONFIG.MAX_RESULTS);
  docAiContext.lastResults = shown.map(r => r.doc.id);

  let html = `<div class="docai-reply">`;
  html += docAiCriteriaHtml(parsed);
  html += docAiNotesHtml(parsed.notes);

  if (!results.length) {
    html += `<p>Wala akong nakitang file na tugma.</p>`;
    const sugg = docAiSuggestWords(parsed, docs);
    if (sugg.length) html += `<div class="docai-note"><i class="fa-solid fa-lightbulb"></i> Baka ang ibig mo ay: ${sugg.map(s => `<b>${docAiEsc(s)}</b>`).join(', ')}?</div>`;
    if (parsed.type) {
      const types = [...new Set(docs.map(d => d.aiDocType).filter(Boolean))];
      if (types.length) html += `<div class="docai-note"><i class="fa-solid fa-list"></i> Mga uri ng file na meron: ${types.map(docAiEsc).join(', ')}.</div>`;
    }
  } else if (options.countMode) {
    html += exact
      ? `<p>Bilang: <b>${results.length}</b> file.</p>`
      : `<p>Bilang ng eksaktong tugma: <b>0</b>. Ito ang pinakamalapit:</p>`;
    html += shown.map((r, i) => docAiRenderCard(r, i, parsed)).join('');
  } else {
    if (!hasCriteria) html += `<p>Ito ang mga pinakabagong file (${results.length} total):</p>`;
    else if (exact) html += `<p>Nakita ko ang <b>${results.length}</b> file${results.length > 1 ? 's' : ''}${results.length > shown.length ? ` — top ${shown.length} ang ipinapakita` : ''}:</p>`;
    else html += `<p>Walang eksaktong tugma, pero ito ang pinakamalapit sa hinahanap mo:</p>`;
    html += shown.map((r, i) => docAiRenderCard(r, i, parsed)).join('');
    if (shown.length > 1) html += `<div class="docai-hint">Tip: pwede mong sabihing <i>"buksan yung pangalawa"</i> o <i>"sino nag-upload nyan?"</i></div>`;
  }

  html += docAiPendingNotice(docs);
  html += `</div>`;
  return html;
}

function docAiBuildTypeBreakdown(docs) {
  const counts = {};
  docs.forEach(d => {
    const t = d.aiStatus === 'done' ? (d.aiDocType || 'Other') : 'Not scanned yet';
    counts[t] = (counts[t] || 0) + 1;
  });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<li>${docAiEsc(t)}: <b>${n}</b></li>`).join('');
  return `<div class="docai-reply"><p>May <b>${docs.length}</b> file sa Document Manager:</p><ul class="docai-list">${rows}</ul>${docAiPendingNotice(docs)}</div>`;
}

/* ---------- MOVEMENTS ---------- */
function docAiDetectAction(q) {
  for (const [action, list] of Object.entries(DOC_AI_ACTIONS)) {
    if (docAiHas(q, list)) return action;
  }
  return null;
}

function docAiMatchUser(freeWords) {
  if (!freeWords || !freeWords.length) return null;
  let best = null;
  getUsers().forEach(u => {
    [`${u.firstName} ${u.lastName}`, u.firstName, u.lastName, u.username]
      .map(docAiNormalize)
      .filter(n => n && n.length >= 3)
      .forEach(n => {
        const r = docAiPhraseScore(freeWords, n);
        if (r.score >= 0.82 && (!best || r.score > best.score)) best = { user: u, score: r.score };
      });
  });
  return best;
}

function docAiMoveItemHtml(m, existingIds) {
  const label = DOC_AI_ACTION_LABELS[m.action] || String(m.action || '').toUpperCase().replace(/-/g, ' ');
  const cls = 'docai-act-' + String(m.action || 'other').replace(/[^a-z-]/g, '');

  let target;
  if (m.isActivity) {
    target = docAiEsc(m.details || '');
  } else {
    target = `"${docAiEsc(m.docName)}"`;
    if (m.action === 'rename' && m.oldName) target += ` <small>(dati: ${docAiEsc(m.oldName)})</small>`;
    if (m.caseNumber) target += ` <small>· Case ${docAiEsc(m.caseNumber)}${m.clientName ? ` · ${docAiEsc(m.clientName)}` : ''}</small>`;
    target += existingIds.has(m.docId)
      ? ` <button type="button" class="docai-link-btn" data-docai-open="${docAiEsc(m.docId)}">View</button>`
      : ` <small class="docai-muted">(wala na ang file)</small>`;
  }

  return `<li><span class="docai-when">${docAiEsc(formatDateTime(m.createdAt))}</span> <b>${docAiEsc(m.userName || 'System')}</b> <span class="docai-act ${cls}">${docAiEsc(label)}</span> ${target}</li>`;
}

function docAiBuildDocHistory(docId) {
  const doc = findDocumentById(docId);
  const moves = getDocMovementsForDoc(docId);
  const existingIds = new Set(getDocuments().map(d => d.id));
  const name = doc ? doc.fileName : (moves[0] ? moves[0].docName : 'file');

  if (!moves.length) {
    return `<div class="docai-reply"><p>Walang naka-record na movement para sa "<b>${docAiEsc(name)}</b>" (baka na-upload bago na-install ang tracking).</p></div>`;
  }
  return `<div class="docai-reply">
    <p><i class="fa-solid fa-clock-rotate-left"></i> History ng "<b>${docAiEsc(name)}</b>" (${moves.length}):</p>
    <ul class="docai-moves">${moves.slice(0, 15).map(m => docAiMoveItemHtml(m, existingIds)).join('')}</ul>
  </div>`;
}

function docAiBuildMovementReply(parsed, docs, forcedDocId = null) {
  const q = parsed.q;
  const action = docAiDetectAction(q);
  const existingIds = new Set(docs.map(d => d.id));

  let persons = parsed.persons;
  let userFilter = null;
  const userMatch = forcedDocId ? null : docAiMatchUser(parsed.freeWords);
  if (userMatch && (!persons.length || userMatch.score > persons[0].score)) {
    userFilter = userMatch.user;
    persons = [];
  }

  let targetIds = null;
  const hasDocTarget = !!(forcedDocId || parsed.type || persons.length || parsed.keywords.length);
  if (forcedDocId) {
    targetIds = new Set([forcedDocId]);
  } else if (hasDocTarget) {
    const search = docAiSearchParsed({ ...parsed, persons, date: null }, docs);
    targetIds = new Set(search.results.map(r => r.doc.id));
  }

  // deleted files no longer exist in documents — match them by saved name/type/client
  const matchesDeleted = (m) => {
    if (forcedDocId || existingIds.has(m.docId)) return false;
    if (!parsed.type && !persons.length && !parsed.keywords.length) return false;
    const nameWords = docAiWords(`${m.docName} ${m.docType || ''} ${m.clientName || ''}`);
    let ok = true;
    if (parsed.type) ok = ok && (docAiTypeMatches(m.docType, parsed.type) || docAiPhraseScore(nameWords, parsed.type.toLowerCase()).score >= 0.8);
    if (persons.length) ok = ok && persons.some(p => docAiPhraseScore(nameWords, docAiNormalize(p.name)).score >= 0.8 || (p.kind === 'client' && m.clientId === p.id));
    if (parsed.keywords.length && !parsed.type && !persons.length) ok = ok && parsed.keywords.some(k => docAiPhraseScore(nameWords, k).score >= 0.8);
    return ok;
  };

  let moves = getDocMovements();
  if (targetIds) moves = moves.filter(m => targetIds.has(m.docId) || matchesDeleted(m));
  if (action) moves = moves.filter(m => m.action === action);
  if (userFilter) moves = moves.filter(m => m.userId === userFilter.id);

  const inDate = iso => {
    if (!parsed.date) return true;
    const d = docAiLocalIso(new Date(iso));
    return d >= parsed.date.from && d <= parsed.date.to;
  };
  moves = moves.filter(m => inDate(m.createdAt));

  // "ano ginawa ni X" -> also include non-document activity (login, cases, clients, chat...)
  if (userFilter && !hasDocTarget && !action && typeof getActivityLogForUser === 'function') {
    const extra = getActivityLogForUser(userFilter.id)
      .filter(a => !String(a.action || '').startsWith('doc-') && inDate(a.createdAt))
      .map(a => ({
        isActivity: true, action: a.action, details: a.description, createdAt: a.createdAt,
        userName: `${userFilter.firstName} ${userFilter.lastName}`
      }));
    moves = moves.concat(extra);
  }

  moves.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const shown = moves.slice(0, 12);

  let html = `<div class="docai-reply">`;
  const chips = docAiCriteriaHtml({ ...parsed, persons });
  const extraChips = [];
  if (action) extraChips.push(`<span class="docai-chip"><i class="fa-solid fa-bolt"></i> ${docAiEsc(DOC_AI_ACTION_LABELS[action])}</span>`);
  if (userFilter) extraChips.push(`<span class="docai-chip"><i class="fa-solid fa-user-tie"></i> ${docAiEsc(userFilter.firstName + ' ' + userFilter.lastName)}</span>`);
  html += chips ? chips.replace('</div>', extraChips.join('') + '</div>') : (extraChips.length ? `<div class="docai-criteria">${extraChips.join('')}</div>` : '');
  html += docAiNotesHtml(parsed.notes);

  if (!shown.length) {
    html += `<p>Wala akong nakitang movement na tugma${parsed.date ? ` (${docAiEsc(parsed.date.label)})` : ''}.</p>`;
    if (hasDocTarget && targetIds && !targetIds.size) html += `<div class="docai-note"><i class="fa-solid fa-lightbulb"></i> Hindi ko rin mahanap ang file mismo — subukan mong i-check ang spelling ng pangalan o uri ng dokumento.</div>`;
  } else {
    const first = shown[0];
    const distinctDocs = new Set(shown.filter(m => !m.isActivity).map(m => m.docId));
    if (action && distinctDocs.size === 1 && !first.isActivity) {
      html += `<p>Si <b>${docAiEsc(first.userName)}</b> ang ${docAiEsc(DOC_AI_ACTION_VERBS[action] || action)} ng "<b>${docAiEsc(first.docName)}</b>" noong <b>${docAiEsc(formatDateTime(first.createdAt))}</b>.</p>`;
    } else if (userFilter) {
      html += `<p>Mga galaw ni <b>${docAiEsc(userFilter.firstName + ' ' + userFilter.lastName)}</b>${parsed.date ? ` (${docAiEsc(parsed.date.label)})` : ''}: <b>${moves.length}</b>${moves.length > shown.length ? ` — huling ${shown.length} ang ipinapakita` : ''}</p>`;
    } else {
      html += `<p>Nakita ko ang <b>${moves.length}</b> movement${moves.length > 1 ? 's' : ''}${moves.length > shown.length ? ` — huling ${shown.length} ang ipinapakita` : ''}:</p>`;
    }
    html += `<ul class="docai-moves">${shown.map(m => docAiMoveItemHtml(m, existingIds)).join('')}</ul>`;
  }

  html += `</div>`;
  return html;
}

/* ============================================================
   MAIN ENTRY — called by ai-assistant.js
   Returns null if the question is NOT about documents,
   otherwise { html } to show in the chat.
   ============================================================ */
function docAiHandleQuery(rawQuery) {
  const q = docAiClean(rawQuery);
  if (!q) return null;

  const docWord = docAiHas(q, DOC_AI_DOC_WORDS);
  const trigger = docAiHas(q, DOC_AI_MOVE_TRIGGERS);
  const pronoun = docAiHas(q, ['yan', 'iyan', 'nyan', 'niyan', 'yun', 'iyon', 'yon', 'that', 'it', 'non', 'nun', 'dun', 'doon', 'ito', 'nito', 'una', 'first', 'pangalawa', 'ikalawa', 'second', 'pangatlo', 'ikatlo', 'third', '1', '2', '3', '4', '5']);

  // ---- FOLLOW-UPS on the last results ----
  if (docAiContext.lastResults.length && pronoun) {
    const pickIndex = () => {
      if (docAiHas(q, ['pangalawa', 'ikalawa', 'second', '2'])) return 1;
      if (docAiHas(q, ['pangatlo', 'ikatlo', 'third', '3'])) return 2;
      if (docAiHas(q, ['4'])) return 3;
      if (docAiHas(q, ['5'])) return 4;
      return 0;
    };
    const targetId = docAiContext.lastResults[Math.min(pickIndex(), docAiContext.lastResults.length - 1)];

    if (docAiHas(q, ['open', 'buksan', 'view', 'tingnan', 'patingin', 'ipakita', 'pakita', 'show'])) {
      const doc = findDocumentById(targetId);
      if (doc) {
        setTimeout(() => docAiOpenDocument(targetId), 400);
        return { html: `<div class="docai-reply"><p>Binubuksan ko ang "<b>${docAiEsc(doc.fileName)}</b>" sa Document Manager…</p></div>` };
      }
    }
    if (trigger || docAiDetectAction(q)) {
      const docs = getDocuments();
      const parsed = docAiParseQuery(rawQuery, docs);
      return { html: docAiBuildMovementReply(parsed, docs, targetId) };
    }
  }

  const docs = getDocuments();
  const parsed = docAiParseQuery(rawQuery, docs);
  docAiContext.lastQuery = rawQuery;

  const action = docAiDetectAction(q);
  const isMovement = trigger && (docWord || !!parsed.type || !!action || docAiHas(q, ['ginawa', 'galaw', 'movement', 'movements', 'history', 'activity', 'activities']));
  if (isMovement) return { html: docAiBuildMovementReply(parsed, docs) };

  if (!docWord && !parsed.type) return null;

  if (docAiHas(q, ['ilan', 'ilang', 'how many', 'count', 'bilang'])) {
    const hasCriteria = parsed.type || parsed.persons.length || parsed.date || parsed.keywords.length;
    if (!hasCriteria) return { html: docAiBuildTypeBreakdown(docs) };
    return { html: docAiBuildSearchReply(parsed, docs, { countMode: true }) };
  }

  return { html: docAiBuildSearchReply(parsed, docs) };
}

/* ============================================================
   OPEN + HIGHLIGHT IN DOCUMENT MANAGER
   ============================================================ */
function docAiIsHighlighted(docId) {
  return docId === _docAiHighlightId && Date.now() < _docAiHighlightUntil;
}

function docAiHighlightRow(docId) {
  _docAiHighlightId = docId;
  _docAiHighlightUntil = Date.now() + DOC_AI_CONFIG.HIGHLIGHT_MS;

  const row = document.querySelector(`#documentsTableBody [data-doc-row="${CSS.escape(docId)}"]`);
  if (!row) return;
  document.querySelectorAll('#documentsTableBody .docai-highlight').forEach(r => r.classList.remove('docai-highlight'));
  row.classList.add('docai-highlight');
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });

  setTimeout(() => {
    if (!docAiIsHighlighted(docId)) {
      const r = document.querySelector(`#documentsTableBody [data-doc-row="${CSS.escape(docId)}"]`);
      if (r) r.classList.remove('docai-highlight');
    }
  }, DOC_AI_CONFIG.HIGHLIGHT_MS + 100);
}

function docAiShowInManager(docId) {
  const doc = findDocumentById(docId);
  if (!doc) return;
  if (typeof closeAiAssistantPanel === 'function' && window.innerWidth < 768) closeAiAssistantPanel();
  _docAiHighlightId = docId;
  _docAiHighlightUntil = Date.now() + DOC_AI_CONFIG.HIGHLIGHT_MS;
  openDocumentsModal(doc.caseId);
  setTimeout(() => docAiHighlightRow(docId), 200);
}

function docAiOpenDocument(docId) {
  const doc = findDocumentById(docId);
  if (!doc) {
    if (typeof showToast === 'function') showToast('Hindi na makita ang file — baka na-delete na.', 'error');
    return;
  }

  const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  if (user && typeof getVisibleNavItemsForUser === 'function' &&
      !getVisibleNavItemsForUser(user).some(i => i.key === 'dashboard')) {
    if (typeof showToast === 'function') showToast('Wala kang access sa Dashboard / Document Manager.', 'error');
    return;
  }

  if (typeof logDocMovement === 'function') logDocMovement('ai-open', doc, { details: 'Opened from CaseFlow AI Assistant' });

  if (typeof openDocumentsModal === 'function' && document.getElementById('documentsModalOverlay')) {
    docAiShowInManager(docId);
  } else {
    setPendingNavTarget(`doc:${docId}`);
    window.location.href = 'dashboard.html';
  }
}

// Called by dashboard.js with the pending nav target (e.g. "doc:DOC-123")
function docAiHandleNavTarget(target) {
  if (!target || !String(target).startsWith('doc:')) return false;
  const docId = String(target).slice(4);
  setTimeout(() => docAiShowInManager(docId), 350);
  return true;
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
document.addEventListener('click', (e) => {
  const openBtn = e.target.closest('[data-docai-open]');
  if (openBtn) {
    e.preventDefault();
    docAiOpenDocument(openBtn.dataset.docaiOpen);
    return;
  }
  const histBtn = e.target.closest('[data-docai-history]');
  if (histBtn) {
    e.preventDefault();
    const html = docAiBuildDocHistory(histBtn.dataset.docaiHistory);
    if (typeof addAiHtmlMessage === 'function') addAiHtmlMessage('assistant', html);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  if (!docAiCanScan() || !getSession()) return;
  // give the page time to render first, then scan un-scanned files
  setTimeout(docAiScanAllPending, 2500);
});