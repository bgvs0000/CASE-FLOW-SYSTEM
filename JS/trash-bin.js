/* ============================================================
   CASEFLOW — TRASH-BIN.JS
   Recycle Bin for the whole system.

   WHAT IT DOES
   1. Every delete (single, bulk, cascade) is caught at the
      storage layer and the record is MOVED TO TRASH instead of
      being lost: Cases (with their documents / progress /
      hearings), Clients, Calendar Notes, Accounts, and files
      inside Cases.
   2. "Moved to Trash · Undo" snackbar right after deleting.
   3. Trash Bin modal (trash icon in the top bar):
      search, filter by type, sort, select many,
      Restore / Delete forever / Empty Trash.
      Items are kept for 30 days, then removed automatically.
   4. RESTORE CHECKS before anything is put back:
      - already in the system       → just remove from trash
      - same Case No. / client name or email /
        username or email / file name → Keep both (renamed copy),
        Replace the existing one (it goes to trash), or Cancel
      - looks like a duplicate (same note)
                                   → Restore anyway or Cancel
      - parent is gone (file of a deleted case)
                                   → Restore the parent first
                                     (one click if it's in trash)
      - linked record missing (client of a case)
                                   → warning, Restore anyway
   5. Employees only see what they deleted; attorney / head / IT
      see everything.
   6. Delete confirmations now say the item goes to the Trash Bin.

   Put this script on EVERY internal page, before account.js.
   Depends on: storage.js, modal.js
   ============================================================ */

const TRASH_KEY = 'caseflow_trash';
const TRASH_DAYS = 30;

const TRASH = {
  pending: [],
  flushTimer: 0,
  quiet: 0,            // >0 while the trash itself is writing (no snackbar)
  filter: 'all',
  search: '',
  sort: 'newest',
  selected: new Set(),
  conflicts: {},       // entryId → conflict object
  orig: {}             // original save functions
};

/* ---------- item types ---------- */
const TRASH_TYPES = {
  case:     { label: 'Case',              icon: 'fa-scale-balanced', group: 'cases' },
  hearing:  { label: 'Hearing',           icon: 'fa-gavel',          group: 'cases' },
  progress: { label: 'Progress Entry',    icon: 'fa-list-check',     group: 'cases' },
  client:   { label: 'Client',            icon: 'fa-user',           group: 'clients' },
  note:     { label: 'Calendar Note',     icon: 'fa-note-sticky',    group: 'notes' },
  account:  { label: 'Account',           icon: 'fa-id-badge',       group: 'accounts' },
  caseDoc:  { label: 'Case Document',     icon: 'fa-file-lines',     group: 'docs' }
};

const TRASH_GROUPS = [
  { key: 'all', label: 'All' },
  { key: 'cases', label: 'Cases' },
  { key: 'clients', label: 'Clients' },
  { key: 'notes', label: 'Notes' },
  { key: 'docs', label: 'Files' },
  { key: 'accounts', label: 'Accounts' }
];

/* ---------- storage collections that are watched ---------- */
const TRASH_COLLECTIONS = [
  { type: 'case',     get: 'getCases',            save: 'saveCases' },
  { type: 'client',   get: 'getClients',          save: 'saveClients' },
  { type: 'note',     get: 'getCalendarNotes',    save: 'saveCalendarNotes' },
  { type: 'account',  get: 'getUsers',            save: 'saveUsers' },
  { type: 'caseDoc',  get: 'getDocuments',        save: 'saveDocuments' },
  { type: 'hearing',  get: 'getHearings',         save: 'saveHearings' },
  { type: 'progress', get: 'getProgressEntries',  save: 'saveProgressEntries' }
];
const TRASH_COL_BY_TYPE = {};
TRASH_COLLECTIONS.forEach(c => { TRASH_COL_BY_TYPE[c.type] = c; });
const TRASH_NESTED_PARENT = {}; // (no modules with files-inside-a-record in this build)
const TRASH_CASE_CHILD = { caseDoc: 'documents', hearing: 'hearings', progress: 'progress' };

/* ============================================================
   1. WATCH EVERY DELETE (wrap the save functions)
   ============================================================ */
(function trashWrapSaves() {
  TRASH_COLLECTIONS.forEach(col => {
    const original = window[col.save];
    const getter = window[col.get];
    if (typeof original !== 'function' || typeof getter !== 'function' || original._trashWrapped) return;
    TRASH.orig[col.save] = original;

    const wrapped = function (newList) {
      try {
        if (Array.isArray(newList)) {
          const oldList = getter() || [];
          const newById = new Map(newList.filter(Boolean).map(x => [x.id, x]));

          oldList.forEach(old => {
            if (!old || !old.id) return;
            const now = newById.get(old.id);
            if (!now) {
              const meta = {};
              if (col.type === 'account' && typeof getAccessOverrideForUser === 'function') {
                meta.accessOverride = getAccessOverrideForUser(old.id);
              }
              trashQueue(col.type, old, meta);
            } else if (col.nested) {
              // files removed from inside a parent record
              const keep = new Set((now.documents || []).map(d => d.id));
              (old.documents || []).forEach(d => {
                if (d && d.id && !keep.has(d.id)) {
                  trashQueue(col.nested, d, { parentId: old.id, parentName: trashParentLabel(col.type, old) });
                }
              });
            }
          });
        }
      } catch (err) {
        console.error('[trash-bin.js] watch failed:', err);
      }
      return original.apply(this, arguments);
    };
    wrapped._trashWrapped = true;
    window[col.save] = wrapped;
  });

  // delete confirmations now mention the Trash Bin
  if (typeof window.confirmDelete === 'function' && !window.confirmDelete._trashWrapped) {
    const origConfirm = window.confirmDelete;
    TRASH.origConfirm = origConfirm;
    const patched = function (message, onConfirm, title, label, icon) {
      let msg = String(message || '')
        .replace(/\s*This cannot be undone\.?/gi, ' It will be moved to the Trash Bin — you can restore it within 30 days.')
        .replace(/Permanently delete/gi, 'Delete')
        .replace(/permanently remove/gi, 'remove');
      return origConfirm.call(this, msg, onConfirm, title, label, icon);
    };
    patched._trashWrapped = true;
    window.confirmDelete = patched;
  }
})();

function trashParentLabel(type, p) {
  if (type === 'case') return p.caseNumber || p.caseName || 'Case';
  return '';
}

function trashQueue(type, item, meta) {
  TRASH.pending.push({ type, item: trashClone(item), meta: meta || {}, quiet: TRASH.quiet > 0 });
  if (!TRASH.flushTimer) TRASH.flushTimer = setTimeout(trashFlush, 0);
}

/** Group one batch of removals: a case takes its docs / hearings / progress */
function trashFlush() {
  TRASH.flushTimer = 0;
  const batch = TRASH.pending.splice(0);
  if (!batch.length) return;

  const me = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const by = me ? { id: me.id, name: `${me.firstName} ${me.lastName}` } : { id: null, name: 'System' };
  const stamp = typeof nowISO === 'function' ? nowISO() : new Date().toISOString();
  let seq = 0;
  const make = (b) => ({
    id: `TR-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.floor(Math.random() * 1e4)}`,
    type: b.type,
    item: b.item,
    meta: b.meta,
    deletedAt: stamp,
    deletedBy: by
  });

  const entries = [];
  const caseEntries = {};
  batch.filter(b => b.type === 'case').forEach(b => {
    const e = make(b);
    e.children = { documents: [], hearings: [], progress: [] };
    caseEntries[b.item.id] = e;
    entries.push(e);
  });
  batch.forEach(b => {
    if (b.type === 'case') return;
    const childKey = TRASH_CASE_CHILD[b.type];
    if (childKey && caseEntries[b.item.caseId]) {
      caseEntries[b.item.caseId].children[childKey].push(b.item);
      return;
    }
    entries.push(make(b));
  });

  const list = trashGetAll();
  trashSaveAll(entries.concat(list));
  trashUpdateBadge();
  if (document.getElementById('trashModalOverlay') && document.getElementById('trashModalOverlay').classList.contains('active')) {
    trashRender();
  }

  if (!batch.every(b => b.quiet)) trashSnackbar(entries);
}

/* ============================================================
   TRASH STORAGE
   ============================================================ */
function trashGetAll() {
  try {
    const list = JSON.parse(localStorage.getItem(TRASH_KEY));
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

function trashSaveAll(list) {
  const write = (l) => { localStorage.setItem(TRASH_KEY, JSON.stringify(l)); };
  try { write(list); return true; } catch (e) { /* full — try to make room */ }

  // 1) drop the oldest entries
  let l = list.slice().sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  while (l.length > 1) {
    l.pop();
    try { write(l); trashToast('Trash was full — the oldest items were removed.', 'error'); return true; } catch (e) { /* keep trimming */ }
  }
  // 2) keep the records but drop the file contents
  l = list.map(trashStripFiles);
  try { write(l); trashToast('Trash is full — file contents were not kept (details only).', 'error'); return true; } catch (e) { /* give up */ }
  trashToast('Could not save to Trash — browser storage is full.', 'error');
  return false;
}

function trashStripFiles(entry) {
  const strip = (o) => {
    if (!o || typeof o !== 'object') return o;
    const c = Array.isArray(o) ? o.map(strip) : { ...o };
    if (!Array.isArray(c)) {
      ['dataUrl', 'imageDataUrl', 'profilePhoto'].forEach(k => { if (c[k]) { c[k] = null; c._fileLost = true; } });
      Object.keys(c).forEach(k => { if (c[k] && typeof c[k] === 'object') c[k] = strip(c[k]); });
    }
    return c;
  };
  return strip(entry);
}

function trashPurgeOld() {
  const limit = Date.now() - TRASH_DAYS * 86400000;
  const list = trashGetAll();
  const keep = list.filter(e => new Date(e.deletedAt).getTime() >= limit);
  if (keep.length !== list.length) trashSaveAll(keep);
}

function trashRemoveEntries(ids) {
  const set = new Set(ids);
  trashSaveAll(trashGetAll().filter(e => !set.has(e.id)));
  ids.forEach(id => { TRASH.selected.delete(id); delete TRASH.conflicts[id]; });
}

/* ============================================================
   WHO SEES WHAT
   ============================================================ */
function trashIsManager() {
  const me = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  return !!(me && me.role !== 'employee');
}

function trashVisible() {
  const me = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const all = trashGetAll();
  if (trashIsManager()) return all;
  return all.filter(e => e.type !== 'account' && e.deletedBy && me && e.deletedBy.id === me.id);
}

/* ============================================================
   NAMES / DETAILS
   ============================================================ */
function trashName(e) {
  const i = e.item || {};
  switch (e.type) {
    case 'case': return `${i.caseNumber || '—'} · ${i.caseName || 'Untitled case'}`;
    case 'client': return i.name || 'Unnamed client';
    case 'note': return i.title || 'Calendar note';
    case 'account': return `${i.firstName || ''} ${i.lastName || ''} (@${i.username || '—'})`;
    case 'hearing': return i.hearingName || 'Hearing';
    case 'progress': return i.title || 'Progress entry';
    default: return i.fileName || 'File';
  }
}

function trashDetails(e) {
  const i = e.item || {};
  const parts = [];
  if (e.type === 'case') {
    const c = e.children || {};
    const bits = [];
    if ((c.documents || []).length) bits.push(`${c.documents.length} document(s)`);
    if ((c.hearings || []).length) bits.push(`${c.hearings.length} hearing(s)`);
    if ((c.progress || []).length) bits.push(`${c.progress.length} progress`);
    if (bits.length) parts.push('with ' + bits.join(', '));
  }
  if (e.type === 'client' && (i.email || i.contact)) parts.push(i.email || i.contact);
  if (e.type === 'note' && i.date) parts.push(trashDate(i.date));
  if (e.type === 'account' && i.role) parts.push(i.role);
  if (e.type === 'hearing' && i.hearingDate) parts.push(trashDate(i.hearingDate));
  if (['caseDoc', 'hearing', 'progress'].includes(e.type) && i.caseId) {
    const c = typeof getCases === 'function' ? getCases().find(x => x.id === i.caseId) : null;
    parts.push('from ' + (c ? (c.caseNumber || c.caseName) : 'a deleted case'));
  }
  if (e.meta && e.meta.parentName) parts.push('from ' + e.meta.parentName);
  if (i._fileLost) parts.push('file content not kept');
  return parts.join(' · ');
}

/* ============================================================
   2. RESTORE CHECKS
   ============================================================ */
const trLc = (v) => String(v === undefined || v === null ? '' : v).trim().toLowerCase();

function trashCheck(e) {
  const i = e.item || {};
  const col = TRASH_COL_BY_TYPE[e.type];
  const list = col ? window[col.get]() : [];

  // same record already back in the system
  if (col && list.some(x => x.id === i.id)) {
    return { kind: 'exists', msg: 'This item is already in the system (it was restored or re-added).' };
  }

  const inTrashParent = (type, id) => trashGetAll().find(t => t.type === type && t.item && t.item.id === id);

  switch (e.type) {
    case 'case': {
      const d = list.find(c => trLc(c.caseNumber) && trLc(c.caseNumber) === trLc(i.caseNumber));
      if (d) return { kind: 'dup', existingId: d.id, msg: `Case No. "${i.caseNumber}" is already used by "${d.caseName}".` };
      if (i.clientId && !getClients().some(c => c.id === i.clientId)) {
        return { kind: 'warn', msg: 'Its client no longer exists — the case will show as "Unknown Client".' };
      }
      return null;
    }
    case 'client': {
      const d = list.find(c => trLc(c.name) === trLc(i.name)) ||
                list.find(c => trLc(i.email) && trLc(c.email) === trLc(i.email));
      if (d) {
        const why = trLc(d.name) === trLc(i.name) ? `named "${d.name}"` : `with email "${d.email}"`;
        return { kind: 'dup', existingId: d.id, msg: `There is already a client ${why}.` };
      }
      return null;
    }
    case 'note': {
      const d = list.find(n => trLc(n.title) === trLc(i.title) && n.date === i.date);
      if (d) return { kind: 'soft', existingId: d.id, msg: `A note "${d.title}" on the same date already exists.` };
      return null;
    }
    case 'account': {
      const d = list.find(u => trLc(u.username) === trLc(i.username)) ||
                list.find(u => trLc(i.email) && trLc(u.email) === trLc(i.email));
      if (d) {
        const why = trLc(d.username) === trLc(i.username) ? `username "@${d.username}"` : `email "${d.email}"`;
        return { kind: 'dup', existingId: d.id, noCopy: true, msg: `Another account already uses the ${why}.` };
      }
      return null;
    }
    case 'caseDoc':
    case 'hearing':
    case 'progress': {
      if (!getCases().some(c => c.id === i.caseId)) {
        const p = inTrashParent('case', i.caseId);
        return { kind: 'block', parentEntryId: p ? p.id : null,
          msg: p ? `Its case "${trashName(p)}" is in the Trash. Restore the case first.` : 'Its case was deleted permanently — this cannot be restored.' };
      }
      if (e.type === 'caseDoc') {
        const d = list.find(x => x.caseId === i.caseId && trLc(x.fileName) === trLc(i.fileName));
        if (d) return { kind: 'dup', existingId: d.id, msg: `This case already has a file named "${i.fileName}".` };
      }
      return null;
    }
  }
  return null;
}

/** Make a renamed copy so it can live beside the existing one */
function trashMakeCopy(type, item) {
  const c = trashClone(item);
  const renameFile = (name) => {
    const m = String(name || 'file').match(/^(.*?)(\.[^.]+)?$/);
    return `${m[1]} (restored)${m[2] || ''}`;
  };
  switch (type) {
    case 'case': c.caseNumber = trashUnique(`${c.caseNumber} (restored)`, getCases().map(x => x.caseNumber)); break;
    case 'client': {
      c.name = trashUnique(`${c.name} (restored)`, getClients().map(x => x.name));
      if (c.email && getClients().some(x => trLc(x.email) === trLc(c.email))) c.email = '';
      break;
    }
    default: if (c.fileName) c.fileName = renameFile(c.fileName);
  }
  return c;
}

function trashUnique(base, taken) {
  const set = new Set(taken.map(trLc));
  let v = base, n = 2;
  while (set.has(trLc(v))) v = `${base} ${n++}`;
  return v;
}

/**
 * Restore one entry.
 * mode: undefined = check first · 'copy' keep both · 'replace' ·
 *       'anyway' · 'discard' (already exists) · 'withParent'
 * returns { ok } | { conflict } | { error }
 */
function trashRestore(entryId, mode) {
  const e = trashGetAll().find(x => x.id === entryId);
  if (!e) return { error: 'Not in trash anymore.' };
  const c = trashCheck(e);

  if (c && !mode) return { conflict: c };

  if (c) {
    if (c.kind === 'exists') {
      trashRemoveEntries([e.id]);
      return { ok: true, discarded: true };
    }
    if (c.kind === 'block') {
      if (mode !== 'withParent' || !c.parentEntryId) return { conflict: c };
      const parentResult = trashRestore(c.parentEntryId);
      if (!parentResult.ok) return { error: 'Restore the parent first — it has its own conflict to fix.', parentConflict: true };
      return trashRestore(entryId); // check again now that the parent is back
    }
    if (c.kind === 'dup' && mode === 'copy' && c.noCopy) return { conflict: c };
    if (c.kind === 'dup' && !['copy', 'replace'].includes(mode)) return { conflict: c };
    if ((c.kind === 'soft' || c.kind === 'warn') && mode !== 'anyway') return { conflict: c };
  }

  let item = trashClone(e.item);
  delete item._fileLost;

  TRASH.quiet++;
  try {
    if (c && c.kind === 'dup' && mode === 'replace') {
      const me = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
      if (e.type === 'account' && me && c.existingId === me.id) {
        return { error: 'You cannot replace your own account.' };
      }
      trashRemoveExisting(e.type, c.existingId, e.meta);
    }
    if (c && c.kind === 'dup' && mode === 'copy') item = trashMakeCopy(e.type, item);

    trashInsert(e.type, item, e.meta);

    // children of a case
    if (e.type === 'case' && e.children) {
      const addMissing = (getName, saveName, items) => {
        if (!items || !items.length || typeof window[getName] !== 'function') return;
        const list = window[getName]();
        const have = new Set(list.map(x => x.id));
        items.forEach(x => { if (!have.has(x.id)) list.push(x); });
        trashOrigSave(saveName, list);
      };
      addMissing('getDocuments', 'saveDocuments', e.children.documents);
      addMissing('getHearings', 'saveHearings', e.children.hearings);
      addMissing('getProgressEntries', 'saveProgressEntries', e.children.progress);
    }

    // account access settings
    if (e.type === 'account' && e.meta && e.meta.accessOverride && typeof getAccessControlList === 'function') {
      const acl = getAccessControlList().filter(a => a.userId !== item.id);
      acl.push(e.meta.accessOverride);
      saveAccessControlList(acl);
    }
  } finally {
    // let queued "replace" removals flush quietly
    setTimeout(() => { TRASH.quiet = Math.max(0, TRASH.quiet - 1); }, 0);
  }

  trashRemoveEntries([e.id]);
  const me = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (me && typeof logActivity === 'function') {
    logActivity(me.id, 'trash-restore', `Restored ${TRASH_TYPES[e.type].label.toLowerCase()} "${trashName(e)}" from the Trash Bin.`);
  }
  return { ok: true, renamed: c && c.kind === 'dup' && mode === 'copy' };
}

function trashOrigSave(saveName, list) {
  const fn = TRASH.orig[saveName] || window[saveName];
  return fn(list);
}

function trashInsert(type, item, meta) {
  if (TRASH_NESTED_PARENT[type]) {
    const parentCol = TRASH_COL_BY_TYPE[TRASH_NESTED_PARENT[type]];
    const parents = window[parentCol.get]();
    const p = parents.find(x => x.id === meta.parentId);
    if (!p) return;
    p.documents = (p.documents || []).concat([item]);
    trashOrigSave(parentCol.save, parents);
    return;
  }
  const col = TRASH_COL_BY_TYPE[type];
  const list = window[col.get]();
  list.push(item);
  trashOrigSave(col.save, list);
}

/** "Replace" — the existing record goes to the trash (normal delete) */
function trashRemoveExisting(type, id, meta) {
  if (TRASH_NESTED_PARENT[type]) {
    const parentCol = TRASH_COL_BY_TYPE[TRASH_NESTED_PARENT[type]];
    const parents = window[parentCol.get]();
    const p = parents.find(x => x.id === meta.parentId);
    if (!p) return;
    p.documents = (p.documents || []).filter(d => d.id !== id);
    window[parentCol.save](parents);
    return;
  }
  const col = TRASH_COL_BY_TYPE[type];
  window[col.save](window[col.get]().filter(x => x.id !== id));
  if (type === 'case') {
    if (typeof getDocuments === 'function') saveDocuments(getDocuments().filter(d => d.caseId !== id));
    if (typeof getHearings === 'function') saveHearings(getHearings().filter(h => h.caseId !== id));
    if (typeof getProgressEntries === 'function') saveProgressEntries(getProgressEntries().filter(p => p.caseId !== id));
  }
  if (type === 'account' && typeof clearAccessOverrideForUser === 'function') clearAccessOverrideForUser(id);
}

/* ============================================================
   3. UI — top bar button, modal, snackbar
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  trashInjectStyles();
  trashPurgeOld();
  trashInjectModal();

  // the top bar is built by navigation.js — wait for it
  const tryButton = () => {
    if (trashInjectNavButton()) return true;
    return false;
  };
  if (!tryButton()) {
    const mo = new MutationObserver(() => { if (tryButton()) mo.disconnect(); });
    mo.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 8000);
  }
});

function trashInjectNavButton() {
  const right = document.querySelector('#appTopnav .topnav-right, .topnav-right');
  if (!right) return false;
  if (document.getElementById('trashNavBtn')) return true;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'trashNavBtn';
  btn.className = 'notif-sound-toggle-btn trash-nav-btn';
  btn.title = 'Trash Bin';
  btn.innerHTML = '<i class="fa-solid fa-trash-can"></i><span class="trash-nav-badge" id="trashNavBadge"></span>';
  btn.addEventListener('click', trashOpen);

  const bell = right.querySelector('.notif-bell-wrap');
  right.insertBefore(btn, bell || right.firstChild);
  trashUpdateBadge();
  return true;
}

function trashUpdateBadge() {
  const badge = document.getElementById('trashNavBadge');
  if (!badge) return;
  const n = trashVisible().length;
  badge.textContent = n > 99 ? '99+' : n;
  badge.style.display = n ? '' : 'none';
}

function trashInjectModal() {
  if (document.getElementById('trashModalOverlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'trashModalOverlay';
  overlay.innerHTML = `
    <div class="modal-box modal-lg glass tb-modal">
      <div class="modal-header">
        <h2><i class="fa-solid fa-trash-can"></i> Trash Bin <span class="tb-head-count" id="tbHeadCount">0</span></h2>
        <button type="button" class="modal-close" id="tbCloseBtn">&times;</button>
      </div>

      <div class="modal-body tb-body">
        <div class="tb-note">
          <i class="fa-solid fa-circle-info"></i>
          Deleted items stay here for ${TRASH_DAYS} days, then they are removed for good.
          Restoring checks for duplicates first.
        </div>

        <div class="tb-toolbar">
          <div class="tb-search">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" id="tbSearch" placeholder="Search deleted items...">
          </div>
          <select id="tbSort" class="tb-select">
            <option value="newest">Recently deleted</option>
            <option value="oldest">Oldest first</option>
            <option value="type">By type</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>

        <div class="tb-chips" id="tbChips"></div>

        <div class="tb-bulk" id="tbBulk">
          <label class="tb-check-all"><input type="checkbox" id="tbSelectAll"> <span>Select all</span></label>
          <span class="tb-bulk-count" id="tbBulkCount"></span>
          <div class="tb-bulk-actions">
            <button type="button" class="tb-btn tb-btn-gold" id="tbRestoreSelected"><i class="fa-solid fa-rotate-left"></i> Restore</button>
            <button type="button" class="tb-btn tb-btn-danger" id="tbDeleteSelected"><i class="fa-solid fa-trash"></i> Delete forever</button>
          </div>
        </div>

        <div class="tb-list" id="tbList"></div>
      </div>

      <div class="modal-footer tb-footer">
        <span class="tb-foot-info" id="tbFootInfo"></span>
        <button type="button" class="tb-btn tb-btn-outline-danger" id="tbEmptyBtn"><i class="fa-solid fa-dumpster"></i> Empty Trash</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('tbCloseBtn').addEventListener('click', () => closeModal('trashModalOverlay'));
  if (typeof enableClickOutsideClose === 'function') enableClickOutsideClose('trashModalOverlay');

  document.getElementById('tbSearch').addEventListener('input', (e) => { TRASH.search = e.target.value; trashRender(); });
  document.getElementById('tbSort').addEventListener('change', (e) => { TRASH.sort = e.target.value; trashRender(); });

  document.getElementById('tbChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-group]');
    if (!chip) return;
    TRASH.filter = chip.dataset.group;
    trashRender();
  });

  document.getElementById('tbSelectAll').addEventListener('change', (e) => {
    trashShown().forEach(x => { if (e.target.checked) TRASH.selected.add(x.id); else TRASH.selected.delete(x.id); });
    trashRender();
  });

  document.getElementById('tbRestoreSelected').addEventListener('click', trashRestoreSelected);
  document.getElementById('tbDeleteSelected').addEventListener('click', () => {
    const ids = Array.from(TRASH.selected);
    if (!ids.length) return;
    trashConfirm(`Delete ${ids.length} item(s) forever? They cannot be restored after this.`, () => {
      trashRemoveEntries(ids);
      trashAfterChange();
      trashToast(`${ids.length} item(s) deleted forever.`, 'success');
    }, 'Delete Forever');
  });

  document.getElementById('tbEmptyBtn').addEventListener('click', () => {
    const ids = trashVisible().map(x => x.id);
    if (!ids.length) return;
    trashConfirm(`Empty the Trash Bin? ${ids.length} item(s) will be deleted forever.`, () => {
      trashRemoveEntries(ids);
      trashAfterChange();
      trashToast('Trash emptied.', 'success');
    }, 'Empty Trash');
  });

  document.getElementById('tbList').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-tb-check]');
    if (!cb) return;
    if (cb.checked) TRASH.selected.add(cb.dataset.tbCheck); else TRASH.selected.delete(cb.dataset.tbCheck);
    trashRefreshBulk();
    cb.closest('.tb-item').classList.toggle('selected', cb.checked);
  });

  document.getElementById('tbList').addEventListener('click', (e) => {
    const row = e.target.closest('.tb-item');
    if (!row) return;
    const id = row.dataset.id;
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;

    if (a === 'restore') trashDoRestore(id);
    else if (a === 'forever') {
      trashConfirm(`Delete "${row.dataset.name}" forever? It cannot be restored after this.`, () => {
        trashRemoveEntries([id]);
        trashAfterChange();
        trashToast('Deleted forever.', 'success');
      }, 'Delete Forever');
    }
    else if (a === 'cancel') { delete TRASH.conflicts[id]; trashRender(); }
    else trashDoRestore(id, a); // copy · replace · anyway · discard · withParent
  });
}

function trashOpen() {
  TRASH.selected.clear();
  TRASH.conflicts = {};
  trashPurgeOld();
  trashRender();
  openModal('trashModalOverlay');
}

function trashShown() {
  let list = trashVisible();
  if (TRASH.filter !== 'all') list = list.filter(e => TRASH_TYPES[e.type] && TRASH_TYPES[e.type].group === TRASH.filter);
  const q = trLc(TRASH.search);
  if (q) {
    list = list.filter(e => (trashName(e) + ' ' + trashDetails(e) + ' ' + TRASH_TYPES[e.type].label + ' ' + (e.deletedBy ? e.deletedBy.name : '')).toLowerCase().includes(q));
  }
  switch (TRASH.sort) {
    case 'oldest': list.sort((a, b) => new Date(a.deletedAt) - new Date(b.deletedAt)); break;
    case 'type': list.sort((a, b) => TRASH_TYPES[a.type].label.localeCompare(TRASH_TYPES[b.type].label)); break;
    case 'name': list.sort((a, b) => trashName(a).localeCompare(trashName(b))); break;
    default: list.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  }
  return list;
}

function trashRender() {
  const all = trashVisible();
  const shown = trashShown();
  const esc = trashEsc;

  document.getElementById('tbHeadCount').textContent = all.length;
  document.getElementById('tbFootInfo').textContent = all.length
    ? `${all.length} item(s) in trash · auto-deleted after ${TRASH_DAYS} days`
    : '';
  document.getElementById('tbEmptyBtn').disabled = !all.length;

  // chips with counts
  const counts = {};
  all.forEach(e => { const g = TRASH_TYPES[e.type].group; counts[g] = (counts[g] || 0) + 1; });
  document.getElementById('tbChips').innerHTML = TRASH_GROUPS
    .filter(g => g.key === 'all' || counts[g.key] || TRASH.filter === g.key)
    .filter(g => g.key !== 'accounts' || trashIsManager())
    .map(g => {
      const n = g.key === 'all' ? all.length : (counts[g.key] || 0);
      return `<button type="button" class="tb-chip ${TRASH.filter === g.key ? 'active' : ''}" data-group="${g.key}">${esc(g.label)} <span>${n}</span></button>`;
    }).join('');

  // drop selections that are not visible anymore
  const shownIds = new Set(shown.map(e => e.id));
  Array.from(TRASH.selected).forEach(id => { if (!shownIds.has(id)) TRASH.selected.delete(id); });

  const listEl = document.getElementById('tbList');
  if (!shown.length) {
    listEl.innerHTML = `
      <div class="tb-empty">
        <i class="fa-solid fa-trash-can"></i>
        <p>${all.length ? 'No items match your search.' : 'Trash is empty.'}</p>
      </div>`;
  } else {
    listEl.innerHTML = shown.map(e => {
      const t = TRASH_TYPES[e.type];
      const name = trashName(e);
      const details = trashDetails(e);
      const left = trashDaysLeft(e);
      const sel = TRASH.selected.has(e.id);
      const conf = TRASH.conflicts[e.id];
      return `
        <div class="tb-item ${sel ? 'selected' : ''} ${conf ? 'has-conflict' : ''}" data-id="${esc(e.id)}" data-name="${esc(name)}">
          <label class="tb-check"><input type="checkbox" data-tb-check="${esc(e.id)}" ${sel ? 'checked' : ''}></label>
          <span class="tb-icon"><i class="fa-solid ${t.icon}"></i></span>
          <div class="tb-main">
            <div class="tb-name" title="${esc(name)}">${esc(name)}</div>
            <div class="tb-sub">
              <span class="tb-type">${esc(t.label)}</span>
              ${details ? `<span class="tb-details" title="${esc(details)}">${esc(details)}</span>` : ''}
            </div>
            <div class="tb-meta">
              Deleted ${esc(trashAgo(e.deletedAt))}${e.deletedBy ? ` by ${esc(e.deletedBy.name)}` : ''}
              · <span class="${left <= 3 ? 'tb-soon' : ''}">${left} day${left === 1 ? '' : 's'} left</span>
            </div>
          </div>
          <div class="tb-actions">
            <button type="button" class="tb-btn tb-btn-gold tb-btn-sm" data-act="restore"><i class="fa-solid fa-rotate-left"></i> Restore</button>
            <button type="button" class="tb-icon-btn" data-act="forever" title="Delete forever"><i class="fa-solid fa-xmark"></i></button>
          </div>
          ${conf ? trashConflictHtml(e, conf) : ''}
        </div>
      `;
    }).join('');
  }

  trashRefreshBulk();
}

function trashConflictHtml(e, c) {
  const esc = trashEsc;
  const icon = { dup: 'fa-clone', soft: 'fa-circle-question', warn: 'fa-triangle-exclamation', block: 'fa-link-slash', exists: 'fa-circle-check', error: 'fa-circle-exclamation' }[c.kind] || 'fa-circle-info';
  let buttons = '';
  if (c.kind === 'dup') {
    buttons = (c.noCopy ? '' : `<button type="button" class="tb-btn tb-btn-gold tb-btn-sm" data-act="copy"><i class="fa-solid fa-copy"></i> Keep both</button>`) +
      `<button type="button" class="tb-btn tb-btn-dark tb-btn-sm" data-act="replace"><i class="fa-solid fa-right-left"></i> Replace existing</button>`;
  } else if (c.kind === 'soft' || c.kind === 'warn') {
    buttons = `<button type="button" class="tb-btn tb-btn-gold tb-btn-sm" data-act="anyway"><i class="fa-solid fa-rotate-left"></i> Restore anyway</button>`;
  } else if (c.kind === 'block' && c.parentEntryId) {
    buttons = `<button type="button" class="tb-btn tb-btn-gold tb-btn-sm" data-act="withParent"><i class="fa-solid fa-layer-group"></i> Restore both</button>`;
  } else if (c.kind === 'exists') {
    buttons = `<button type="button" class="tb-btn tb-btn-dark tb-btn-sm" data-act="discard"><i class="fa-solid fa-broom"></i> Remove from trash</button>`;
  }
  const hint = c.kind === 'dup' && !c.noCopy
    ? '<small>Keep both restores it with a new name. Replace moves the existing one to the trash.</small>'
    : (c.kind === 'dup' ? '<small>Replace moves the existing one to the trash.</small>' : '');
  return `
    <div class="tb-resolve tb-resolve-${c.kind}">
      <div class="tb-resolve-msg"><i class="fa-solid ${icon}"></i><div><b>${esc(c.msg)}</b>${hint}</div></div>
      <div class="tb-resolve-actions">
        ${buttons}
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-act="cancel">Cancel</button>
      </div>
    </div>
  `;
}

function trashRefreshBulk() {
  const n = TRASH.selected.size;
  const shown = trashShown();
  const bulk = document.getElementById('tbBulk');
  bulk.classList.toggle('active', n > 0);
  document.getElementById('tbBulkCount').textContent = n ? `${n} selected` : '';
  document.getElementById('tbRestoreSelected').disabled = !n;
  document.getElementById('tbDeleteSelected').disabled = !n;
  const all = document.getElementById('tbSelectAll');
  all.checked = shown.length > 0 && shown.every(e => TRASH.selected.has(e.id));
  all.indeterminate = n > 0 && !all.checked;
  all.disabled = !shown.length;
}

function trashDoRestore(id, mode) {
  const r = trashRestore(id, mode);
  if (r.conflict) {
    TRASH.conflicts[id] = r.conflict;
    trashRender();
    const row = document.querySelector(`.tb-item[data-id="${CSS.escape(id)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  if (r.error) {
    TRASH.conflicts[id] = { kind: 'error', msg: r.error };
    trashRender();
    return;
  }
  delete TRASH.conflicts[id];
  trashAfterChange();
  trashToast(r.discarded ? 'Removed from trash (it was already in the system).'
    : r.renamed ? 'Restored as a copy with a new name.' : 'Restored.', 'success');
}

function trashRestoreSelected() {
  const ids = trashShown().filter(e => TRASH.selected.has(e.id)).map(e => e.id);
  if (!ids.length) return;

  // parents first so their files can follow
  const order = { case: 0, client: 0, account: 0, note: 1, hearing: 2, progress: 2, caseDoc: 2 };
  const all = trashGetAll();
  ids.sort((a, b) => {
    const ea = all.find(x => x.id === a), eb = all.find(x => x.id === b);
    return (order[ea && ea.type] || 0) - (order[eb && eb.type] || 0);
  });

  let ok = 0, conflicts = 0;
  ids.forEach(id => {
    const r = trashRestore(id);
    if (r.ok) { ok++; delete TRASH.conflicts[id]; }
    else { conflicts++; TRASH.conflicts[id] = r.conflict || { kind: 'error', msg: r.error }; }
  });
  TRASH.selected.clear();
  trashAfterChange();
  if (conflicts) {
    trashToast(`${ok} restored · ${conflicts} need your decision (see the highlighted items).`, ok ? 'success' : 'error');
  } else {
    trashToast(`${ok} item(s) restored.`, 'success');
  }
}

function trashAfterChange() {
  trashRender();
  trashUpdateBadge();
  trashRerenderPage();
}

/** Refresh whatever list is on the current page */
function trashRerenderPage() {
  const call = (name) => {
    if (typeof window[name] !== 'function') return;
    try { window[name](); } catch (err) { /* page part not open */ }
  };
  ['renderCaseTable', 'renderCabinet', 'renderClientsGrid', 'renderCalendar', 'renderAccountList', 'renderPendingApprovals']
    .forEach(call);
  const openModalOf = (id) => { const el = document.getElementById(id); return el && el.classList.contains('active'); };
  if (openModalOf('documentsModalOverlay')) call('renderDocumentsTable');
}

/* ---------- confirm (always shown on top of the trash modal) ---------- */
function trashConfirm(message, onYes, title) {
  const fn = TRASH.origConfirm || window.confirmDelete;
  fn(message, onYes, title, `<i class="fa-solid fa-trash"></i> ${title}`);
  const id = typeof CONFIRM_MODAL_ID !== 'undefined' ? CONFIRM_MODAL_ID : 'globalConfirmModal';
  const el = document.getElementById(id);
  if (el) document.body.appendChild(el); // move to the end so it sits above
}

/* ---------- "Moved to Trash · Undo" snackbar ---------- */
function trashSnackbar(entries) {
  if (!entries.length) return;
  let bar = document.getElementById('trashSnackbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'trashSnackbar';
    bar.className = 'trash-snackbar';
    document.body.appendChild(bar);
  }
  const first = trashName(entries[0]);
  const more = entries.length > 1 ? ` +${entries.length - 1} more` : '';
  bar.innerHTML = `
    <i class="fa-solid fa-trash-can"></i>
    <span class="trash-snackbar-text">Moved to Trash: <b>${trashEsc(first)}</b>${more}</span>
    <button type="button" class="trash-snackbar-undo">Undo</button>
    <button type="button" class="trash-snackbar-open">View</button>
  `;
  const ids = entries.map(e => e.id);
  bar.querySelector('.trash-snackbar-undo').onclick = () => {
    let ok = 0, left = 0;
    ids.forEach(id => {
      const r = trashRestore(id, 'anyway');
      if (r.ok) ok++; else left++;
    });
    trashAfterChange();
    bar.classList.remove('show');
    trashToast(left ? `${ok} restored · ${left} need a decision in the Trash Bin.` : 'Undo complete.', left ? 'error' : 'success');
  };
  bar.querySelector('.trash-snackbar-open').onclick = () => { bar.classList.remove('show'); trashOpen(); };

  clearTimeout(bar._t);
  requestAnimationFrame(() => bar.classList.add('show'));
  bar._t = setTimeout(() => bar.classList.remove('show'), 7000);
}

/* ============================================================
   HELPERS
   ============================================================ */
function trashClone(o) {
  try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; }
}

function trashDate(d) {
  if (!d) return '—';
  return typeof formatDate === 'function' ? formatDate(d) : String(d).slice(0, 10);
}

function trashAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function trashDaysLeft(e) {
  const passed = (Date.now() - new Date(e.deletedAt).getTime()) / 86400000;
  return Math.max(0, Math.ceil(TRASH_DAYS - passed));
}

function trashToast(msg, type) {
  if (typeof showToast === 'function') showToast(msg, type);
}

function trashEsc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   STYLES (theme variables — Light / Dark ready)
   ============================================================ */
function trashInjectStyles() {
  if (document.getElementById('trashBinStyles')) return;
  const style = document.createElement('style');
  style.id = 'trashBinStyles';
  style.textContent = `
    /* ---------- top bar button ---------- */
    .trash-nav-btn { position: relative; }
    .trash-nav-badge {
      position: absolute; top: -3px; right: -3px; min-width: 17px; height: 17px; padding: 0 4px;
      border-radius: 999px; font-size: 10px; font-weight: 800; line-height: 17px; text-align: center;
      background: var(--color-black, #130D1D); color: var(--color-gold, #EAB52A);
      border: 2px solid var(--card-bg, #fff);
    }

    /* ---------- modal ---------- */
    .modal-box.tb-modal { width: min(860px, 96vw); max-height: 90vh; }
    .tb-modal .modal-header h2 { display: flex; align-items: center; gap: 10px; }
    .tb-head-count {
      font-size: 11px; font-weight: 800; padding: 2px 9px; border-radius: 999px;
      background: var(--color-black, #130D1D); color: var(--color-gold, #EAB52A);
    }
    .tb-body { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
    .tb-note {
      display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 1.5;
      padding: 9px 12px; border-radius: var(--radius-sm, 8px);
      background: var(--primary-soft, rgba(234,181,42,.13)); color: var(--text-soft, #3E3648);
    }
    .tb-note i { color: var(--color-gold-dark, #A17421); margin-top: 2px; }

    .tb-toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
    .tb-search {
      flex: 1; min-width: 200px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
      border: 1px solid var(--color-gray-border, #E8E4DA); border-radius: 10px; background: var(--card-bg, #fff);
    }
    .tb-search i { color: var(--color-gray-text, #6A6377); font-size: 12px; }
    .tb-search input { flex: 1; border: none; outline: none; background: transparent; padding: 9px 0; font-size: 13px; color: var(--color-black, #130D1D); }
    .tb-select {
      padding: 8px 10px; font-size: 12.5px; border-radius: 10px; cursor: pointer;
      border: 1px solid var(--color-gray-border, #E8E4DA); background: var(--card-bg, #fff); color: var(--color-black, #130D1D);
    }

    .tb-chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .tb-chip {
      display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; cursor: pointer;
      border-radius: 999px; font-size: 12px; font-weight: 700;
      border: 1px solid var(--color-gray-border, #E8E4DA); background: var(--card-bg, #fff); color: var(--text-soft, #3E3648);
      transition: background .2s ease, color .2s ease, border-color .2s ease;
    }
    .tb-chip span {
      min-width: 18px; padding: 0 5px; border-radius: 999px; font-size: 10.5px; text-align: center;
      background: var(--color-gray-bg, #F6F4EF); color: var(--color-gray-text, #6A6377);
    }
    .tb-chip:hover { border-color: var(--color-gold, #EAB52A); }
    .tb-chip.active { background: var(--tile-orange, #EAB52A); border-color: transparent; color: #fff; }
    .tb-chip.active span { background: rgba(255,255,255,.25); color: #fff; }

    .tb-bulk {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 8px 12px; border-radius: 10px;
      border: 1px solid var(--color-gray-border, #E8E4DA); background: var(--color-gray-bg, #F6F4EF);
      transition: background .2s ease, border-color .2s ease;
    }
    .tb-bulk.active { background: var(--color-black, #130D1D); border-color: transparent; color: #fff; }
    .tb-check-all { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; cursor: pointer; }
    .tb-check-all input, .tb-check input { width: 16px; height: 16px; cursor: pointer; accent-color: var(--color-gold, #EAB52A); }
    .tb-bulk-count { font-size: 12px; font-weight: 700; color: var(--color-gold, #EAB52A); }
    .tb-bulk-actions { margin-left: auto; display: flex; gap: 6px; }

    .tb-list { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 48vh; padding-right: 2px; }
    .tb-item {
      display: grid; grid-template-columns: 22px 38px minmax(0, 1fr) auto; align-items: center; gap: 10px;
      padding: 10px 12px; border-radius: var(--radius-md, 12px);
      border: 1px solid var(--color-gray-border, #E8E4DA); background: var(--card-bg, #fff);
      transition: border-color .2s ease, background .2s ease;
    }
    .tb-item:hover { border-color: var(--primary-soft-2, rgba(234,181,42,.24)); }
    .tb-item.selected { background: var(--row-hover, #FDF6E3); border-color: var(--color-gold, #EAB52A); }
    .tb-item.has-conflict { border-color: var(--color-warning, #D98E04); }
    .tb-icon {
      width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
      background: var(--color-black, #130D1D); color: var(--color-gold, #EAB52A); font-size: 14px;
    }
    .tb-main { min-width: 0; }
    .tb-name { font-size: 13.5px; font-weight: 700; color: var(--color-black, #130D1D); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tb-sub { display: flex; align-items: center; gap: 6px; min-width: 0; margin-top: 2px; }
    .tb-type {
      flex-shrink: 0; font-size: 10px; font-weight: 800; letter-spacing: .3px; text-transform: uppercase;
      padding: 1px 7px; border-radius: 999px; background: var(--primary-soft, rgba(234,181,42,.13)); color: var(--color-gold-dark, #A17421);
    }
    .tb-details { font-size: 11.5px; color: var(--text-soft, #3E3648); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tb-meta { font-size: 11px; color: var(--color-gray-text, #6A6377); margin-top: 3px; }
    .tb-soon { color: var(--color-danger, #D9534F); font-weight: 700; }
    .tb-actions { display: flex; align-items: center; gap: 6px; }

    .tb-resolve {
      grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
      margin-top: 4px; padding: 10px 12px; border-radius: 10px;
      background: rgba(217,142,4,.08); border: 1px dashed var(--color-warning, #D98E04);
      animation: tbIn .25s var(--ease-out, ease);
    }
    .tb-resolve-block, .tb-resolve-error { background: rgba(217,83,79,.07); border-color: var(--color-danger, #D9534F); }
    .tb-resolve-exists { background: rgba(62,142,79,.08); border-color: var(--color-success, #3E8E4F); }
    .tb-resolve-msg { display: flex; gap: 9px; align-items: flex-start; font-size: 12.5px; color: var(--color-black, #130D1D); min-width: 220px; flex: 1; }
    .tb-resolve-msg i { color: var(--color-warning, #D98E04); margin-top: 2px; }
    .tb-resolve-block .tb-resolve-msg i, .tb-resolve-error .tb-resolve-msg i { color: var(--color-danger, #D9534F); }
    .tb-resolve-exists .tb-resolve-msg i { color: var(--color-success, #3E8E4F); }
    .tb-resolve-msg small { display: block; margin-top: 2px; font-size: 11px; color: var(--color-gray-text, #6A6377); }
    .tb-resolve-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    @keyframes tbIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

    .tb-empty { text-align: center; padding: 50px 20px; color: var(--color-gray-text, #6A6377); }
    .tb-empty i { font-size: 36px; color: var(--color-gold, #EAB52A); opacity: .5; display: block; margin-bottom: 10px; }
    .tb-footer { justify-content: space-between !important; align-items: center; }
    .tb-foot-info { font-size: 12px; color: var(--color-gray-text, #6A6377); }

    /* ---------- buttons ---------- */
    .tb-btn {
      display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; cursor: pointer;
      border-radius: 999px; font-size: 12.5px; font-weight: 700; border: 1px solid transparent; white-space: nowrap;
      transition: background .2s ease, color .2s ease, border-color .2s ease, opacity .2s ease;
    }
    .tb-btn:disabled { opacity: .45; cursor: default; }
    .tb-btn-sm { padding: 6px 11px; font-size: 11.5px; }
    .tb-btn-gold { background: var(--tile-orange, #EAB52A); color: #fff; }
    .tb-btn-gold:hover:not(:disabled) { filter: brightness(1.05); }
    .tb-btn-dark { background: var(--color-black, #130D1D); color: var(--color-gold, #EAB52A); }
    .tb-btn-danger { background: var(--color-danger, #D9534F); color: #fff; }
    .tb-btn-danger:hover:not(:disabled) { background: #b93f3b; }
    .tb-btn-ghost { background: transparent; color: var(--color-gray-text, #6A6377); border-color: var(--color-gray-border, #E8E4DA); }
    .tb-btn-outline-danger { background: transparent; color: var(--color-danger, #D9534F); border-color: var(--color-danger, #D9534F); }
    .tb-btn-outline-danger:hover:not(:disabled) { background: var(--color-danger, #D9534F); color: #fff; }
    .tb-icon-btn {
      width: 30px; height: 30px; border-radius: 50%; cursor: pointer; border: 1px solid var(--color-gray-border, #E8E4DA);
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--card-bg, #fff); color: var(--color-gray-text, #6A6377); font-size: 12px;
      transition: background .2s ease, color .2s ease, border-color .2s ease;
    }
    .tb-icon-btn:hover { background: var(--color-danger, #D9534F); border-color: transparent; color: #fff; }

    /* ---------- snackbar ---------- */
    .trash-snackbar {
      position: fixed; left: 50%; bottom: 22px; z-index: 5000;
      display: flex; align-items: center; gap: 10px; max-width: min(560px, calc(100vw - 32px));
      padding: 10px 12px 10px 16px; border-radius: 999px;
      background: var(--color-black, #130D1D); color: #fff; font-size: 13px;
      box-shadow: 0 14px 30px rgba(19,13,29,.3);
      transform: translate(-50%, 140%); opacity: 0; pointer-events: none;
      transition: transform .35s var(--ease-out, ease), opacity .25s ease;
    }
    .trash-snackbar.show { transform: translate(-50%, 0); opacity: 1; pointer-events: auto; }
    .trash-snackbar > i { color: var(--color-gold, #EAB52A); }
    .trash-snackbar-text { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .trash-snackbar button {
      padding: 6px 12px; border-radius: 999px; cursor: pointer; font-size: 12px; font-weight: 800;
      border: 1px solid rgba(255,255,255,.25); background: transparent; color: #fff;
    }
    .trash-snackbar .trash-snackbar-undo { background: var(--tile-orange, #EAB52A); border-color: transparent; }

    @media (max-width: 600px) {
      .tb-item { grid-template-columns: 22px 34px minmax(0, 1fr); }
      .tb-icon { width: 34px; height: 34px; }
      .tb-actions { grid-column: 1 / -1; justify-content: flex-end; }
      .tb-bulk-actions { margin-left: 0; width: 100%; }
      .tb-bulk-actions .tb-btn { flex: 1; justify-content: center; }
      .tb-list { max-height: none; }
      .trash-snackbar { border-radius: 16px; bottom: 12px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .trash-snackbar, .tb-resolve { transition: none; animation: none; }
    }
  `;
  document.head.appendChild(style);
}