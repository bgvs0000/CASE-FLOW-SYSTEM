/* ============================================================
   ABANTO LAW FIRM — DAILY-LOG.JS
   Daily Tasks Description Tracker: paralegal (Employee) fills
   a time-blocked task log + end-of-day summary, saves as draft
   or submits for review. Attorney/Head/IT see all submitted
   logs (read-only); Employees see and edit only their own.

   Depends on: storage.js, auth.js, modal.js, navigation.js
   ============================================================ */

let currentLogUser = null;
let logSearchTerm = '';
let logSortMode = 'newest';
let currentEditingLogId = null; // null = new log being drafted
let logRowCounter = 0;

document.addEventListener('DOMContentLoaded', () => {
  const session = requireAuth();
  if (!session) return;

  currentLogUser = getCurrentUser();
  initLayout('daily-log');

  applyRoleBasedLogUI();
  renderLogTable();
  attachDailyLogEvents();
});

/* ============================================================
   ROLE HELPERS
   ============================================================ */
function canReviewLogs(role) {
  return role === 'attorney' || role === 'head' || role === 'it';
}
function isParalegalRole(role) {
  return role === 'employee';
}

function applyRoleBasedLogUI() {
  const newBtn = document.getElementById('newDailyLogBtn');
  const subtitle = document.getElementById('dailyLogSubtitle');

  if (canReviewLogs(currentLogUser.role)) {
    newBtn.style.display = 'none';
    subtitle.textContent = 'Daily task logs submitted by paralegals.';
  } else {
    newBtn.style.display = 'inline-flex';
    subtitle.textContent = 'Log your day\'s tasks and submit for review.';
  }
}

/* ============================================================
   VISIBLE LOGS FOR CURRENT USER
   ============================================================ */
function getVisibleLogsForCurrentUser() {
  const allLogs = getDailyLogs();
  if (isParalegalRole(currentLogUser.role)) {
    return allLogs.filter(l => l.employeeId === currentLogUser.id);
  }
  return allLogs.filter(l => l.status === 'submitted'); // approvers only see finished logs, not each other's... wait paralegal drafts
}

function getFilteredSortedLogs() {
  let logs = getVisibleLogsForCurrentUser();

  if (logSearchTerm.trim()) {
    const q = logSearchTerm.trim().toLowerCase();
    logs = logs.filter(l => {
      const employee = findUserById(l.employeeId);
      const empName = employee ? `${employee.firstName} ${employee.lastName}`.toLowerCase() : '';
      return empName.includes(q) || (l.date || '').includes(q);
    });
  }

  logs.sort((a, b) => logSortMode === 'oldest'
    ? new Date(a.date) - new Date(b.date)
    : new Date(b.date) - new Date(a.date));

  return logs;
}

function getLogStatusBadgeClass(status) {
  return status === 'submitted' ? 'badge-completed' : 'badge-pending';
}
function getLogStatusLabel(status) {
  return status === 'submitted' ? 'Submitted' : 'Draft';
}

function renderLogTable() {
  const logs = getFilteredSortedLogs();
  const tbody = document.getElementById('logTableBody');

  if (logs.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No daily logs found.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const employee = findUserById(l.employeeId);
    const supervisor = findUserById(l.supervisingLawyerId);
    const isOwner = l.employeeId === currentLogUser.id;
    const canEdit = isOwner && l.status === 'draft';

    return `
      <tr>
        <td>${formatDate(l.date)}</td>
        <td>${employee ? escapeHtml(employee.firstName + ' ' + employee.lastName) : 'Unknown'}</td>
        <td>${supervisor ? escapeHtml(supervisor.firstName + ' ' + supervisor.lastName) : '—'}</td>
        <td class="daily-log-status-cell"><span class="badge ${getLogStatusBadgeClass(l.status)}">${getLogStatusLabel(l.status)}</span></td>
        <td>
          <div class="table-actions">
            ${canEdit
              ? `<button class="btn-icon" title="Edit Draft" data-edit-log="${l.id}"><i class="fa-solid fa-pen"></i></button>
                 <button class="btn-icon danger" title="Delete Draft" data-delete-log="${l.id}"><i class="fa-solid fa-trash"></i></button>`
              : `<button class="btn-icon" title="View" data-view-log="${l.id}"><i class="fa-solid fa-eye"></i></button>`
            }
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/* ============================================================
   SUPERVISING LAWYER DROPDOWN
   ============================================================ */
function populateSupervisorDropdown() {
  const select = document.getElementById('logSupervisingLawyer');
  const supervisors = getUsers().filter(u => u.role === 'attorney' || u.role === 'head');

  const currentValue = select.value;
  select.innerHTML = `<option value="">-- Select --</option>` +
    supervisors.map(u => `<option value="${u.id}">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</option>`).join('');

  if (currentValue) select.value = currentValue;
}

/* ============================================================
   ROW MANAGEMENT (editor modal)
   ============================================================ */
function addLogRow(rowData = null) {
  logRowCounter++;
  const tbody = document.getElementById('dailyLogRowsBody');
  const rowNum = tbody.children.length + 1;
  const rowId = `row_${logRowCounter}`;

  const tr = document.createElement('tr');
  tr.dataset.rowId = rowId;
  tr.innerHTML = `
    <td class="row-number-cell">${rowNum}</td>
    <td><input type="time" class="row-time-started" value="${rowData?.timeStarted || ''}"></td>
    <td><input type="time" class="row-time-completed" value="${rowData?.timeCompleted || ''}"></td>
    <td><textarea class="row-task-desc" rows="1" placeholder="Task description">${escapeHtml(rowData?.taskDescription || '')}</textarea></td>
    <td><input type="text" class="row-client" placeholder="Client" value="${escapeHtml(rowData?.client || '')}"></td>
    <td><input type="text" class="row-remarks" placeholder="Remarks" value="${escapeHtml(rowData?.remarks || '')}"></td>
    <td><button type="button" class="daily-log-remove-row-btn" data-remove-row><i class="fa-solid fa-xmark"></i></button></td>
  `;
  tbody.appendChild(tr);
}

function removeLogRow(rowEl) {
  rowEl.remove();
  // renumber remaining rows
  document.querySelectorAll('#dailyLogRowsBody tr').forEach((tr, idx) => {
    tr.querySelector('.row-number-cell').textContent = idx + 1;
  });
}

function collectRowsFromForm() {
  const rows = [];
  document.querySelectorAll('#dailyLogRowsBody tr').forEach(tr => {
    const timeStarted = tr.querySelector('.row-time-started').value;
    const timeCompleted = tr.querySelector('.row-time-completed').value;
    const taskDescription = tr.querySelector('.row-task-desc').value.trim();
    const client = tr.querySelector('.row-client').value.trim();
    const remarks = tr.querySelector('.row-remarks').value.trim();

    // Skip fully empty rows so blank template rows don't get saved
    if (timeStarted || timeCompleted || taskDescription || client || remarks) {
      rows.push({ timeStarted, timeCompleted, taskDescription, client, remarks });
    }
  });
  return rows;
}

/* ============================================================
   OPEN EDITOR (new log or edit existing draft)
   ============================================================ */
function openNewLogModal() {
  currentEditingLogId = null;
  document.getElementById('logEditorTitle').innerHTML = '<i class="fa-solid fa-clipboard-list"></i> New Daily Log';
  document.getElementById('dailyLogForm').reset();
  document.getElementById('logId').value = '';
  document.getElementById('logDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('logParalegalName').value = `${currentLogUser.firstName} ${currentLogUser.lastName}`;
  clearFormError('dailyLogFormError');
  populateSupervisorDropdown();

  document.getElementById('dailyLogRowsBody').innerHTML = '';
  for (let i = 0; i < 5; i++) addLogRow(); // 5 starter rows, matches the paper template

  openModal('logEditorModalOverlay');
}

function openEditLogModal(logId) {
  const log = findDailyLogById(logId);
  if (!log || log.employeeId !== currentLogUser.id || log.status !== 'draft') return;

  currentEditingLogId = logId;
  document.getElementById('logEditorTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Edit Daily Log (Draft)';
  clearFormError('dailyLogFormError');
  populateSupervisorDropdown();

  document.getElementById('logId').value = log.id;
  document.getElementById('logDate').value = log.date;
  document.getElementById('logParalegalName').value = `${currentLogUser.firstName} ${currentLogUser.lastName}`;
  document.getElementById('logSupervisingLawyer').value = log.supervisingLawyerId || '';

  document.getElementById('dailyLogRowsBody').innerHTML = '';
  (log.rows && log.rows.length ? log.rows : [null, null, null, null, null]).forEach(r => addLogRow(r));

  document.getElementById('logTasksCompleted').value = log.summary?.completed || '';
  document.getElementById('logTasksPending').value = log.summary?.pending || '';
  document.getElementById('logPendingReason').value = log.summary?.pendingReason || '';
  document.getElementById('logPriorityNextDay').value = log.summary?.priorityNextDay || '';

  openModal('logEditorModalOverlay');
}

/* ============================================================
   SAVE DRAFT / SUBMIT
   ============================================================ */
function buildLogPayload() {
  return {
    date: document.getElementById('logDate').value,
    supervisingLawyerId: document.getElementById('logSupervisingLawyer').value,
    rows: collectRowsFromForm(),
    summary: {
      completed: document.getElementById('logTasksCompleted').value.trim(),
      pending: document.getElementById('logTasksPending').value.trim(),
      pendingReason: document.getElementById('logPendingReason').value.trim(),
      priorityNextDay: document.getElementById('logPriorityNextDay').value.trim()
    }
  };
}

function handleSaveDraft() {
  clearFormError('dailyLogFormError');
  const payload = buildLogPayload();

  if (!payload.date) {
    showFormError('dailyLogFormError', 'Please select a date.');
    return;
  }

  const logs = getDailyLogs();

  if (currentEditingLogId) {
    const idx = logs.findIndex(l => l.id === currentEditingLogId);
    if (idx === -1) return;
    logs[idx] = { ...logs[idx], ...payload, updatedAt: nowISO() };
    saveDailyLogs(logs);
  } else {
    const newLog = {
      id: generateId('DLOG'),
      employeeId: currentLogUser.id,
      status: 'draft',
      ...payload,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      submittedAt: null
    };
    logs.push(newLog);
    saveDailyLogs(logs);
    currentEditingLogId = newLog.id;
    document.getElementById('logId').value = newLog.id;
  }

  showToast('Draft saved.', 'success');
  renderLogTable();
}

function handleSubmitLog(e) {
  e.preventDefault();
  clearFormError('dailyLogFormError');

  const payload = buildLogPayload();

  if (!payload.date) {
    showFormError('dailyLogFormError', 'Please select a date.');
    return;
  }
  if (!payload.supervisingLawyerId) {
    showFormError('dailyLogFormError', 'Please select a Supervising Lawyer.');
    return;
  }
  if (payload.rows.length === 0) {
    showFormError('dailyLogFormError', 'Please log at least one task before submitting.');
    return;
  }

  const logs = getDailyLogs();
  let savedLog;

  if (currentEditingLogId) {
    const idx = logs.findIndex(l => l.id === currentEditingLogId);
    if (idx === -1) return;
    logs[idx] = { ...logs[idx], ...payload, status: 'submitted', submittedAt: nowISO(), updatedAt: nowISO() };
    saveDailyLogs(logs);
    savedLog = logs[idx];
  } else {
    savedLog = {
      id: generateId('DLOG'),
      employeeId: currentLogUser.id,
      status: 'submitted',
      ...payload,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      submittedAt: nowISO()
    };
    logs.push(savedLog);
    saveDailyLogs(logs);
  }

  // Notify the selected supervising lawyer + every other Attorney/Head,
  // so any approver can review it even if the named supervisor is away.
  const approvers = getUsers().filter(u => u.role === 'attorney' || u.role === 'head').map(u => u.id);
  createNotificationForMany(
    approvers,
    'daily-log-submitted',
    'Daily task log submitted',
    `${currentLogUser.firstName} ${currentLogUser.lastName} submitted their daily log for ${formatDate(savedLog.date)}.`,
    { page: 'daily-log.html', targetId: `log:${savedLog.id}` }
  );

  showToast('Daily log submitted for review.', 'success');
  closeModal('logEditorModalOverlay');
  renderLogTable();
}

/* ============================================================
   DELETE DRAFT
   ============================================================ */
function handleDeleteLog(logId) {
  const log = findDailyLogById(logId);
  if (!log || log.employeeId !== currentLogUser.id || log.status !== 'draft') return;

  confirmDelete(
    `Delete this draft log for ${formatDate(log.date)}? This cannot be undone.`,
    () => {
      saveDailyLogs(getDailyLogs().filter(l => l.id !== logId));
      renderLogTable();
      showToast('Draft deleted.', 'success');
    },
    'Delete Draft',
    '<i class="fa-solid fa-trash"></i> Delete Draft'
  );
}

/* ============================================================
   VIEW LOG (read-only — submitted logs, or anyone else's)
   ============================================================ */
function openViewLogModal(logId) {
  const log = findDailyLogById(logId);
  if (!log) return;

  const employee = findUserById(log.employeeId);
  const supervisor = findUserById(log.supervisingLawyerId);

  document.getElementById('viewLogDate').textContent = formatDate(log.date);
  document.getElementById('viewLogParalegal').textContent = employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown';
  document.getElementById('viewLogSupervisor').textContent = supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : '—';

  const rowsBody = document.getElementById('viewLogRowsBody');
  if (!log.rows || log.rows.length === 0) {
    rowsBody.innerHTML = `<tr><td colspan="6" class="text-muted" style="text-align:center;">No task rows logged.</td></tr>`;
  } else {
    rowsBody.innerHTML = log.rows.map((r, idx) => `
      <tr>
        <td style="text-align:center; font-weight:700;">${idx + 1}</td>
        <td>${r.timeStarted || '—'}</td>
        <td>${r.timeCompleted || '—'}</td>
        <td>${escapeHtml(r.taskDescription || '—')}</td>
        <td>${escapeHtml(r.client || '—')}</td>
        <td>${escapeHtml(r.remarks || '—')}</td>
      </tr>
    `).join('');
  }

  document.getElementById('viewLogCompleted').textContent = log.summary?.completed || '—';
  document.getElementById('viewLogPending').textContent = log.summary?.pending || '—';
  document.getElementById('viewLogPendingReason').textContent = log.summary?.pendingReason || '—';
  document.getElementById('viewLogPriority').textContent = log.summary?.priorityNextDay || '—';

  document.getElementById('viewLogSubmittedMeta').textContent = log.status === 'submitted'
    ? `Submitted ${formatDateTime(log.submittedAt)}`
    : 'Draft — not yet submitted';

  openModal('logViewModalOverlay');
}

/* ============================================================
   PENDING NAV TARGET (bell click-to-jump) — format "log:<id>"
   ============================================================ */
function handlePendingNavTarget() {
  const target = consumePendingNavTarget();
  if (!target) return;
  const [type, id] = target.split(':');
  if (type === 'log' && id) openViewLogModal(id);
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function attachDailyLogEvents() {
  document.getElementById('newDailyLogBtn').addEventListener('click', openNewLogModal);
  document.getElementById('closeLogEditorModal').addEventListener('click', () => closeModal('logEditorModalOverlay'));
  enableClickOutsideClose('logEditorModalOverlay');

  document.getElementById('addLogRowBtn').addEventListener('click', () => addLogRow());
  document.getElementById('dailyLogRowsBody').addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove-row]');
    if (removeBtn) removeLogRow(removeBtn.closest('tr'));
  });

  document.getElementById('saveDraftBtn').addEventListener('click', handleSaveDraft);
  document.getElementById('dailyLogForm').addEventListener('submit', handleSubmitLog);

  document.getElementById('closeLogViewModal').addEventListener('click', () => closeModal('logViewModalOverlay'));
  enableClickOutsideClose('logViewModalOverlay');

  document.getElementById('logSearchInput').addEventListener('input', (e) => {
    logSearchTerm = e.target.value;
    renderLogTable();
  });
  document.getElementById('logSortSelect').addEventListener('change', (e) => {
    logSortMode = e.target.value;
    renderLogTable();
  });

  document.getElementById('logTableBody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-log]');
    const deleteBtn = e.target.closest('[data-delete-log]');
    const viewBtn = e.target.closest('[data-view-log]');

    if (editBtn) openEditLogModal(editBtn.dataset.editLog);
    if (deleteBtn) handleDeleteLog(deleteBtn.dataset.deleteLog);
    if (viewBtn) openViewLogModal(viewBtn.dataset.viewLog);
  });

  handlePendingNavTarget();
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