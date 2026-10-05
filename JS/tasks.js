/* ============================================================
   ABANTO LAW FIRM — TASKS.JS
   Full task workflow: Attorney/Head/IT create/edit/delete tasks;
   Employee views/updates/submits; Attorney/Head reviews with
   Approve / Reject (instant) / Redo (requires notes) — all fire
   notifications, bell click-to-jump, Control Panel activity
   logging, and (NEW) Custom Fields — a "+" button in the table
   header for extra columns, shown in the Create Task modal too.

   Status flow: pending -> in-progress -> awaiting-approval -> completed

   Depends on: storage.js, auth.js, modal.js, navigation.js,
   custom-fields.js (loaded before this file)
   ============================================================ */

const CF_MODULE_TASKS = 'tasks';

let currentTaskSession = null;
let currentTaskUser = null;
let taskSearchTerm = '';
let taskSortMode = 'newest';
let pendingTaskImageDataUrl = null;
let pendingEmpEvidenceDataUrl = null;

document.addEventListener('DOMContentLoaded', () => {
  currentTaskSession = requireAuth();
  if (!currentTaskSession) return;

  currentTaskUser = getCurrentUser();
  initLayout('tasks');
  injectCustomFieldsModal();
  attachCustomFieldClearHandler(document.getElementById('taskTableBody'), renderTaskTable);

  applyRoleBasedTaskUI();
  populateTaskEmployeeDropdown();
  renderTaskTable();
  attachTaskCoreEvents();
  attachEmployeeTaskEvents();
  attachTaskReviewEvents();
  attachRedoNotesEvents();

  handlePendingNavTarget();
});

/* ============================================================
   PENDING NAV TARGET (bell click-to-jump)
   ============================================================ */
function handlePendingNavTarget() {
  const target = consumePendingNavTarget();
  if (!target) return;

  const [type, id] = target.split(':');
  if (type !== 'task' || !id) return;

  const task = getTasks().find(t => t.id === id);
  if (!task) return;

  if (canApproveTasks(currentTaskUser.role) && task.status === 'awaiting-approval') {
    openTaskReviewModal(id);
  } else {
    openEmployeeTaskModal(id);
  }
}

/* ============================================================
   ROLE HELPERS
   ============================================================ */
function canCreateTasks(role) {
  return role === 'attorney' || role === 'head' || role === 'it';
}
function canApproveTasks(role) {
  return role === 'attorney' || role === 'head';
}
function isEmployeeRole(role) {
  return role === 'employee';
}

/* ============================================================
   APPLY ROLE-BASED UI
   ============================================================ */
function applyRoleBasedTaskUI() {
  const addBtn = document.getElementById('addTaskBtn');
  const subtitle = document.getElementById('tasksPageSubtitle');

  if (!canCreateTasks(currentTaskUser.role)) {
    addBtn.style.display = 'none';
    subtitle.textContent = 'View and update tasks assigned to you.';
  } else {
    addBtn.style.display = 'inline-flex';
    subtitle.textContent = 'Create, assign, and manage tasks for employees.';
  }
}

/* ============================================================
   EMPLOYEE DROPDOWN
   ============================================================ */
function populateTaskEmployeeDropdown() {
  const select = document.getElementById('taskAssignedEmployee');
  const employees = getUsers().filter(u => u.role === 'employee');

  const currentValue = select.value;
  select.innerHTML = `<option value="">-- Select Employee --</option>` +
    employees.map(u => `<option value="${u.id}">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</option>`).join('');

  if (currentValue) select.value = currentValue;

  if (employees.length === 0) {
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.textContent = 'No employee accounts registered yet';
    select.appendChild(opt);
  }
}

/* ============================================================
   RENDER: STAT TILES + TABLE
   ============================================================ */
function getVisibleTasksForCurrentUser() {
  const allTasks = getTasks();
  if (isEmployeeRole(currentTaskUser.role)) {
    return allTasks.filter(t => t.assignedTo === currentTaskUser.id);
  }
  return allTasks;
}

function renderTaskTiles(tasks) {
  const total = tasks.length;
  const pending = tasks.filter(t => t.status === 'pending').length;
  const inProgress = tasks.filter(t => t.status === 'in-progress' || t.status === 'awaiting-approval').length;
  const completed = tasks.filter(t => t.status === 'completed').length;

  document.getElementById('tileTotalTasks').textContent = total;
  document.getElementById('tilePendingTasks').textContent = pending;
  document.getElementById('tileInProgressTasks').textContent = inProgress;
  document.getElementById('tileCompletedTasks').textContent = completed;
}

function getFilteredSortedTasks() {
  let tasks = getVisibleTasksForCurrentUser();

  if (taskSearchTerm.trim()) {
    const q = taskSearchTerm.trim().toLowerCase();
    tasks = tasks.filter(t => {
      const employee = findUserById(t.assignedTo);
      const empName = employee ? `${employee.firstName} ${employee.lastName}`.toLowerCase() : '';
      return t.title.toLowerCase().includes(q) || empName.includes(q);
    });
  }

  switch (taskSortMode) {
    case 'newest': tasks.sort((a, b) => new Date(b.taskDate) - new Date(a.taskDate)); break;
    case 'oldest': tasks.sort((a, b) => new Date(a.taskDate) - new Date(b.taskDate)); break;
    case 'az': tasks.sort((a, b) => a.title.localeCompare(b.title)); break;
    case 'za': tasks.sort((a, b) => b.title.localeCompare(a.title)); break;
    case 'status': tasks.sort((a, b) => a.status.localeCompare(b.status)); break;
  }

  return tasks;
}

function getStatusLabel(status) {
  const labels = {
    'pending': 'Pending',
    'in-progress': 'In Progress',
    'awaiting-approval': 'Completed / Awaiting Approval',
    'completed': 'Completed'
  };
  return labels[status] || status;
}

function getStatusBadgeClass(status) {
  const map = {
    'pending': 'badge-pending',
    'in-progress': 'badge-in-progress',
    'awaiting-approval': 'badge-awaiting',
    'completed': 'badge-completed'
  };
  return map[status] || 'badge-pending';
}

function getEmployeeInitials(user) {
  if (!user) return '?';
  return ((user.firstName || '').charAt(0) + (user.lastName || '').charAt(0)).toUpperCase();
}

/**
 * Renders the "+" column header + any existing custom field
 * headers into the table's <thead>. Same swap pattern as
 * lbc.js/dashboard.js/bills.js.
 */
function renderTaskCustomFieldHeaders() {
  const headerCell = document.getElementById('taskCustomFieldHeaders');
  if (!headerCell) return;

  const temp = document.createElement('tr');
  temp.innerHTML = renderCustomFieldHeaders(CF_MODULE_TASKS);
  const newCells = Array.from(temp.children);

  const parentRow = headerCell.parentElement;
  const placeholderIndex = Array.from(parentRow.children).indexOf(headerCell);
  headerCell.remove();
  newCells.reverse().forEach(cell => {
    parentRow.insertBefore(cell, parentRow.children[placeholderIndex] || null);
  });
  newCells[newCells.length - 1].id = 'taskCustomFieldHeaders';
}

function renderTaskTable() {
  const tasks = getFilteredSortedTasks();
  const tbody = document.getElementById('taskTableBody');

  renderTaskTiles(getVisibleTasksForCurrentUser());
  renderTaskCustomFieldHeaders();

  const totalCols = 6 + getCustomFieldColspan(CF_MODULE_TASKS);

  if (tasks.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${totalCols}">No tasks found.</td></tr>`;
    return;
  }

  tbody.innerHTML = tasks.map(t => {
    const employee = findUserById(t.assignedTo);
    const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : '<span class="text-muted">Unassigned</span>';
    const rowClass = t.status === 'awaiting-approval' ? 'row-awaiting-approval' : '';

    return `
      <tr class="${rowClass}">
        <td class="task-date-cell">${formatDate(t.taskDate)}</td>
        <td class="task-title-cell">${escapeHtml(t.title)}</td>
        <td>
          <div class="task-employee-cell">
            <div class="task-employee-avatar">${getEmployeeInitials(employee)}</div>
            <span>${employeeName}</span>
          </div>
        </td>
        <td class="task-notes-cell" title="${escapeHtml(t.notes)}">${escapeHtml(t.notes)}</td>
        <td><span class="badge ${getStatusBadgeClass(t.status)}">${getStatusLabel(t.status)}</span></td>
        ${renderCustomFieldCells(CF_MODULE_TASKS, t)}
        <td>
          <div class="table-actions">
            ${buildTaskRowActionButton(t)}
            ${canCreateTasks(currentTaskUser.role) ? `
              <button class="btn-icon" title="Edit" data-edit-task="${t.id}"><i class="fa-solid fa-pen"></i></button>
              <button class="btn-icon danger" title="Delete" data-delete-task="${t.id}"><i class="fa-solid fa-trash"></i></button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function buildTaskRowActionButton(task) {
  const role = currentTaskUser.role;

  if (isEmployeeRole(role) && task.assignedTo === currentTaskUser.id) {
    const label = task.status === 'completed' ? 'View' : 'Open';
    const icon = task.status === 'completed' ? 'fa-eye' : 'fa-arrow-up-right-from-square';
    return `<button class="task-open-btn" data-open-employee-task="${task.id}"><i class="fa-solid ${icon}"></i> ${label}</button>`;
  }

  if (canApproveTasks(role) && task.status === 'awaiting-approval') {
    return `<button class="task-open-btn review" data-open-task-review="${task.id}"><i class="fa-solid fa-clipboard-check"></i> Review</button>`;
  }

  return `<button class="task-open-btn" data-open-employee-task="${task.id}"><i class="fa-solid fa-eye"></i> View</button>`;
}

/* ============================================================
   ADD / EDIT TASK
   ============================================================ */
function openAddTaskModal() {
  if (!canCreateTasks(currentTaskUser.role)) return;

  document.getElementById('taskModalTitle').innerHTML = '<i class="fa-solid fa-list-check"></i> Create Task';
  document.getElementById('taskForm').reset();
  document.getElementById('taskId').value = '';
  document.getElementById('taskImgPreviewWrap').style.display = 'none';
  document.getElementById('taskImgPreview').src = '';
  pendingTaskImageDataUrl = null;
  clearFormError('taskFormError');
  populateTaskEmployeeDropdown();
  document.getElementById('taskCustomFieldsWrap').innerHTML = renderCustomFieldFormInputs(CF_MODULE_TASKS, {});
  openModal('taskModalOverlay');
}

function openEditTaskModal(taskId) {
  if (!canCreateTasks(currentTaskUser.role)) return;

  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;

  document.getElementById('taskModalTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Edit Task';
  clearFormError('taskFormError');
  populateTaskEmployeeDropdown();

  document.getElementById('taskId').value = task.id;
  document.getElementById('taskDate').value = task.taskDate;
  document.getElementById('taskAssignedEmployee').value = task.assignedTo || '';
  document.getElementById('taskTitle').value = task.title;
  document.getElementById('taskNotes').value = task.notes;

  if (task.referenceImageDataUrl) {
    document.getElementById('taskImgPreview').src = task.referenceImageDataUrl;
    document.getElementById('taskImgPreviewWrap').style.display = 'block';
    pendingTaskImageDataUrl = task.referenceImageDataUrl;
  } else {
    document.getElementById('taskImgPreviewWrap').style.display = 'none';
    pendingTaskImageDataUrl = null;
  }

  document.getElementById('taskCustomFieldsWrap').innerHTML = renderCustomFieldFormInputs(CF_MODULE_TASKS, task.customFields || {});

  openModal('taskModalOverlay');
}

async function handleTaskImageSelect(file) {
  if (!file) {
    pendingTaskImageDataUrl = null;
    document.getElementById('taskImgPreviewWrap').style.display = 'none';
    return;
  }

  const MAX_IMAGE_SIZE = 3 * 1024 * 1024;
  if (file.size > MAX_IMAGE_SIZE) {
    showFormError('taskFormError', 'Image too large (3MB limit for this prototype).');
    document.getElementById('taskImageInput').value = '';
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    pendingTaskImageDataUrl = dataUrl;
    document.getElementById('taskImgPreview').src = dataUrl;
    document.getElementById('taskImgPreviewWrap').style.display = 'block';
  } catch (err) {
    console.error('[tasks.js] Failed to read image:', err);
    showFormError('taskFormError', 'Failed to read image file.');
  }
}

function handleTaskFormSubmit(e) {
  e.preventDefault();
  clearFormError('taskFormError');

  const id = document.getElementById('taskId').value;
  const taskDate = document.getElementById('taskDate').value;
  const assignedTo = document.getElementById('taskAssignedEmployee').value;
  const title = document.getElementById('taskTitle').value.trim();
  const notes = document.getElementById('taskNotes').value.trim();
  const customFields = collectCustomFieldValues(CF_MODULE_TASKS);

  if (!taskDate || !assignedTo || !title || !notes) {
    showFormError('taskFormError', 'Please fill in all required fields.');
    return;
  }

  const tasks = getTasks();
  const employee = findUserById(assignedTo);
  const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : 'employee';

  if (id) {
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) {
      showFormError('taskFormError', 'Task not found.');
      return;
    }
    const reassigned = tasks[idx].assignedTo !== assignedTo;
    tasks[idx] = {
      ...tasks[idx],
      taskDate, assignedTo, title, notes,
      referenceImageDataUrl: pendingTaskImageDataUrl || null,
      customFields,
      updatedAt: nowISO()
    };
    saveTasks(tasks);

    if (reassigned) {
      createNotification(
        assignedTo, 'task-assigned', 'Task assigned to you', `"${title}" was assigned to you.`,
        { page: 'tasks.html', targetId: `task:${id}` }
      );
    }

    if (typeof logActivity === 'function') {
      logActivity(currentTaskUser.id, 'task-action', `Edited task "${title}" (assigned to ${employeeName}).`);
    }

    showToast('Task updated successfully.', 'success');
  } else {
    const newTask = {
      id: generateId('TASK'),
      taskDate, assignedTo, title, notes,
      referenceImageDataUrl: pendingTaskImageDataUrl || null,
      status: 'pending',
      createdBy: currentTaskUser.id,
      submissionNotes: '',
      evidenceImageDataUrl: null,
      redoNotes: null,
      customFields,
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
    tasks.push(newTask);
    saveTasks(tasks);

    createNotification(
      assignedTo, 'task-assigned', 'New task assigned to you', `"${title}" — due ${formatDate(taskDate)}`,
      { page: 'tasks.html', targetId: `task:${newTask.id}` }
    );

    if (typeof logActivity === 'function') {
      logActivity(currentTaskUser.id, 'task-action', `Created task "${title}" for ${employeeName}.`);
    }

    showToast('Task created and assigned successfully.', 'success');
  }

  closeModal('taskModalOverlay');
  renderTaskTable();
}

/* ============================================================
   DELETE TASK
   ============================================================ */
function handleDeleteTask(taskId) {
  if (!canCreateTasks(currentTaskUser.role)) return;

  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;

  confirmDelete(
    `Delete task "${task.title}"? This cannot be undone.`,
    () => {
      saveTasks(getTasks().filter(t => t.id !== taskId));

      if (typeof logActivity === 'function') {
        logActivity(currentTaskUser.id, 'task-action', `Deleted task "${task.title}".`);
      }

      renderTaskTable();
      showToast('Task deleted.', 'success');
    },
    'Delete Task',
    '<i class="fa-solid fa-trash"></i> Delete Task'
  );
}

/* ============================================================
   EMPLOYEE TASK MODAL
   ============================================================ */
function openEmployeeTaskModal(taskId) {
  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;

  const isOwner = isEmployeeRole(currentTaskUser.role) && task.assignedTo === currentTaskUser.id;
  const isReadOnly = !isOwner || task.status === 'completed';

  document.getElementById('empTaskId').value = task.id;
  document.getElementById('empTaskTitleView').textContent = task.title;
  document.getElementById('empTaskDateView').textContent = formatDate(task.taskDate);
  document.getElementById('empTaskNotesView').textContent = task.notes;

  const imgBlock = document.getElementById('empTaskImageBlock');
  if (task.referenceImageDataUrl) {
    document.getElementById('empTaskImageView').src = task.referenceImageDataUrl;
    imgBlock.style.display = 'block';
  } else {
    imgBlock.style.display = 'none';
  }

  const redoBlock = document.getElementById('empTaskRedoNoticeBlock');
  if (task.redoNotes && task.status === 'in-progress') {
    document.getElementById('empTaskRedoNotesView').textContent = task.redoNotes;
    redoBlock.style.display = 'block';
  } else {
    redoBlock.style.display = 'none';
  }

  document.getElementById('empTaskSubmissionNotes').value = task.submissionNotes || '';
  pendingEmpEvidenceDataUrl = task.evidenceImageDataUrl || null;

  const evidencePreviewWrap = document.getElementById('empTaskEvidencePreviewWrap');
  if (task.evidenceImageDataUrl) {
    document.getElementById('empTaskEvidencePreview').src = task.evidenceImageDataUrl;
    evidencePreviewWrap.style.display = 'block';
  } else {
    evidencePreviewWrap.style.display = 'none';
  }

  clearFormError('empTaskFormError');

  const markInProgressBtn = document.getElementById('markInProgressBtn');
  const submitBtn = document.getElementById('submitTaskCompletionBtn');
  const notesInput = document.getElementById('empTaskSubmissionNotes');
  const evidenceInput = document.getElementById('empTaskEvidenceInput');

  if (isReadOnly) {
    notesInput.disabled = true;
    evidenceInput.disabled = true;
    markInProgressBtn.style.display = 'none';
    submitBtn.style.display = 'none';
  } else {
    notesInput.disabled = false;
    evidenceInput.disabled = false;
    markInProgressBtn.style.display = task.status === 'pending' ? 'inline-flex' : 'none';
    submitBtn.style.display = 'inline-flex';
  }

  openModal('employeeTaskModalOverlay');
}

async function handleEmpEvidenceSelect(file) {
  if (!file) return;

  const MAX_IMAGE_SIZE = 3 * 1024 * 1024;
  if (file.size > MAX_IMAGE_SIZE) {
    showFormError('empTaskFormError', 'Image too large (3MB limit for this prototype).');
    document.getElementById('empTaskEvidenceInput').value = '';
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    pendingEmpEvidenceDataUrl = dataUrl;
    document.getElementById('empTaskEvidencePreview').src = dataUrl;
    document.getElementById('empTaskEvidencePreviewWrap').style.display = 'block';
  } catch (err) {
    console.error('[tasks.js] Failed to read evidence image:', err);
    showFormError('empTaskFormError', 'Failed to read image file.');
  }
}

function handleMarkInProgress() {
  const taskId = document.getElementById('empTaskId').value;
  const tasks = getTasks();
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return;

  tasks[idx].status = 'in-progress';
  tasks[idx].updatedAt = nowISO();
  saveTasks(tasks);

  if (typeof logActivity === 'function') {
    logActivity(currentTaskUser.id, 'task-action', `Marked task "${tasks[idx].title}" as In Progress.`);
  }

  showToast('Task marked as In Progress.', 'success');
  closeModal('employeeTaskModalOverlay');
  renderTaskTable();
}

function notifyApproversOfSubmission(task) {
  const approvers = getUsers().filter(u => canApproveTasks(u.role)).map(u => u.id);
  const employee = findUserById(task.assignedTo);
  const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : 'An employee';

  createNotificationForMany(
    approvers,
    'task-submitted',
    'Task submitted for approval',
    `${employeeName} completed "${task.title}" — ready for review.`,
    { page: 'tasks.html', targetId: `task:${task.id}` }
  );
}

function handleSubmitTaskCompletion(e) {
  e.preventDefault();
  clearFormError('empTaskFormError');

  const taskId = document.getElementById('empTaskId').value;
  const submissionNotes = document.getElementById('empTaskSubmissionNotes').value.trim();

  if (!submissionNotes) {
    showFormError('empTaskFormError', 'Please describe what you did before submitting.');
    return;
  }

  const tasks = getTasks();
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return;

  tasks[idx].status = 'awaiting-approval';
  tasks[idx].submissionNotes = submissionNotes;
  tasks[idx].evidenceImageDataUrl = pendingEmpEvidenceDataUrl || null;
  tasks[idx].redoNotes = null;
  tasks[idx].submittedAt = nowISO();
  tasks[idx].updatedAt = nowISO();
  saveTasks(tasks);

  notifyApproversOfSubmission(tasks[idx]);

  if (typeof logActivity === 'function') {
    logActivity(currentTaskUser.id, 'task-action', `Submitted task "${tasks[idx].title}" for approval.`);
  }

  showToast('Task submitted for approval.', 'success');
  closeModal('employeeTaskModalOverlay');
  renderTaskTable();
}

/* ============================================================
   TASK REVIEW MODAL — Approve / Reject / Redo
   ============================================================ */
function openTaskReviewModal(taskId) {
  if (!canApproveTasks(currentTaskUser.role)) return;

  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;

  const employee = findUserById(task.assignedTo);

  document.getElementById('reviewTaskId').value = task.id;
  document.getElementById('reviewTaskTitle').textContent = task.title;
  document.getElementById('reviewTaskEmployee').textContent = employee ? `${employee.firstName} ${employee.lastName}` : 'Unassigned';
  document.getElementById('reviewTaskNotes').textContent = task.notes;
  document.getElementById('reviewTaskSubmissionNotes').textContent = task.submissionNotes || '(No notes submitted)';

  const evidenceBlock = document.getElementById('reviewTaskEvidenceBlock');
  if (task.evidenceImageDataUrl) {
    document.getElementById('reviewTaskEvidenceImg').src = task.evidenceImageDataUrl;
    evidenceBlock.style.display = 'block';
  } else {
    evidenceBlock.style.display = 'none';
  }

  openModal('taskReviewModalOverlay');
}

function handleApproveTask() {
  const taskId = document.getElementById('reviewTaskId').value;
  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;

  confirmDelete(
    `Approve completion of "${task.title}"? This will mark the task as fully Completed.`,
    () => {
      const tasks = getTasks();
      const idx = tasks.findIndex(t => t.id === taskId);
      if (idx === -1) return;

      tasks[idx].status = 'completed';
      tasks[idx].approvedBy = currentTaskUser.id;
      tasks[idx].approvedAt = nowISO();
      tasks[idx].updatedAt = nowISO();
      saveTasks(tasks);

      createNotification(
        tasks[idx].assignedTo, 'task-approved', 'Task approved!', `"${tasks[idx].title}" was approved and marked Completed.`,
        { page: 'tasks.html', targetId: `task:${taskId}` }
      );

      if (typeof logActivity === 'function') {
        logActivity(currentTaskUser.id, 'task-action', `Approved task "${tasks[idx].title}".`);
      }

      showToast('Task approved and marked Completed.', 'success');
      closeModal('taskReviewModalOverlay');
      renderTaskTable();
    },
    'Approve Task',
    '<i class="fa-solid fa-check-double"></i> Approve',
    'fa-clipboard-check'
  );
}

function handleRejectTask() {
  const taskId = document.getElementById('reviewTaskId').value;
  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;

  confirmDelete(
    `Reject "${task.title}" and send it back to the employee? Status will return to In Progress.`,
    () => {
      const tasks = getTasks();
      const idx = tasks.findIndex(t => t.id === taskId);
      if (idx === -1) return;

      tasks[idx].status = 'in-progress';
      tasks[idx].redoNotes = null;
      tasks[idx].updatedAt = nowISO();
      saveTasks(tasks);

      createNotification(
        tasks[idx].assignedTo, 'task-rejected', 'Task rejected', `"${tasks[idx].title}" was rejected and needs to be redone.`,
        { page: 'tasks.html', targetId: `task:${taskId}` }
      );

      if (typeof logActivity === 'function') {
        logActivity(currentTaskUser.id, 'task-action', `Rejected task "${tasks[idx].title}".`);
      }

      showToast('Task rejected and sent back to employee.', 'success');
      closeModal('taskReviewModalOverlay');
      renderTaskTable();
    },
    'Reject Task',
    '<i class="fa-solid fa-xmark"></i> Reject',
    'fa-xmark'
  );
}

function handleRedoTaskClick() {
  const taskId = document.getElementById('reviewTaskId').value;
  document.getElementById('redoTaskId').value = taskId;
  document.getElementById('redoNotesInput').value = '';
  clearFormError('redoNotesError');
  openModal('redoNotesModalOverlay');
}

function handleRedoNotesSubmit(e) {
  e.preventDefault();
  clearFormError('redoNotesError');

  const taskId = document.getElementById('redoTaskId').value;
  const notes = document.getElementById('redoNotesInput').value.trim();

  if (!notes) {
    showFormError('redoNotesError', 'Please explain what needs to be revised.');
    return;
  }

  const tasks = getTasks();
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return;

  tasks[idx].status = 'in-progress';
  tasks[idx].redoNotes = notes;
  tasks[idx].updatedAt = nowISO();
  saveTasks(tasks);

  createNotification(
    tasks[idx].assignedTo, 'task-redo', 'Task sent back for revision', `"${tasks[idx].title}": ${notes}`,
    { page: 'tasks.html', targetId: `task:${taskId}` }
  );

  if (typeof logActivity === 'function') {
    logActivity(currentTaskUser.id, 'task-action', `Sent task "${tasks[idx].title}" back for revision.`);
  }

  showToast('Task sent back to employee with revision notes.', 'success');
  closeModal('redoNotesModalOverlay');
  closeModal('taskReviewModalOverlay');
  renderTaskTable();
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function attachTaskCoreEvents() {
  const addBtn = document.getElementById('addTaskBtn');
  if (addBtn) addBtn.addEventListener('click', openAddTaskModal);

  document.getElementById('closeTaskModal').addEventListener('click', () => closeModal('taskModalOverlay'));
  document.getElementById('taskForm').addEventListener('submit', handleTaskFormSubmit);
  enableClickOutsideClose('taskModalOverlay');

  const taskImageInput = document.getElementById('taskImageInput');
  taskImageInput.addEventListener('change', () => {
    handleTaskImageSelect(taskImageInput.files[0]);
  });

  document.getElementById('taskSearchInput').addEventListener('input', (e) => {
    taskSearchTerm = e.target.value;
    renderTaskTable();
  });

  document.getElementById('taskSortSelect').addEventListener('change', (e) => {
    taskSortMode = e.target.value;
    renderTaskTable();
  });

  document.getElementById('taskTableBody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-task]');
    const deleteBtn = e.target.closest('[data-delete-task]');
    const openEmpBtn = e.target.closest('[data-open-employee-task]');
    const openReviewBtn = e.target.closest('[data-open-task-review]');

    if (editBtn) openEditTaskModal(editBtn.dataset.editTask);
    if (deleteBtn) handleDeleteTask(deleteBtn.dataset.deleteTask);
    if (openEmpBtn) openEmployeeTaskModal(openEmpBtn.dataset.openEmployeeTask);
    if (openReviewBtn) openTaskReviewModal(openReviewBtn.dataset.openTaskReview);
  });

  // NEW: "+" button in the table header opens the shared Custom Fields manager
  document.getElementById('taskTableBody').closest('table').querySelector('thead').addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-cf-open-manager]');
    if (openBtn) {
      openCustomFieldsManager(CF_MODULE_TASKS, 'Tasks', renderTaskTable);
    }
  });

  document.getElementById('taskCustomFieldsBtn').addEventListener('click', () => {
    openCustomFieldsManager(CF_MODULE_TASKS, 'Tasks', renderTaskTable);
  });
}

function attachEmployeeTaskEvents() {
  document.getElementById('closeEmployeeTaskModal').addEventListener('click', () => closeModal('employeeTaskModalOverlay'));
  enableClickOutsideClose('employeeTaskModalOverlay');

  document.getElementById('markInProgressBtn').addEventListener('click', handleMarkInProgress);
  document.getElementById('employeeTaskForm').addEventListener('submit', handleSubmitTaskCompletion);

  const evidenceInput = document.getElementById('empTaskEvidenceInput');
  evidenceInput.addEventListener('change', () => {
    handleEmpEvidenceSelect(evidenceInput.files[0]);
  });
}

function attachTaskReviewEvents() {
  document.getElementById('closeTaskReviewModal').addEventListener('click', () => closeModal('taskReviewModalOverlay'));
  enableClickOutsideClose('taskReviewModalOverlay');

  document.getElementById('approveTaskBtn').addEventListener('click', handleApproveTask);
  document.getElementById('rejectTaskBtn').addEventListener('click', handleRejectTask);
  document.getElementById('redoTaskBtn').addEventListener('click', handleRedoTaskClick);
}

function attachRedoNotesEvents() {
  document.getElementById('closeRedoNotesModal').addEventListener('click', () => closeModal('redoNotesModalOverlay'));
  enableClickOutsideClose('redoNotesModalOverlay');
  document.getElementById('redoNotesForm').addEventListener('submit', handleRedoNotesSubmit);
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}