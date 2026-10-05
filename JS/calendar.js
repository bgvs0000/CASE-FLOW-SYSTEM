/* ============================================================
   CASEFLOW — CALENDAR.JS
   Month grid rendering, navigation (prev/next/today), MIXED
   hearing + custom NOTE pills per day, day-events list modal
   for overflow, hearing detail (via hearings.js), and (NEW) full Note CRUD:
   Add Note (title/description/image), Note Detail (view/edit/
   delete), permission-checked so only the creator or an
   Attorney/Head/IT can edit/delete someone else's note.

   Depends on: storage.js, auth.js, modal.js, navigation.js, hearings.js
   ============================================================ */

let calendarViewDate = new Date();
let currentCalendarSession = null;
let currentCalendarUser = null;
let pendingNoteImageDataUrl = null;

document.addEventListener('DOMContentLoaded', () => {
  currentCalendarSession = requireAuth();
  if (!currentCalendarSession) return;

  currentCalendarUser = getCurrentUser();
  initLayout('calendar');
  renderCalendar();
  attachCalendarEvents();
});

/* ============================================================
   BUILD A LOOKUP OF EVENTS BY DATE (YYYY-MM-DD -> array)
   ============================================================ */
function getEventsByDate() {
  const map = {};

  // ---------- HEARINGS ----------
  getHearings().forEach(h => {
    if (!h.hearingDate) return;
    const caseObj = findCaseById(h.caseId);
    if (!caseObj) return;

    if (!map[h.hearingDate]) map[h.hearingDate] = [];
    map[h.hearingDate].push({
      eventType: 'hearing',
      hearingId: h.id,
      caseId: h.caseId,
      label: h.hearingName,
      subLabel: caseObj.caseNumber
    });
  });

  // ---------- CUSTOM NOTES (NEW) ----------
  getCalendarNotes().forEach(n => {
    if (!n.date) return;

    if (!map[n.date]) map[n.date] = [];
    map[n.date].push({
      eventType: 'note',
      noteId: n.id,
      label: n.title,
      subLabel: n.description ? truncateNoteText(n.description, 40) : ''
    });
  });

  return map;
}

function truncateNoteText(text, maxLen) {
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

/* ============================================================
   RENDER CALENDAR GRID
   ============================================================ */
function renderCalendar() {
  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('calendarMonthLabel').textContent = `${monthNames[month]} ${year}`;

  const firstDayOfMonth = new Date(year, month, 1);
  const startWeekday = firstDayOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const eventsByDate = getEventsByDate();
  const todayStr = formatDateForKey(new Date());

  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  let html = '';

  for (let i = 0; i < totalCells; i++) {
    const dayOffset = i - startWeekday;
    let cellDate, isOutsideMonth;

    if (dayOffset < 0) {
      cellDate = new Date(year, month - 1, daysInPrevMonth + dayOffset + 1);
      isOutsideMonth = true;
    } else if (dayOffset >= daysInMonth) {
      cellDate = new Date(year, month + 1, dayOffset - daysInMonth + 1);
      isOutsideMonth = true;
    } else {
      cellDate = new Date(year, month, dayOffset + 1);
      isOutsideMonth = false;
    }

    const dateStr = formatDateForKey(cellDate);
    const isToday = dateStr === todayStr;
    const dayEvents = eventsByDate[dateStr] || [];

    const MAX_VISIBLE_PILLS = 2;
    const visibleEvents = dayEvents.slice(0, MAX_VISIBLE_PILLS);
    const remainingCount = dayEvents.length - visibleEvents.length;

    const pillsHtml = visibleEvents.map(ev => buildEventPillHtml(ev)).join('');

    const morePillHtml = remainingCount > 0
      ? `<div class="calendar-more-pill" data-more-pill data-date="${dateStr}">+${remainingCount} more</div>`
      : '';

    html += `
      <div class="calendar-day-cell ${isOutsideMonth ? 'outside-month' : ''} ${isToday ? 'today' : ''}">
        <div class="calendar-day-number">${cellDate.getDate()}</div>
        ${pillsHtml}
        ${morePillHtml}
      </div>
    `;
  }

  document.getElementById('calendarGrid').innerHTML = html;
}

/**
 * Builds the pill markup for a single event (hearing or note).
 */
function buildEventPillHtml(ev) {
  if (ev.eventType === 'hearing') {
    return `
      <div class="calendar-event-pill pill-hearing" data-hearing-pill data-case-id="${ev.caseId}" data-hearing-id="${ev.hearingId}" title="${escapeHtml(ev.subLabel)} — ${escapeHtml(ev.label)}">
        <i class="fa-solid fa-gavel"></i>${escapeHtml(ev.subLabel)}
      </div>
    `;
  }
  return `
    <div class="calendar-event-pill pill-note" data-note-pill data-note-id="${ev.noteId}" title="${escapeHtml(ev.label)}">
      <i class="fa-solid fa-note-sticky"></i>${escapeHtml(ev.label)}
    </div>
  `;
}

function formatDateForKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* ============================================================
   DAY EVENTS LIST MODAL (hearings + notes mixed)
   ============================================================ */
function openDayHearingsModal(dateStr) {
  const eventsByDate = getEventsByDate();
  const dayEvents = eventsByDate[dateStr] || [];

  document.getElementById('dayHearingsDateLabel').textContent = formatDate(dateStr);

  document.getElementById('dayHearingsList').innerHTML = dayEvents.length > 0
    ? dayEvents.map(ev => {
        if (ev.eventType === 'hearing') {
          return `
            <div class="day-hearing-item" data-day-hearing-item data-case-id="${ev.caseId}" data-hearing-id="${ev.hearingId}">
              <div class="event-type-tag"><i class="fa-solid fa-gavel"></i> Hearing</div>
              <strong>${escapeHtml(ev.subLabel)} — ${escapeHtml(ev.label)}</strong>
              <span>Click to view case & hearing details</span>
            </div>
          `;
        }
        return `
          <div class="day-hearing-item event-note" data-day-note-item data-note-id="${ev.noteId}">
            <div class="event-type-tag"><i class="fa-solid fa-note-sticky"></i> Note</div>
            <strong>${escapeHtml(ev.label)}</strong>
            <span>${escapeHtml(ev.subLabel)}</span>
          </div>
        `;
      }).join('')
    : `<p class="text-muted">No events on this date.</p>`;

  openModal('dayHearingsModalOverlay');
}

/* ============================================================
   NOTE CRUD (NEW)
   ============================================================ */
function canManageNote(note) {
  if (!note) return false;
  if (note.createdBy === currentCalendarUser.id) return true;
  return ['attorney', 'head', 'it'].includes(currentCalendarUser.role);
}

function readNoteFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ---------- ADD / EDIT NOTE MODAL ---------- */
function openAddNoteModal(prefillDate = null) {
  document.getElementById('noteEditorTitle').innerHTML = '<i class="fa-solid fa-note-sticky"></i> Add Note';
  document.getElementById('noteEditorForm').reset();
  document.getElementById('noteId').value = '';
  document.getElementById('noteDate').value = prefillDate || formatDateForKey(new Date());
  document.getElementById('noteImgPreviewWrap').style.display = 'none';
  document.getElementById('noteImgPreview').src = '';
  pendingNoteImageDataUrl = null;
  clearNoteFormError();
  openModal('noteEditorModalOverlay');
}

function openEditNoteModal(noteId) {
  const note = findCalendarNoteById(noteId);
  if (!note || !canManageNote(note)) {
    showToast('You do not have permission to edit this note.', 'error');
    return;
  }

  document.getElementById('noteEditorTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Edit Note';
  clearNoteFormError();

  document.getElementById('noteId').value = note.id;
  document.getElementById('noteDate').value = note.date;
  document.getElementById('noteTitle').value = note.title;
  document.getElementById('noteDescription').value = note.description || '';

  if (note.imageDataUrl) {
    document.getElementById('noteImgPreview').src = note.imageDataUrl;
    document.getElementById('noteImgPreviewWrap').style.display = 'block';
    pendingNoteImageDataUrl = note.imageDataUrl;
  } else {
    document.getElementById('noteImgPreviewWrap').style.display = 'none';
    pendingNoteImageDataUrl = null;
  }

  closeModal('noteDetailModalOverlay');
  openModal('noteEditorModalOverlay');
}

async function handleNoteImageSelect(file) {
  if (!file) return;

  const MAX_IMAGE_SIZE = 3 * 1024 * 1024;
  if (file.size > MAX_IMAGE_SIZE) {
    showNoteFormError('Image too large (3MB limit for this prototype).');
    document.getElementById('noteImageInput').value = '';
    return;
  }

  try {
    const dataUrl = await readNoteFileAsDataUrl(file);
    pendingNoteImageDataUrl = dataUrl;
    document.getElementById('noteImgPreview').src = dataUrl;
    document.getElementById('noteImgPreviewWrap').style.display = 'block';
  } catch (err) {
    console.error('[calendar.js] Failed to read note image:', err);
    showNoteFormError('Failed to read image file.');
  }
}

function handleNoteFormSubmit(e) {
  e.preventDefault();
  clearNoteFormError();

  const id = document.getElementById('noteId').value;
  const date = document.getElementById('noteDate').value;
  const title = document.getElementById('noteTitle').value.trim();
  const description = document.getElementById('noteDescription').value.trim();

  if (!date || !title) {
    showNoteFormError('Please fill in the Date and Title.');
    return;
  }

  const notes = getCalendarNotes();

  if (id) {
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) return;
    if (!canManageNote(notes[idx])) {
      showNoteFormError('You do not have permission to edit this note.');
      return;
    }
    notes[idx] = {
      ...notes[idx],
      date, title, description,
      imageDataUrl: pendingNoteImageDataUrl || null,
      updatedAt: nowISO()
    };
    saveCalendarNotes(notes);
    showToast('Note updated.', 'success');
  } else {
    notes.push({
      id: generateId('NOTE'),
      date, title, description,
      imageDataUrl: pendingNoteImageDataUrl || null,
      createdBy: currentCalendarUser.id,
      createdAt: nowISO()
    });
    saveCalendarNotes(notes);
    showToast('Note added to calendar.', 'success');
  }

  closeModal('noteEditorModalOverlay');
  renderCalendar();
}

/* ---------- NOTE DETAIL MODAL ---------- */
let currentDetailNoteId = null;

function openNoteDetailModal(noteId) {
  const note = findCalendarNoteById(noteId);
  if (!note) return;

  currentDetailNoteId = noteId;
  const creator = findUserById(note.createdBy);

  document.getElementById('noteDetailTitle').textContent = note.title;
  document.getElementById('noteDetailDate').textContent = formatDate(note.date);
  document.getElementById('noteDetailDescription').textContent = note.description || 'No description provided.';

  const imgWrap = document.getElementById('noteDetailImageWrap');
  if (note.imageDataUrl) {
    document.getElementById('noteDetailImage').src = note.imageDataUrl;
    imgWrap.style.display = 'block';
  } else {
    imgWrap.style.display = 'none';
  }

  document.getElementById('noteDetailMeta').textContent = `Added by ${creator ? creator.firstName + ' ' + creator.lastName : 'Unknown'} on ${formatDateTime(note.createdAt)}`;

  const canManage = canManageNote(note);
  document.getElementById('noteDetailActions').style.display = canManage ? 'flex' : 'none';

  openModal('noteDetailModalOverlay');
}

function handleDeleteNote() {
  const note = findCalendarNoteById(currentDetailNoteId);
  if (!note || !canManageNote(note)) return;

  confirmDelete(
    `Delete note "${note.title}"? This cannot be undone.`,
    () => {
      saveCalendarNotes(getCalendarNotes().filter(n => n.id !== note.id));
      closeModal('noteDetailModalOverlay');
      renderCalendar();
      showToast('Note deleted.', 'success');
    },
    'Delete Note',
    '<i class="fa-solid fa-trash"></i> Delete Note'
  );
}

/* ---------- FORM ERROR HELPERS (note editor) ---------- */
function showNoteFormError(msg) {
  const el = document.getElementById('noteEditorError');
  el.textContent = msg;
  el.classList.add('active');
}
function clearNoteFormError() {
  const el = document.getElementById('noteEditorError');
  el.textContent = '';
  el.classList.remove('active');
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function attachCalendarEvents() {
  document.getElementById('prevMonthBtn').addEventListener('click', () => {
    calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
    renderCalendar();
  });

  document.getElementById('nextMonthBtn').addEventListener('click', () => {
    calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
    renderCalendar();
  });

  document.getElementById('todayBtn').addEventListener('click', () => {
    calendarViewDate = new Date();
    renderCalendar();
  });

  // Delegated clicks on the calendar grid: hearing/note pills, "more" pills
  document.getElementById('calendarGrid').addEventListener('click', (e) => {
    const hearingPill = e.target.closest('[data-hearing-pill]');
    const notePill = e.target.closest('[data-note-pill]');
    const morePill = e.target.closest('[data-more-pill]');

    if (hearingPill) {
      openHearingDetailModal(hearingPill.dataset.caseId, hearingPill.dataset.hearingId);
    } else if (notePill) {
      openNoteDetailModal(notePill.dataset.noteId);
    } else if (morePill) {
      openDayHearingsModal(morePill.dataset.date);
    }
  });

  // Delegated clicks inside the Day Events List modal
  document.getElementById('dayHearingsList').addEventListener('click', (e) => {
    const hearingItem = e.target.closest('[data-day-hearing-item]');
    const noteItem = e.target.closest('[data-day-note-item]');

    if (hearingItem) {
      closeModal('dayHearingsModalOverlay');
      openHearingDetailModal(hearingItem.dataset.caseId, hearingItem.dataset.hearingId);
    } else if (noteItem) {
      closeModal('dayHearingsModalOverlay');
      openNoteDetailModal(noteItem.dataset.noteId);
    }
  });

  document.getElementById('closeDayHearingsModal').addEventListener('click', () => closeModal('dayHearingsModalOverlay'));
  enableClickOutsideClose('dayHearingsModalOverlay');

  /* ---------- NOTE EDITOR ---------- */
  document.getElementById('addNoteBtn').addEventListener('click', () => openAddNoteModal());
  document.getElementById('closeNoteEditorModal').addEventListener('click', () => closeModal('noteEditorModalOverlay'));
  enableClickOutsideClose('noteEditorModalOverlay');
  document.getElementById('noteEditorForm').addEventListener('submit', handleNoteFormSubmit);

  const noteImageInput = document.getElementById('noteImageInput');
  noteImageInput.addEventListener('change', () => handleNoteImageSelect(noteImageInput.files[0]));

  document.getElementById('removeNoteImageBtn').addEventListener('click', () => {
    pendingNoteImageDataUrl = null;
    document.getElementById('noteImgPreviewWrap').style.display = 'none';
    document.getElementById('noteImageInput').value = '';
  });

  /* ---------- NOTE DETAIL ---------- */
  document.getElementById('closeNoteDetailModal').addEventListener('click', () => closeModal('noteDetailModalOverlay'));
  enableClickOutsideClose('noteDetailModalOverlay');
  document.getElementById('editNoteBtn').addEventListener('click', () => openEditNoteModal(currentDetailNoteId));
  document.getElementById('deleteNoteBtn').addEventListener('click', handleDeleteNote);
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