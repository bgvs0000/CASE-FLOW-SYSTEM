/* ============================================================
   CASEFLOW — BULK-SELECT.JS
   "Select + Delete Selected" for every list in the system.

   WHERE IT WORKS (auto-detected — one file for all pages):
     Dashboard  → Cases table, Case Documents (modal)
     Clients    → Client cards

   HOW IT WORKS
   - Checkbox on each row / card, "Select all" in the header.
   - Midnight bar appears: "N selected · Clear · Delete Selected".
   - Delete follows the same rules as the single delete button
     (e.g. deleting a case also removes its documents, progress
     and hearings). Only rows that already have a Delete button
     get a checkbox — permissions stay the same.
   - Esc clears the selection.

   Load AFTER the page's own JS (dashboard.js / documents.js /
   clients.js).
   Depends on: storage.js, modal.js
   ============================================================ */

/* ============================================================
   TARGETS — one entry per list
   ============================================================ */
const BULK_TARGETS = [
  {
    key: 'cases',
    container: 'caseTableBody',
    deleteAttr: 'data-delete-case',
    noun: ['case', 'cases'],
    exists: (id) => getCases().some(c => c.id === id),
    extraNote: () => ' Their documents, progress history and hearings will also be removed.',
    remove: (ids) => {
      const set = new Set(ids);
      const names = getCases().filter(c => set.has(c.id)).map(c => c.caseNumber || c.caseName);
      saveCases(getCases().filter(c => !set.has(c.id)));
      if (typeof getDocuments === 'function') saveDocuments(getDocuments().filter(d => !set.has(d.caseId)));
      if (typeof getProgressEntries === 'function') saveProgressEntries(getProgressEntries().filter(p => !set.has(p.caseId)));
      if (typeof getHearings === 'function') saveHearings(getHearings().filter(h => !set.has(h.caseId)));
      bulkLog('case-edit', `Deleted ${ids.length} case(s): ${bulkShortList(names)}.`);
    },
    rerender: () => {
      if (typeof renderCaseTable === 'function') renderCaseTable();
      if (typeof renderCabinet === 'function') renderCabinet();
    }
  },
  {
    key: 'caseDocs',
    container: 'documentsTableBody',
    deleteAttr: 'data-delete-doc',
    noun: ['document', 'documents'],
    exists: (id) => getDocuments().some(d => d.id === id),
    remove: (ids) => {
      const set = new Set(ids);
      saveDocuments(getDocuments().filter(d => !set.has(d.id)));
    },
    rerender: () => { if (typeof renderDocumentsTable === 'function') renderDocumentsTable(); }
  },
  {
    key: 'clients',
    container: 'clientsGrid',
    cards: '.client-card',
    deleteAttr: 'data-delete-client',
    noun: ['client', 'clients'],
    exists: (id) => getClients().some(c => c.id === id),
    extraNote: () => ' Linked cases are kept but will show as "Unknown Client".',
    remove: (ids) => {
      const set = new Set(ids);
      const names = getClients().filter(c => set.has(c.id)).map(c => c.name);
      saveClients(getClients().filter(c => !set.has(c.id)));
      bulkLog('client-edit', `Deleted ${ids.length} client(s): ${bulkShortList(names)}.`);
    },
    rerender: () => { if (typeof renderClientsGrid === 'function') renderClientsGrid(); }
  }
];

const BULK_INSTANCES = [];

document.addEventListener('DOMContentLoaded', () => {
  bulkInjectStyles();
  // wait one tick so the page's own first render is done
  setTimeout(() => {
    BULK_TARGETS.forEach(cfg => {
      const el = document.getElementById(cfg.container);
      if (el) BULK_INSTANCES.push(createBulkSelect(cfg, el));
    });
  }, 0);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // inside an open modal → clear that modal's list first
    const openModalEl = document.querySelector('.modal-overlay.active');
    BULK_INSTANCES.forEach(inst => {
      const inModal = !!inst.container.closest('.modal-overlay');
      if (openModalEl ? inst.container.closest('.modal-overlay') === openModalEl : !inModal) {
        if (inst.selected.size) inst.clear();
      }
    });
  });
});

/* ============================================================
   ENGINE
   ============================================================ */
function createBulkSelect(cfg, container) {
  const inst = { cfg, container, selected: new Set() };
  const isCards = !!cfg.cards;
  const table = isCards ? null : container.closest('table');
  const anchor = isCards ? container : (container.closest('.table-wrapper') || table);

  /* ---------- action bar ---------- */
  const bar = document.createElement('div');
  bar.className = 'bsel-bar';
  bar.innerHTML = `
    <div class="bsel-bar-info">
      <span class="bsel-count">0</span>
      <span class="bsel-count-label">selected</span>
      ${isCards ? `<button type="button" class="bsel-btn bsel-btn-ghost bsel-all-btn"><i class="fa-solid fa-check-double"></i> Select all</button>` : ''}
    </div>
    <div class="bsel-bar-actions">
      <button type="button" class="bsel-btn bsel-btn-ghost bsel-clear-btn"><i class="fa-solid fa-xmark"></i> Clear</button>
      <button type="button" class="bsel-btn bsel-btn-danger bsel-delete-btn"><i class="fa-solid fa-trash"></i> Delete Selected</button>
    </div>
  `;
  anchor.parentNode.insertBefore(bar, anchor);

  /* ---------- helpers ---------- */
  const idOf = (item) => {
    const btn = item.querySelector(`[${cfg.deleteAttr}]`);
    return btn ? btn.getAttribute(cfg.deleteAttr) : null;
  };
  const items = () => isCards
    ? Array.from(container.querySelectorAll(cfg.cards))
    : Array.from(container.querySelectorAll(':scope > tr'));
  const boxes = () => Array.from(container.querySelectorAll('.bsel-check[data-bsel-id]'));

  /* ---------- add checkboxes after every render ---------- */
  function enhance() {
    // forget ids that are gone
    inst.selected.forEach(id => { if (!cfg.exists(id)) inst.selected.delete(id); });

    let deletable = 0;

    if (isCards) {
      items().forEach(card => {
        const id = idOf(card);
        if (!id) return;
        deletable++;
        let box = card.querySelector(':scope > .bsel-card-check');
        if (!box) {
          box = document.createElement('label');
          box.className = 'bsel-card-check';
          box.title = 'Select';
          box.innerHTML = `<input type="checkbox" class="bsel-check" data-bsel-id="${bulkEsc(id)}"><span></span>`;
          card.classList.add('bsel-card');
          card.insertBefore(box, card.firstChild);
        }
        const on = inst.selected.has(id);
        box.querySelector('input').checked = on;
        card.classList.toggle('bsel-selected', on);
      });
    } else {
      const headRow = table.querySelector('thead tr');
      if (headRow && !headRow.querySelector('.bsel-th')) {
        const th = document.createElement('th');
        th.className = 'bsel-th bsel-cell';
        th.innerHTML = '<input type="checkbox" class="bsel-all" title="Select all shown">';
        headRow.insertBefore(th, headRow.firstChild);
      }

      items().forEach(tr => {
        if (tr.querySelector(':scope > .bsel-td')) return;
        if (tr.classList.contains('empty-row')) {
          const td = tr.querySelector('td');
          if (td && !td.dataset.bselFixed) { td.colSpan = (td.colSpan || 1) + 1; td.dataset.bselFixed = '1'; }
          return;
        }
        const td = document.createElement('td');
        td.className = 'bsel-td bsel-cell';
        td.dataset.label = 'Select';
        const id = idOf(tr);
        if (id) {
          deletable++;
          const on = inst.selected.has(id);
          td.innerHTML = `<input type="checkbox" class="bsel-check" data-bsel-id="${bulkEsc(id)}" ${on ? 'checked' : ''}>`;
          tr.classList.toggle('bsel-selected', on);
        }
        tr.insertBefore(td, tr.firstChild);
      });

      // count rows that already had a checkbox
      deletable = boxes().length;
      // nobody can delete anything here → hide the column
      table.classList.toggle('bsel-off', deletable === 0);
    }

    refresh();
  }

  function refresh() {
    const n = inst.selected.size;
    bar.classList.toggle('show', n > 0);
    bar.querySelector('.bsel-count').textContent = n;
    bar.querySelector('.bsel-count-label').textContent = `${n === 1 ? cfg.noun[0] : cfg.noun[1]} selected`;

    const all = isCards ? null : table.querySelector('.bsel-all');
    const list = boxes();
    const checked = list.filter(b => b.checked).length;
    if (all) {
      all.checked = list.length > 0 && checked === list.length;
      all.indeterminate = checked > 0 && checked < list.length;
      all.disabled = list.length === 0;
    }
    const allBtn = bar.querySelector('.bsel-all-btn');
    if (allBtn) {
      const every = list.length > 0 && checked === list.length;
      allBtn.innerHTML = every
        ? '<i class="fa-solid fa-square-minus"></i> Unselect all'
        : '<i class="fa-solid fa-check-double"></i> Select all';
    }
  }

  function setOne(cb, on) {
    cb.checked = on;
    const id = cb.dataset.bselId;
    if (on) inst.selected.add(id); else inst.selected.delete(id);
    const holder = isCards ? cb.closest(cfg.cards) : cb.closest('tr');
    if (holder) holder.classList.toggle('bsel-selected', on);
  }

  inst.clear = () => {
    inst.selected.clear();
    boxes().forEach(cb => setOne(cb, false));
    refresh();
  };

  /* ---------- events ---------- */
  const scope = isCards ? container : table;
  scope.addEventListener('change', (e) => {
    const t = e.target;
    if (t.classList.contains('bsel-all')) {
      boxes().forEach(cb => setOne(cb, t.checked));
      refresh();
    } else if (t.matches('.bsel-check[data-bsel-id]')) {
      setOne(t, t.checked);
      refresh();
    }
  });

  if (!isCards) {
    // click anywhere in the checkbox cell toggles it
    table.addEventListener('click', (e) => {
      const cell = e.target.closest('.bsel-td');
      if (!cell || e.target.matches('input')) return;
      const cb = cell.querySelector('input');
      if (!cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  bar.querySelector('.bsel-clear-btn').addEventListener('click', inst.clear);

  const allBtn = bar.querySelector('.bsel-all-btn');
  if (allBtn) {
    allBtn.addEventListener('click', () => {
      const list = boxes();
      const every = list.length > 0 && list.every(b => b.checked);
      list.forEach(cb => setOne(cb, !every));
      refresh();
    });
  }

  bar.querySelector('.bsel-delete-btn').addEventListener('click', () => {
    const ids = Array.from(inst.selected).filter(cfg.exists);
    if (!ids.length) return;
    const n = ids.length;
    const noun = n === 1 ? cfg.noun[0] : cfg.noun[1];
    const note = cfg.extraNote ? cfg.extraNote(ids) : '';

    confirmDelete(
      `Delete ${n} ${noun}?${note} This cannot be undone.`,
      () => {
        cfg.remove(ids);
        inst.selected.clear();
        cfg.rerender();
        enhance();
        showToast(`${n} ${noun} deleted.`, 'success');
      },
      `Delete Selected ${cfg.noun[1].replace(/^\w/, c => c.toUpperCase())}`,
      `<i class="fa-solid fa-trash"></i> Delete ${n}`
    );
  });

  /* ---------- re-apply after every render ---------- */
  new MutationObserver(enhance).observe(container, { childList: true });
  enhance();

  return inst;
}

/* ============================================================
   HELPERS
   ============================================================ */
function bulkLog(type, text) {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (user && typeof logActivity === 'function') logActivity(user.id, type, text);
}

function bulkShortList(names) {
  const list = names.filter(Boolean);
  return list.slice(0, 5).join(', ') + (list.length > 5 ? '…' : '');
}

function bulkEsc(str) {
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
function bulkInjectStyles() {
  if (document.getElementById('bulkSelectStyles')) return;
  const style = document.createElement('style');
  style.id = 'bulkSelectStyles';
  style.textContent = `
    /* ---------- checkbox column ---------- */
    .bsel-th, .bsel-td { width: 44px; text-align: center !important; cursor: pointer; }
    .bsel-check, .bsel-all {
      width: 17px; height: 17px; cursor: pointer; vertical-align: middle;
      accent-color: var(--color-gold, #EAB52A);
    }
    table.bsel-off .bsel-cell { display: none; }
    tr.bsel-selected > td { background: var(--row-hover, #FDF6E3) !important; }
    tr.bsel-selected > td:first-child { box-shadow: inset 4px 0 0 var(--color-gold, #EAB52A) !important; }

    /* ---------- card checkbox (clients) ---------- */
    .bsel-card { position: relative; }
    .bsel-card-check {
      position: absolute; top: 12px; right: 12px; z-index: 3;
      width: 26px; height: 26px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      border-radius: 8px; background: var(--card-bg, #fff);
      border: 1px solid var(--color-gray-border, #E8E4DA);
      box-shadow: 0 2px 6px rgba(19,13,29,.08);
      opacity: .75; transition: opacity .2s ease, border-color .2s ease;
    }
    .bsel-card:hover .bsel-card-check, .bsel-card.bsel-selected .bsel-card-check { opacity: 1; }
    .bsel-card-check input { margin: 0; }
    .bsel-card-check span { display: none; }
    .bsel-card.bsel-selected {
      outline: 2px solid var(--color-gold, #EAB52A);
      outline-offset: 2px;
      box-shadow: 0 10px 24px rgba(234,181,42,.18) !important;
    }

    /* ---------- action bar ---------- */
    .bsel-bar {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
      max-height: 0; opacity: 0; overflow: hidden; margin-bottom: 0; padding: 0 16px;
      border-radius: var(--radius-md, 12px);
      background: var(--color-black, #130D1D); color: #fff;
      transform: translateY(-6px);
      transition: max-height .3s var(--ease-out, ease), opacity .25s ease, transform .3s var(--ease-out, ease),
                  padding .3s ease, margin .3s ease;
    }
    .bsel-bar.show {
      max-height: 90px; opacity: 1; padding: 10px 16px; margin-bottom: 14px; transform: none;
      box-shadow: 0 10px 24px rgba(19,13,29,.18);
    }
    .bsel-bar-info { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; flex-wrap: wrap; }
    .bsel-count {
      min-width: 30px; height: 30px; padding: 0 8px; border-radius: 999px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tile-orange, #EAB52A); color: #fff; font-weight: 800; font-size: 13px;
    }
    .bsel-bar-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .bsel-btn {
      display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; cursor: pointer;
      border-radius: 999px; font-size: 12.5px; font-weight: 700; border: 1px solid transparent;
      transition: background .2s ease, color .2s ease, border-color .2s ease;
    }
    .bsel-btn-ghost { background: transparent; color: #fff; border-color: rgba(255,255,255,.25); }
    .bsel-btn-ghost:hover { border-color: var(--color-gold, #EAB52A); color: var(--color-gold, #EAB52A); }
    .bsel-btn-danger { background: var(--color-danger, #D9534F); color: #fff; }
    .bsel-btn-danger:hover { background: #b93f3b; }

    /* ---------- "Manage options" link + filter button ---------- */
    .field-label.bsel-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .bsel-manage-link {
      display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; cursor: pointer;
      border-radius: 999px; border: 1px solid var(--color-gray-border, #E8E4DA);
      background: var(--card-bg, #fff); color: var(--color-gold-dark, #A17421);
      font-size: 11px; font-weight: 700; text-transform: none; letter-spacing: 0;
      transition: background .2s ease, color .2s ease, border-color .2s ease;
    }
    .bsel-manage-link:hover { background: var(--tile-orange, #EAB52A); border-color: transparent; color: #fff; }
    .bsel-icon-btn {
      width: 38px; height: 38px; flex-shrink: 0; cursor: pointer; border-radius: 10px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--color-gray-border, #E8E4DA); background: var(--card-bg, #fff);
      color: var(--color-gold-dark, #A17421);
      transition: background .2s ease, color .2s ease, border-color .2s ease;
    }
    .bsel-icon-btn:hover { background: var(--tile-orange, #EAB52A); border-color: transparent; color: #fff; }

    /* ---------- options manager modal ---------- */
    .bsel-opt-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
    .bsel-opt-row {
      display: flex; align-items: center; gap: 10px; padding: 10px 12px;
      border: 1px solid var(--color-gray-border, #E8E4DA); border-radius: var(--radius-md, 12px);
      background: var(--card-bg, #fff);
      transition: border-color .2s ease, background .2s ease;
    }
    .bsel-opt-row:hover { border-color: var(--primary-soft-2, rgba(234,181,42,.24)); }
    .bsel-opt-row.confirming { border-color: var(--color-danger, #D9534F); background: rgba(217,83,79,.06); }
    .bsel-opt-name { font-size: 13px; font-weight: 700; color: var(--color-black, #130D1D); display: inline-flex; align-items: center; gap: 8px; }
    .bsel-opt-name i { color: var(--color-gold-dark, #A17421); width: 16px; text-align: center; }
    .bsel-opt-usage { flex: 1; font-size: 11.5px; color: var(--color-gray-text, #6A6377); }
    .bsel-opt-lock { color: var(--color-gray-text, #6A6377); font-size: 12px; opacity: .7; }
    .bsel-opt-actions { display: flex; align-items: center; gap: 6px; }
    .bsel-opt-del {
      width: 30px; height: 30px; border-radius: 50%; cursor: pointer; border: none;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; color: var(--color-danger, #D9534F); font-size: 12.5px;
      transition: background .2s ease, color .2s ease;
    }
    .bsel-opt-del:hover { background: var(--color-danger, #D9534F); color: #fff; }
    .bsel-opt-confirm { display: none; align-items: center; gap: 6px; }
    .bsel-opt-confirm small { font-size: 11px; color: var(--color-danger, #D9534F); font-weight: 600; }
    .bsel-opt-row.confirming .bsel-opt-del { display: none; }
    .bsel-opt-row.confirming .bsel-opt-confirm { display: flex; }
    .bsel-opt-yes, .bsel-opt-no {
      padding: 5px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 700; cursor: pointer;
      border: 1px solid transparent;
    }
    .bsel-opt-yes { background: var(--color-danger, #D9534F); color: #fff; }
    .bsel-opt-no { background: transparent; color: var(--color-gray-text, #6A6377); border-color: var(--color-gray-border, #E8E4DA); }
    .bsel-opt-add { display: flex; gap: 8px; align-items: stretch; }
    .bsel-opt-add .input-group { flex: 1; margin-bottom: 0; }
    .bsel-opt-add .btn-primary { flex-shrink: 0; white-space: nowrap; }
    .bsel-opt-hint { margin-top: 12px; font-size: 11.5px; color: var(--color-gray-text, #6A6377); }
    .bsel-opt-hint i { color: var(--color-gold-dark, #A17421); margin-right: 4px; }

    @media (max-width: 600px) {
      .bsel-bar.show { max-height: 200px; }
      .bsel-bar-actions, .bsel-btn { width: 100%; }
      .bsel-btn { justify-content: center; flex: 1; }
      .bsel-opt-add { flex-direction: column; }
      .bsel-opt-row { flex-wrap: wrap; }
    }
  `;
  document.head.appendChild(style);
}