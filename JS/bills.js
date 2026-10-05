/* ============================================================
   ABANTO LAW FIRM — BILLS.JS
   Bills Module: stat tiles, search/category filter/sort,
   add/edit/delete bill, Document Manager per bill, Custom
   Fields, Receipt Scan (OCR auto-fill + auto-attach), and (NEW)
   notifies EVERY registered user whenever a new Bill is added.

   Depends on: storage.js, auth.js, modal.js, navigation.js,
   custom-fields.js (loaded before this file)
   ============================================================ */

const CF_MODULE_BILLS = 'bills';

let currentBillsUser = null;
let billSearchTerm = '';
let billCategoryFilter = '';
let billSortMode = 'dueSoonest';

let currentBillDocsBillId = null;
let billDocSearchTerm = '';
let billDocSortMode = 'newest';

let pendingScannedReceiptFile = null;

document.addEventListener('DOMContentLoaded', () => {
  const session = requireAuth();
  if (!session) return;

  currentBillsUser = getCurrentUser();
  initLayout('bills');
  injectCustomFieldsModal();
  attachCustomFieldClearHandler(document.getElementById('billTableBody'), renderBillTable);

  renderBillTable();
  attachBillEvents();
});

/* ============================================================
   CATEGORY LABELS
   ============================================================ */
const BILL_CATEGORIES = {
  'lbc': { label: 'LBC / Shipping', icon: 'fa-truck-fast' },
  'gas': { label: 'Gas / Fuel', icon: 'fa-gas-pump' },
  'utilities': { label: 'Utilities', icon: 'fa-bolt' },
  'rent': { label: 'Rent', icon: 'fa-house' },
  'office-supplies': { label: 'Office Supplies', icon: 'fa-box' },
  'government': { label: 'Government Fees', icon: 'fa-landmark' },
  'other': { label: 'Other', icon: 'fa-file-invoice' }
};

function getCategoryInfo(category) {
  return BILL_CATEGORIES[category] || BILL_CATEGORIES['other'];
}

/* ============================================================
   RENDER: STAT TILES
   ============================================================ */
function renderBillTiles(bills) {
  const total = bills.length;
  const totalAmount = bills.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
  const totalFiles = bills.reduce((sum, b) => sum + ((b.documents || []).length), 0);

  document.getElementById('tileTotalBills').textContent = total;
  document.getElementById('tileTotalAmount').textContent = `₱${totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  document.getElementById('tileTotalFiles').textContent = totalFiles;
}

/* ============================================================
   RENDER: BILLS TABLE
   ============================================================ */
function getFilteredSortedBills() {
  let bills = getBills();

  if (billCategoryFilter) {
    bills = bills.filter(b => b.category === billCategoryFilter);
  }

  if (billSearchTerm.trim()) {
    const q = billSearchTerm.trim().toLowerCase();
    bills = bills.filter(b =>
      b.billName.toLowerCase().includes(q) ||
      (b.vendor || '').toLowerCase().includes(q)
    );
  }

  switch (billSortMode) {
    case 'dueSoonest': bills.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)); break;
    case 'dueLatest': bills.sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate)); break;
    case 'az': bills.sort((a, b) => a.billName.localeCompare(b.billName)); break;
    case 'za': bills.sort((a, b) => b.billName.localeCompare(a.billName)); break;
  }

  return bills;
}

function renderBillCustomFieldHeaders() {
  const headerCell = document.getElementById('billCustomFieldHeaders');
  if (!headerCell) return;

  const temp = document.createElement('tr');
  temp.innerHTML = renderCustomFieldHeaders(CF_MODULE_BILLS);
  const newCells = Array.from(temp.children);

  const parentRow = headerCell.parentElement;
  const placeholderIndex = Array.from(parentRow.children).indexOf(headerCell);
  headerCell.remove();
  newCells.reverse().forEach(cell => {
    parentRow.insertBefore(cell, parentRow.children[placeholderIndex] || null);
  });
  newCells[newCells.length - 1].id = 'billCustomFieldHeaders';
}

function renderBillTable() {
  const bills = getFilteredSortedBills();
  const tbody = document.getElementById('billTableBody');

  renderBillTiles(getBills());
  renderBillCustomFieldHeaders();

  const totalCols = 7 + getCustomFieldColspan(CF_MODULE_BILLS);

  if (bills.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${totalCols}">No bills found.</td></tr>`;
    return;
  }

  tbody.innerHTML = bills.map(b => {
    const docCount = (b.documents || []).length;
    const catInfo = getCategoryInfo(b.category);

    return `
      <tr>
        <td class="bill-name-cell">${escapeHtml(b.billName)}</td>
        <td><span class="bill-category-badge"><i class="fa-solid ${catInfo.icon}"></i> ${escapeHtml(catInfo.label)}</span></td>
        <td>${escapeHtml(b.vendor)}</td>
        <td class="bill-amount-cell">₱${Number(b.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        <td class="bill-due-date-cell">${formatDate(b.dueDate)}</td>
        <td>
          <button class="cell-action-btn" data-open-bill-docs="${b.id}">
            <i class="fa-solid fa-folder"></i> Files <span class="count-badge">${docCount}</span>
          </button>
        </td>
        ${renderCustomFieldCells(CF_MODULE_BILLS, b)}
        <td>
          <div class="table-actions">
            <button class="btn-icon" title="Edit" data-edit-bill="${b.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon danger" title="Delete" data-delete-bill="${b.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/* ============================================================
   ADD / EDIT BILL
   ============================================================ */
function resetScannedReceiptPreview() {
  pendingScannedReceiptFile = null;
  document.getElementById('scannedReceiptPreviewWrap').style.display = 'none';
  document.getElementById('scannedReceiptFileName').textContent = '';
}

function showScannedReceiptPreview(fileName) {
  document.getElementById('scannedReceiptFileName').textContent = fileName;
  document.getElementById('scannedReceiptPreviewWrap').style.display = 'block';
}

function openAddBillModal() {
  document.getElementById('billModalTitle').innerHTML = '<i class="fa-solid fa-file-invoice-dollar"></i> Add Bill';
  document.getElementById('billForm').reset();
  document.getElementById('billId').value = '';
  clearFormError('billFormError');
  resetScannedReceiptPreview();
  document.getElementById('billCustomFieldsWrap').innerHTML = renderCustomFieldFormInputs(CF_MODULE_BILLS, {});
  openModal('billModalOverlay');
}

function openEditBillModal(billId) {
  const bill = findBillById(billId);
  if (!bill) return;

  document.getElementById('billModalTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Edit Bill';
  clearFormError('billFormError');
  resetScannedReceiptPreview();

  document.getElementById('billId').value = bill.id;
  document.getElementById('billName').value = bill.billName;
  document.getElementById('billCategory').value = bill.category || 'other';
  document.getElementById('billVendor').value = bill.vendor;
  document.getElementById('billAmount').value = bill.amount;
  document.getElementById('billDueDate').value = bill.dueDate;
  document.getElementById('billNotes').value = bill.notes || '';

  document.getElementById('billCustomFieldsWrap').innerHTML = renderCustomFieldFormInputs(CF_MODULE_BILLS, bill.customFields || {});

  openModal('billModalOverlay');
}

/**
 * NEW: notifies every registered user (except the person who
 * created it) whenever a new Bill is added.
 */
function notifyAllUsersOfNewBill(bill) {
  const allUserIds = getUsers().map(u => u.id).filter(id => id !== currentBillsUser.id);
  createNotificationForMany(
    allUserIds,
    'bill-added',
    'New bill added',
    `${currentBillsUser.firstName} ${currentBillsUser.lastName} added bill "${bill.billName}" (₱${Number(bill.amount).toFixed(2)}) — due ${formatDate(bill.dueDate)}.`,
    { page: 'bills.html', targetId: null }
  );
}

async function handleBillFormSubmit(e) {
  e.preventDefault();
  clearFormError('billFormError');

  const id = document.getElementById('billId').value;
  const billName = document.getElementById('billName').value.trim();
  const category = document.getElementById('billCategory').value;
  const vendor = document.getElementById('billVendor').value.trim();
  const amount = parseFloat(document.getElementById('billAmount').value);
  const dueDate = document.getElementById('billDueDate').value;
  const notes = document.getElementById('billNotes').value.trim();
  const customFields = collectCustomFieldValues(CF_MODULE_BILLS);

  if (!billName || !vendor || isNaN(amount) || !dueDate) {
    showFormError('billFormError', 'Please fill in all required fields.');
    return;
  }

  let newDocEntry = null;
  if (pendingScannedReceiptFile) {
    try {
      const dataUrl = await readBillFileAsDataUrl(pendingScannedReceiptFile);
      newDocEntry = {
        id: generateId('BILLDOC'),
        fileName: pendingScannedReceiptFile.name,
        fileType: pendingScannedReceiptFile.type || 'application/octet-stream',
        fileSize: pendingScannedReceiptFile.size,
        dataUrl,
        uploadedAt: nowISO()
      };
    } catch (err) {
      console.error('[bills.js] Failed to attach scanned receipt:', err);
      showFormError('billFormError', 'Failed to attach the scanned receipt. You can add it manually via Files after saving.');
      return;
    }
  }

  const bills = getBills();

  if (id) {
    const idx = bills.findIndex(b => b.id === id);
    if (idx === -1) {
      showFormError('billFormError', 'Bill not found.');
      return;
    }
    const existingDocs = bills[idx].documents || [];
    bills[idx] = {
      ...bills[idx],
      billName, category, vendor, amount, dueDate, notes,
      customFields,
      documents: newDocEntry ? [...existingDocs, newDocEntry] : existingDocs,
      updatedAt: nowISO()
    };
    saveBills(bills);

    if (typeof logActivity === 'function') {
      logActivity(currentBillsUser.id, 'bill-edit', `Edited bill "${billName}" (₱${amount.toFixed(2)}).`);
    }

    showToast(newDocEntry ? 'Bill updated and receipt attached.' : 'Bill updated successfully.', 'success');
  } else {
    const newBill = {
      id: generateId('BILL'),
      billName, category, vendor, amount, dueDate, notes,
      documents: newDocEntry ? [newDocEntry] : [],
      customFields,
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
    bills.push(newBill);
    saveBills(bills);

    if (typeof logActivity === 'function') {
      logActivity(currentBillsUser.id, 'bill-add', `Added bill "${billName}" (₱${amount.toFixed(2)}).`);
    }

    // NEW: notify everyone about the new bill
    notifyAllUsersOfNewBill(newBill);

    showToast(newDocEntry ? 'Bill added and receipt attached.' : 'Bill added successfully.', 'success');
  }

  resetScannedReceiptPreview();
  closeModal('billModalOverlay');
  renderBillTable();
}

/* ============================================================
   DELETE BILL
   ============================================================ */
function handleDeleteBill(billId) {
  const bill = findBillById(billId);
  if (!bill) return;

  const docCount = (bill.documents || []).length;
  const message = docCount > 0
    ? `Delete bill "${bill.billName}"? This will also delete its ${docCount} uploaded document(s). This cannot be undone.`
    : `Delete bill "${bill.billName}"? This cannot be undone.`;

  confirmDelete(
    message,
    () => {
      saveBills(getBills().filter(b => b.id !== billId));

      if (typeof logActivity === 'function') {
        logActivity(currentBillsUser.id, 'bill-edit', `Deleted bill "${bill.billName}".`);
      }

      renderBillTable();
      showToast('Bill deleted.', 'success');
    },
    'Delete Bill',
    '<i class="fa-solid fa-trash"></i> Delete Bill'
  );
}

/* ============================================================
   RECEIPT SCAN (OCR AUTO-FILL + AUTO-ATTACH)
   ============================================================ */
function triggerReceiptScan() {
  const tempInput = document.createElement('input');
  tempInput.type = 'file';
  tempInput.accept = 'application/pdf,image/*';
  tempInput.style.display = 'none';

  tempInput.addEventListener('change', () => {
    const file = tempInput.files[0];
    if (file) handleReceiptFileSelected(file);
    tempInput.remove();
  });

  document.body.appendChild(tempInput);
  tempInput.click();
}

async function handleReceiptFileSelected(file) {
  const MAX_FILE_SIZE = 3 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    showToast('File too large (3MB limit for this prototype).', 'error');
    return;
  }

  openModal('billOcrProcessingModalOverlay');
  updateBillOcrProgress(5, 'Reading file...');

  try {
    const text = await extractTextFromReceiptFile(file, updateBillOcrProgress);
    updateBillOcrProgress(95, 'Extracting bill details...');

    const parsed = parseReceiptText(text);

    updateBillOcrProgress(100, 'Done.');
    setTimeout(() => {
      closeModal('billOcrProcessingModalOverlay');
      applyReceiptDataToForm(parsed);

      pendingScannedReceiptFile = file;
      showScannedReceiptPreview(file.name);
    }, 300);

  } catch (err) {
    console.error('[bills.js] Receipt OCR failed:', err);
    closeModal('billOcrProcessingModalOverlay');
    showToast('Could not read this receipt. Please fill in the details manually.', 'error');
  }
}

function updateBillOcrProgress(percent, label) {
  const fill = document.getElementById('billOcrProgressFill');
  const labelEl = document.getElementById('billOcrProgressLabel');
  if (fill) fill.style.width = `${percent}%`;
  if (labelEl) labelEl.textContent = label;
}

async function extractTextFromReceiptFile(file, onProgress) {
  if (file.type === 'application/pdf') {
    onProgress(15, 'Reading PDF text layer...');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const pdfText = content.items.map(item => item.str).join(' ');

    if (pdfText && pdfText.trim().length > 15) return pdfText;

    onProgress(35, 'No text layer found — running OCR on scanned page...');
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    const result = await Tesseract.recognize(canvas, 'eng', {
      logger: (m) => { if (m.status === 'recognizing text') onProgress(35 + Math.round(m.progress * 55), 'Reading scanned text...'); }
    });
    return result.data.text;
  }

  if (file.type.startsWith('image/')) {
    onProgress(20, 'Running OCR on image...');
    const result = await Tesseract.recognize(file, 'eng', {
      logger: (m) => { if (m.status === 'recognizing text') onProgress(20 + Math.round(m.progress * 70), 'Reading receipt text...'); }
    });
    return result.data.text;
  }

  throw new Error('Unsupported file type.');
}

function parseReceiptText(rawText) {
  const text = (rawText || '').trim();
  const textLower = text.toLowerCase();
  const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);

  let amount = null;
  const totalLineMatch = text.match(/total\s*[:\-]?\s*(?:php|₱)?\s*([\d,]+\.\d{2})/i);
  if (totalLineMatch) {
    amount = parseFloat(totalLineMatch[1].replace(/,/g, ''));
  } else {
    const allAmounts = [...text.matchAll(/(?:php|₱)?\s*([\d,]{1,3}(?:,\d{3})*\.\d{2})/g)]
      .map(m => parseFloat(m[1].replace(/,/g, '')))
      .filter(n => !isNaN(n));
    if (allAmounts.length > 0) amount = Math.max(...allAmounts);
  }

  let dueDate = null;
  const monthNames = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

  const datePatterns = [
    /\b(\d{4})[\-\.\/](\d{1,2})[\-\.\/](\d{1,2})\b/,
    /\b(\d{1,2})[\-\.\/](\d{1,2})[\-\.\/](\d{2,4})\b/,
    new RegExp(`\\b(\\d{1,2})[\\-\\s]?(${monthNames})[\\-\\s]?(\\d{2,4})\\b`, 'i'),
    new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'i')
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const parsedDate = new Date(match[0].replace(/\./g, ' '));
    if (!isNaN(parsedDate) && parsedDate.getFullYear() > 2000 && parsedDate.getFullYear() < 2100) {
      dueDate = parsedDate.toISOString().split('T')[0];
      break;
    }
  }

  let vendor = null;
  const skipLinePattern = /(receipt|invoice|official|address|street|brgy|barangay|city|tel(?:ephone)?|phone|contact|tin|vat|reg(?:istered)?|no\.|date|time|cashier|clerk|www\.|\.com|@)/i;

  const candidateLines = lines.slice(0, 8);
  const scored = candidateLines
    .map((line, idx) => {
      const digitCount = (line.match(/\d/g) || []).length;
      const letterCount = (line.match(/[a-zA-Z]/g) || []).length;
      const looksLikeJunk = skipLinePattern.test(line) || digitCount > letterCount || line.length < 3 || line.length > 60;
      const uppercaseRatio = letterCount > 0 ? (line.match(/[A-Z]/g) || []).length / letterCount : 0;
      const score = looksLikeJunk ? -1 : (100 - idx * 5) + (uppercaseRatio * 20) + Math.min(letterCount, 30);
      return { line, score };
    })
    .filter(c => c.score >= 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) vendor = scored[0].line;

  let category = 'other';
  if (/lbc|shipping|courier/i.test(textLower)) category = 'lbc';
  else if (/petron|shell|caltex|gas station|fuel/i.test(textLower)) category = 'gas';
  else if (/meralco|maynilad|electric|water bill|utility/i.test(textLower)) category = 'utilities';
  else if (/rent|lease/i.test(textLower)) category = 'rent';
  else if (/office|supplies|bond paper|ink/i.test(textLower)) category = 'office-supplies';
  else if (/bir|sec|dti|government|permit|license fee/i.test(textLower)) category = 'government';

  return { amount, dueDate, vendor, category, rawText: text };
}

function applyReceiptDataToForm(parsed) {
  let filledCount = 0;

  if (parsed.vendor) {
    document.getElementById('billVendor').value = parsed.vendor;
    filledCount++;
  }
  if (parsed.amount !== null) {
    document.getElementById('billAmount').value = parsed.amount.toFixed(2);
    filledCount++;
  }
  if (parsed.dueDate) {
    document.getElementById('billDueDate').value = parsed.dueDate;
    filledCount++;
  }
  if (parsed.category) {
    document.getElementById('billCategory').value = parsed.category;
    filledCount++;
  }

  if (filledCount > 0) {
    showToast(`Auto-filled ${filledCount} field(s) from the receipt. Please review before saving.`, 'success');
  } else {
    showToast('Could not confidently extract details — please fill in manually. The receipt will still be attached.', 'error');
  }
}

/* ============================================================
   BILL DOCUMENT MANAGER
   ============================================================ */
function openBillDocsModal(billId) {
  const bill = findBillById(billId);
  if (!bill) return;

  currentBillDocsBillId = billId;
  billDocSearchTerm = '';
  billDocSortMode = 'newest';

  document.getElementById('billDocsBillId').value = billId;
  document.getElementById('billDocsLabel').textContent = `${bill.billName} — ${bill.vendor}`;
  document.getElementById('billDocSearchInput').value = '';
  document.getElementById('billDocSortSelect').value = 'newest';

  renderBillDocsTable();
  openModal('billDocsModalOverlay');
}

function getFilteredSortedBillDocs() {
  const bill = findBillById(currentBillDocsBillId);
  let docs = bill ? [...(bill.documents || [])] : [];

  if (billDocSearchTerm.trim()) {
    const q = billDocSearchTerm.trim().toLowerCase();
    docs = docs.filter(d => d.fileName.toLowerCase().includes(q));
  }

  switch (billDocSortMode) {
    case 'newest': docs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)); break;
    case 'oldest': docs.sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt)); break;
    case 'az': docs.sort((a, b) => a.fileName.localeCompare(b.fileName)); break;
    case 'za': docs.sort((a, b) => b.fileName.localeCompare(a.fileName)); break;
  }

  return docs;
}

function renderBillDocsTable() {
  const docs = getFilteredSortedBillDocs();
  const tbody = document.getElementById('billDocsTableBody');

  if (docs.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No documents found.</td></tr>`;
  } else {
    tbody.innerHTML = docs.map(d => `
      <tr>
        <td>
          <div class="doc-name-cell">
            <i class="fa-solid ${getBillDocFileIcon(d.fileType)}"></i>
            <span class="doc-name-text" title="${escapeHtml(d.fileName)}">${escapeHtml(d.fileName)}</span>
          </div>
        </td>
        <td><span class="doc-type-badge">${escapeHtml(getBillDocFileExtension(d.fileName))}</span></td>
        <td>${formatDate(d.uploadedAt)}</td>
        <td>${formatBillDocFileSize(d.fileSize)}</td>
        <td>
          <div class="table-actions">
            <button class="btn-icon" title="View" data-view-bill-doc="${d.id}"><i class="fa-solid fa-eye"></i></button>
            <button class="btn-icon" title="Rename" data-rename-bill-doc="${d.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon" title="Download" data-download-bill-doc="${d.id}"><i class="fa-solid fa-download"></i></button>
            <button class="btn-icon danger" title="Delete" data-delete-bill-doc="${d.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  renderBillTable();
}

function getBillDocFileExtension(fileName) {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'FILE';
}

function getBillDocFileIcon(fileType) {
  if (!fileType) return 'fa-file';
  if (fileType.includes('pdf')) return 'fa-file-pdf';
  if (fileType.includes('image')) return 'fa-file-image';
  return 'fa-file';
}

function formatBillDocFileSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readBillFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleBillDocUpload(fileList) {
  if (!currentBillDocsBillId || !fileList || fileList.length === 0) return;

  const MAX_FILE_SIZE = 3 * 1024 * 1024;
  const bills = getBills();
  const idx = bills.findIndex(b => b.id === currentBillDocsBillId);
  if (idx === -1) return;

  if (!bills[idx].documents) bills[idx].documents = [];

  let uploadedCount = 0;
  let skippedCount = 0;

  for (const file of Array.from(fileList)) {
    if (file.size > MAX_FILE_SIZE) { skippedCount++; continue; }
    try {
      const dataUrl = await readBillFileAsDataUrl(file);
      bills[idx].documents.push({
        id: generateId('BILLDOC'),
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        dataUrl,
        uploadedAt: nowISO()
      });
      uploadedCount++;
    } catch (err) {
      console.error('[bills.js] Failed to read file:', file.name, err);
      skippedCount++;
    }
  }

  saveBills(bills);
  renderBillDocsTable();

  if (uploadedCount > 0) showToast(`${uploadedCount} document(s) uploaded successfully.`, 'success');
  if (skippedCount > 0) showToast(`${skippedCount} file(s) skipped (too large, 3MB limit).`, 'error');
}

function handleViewBillDoc(docId) {
  const bill = findBillById(currentBillDocsBillId);
  const doc = bill ? (bill.documents || []).find(d => d.id === docId) : null;
  if (!doc) return;

  document.getElementById('viewBillDocName').textContent = doc.fileName;
  const body = document.getElementById('viewBillDocBody');

  if (doc.fileType.includes('image')) {
    body.innerHTML = `<img src="${doc.dataUrl}" alt="${escapeHtml(doc.fileName)}">`;
  } else if (doc.fileType.includes('pdf')) {
    body.innerHTML = `<iframe src="${doc.dataUrl}"></iframe>`;
  } else {
    body.innerHTML = `
      <div class="doc-preview-unavailable">
        <i class="fa-solid ${getBillDocFileIcon(doc.fileType)}"></i>
        <p>Preview not available for this file type.</p>
      </div>
    `;
  }

  openModal('viewBillDocModalOverlay');
}

function handleOpenRenameBillDoc(docId) {
  const bill = findBillById(currentBillDocsBillId);
  const doc = bill ? (bill.documents || []).find(d => d.id === docId) : null;
  if (!doc) return;

  document.getElementById('renameBillDocId').value = doc.id;
  document.getElementById('renameBillDocInput').value = doc.fileName;
  openModal('renameBillDocModalOverlay');
}

function handleRenameBillDocSubmit(e) {
  e.preventDefault();
  const docId = document.getElementById('renameBillDocId').value;
  const newName = document.getElementById('renameBillDocInput').value.trim();
  if (!newName) return;

  const bills = getBills();
  const billIdx = bills.findIndex(b => b.id === currentBillDocsBillId);
  if (billIdx === -1) return;

  const docIdx = (bills[billIdx].documents || []).findIndex(d => d.id === docId);
  if (docIdx === -1) return;

  bills[billIdx].documents[docIdx].fileName = newName;
  saveBills(bills);

  closeModal('renameBillDocModalOverlay');
  renderBillDocsTable();
  showToast('Document renamed.', 'success');
}

function handleDownloadBillDoc(docId) {
  const bill = findBillById(currentBillDocsBillId);
  const doc = bill ? (bill.documents || []).find(d => d.id === docId) : null;
  if (!doc) return;

  const link = document.createElement('a');
  link.href = doc.dataUrl;
  link.download = doc.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function handleDeleteBillDoc(docId) {
  const bill = findBillById(currentBillDocsBillId);
  const doc = bill ? (bill.documents || []).find(d => d.id === docId) : null;
  if (!doc) return;

  confirmDelete(
    `Delete document "${doc.fileName}"? This cannot be undone.`,
    () => {
      const bills = getBills();
      const billIdx = bills.findIndex(b => b.id === currentBillDocsBillId);
      if (billIdx === -1) return;

      bills[billIdx].documents = (bills[billIdx].documents || []).filter(d => d.id !== docId);
      saveBills(bills);
      renderBillDocsTable();
      showToast('Document deleted.', 'success');
    },
    'Delete Document',
    '<i class="fa-solid fa-trash"></i> Delete Document'
  );
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function attachBillEvents() {
  document.getElementById('addBillBtn').addEventListener('click', openAddBillModal);
  document.getElementById('closeBillModal').addEventListener('click', () => {
    closeModal('billModalOverlay');
    resetScannedReceiptPreview();
  });
  document.getElementById('billForm').addEventListener('submit', handleBillFormSubmit);
  enableClickOutsideClose('billModalOverlay');

  document.getElementById('scanReceiptBtn').addEventListener('click', triggerReceiptScan);
  document.getElementById('removeScannedReceiptBtn').addEventListener('click', () => {
    resetScannedReceiptPreview();
    showToast('Scanned receipt removed. It will not be attached when you save.', 'info');
  });

  document.getElementById('billSearchInput').addEventListener('input', (e) => {
    billSearchTerm = e.target.value;
    renderBillTable();
  });

  document.getElementById('billCategoryFilter').addEventListener('change', (e) => {
    billCategoryFilter = e.target.value;
    renderBillTable();
  });

  document.getElementById('billSortSelect').addEventListener('change', (e) => {
    billSortMode = e.target.value;
    renderBillTable();
  });

  document.getElementById('billTableBody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-bill]');
    const deleteBtn = e.target.closest('[data-delete-bill]');
    const docsBtn = e.target.closest('[data-open-bill-docs]');

    if (editBtn) openEditBillModal(editBtn.dataset.editBill);
    if (deleteBtn) handleDeleteBill(deleteBtn.dataset.deleteBill);
    if (docsBtn) openBillDocsModal(docsBtn.dataset.openBillDocs);
  });

  document.getElementById('closeBillDocsModal').addEventListener('click', () => closeModal('billDocsModalOverlay'));
  enableClickOutsideClose('billDocsModalOverlay');

  const uploadInput = document.getElementById('billDocUploadInput');
  uploadInput.addEventListener('change', () => {
    handleBillDocUpload(uploadInput.files);
    uploadInput.value = '';
  });

  document.getElementById('billDocSearchInput').addEventListener('input', (e) => {
    billDocSearchTerm = e.target.value;
    renderBillDocsTable();
  });

  document.getElementById('billDocSortSelect').addEventListener('change', (e) => {
    billDocSortMode = e.target.value;
    renderBillDocsTable();
  });

  document.getElementById('billDocsTableBody').addEventListener('click', (e) => {
    const viewBtn = e.target.closest('[data-view-bill-doc]');
    const renameBtn = e.target.closest('[data-rename-bill-doc]');
    const downloadBtn = e.target.closest('[data-download-bill-doc]');
    const deleteBtn = e.target.closest('[data-delete-bill-doc]');

    if (viewBtn) handleViewBillDoc(viewBtn.dataset.viewBillDoc);
    if (renameBtn) handleOpenRenameBillDoc(renameBtn.dataset.renameBillDoc);
    if (downloadBtn) handleDownloadBillDoc(downloadBtn.dataset.downloadBillDoc);
    if (deleteBtn) handleDeleteBillDoc(deleteBtn.dataset.deleteBillDoc);
  });

  document.getElementById('closeRenameBillDocModal').addEventListener('click', () => closeModal('renameBillDocModalOverlay'));
  enableClickOutsideClose('renameBillDocModalOverlay');
  document.getElementById('renameBillDocForm').addEventListener('submit', handleRenameBillDocSubmit);

  document.getElementById('closeViewBillDocModal').addEventListener('click', () => closeModal('viewBillDocModalOverlay'));
  enableClickOutsideClose('viewBillDocModalOverlay');

  document.getElementById('billTableBody').closest('table').querySelector('thead').addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-cf-open-manager]');
    if (openBtn) {
      openCustomFieldsManager(CF_MODULE_BILLS, 'Bills', renderBillTable);
    }
  });

  document.getElementById('billCustomFieldsBtn').addEventListener('click', () => {
    openCustomFieldsManager(CF_MODULE_BILLS, 'Bills', renderBillTable);
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