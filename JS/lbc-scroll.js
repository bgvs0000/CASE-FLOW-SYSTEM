/* ============================================================
   ABANTO LAW FIRM — LBC-SCROLL.JS  (v2 — no shaking)
   Easier LEFT / RIGHT scrolling for the wide LBC table:

   1. Scroll bar on TOP of the table (synced with the bottom one)
      + ◀ ▶ buttons — no need to go to the bottom of the list.
   2. Table box fits the screen, so the bottom bar is also visible.
   3. Checkbox + Tracking No. columns stay pinned on the left.
   4. Click-and-drag the table sideways (like a phone).
   5. Mouse wheel over the top bar scrolls sideways.
   6. Soft shadow on the pinned column while scrolled.

   v2 fixes the shaking ("nginig"):
   - only the scrollbar you are using drives the other one
     (no more ping-pong between the two bars)
   - no CSS smooth-scroll fighting the sync / drag
   - box height is set once per window resize, not in a loop
   - updates are batched to one per animation frame

   Load AFTER lbc.js and lbc-bulk.js. Mobile (≤600px) keeps the
   card layout and is left alone.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('shipmentTableBody');
  if (!tbody) return;
  const wrap = tbody.closest('.table-wrapper');
  const table = tbody.closest('table');
  if (!wrap || !table) return;

  lbcScrollInjectStyles();

  /* ---------- top bar: ◀ [scrollbar] ▶ ---------- */
  const bar = document.createElement('div');
  bar.className = 'lbcs-hbar';
  bar.innerHTML = `
    <button type="button" class="lbcs-hbtn" data-dir="-1" title="Scroll left"><i class="fa-solid fa-chevron-left"></i></button>
    <div class="lbcs-htrack"><div class="lbcs-hinner"></div></div>
    <button type="button" class="lbcs-hbtn" data-dir="1" title="Scroll right"><i class="fa-solid fa-chevron-right"></i></button>
  `;
  wrap.parentNode.insertBefore(bar, wrap);
  const track = bar.querySelector('.lbcs-htrack');
  const inner = bar.querySelector('.lbcs-hinner');
  const btnLeft = bar.querySelector('[data-dir="-1"]');
  const btnRight = bar.querySelector('[data-dir="1"]');

  const isMobile = () => window.matchMedia('(max-width: 600px)').matches;

  /* ---------- sync: only the one being used leads ---------- */
  let leader = 'wrap';
  const lead = (who) => () => { leader = who; };
  ['pointerdown', 'wheel', 'touchstart', 'mouseenter'].forEach(evt => {
    track.addEventListener(evt, lead('track'), { passive: true });
    wrap.addEventListener(evt, lead('wrap'), { passive: true });
  });

  let edgeFrame = 0;
  track.addEventListener('scroll', () => {
    if (leader !== 'track') return;
    wrap.scrollLeft = track.scrollLeft;
  }, { passive: true });

  wrap.addEventListener('scroll', () => {
    if (leader === 'wrap' && track.scrollLeft !== wrap.scrollLeft) track.scrollLeft = wrap.scrollLeft;
    if (!edgeFrame) edgeFrame = requestAnimationFrame(() => { edgeFrame = 0; updateEdges(); });
  }, { passive: true });

  /* ---------- ◀ ▶ buttons ---------- */
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('.lbcs-hbtn');
    if (!btn || btn.disabled) return;
    leader = 'wrap';
    const step = Math.max(240, wrap.clientWidth * 0.6) * Number(btn.dataset.dir);
    wrap.scrollBy({ left: step, behavior: 'smooth' });
  });

  /* ---------- wheel over the top bar = sideways ---------- */
  bar.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    leader = 'wrap';
    wrap.scrollLeft += e.deltaY;
  }, { passive: false });

  /* ---------- drag to scroll (one update per frame) ---------- */
  let drag = null;
  let dragFrame = 0;
  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || isMobile()) return;
    if (e.target.closest('button, a, input, select, textarea, label, .cf-add-column-btn')) return;
    leader = 'wrap';
    drag = { x: e.clientX, left: wrap.scrollLeft, moved: false, target: wrap.scrollLeft };
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return;
    drag.moved = true;
    wrap.classList.add('lbcs-dragging');
    drag.target = drag.left - dx;
    if (!dragFrame) {
      dragFrame = requestAnimationFrame(() => {
        dragFrame = 0;
        if (drag) wrap.scrollLeft = drag.target;
      });
    }
    e.preventDefault();
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    wrap.classList.remove('lbcs-dragging');
    if (moved) {
      // swallow the click that follows a drag
      const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      wrap.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => wrap.removeEventListener('click', stop, { capture: true }), 50);
    }
  });

  /* ---------- pin checkbox + tracking columns ---------- */
  function pinColumns() {
    const headRow = table.querySelector('thead tr');
    if (!headRow) return;
    const ths = Array.from(headRow.children);
    const hasCheck = !!(ths[0] && ths[0].classList.contains('lbcb-th'));
    const trackIdx = hasCheck ? 1 : 0;
    const checkW = hasCheck ? ths[0].offsetWidth : 0;
    const leftPx = checkW + 'px';

    const pin = (cell, isTrack) => {
      if (!cell) return;
      if (!cell.classList.contains('lbcs-pin')) cell.classList.add('lbcs-pin');
      if (isTrack) {
        if (!cell.classList.contains('lbcs-pin-last')) cell.classList.add('lbcs-pin-last');
        if (cell.style.left !== leftPx) cell.style.left = leftPx;
      }
    };

    ths.forEach((th, i) => {
      if (i > trackIdx && th.classList.contains('lbcs-pin')) {
        th.classList.remove('lbcs-pin', 'lbcs-pin-last');
        th.style.left = '';
      }
    });
    if (hasCheck) pin(ths[0], false);
    pin(ths[trackIdx], true);

    tbody.querySelectorAll('tr').forEach(tr => {
      if (tr.classList.contains('empty-row')) return;
      if (hasCheck) pin(tr.children[0], false);
      pin(tr.children[trackIdx], true);
    });
  }

  /* ---------- sizes ---------- */
  function fitHeight() {
    if (isMobile()) { wrap.style.maxHeight = ''; return; }
    // box ends at the bottom of the screen (measured with page at top), min 360px
    const top = wrap.getBoundingClientRect().top + window.scrollY;
    const h = Math.round(Math.max(360, window.innerHeight - top - 24));
    const current = parseInt(wrap.style.maxHeight, 10) || 0;
    if (Math.abs(current - h) > 4) wrap.style.maxHeight = h + 'px';
  }

  function updateEdges() {
    const max = wrap.scrollWidth - wrap.clientWidth;
    const atLeft = wrap.scrollLeft <= 2;
    const atRight = wrap.scrollLeft >= max - 2;
    wrap.classList.toggle('lbcs-more-left', !atLeft);
    if (btnLeft.disabled !== atLeft) btnLeft.disabled = atLeft;
    if (btnRight.disabled !== atRight) btnRight.disabled = atRight;
  }

  function refreshWidth() {
    const overflow = !isMobile() && table.scrollWidth > wrap.clientWidth + 2;
    bar.classList.toggle('show', overflow);
    const w = table.scrollWidth + 'px';
    if (inner.style.width !== w) inner.style.width = w;
    if (track.scrollLeft !== wrap.scrollLeft) track.scrollLeft = wrap.scrollLeft;
    updateEdges();
  }

  /* ---------- batched refresh ---------- */
  let refreshFrame = 0;
  function scheduleRefresh(withHeight) {
    if (withHeight) scheduleRefresh.height = true;
    if (refreshFrame) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0;
      pinColumns();
      refreshWidth();
      if (scheduleRefresh.height) { scheduleRefresh.height = false; fitHeight(); }
    });
  }

  // table re-rendered (search, sort, add, delete, import)
  new MutationObserver(() => scheduleRefresh(false)).observe(tbody, { childList: true });
  // table got wider / narrower (new custom column, fonts) — watch the TABLE, not the box
  if (window.ResizeObserver) {
    let lastW = 0;
    new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      if (w !== lastW) { lastW = w; scheduleRefresh(false); }
    }).observe(table);
  }
  // window size changed → re-fit the box height too
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => scheduleRefresh(true), 120);
  });

  scheduleRefresh(true);
  setTimeout(() => scheduleRefresh(true), 400); // after fonts / bulk column load
});

/* ============================================================
   STYLES
   ============================================================ */
function lbcScrollInjectStyles() {
  if (document.getElementById('lbcScrollStyles')) return;
  const style = document.createElement('style');
  style.id = 'lbcScrollStyles';
  style.textContent = `
    /* no CSS smooth-scroll here — it fought the sync and caused the shake */
    .lbc-table-wrapper { scroll-behavior: auto !important; }

    /* ---------- top bar ---------- */
    .lbcs-hbar {
      display: none; align-items: center; gap: 8px;
      margin-bottom: 8px; padding: 6px 8px;
      border: 1px solid var(--color-gray-border); border-radius: 999px;
      background: var(--card-bg, #fff);
    }
    .lbcs-hbar.show { display: flex; }
    .lbcs-hbtn {
      width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--color-gray-border); background: var(--color-gray-bg);
      color: var(--color-black); font-size: 11px;
      transition: background .2s ease, color .2s ease, opacity .2s ease;
    }
    .lbcs-hbtn:hover:not(:disabled) { background: var(--tile-orange); color: #fff; border-color: transparent; }
    .lbcs-hbtn:disabled { opacity: .35; cursor: default; }
    .lbcs-htrack {
      flex: 1; overflow-x: auto; overflow-y: hidden; height: 12px;
      scroll-behavior: auto;
      scrollbar-width: thin; scrollbar-color: var(--color-gold) var(--color-gray-bg);
    }
    .lbcs-htrack::-webkit-scrollbar { height: 10px; }
    .lbcs-htrack::-webkit-scrollbar-track { background: var(--color-gray-bg); border-radius: 10px; }
    .lbcs-htrack::-webkit-scrollbar-thumb { background: var(--color-gold); border-radius: 10px; }
    .lbcs-htrack::-webkit-scrollbar-thumb:hover { background: var(--color-gold-dark); }
    .lbcs-hinner { height: 1px; }

    /* ---------- drag ---------- */
    .lbc-table-wrapper { cursor: grab; }
    .lbc-table-wrapper.lbcs-dragging { cursor: grabbing; user-select: none; }
    .lbc-table-wrapper.lbcs-dragging * { cursor: grabbing !important; }

    /* ---------- pinned columns (no transitions → no flicker) ---------- */
    .lbc-table th.lbcs-pin, .lbc-table td.lbcs-pin {
      position: sticky; left: 0; z-index: 2;
      transition: none !important;
      background-clip: padding-box;
    }
    .lbc-table thead th.lbcs-pin { z-index: 5; }
    .lbc-table td.lbcs-pin { background: var(--card-bg, #fff); }
    .lbc-table tbody tr:hover td.lbcs-pin { background: var(--row-hover); }
    .lbc-table tbody tr.lbcb-selected td.lbcs-pin { background: var(--row-hover); }
    .lbc-table-wrapper.lbcs-more-left .lbcs-pin-last {
      box-shadow: 6px 0 10px -6px rgba(19,13,29,.25) !important;
    }

    @media (max-width: 600px) {
      .lbcs-hbar { display: none !important; }
      .lbc-table-wrapper { cursor: auto; }
      .lbc-table th.lbcs-pin, .lbc-table td.lbcs-pin { position: static; box-shadow: none !important; }
    }
  `;
  document.head.appendChild(style);
}