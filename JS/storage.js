/* ============================================================
   CASEFLOW — STORAGE.JS
   Central LocalStorage data layer.
   Every other file reads/writes data ONLY through the helpers
   in this file. Do not access localStorage directly elsewhere.
   ============================================================ */

/* ---------- STORAGE KEYS ---------- */
const STORAGE_KEYS = {
  USERS: 'caseflow_users',
  SESSION: 'caseflow_session',
  CLIENTS: 'caseflow_clients',
  CASES: 'caseflow_cases',
  HEARINGS: 'caseflow_hearings',
  DOCUMENTS: 'caseflow_documents',
  PROGRESS: 'caseflow_progress',
  MESSAGES: 'caseflow_messages',
  GROUPS: 'caseflow_groups',
  NOTIFICATIONS: 'caseflow_notifications',
  CALENDAR_NOTES: 'caseflow_calendar_notes',
  AUDIT_LOG: 'caseflow_audit_log',
  ACCESS_CONTROL: 'caseflow_access_control',
  ACTIVITY_LOG: 'caseflow_activity_log',
  CUSTOM_FIELDS: 'caseflow_custom_fields',
  PENDING_OTP: 'caseflow_pending_otp',
  DOC_MOVEMENTS: 'caseflow_doc_movements'
};

/* ---------- GENERIC GET / SET ---------- */

function getData(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[storage.js] Failed to parse LocalStorage key "${key}":`, err);
    return fallback;
  }
}

function setData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(`[storage.js] Failed to save LocalStorage key "${key}":`, err);
    return false;
  }
}

/* ---------- ID / TIMESTAMP HELPERS ---------- */

function generateId(prefix = 'ID') {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  return `${prefix}-${timestamp}-${random}`;
}

function nowISO() {
  return new Date().toISOString();
}

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d)) return '—';
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

function formatTimeAgo(isoString) {
  if (!isoString) return '—';
  const then = new Date(isoString).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(isoString);
}

/* ---------- SIMPLE PASSWORD OBFUSCATION ---------- */
function hashPassword(plain) {
  return btoa(unescape(encodeURIComponent('caseflow_salt_' + plain)));
}

function verifyPassword(plain, hashed) {
  return hashPassword(plain) === hashed;
}

/* ---------- ENTITY-SPECIFIC ACCESSORS ---------- */

// USERS
function getUsers() { return getData(STORAGE_KEYS.USERS, []); }
function saveUsers(users) { return setData(STORAGE_KEYS.USERS, users); }

// SESSION
function getSession() { return getData(STORAGE_KEYS.SESSION, null); }
function saveSession(sessionObj) { return setData(STORAGE_KEYS.SESSION, sessionObj); }
function clearSession() { localStorage.removeItem(STORAGE_KEYS.SESSION); }

// CLIENTS
function getClients() { return getData(STORAGE_KEYS.CLIENTS, []); }
function saveClients(clients) { return setData(STORAGE_KEYS.CLIENTS, clients); }

// CASES
function getCases() { return getData(STORAGE_KEYS.CASES, []); }
function saveCases(cases) { return setData(STORAGE_KEYS.CASES, cases); }

// HEARINGS
function getHearings() { return getData(STORAGE_KEYS.HEARINGS, []); }
function saveHearings(hearings) { return setData(STORAGE_KEYS.HEARINGS, hearings); }

// DOCUMENTS
function getDocuments() { return getData(STORAGE_KEYS.DOCUMENTS, []); }
function saveDocuments(docs) { return setData(STORAGE_KEYS.DOCUMENTS, docs); }

// PROGRESS
function getProgressEntries() { return getData(STORAGE_KEYS.PROGRESS, []); }
function saveProgressEntries(entries) { return setData(STORAGE_KEYS.PROGRESS, entries); }

// MESSAGES
function getMessages() { return getData(STORAGE_KEYS.MESSAGES, []); }
function saveMessages(messages) { return setData(STORAGE_KEYS.MESSAGES, messages); }

// GROUPS
function getGroups() { return getData(STORAGE_KEYS.GROUPS, []); }
function saveGroups(groups) { return setData(STORAGE_KEYS.GROUPS, groups); }

// NOTIFICATIONS
function getNotifications() { return getData(STORAGE_KEYS.NOTIFICATIONS, []); }
function saveNotifications(notifications) { return setData(STORAGE_KEYS.NOTIFICATIONS, notifications); }

// CALENDAR NOTES
function getCalendarNotes() { return getData(STORAGE_KEYS.CALENDAR_NOTES, []); }
function saveCalendarNotes(notes) { return setData(STORAGE_KEYS.CALENDAR_NOTES, notes); }

// AUDIT LOG
function getAuditLog() { return getData(STORAGE_KEYS.AUDIT_LOG, []); }
function saveAuditLog(entries) { return setData(STORAGE_KEYS.AUDIT_LOG, entries); }

function logAuditEntry(entry) {
  const log = getAuditLog();
  log.push({ id: generateId('AUDIT'), createdAt: nowISO(), ...entry });
  saveAuditLog(log);
}

// ACCESS CONTROL
function getAccessControlList() { return getData(STORAGE_KEYS.ACCESS_CONTROL, []); }
function saveAccessControlList(list) { return setData(STORAGE_KEYS.ACCESS_CONTROL, list); }

function getAccessOverrideForUser(userId) {
  return getAccessControlList().find(a => a.userId === userId) || null;
}

function setAccessOverrideForUser(userId, allowedNavKeys) {
  const list = getAccessControlList();
  const idx = list.findIndex(a => a.userId === userId);
  if (idx !== -1) {
    list[idx].allowedNavKeys = allowedNavKeys;
    list[idx].updatedAt = nowISO();
  } else {
    list.push({ userId, allowedNavKeys, updatedAt: nowISO() });
  }
  saveAccessControlList(list);
}

function clearAccessOverrideForUser(userId) {
  saveAccessControlList(getAccessControlList().filter(a => a.userId !== userId));
}

// ACTIVITY LOG
function getActivityLog() { return getData(STORAGE_KEYS.ACTIVITY_LOG, []); }
function saveActivityLog(entries) { return setData(STORAGE_KEYS.ACTIVITY_LOG, entries); }

function logActivity(userId, action, description) {
  if (!userId) return;
  const log = getActivityLog();
  log.push({ id: generateId('ACT'), userId, action, description, createdAt: nowISO() });
  const trimmed = log.length > 500 ? log.slice(log.length - 500) : log;
  saveActivityLog(trimmed);
}

function getActivityLogForUser(userId) {
  return getActivityLog()
    .filter(a => a.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// CUSTOM FIELDS
function getCustomFieldDefinitions() { return getData(STORAGE_KEYS.CUSTOM_FIELDS, []); }
function saveCustomFieldDefinitions(defs) { return setData(STORAGE_KEYS.CUSTOM_FIELDS, defs); }

function getCustomFieldsForModule(module) {
  return getCustomFieldDefinitions().filter(f => f.module === module);
}

function addCustomFieldDefinition(module, fieldLabel, fieldType) {
  const fieldKey = 'cf_' + fieldLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '_' + Date.now().toString(36);
  const defs = getCustomFieldDefinitions();
  const newField = { id: generateId('CFIELD'), module, fieldKey, fieldLabel: fieldLabel.trim(), fieldType, createdAt: nowISO() };
  defs.push(newField);
  saveCustomFieldDefinitions(defs);
  return newField;
}

function deleteCustomFieldDefinition(fieldId) {
  saveCustomFieldDefinitions(getCustomFieldDefinitions().filter(f => f.id !== fieldId));
}

// PENDING OTP
function getPendingOtp() { return getData(STORAGE_KEYS.PENDING_OTP, null); }
function savePendingOtp(otpObj) { return setData(STORAGE_KEYS.PENDING_OTP, otpObj); }
function clearPendingOtp() { localStorage.removeItem(STORAGE_KEYS.PENDING_OTP); }

// DOCUMENT MOVEMENTS (every action done on a Document Manager file)
const DOC_MOVEMENTS_LIMIT = 1000;

function getDocMovements() { return getData(STORAGE_KEYS.DOC_MOVEMENTS, []); }
function saveDocMovements(list) { return setData(STORAGE_KEYS.DOC_MOVEMENTS, list); }

function findDocumentById(docId) {
  return getDocuments().find(d => d.id === docId) || null;
}

/**
 * Records one movement on a document.
 * action: 'upload' | 'view' | 'rename' | 'replace' | 'download' | 'delete' | 'ai-scan' | 'ai-open' | 'auto-route'
 * doc: the document object (pass it BEFORE deleting so the name is kept)
 * extra: optional { details: '...', oldName: '...', newName: '...' }
 */
function logDocMovement(action, doc, extra = {}) {
  if (!doc) return;

  const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  const caseObj = doc.caseId ? findCaseById(doc.caseId) : null;
  const clientObj = caseObj ? findClientById(caseObj.clientId) : null;

  const entry = {
    id: generateId('DMOVE'),
    action,
    docId: doc.id,
    docName: doc.fileName,
    docType: doc.aiDocType || null,
    caseId: doc.caseId || null,
    caseNumber: caseObj ? caseObj.caseNumber : null,
    clientId: clientObj ? clientObj.id : null,
    clientName: clientObj ? clientObj.name : null,
    userId: user ? user.id : null,
    userName: user ? `${user.firstName} ${user.lastName}` : 'System',
    details: extra.details || '',
    oldName: extra.oldName || null,
    newName: extra.newName || null,
    createdAt: nowISO()
  };

  const list = getDocMovements();
  list.push(entry);
  const trimmed = list.length > DOC_MOVEMENTS_LIMIT ? list.slice(list.length - DOC_MOVEMENTS_LIMIT) : list;
  saveDocMovements(trimmed);

  // Mirror important actions to the Control Panel activity log
  if (user && typeof logActivity === 'function' && action !== 'view' && action !== 'ai-open') {
    logActivity(user.id, `doc-${action}`, `${action.toUpperCase()}: "${doc.fileName}"${caseObj ? ` (case ${caseObj.caseNumber})` : ''}.`);
  }

  return entry;
}

function getDocMovementsForDoc(docId) {
  return getDocMovements()
    .filter(m => m.docId === docId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getDocMovementsByUser(userId) {
  return getDocMovements()
    .filter(m => m.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/* ---------- LOOKUP HELPERS ---------- */

function findUserById(userId) {
  return getUsers().find(u => u.id === userId) || null;
}

function findUserByUsername(username) {
  const uname = (username || '').trim().toLowerCase();
  return getUsers().find(u => u.username.toLowerCase() === uname) || null;
}

function findUserByEmail(email) {
  const mail = (email || '').trim().toLowerCase();
  return getUsers().find(u => u.email.toLowerCase() === mail) || null;
}

function findUserByUsernameOrEmail(identifier) {
  return findUserByUsername(identifier) || findUserByEmail(identifier);
}

function findClientById(clientId) {
  return getClients().find(c => c.id === clientId) || null;
}

function findCaseById(caseId) {
  return getCases().find(c => c.id === caseId) || null;
}

function findGroupById(groupId) {
  return getGroups().find(g => g.id === groupId) || null;
}

function findCalendarNoteById(noteId) {
  return getCalendarNotes().find(n => n.id === noteId) || null;
}

/* ============================================================
   ACCOUNT APPROVAL HELPERS
   ============================================================ */
function isAccountApproved(user) {
  if (!user) return false;
  return user.isApproved !== false;
}

function getPendingApprovalUsers() {
  return getUsers().filter(u => u.isApproved === false);
}

function getPendingApprovalCount() {
  return getPendingApprovalUsers().length;
}

/* ============================================================
   HEARTBEAT / ONLINE STATUS
   ============================================================ */
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function touchUserHeartbeat(userId) {
  if (!userId) return;
  const users = getUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return;
  users[idx].lastActiveAt = nowISO();
  saveUsers(users);
}

function isUserOnline(user) {
  if (!user || !user.lastActiveAt) return false;
  return (Date.now() - new Date(user.lastActiveAt).getTime()) < ONLINE_THRESHOLD_MS;
}

function getLastActiveLabel(user) {
  if (!user || !user.lastActiveAt) return 'Never logged in';
  if (isUserOnline(user)) return 'Online now';
  return `Last seen ${formatTimeAgo(user.lastActiveAt)}`;
}

/* ============================================================
   NOTIFICATION HELPERS
   ============================================================ */
function createNotification(userId, type, title, message, link = null) {
  if (!userId) return;

  const notifications = getNotifications();
  notifications.push({
    id: generateId('NOTIF'),
    userId,
    type,
    title,
    message,
    link,
    isRead: false,
    createdAt: nowISO()
  });
  saveNotifications(notifications);
}

function createNotificationForMany(userIds, type, title, message, link = null) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  uniqueIds.forEach(id => createNotification(id, type, title, message, link));
}

function getUnreadNotificationCount(userId) {
  return getNotifications().filter(n => n.userId === userId && !n.isRead).length;
}

function getNotificationsForUser(userId) {
  return getNotifications()
    .filter(n => n.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function markNotificationRead(notificationId) {
  const notifications = getNotifications();
  const idx = notifications.findIndex(n => n.id === notificationId);
  if (idx !== -1) {
    notifications[idx].isRead = true;
    saveNotifications(notifications);
  }
}

function markAllNotificationsRead(userId) {
  const notifications = getNotifications();
  let changed = false;
  notifications.forEach(n => {
    if (n.userId === userId && !n.isRead) {
      n.isRead = true;
      changed = true;
    }
  });
  if (changed) saveNotifications(notifications);
}

/* ============================================================
   PENDING NAVIGATION TARGET
   ============================================================ */
const NAV_TARGET_KEY = 'caseflow_nav_target';

function setPendingNavTarget(targetId) {
  sessionStorage.setItem(NAV_TARGET_KEY, targetId);
}

function consumePendingNavTarget() {
  const val = sessionStorage.getItem(NAV_TARGET_KEY);
  sessionStorage.removeItem(NAV_TARGET_KEY);
  return val;
}

/* ---------- INITIAL SEED DATA ---------- */
function initStorage() {
  Object.values(STORAGE_KEYS).forEach(key => {
    if (key === STORAGE_KEYS.SESSION || key === STORAGE_KEYS.PENDING_OTP) return;
    if (localStorage.getItem(key) === null) {
      setData(key, []);
    }
  });

  const existingUsers = getUsers();
  if (existingUsers.length > 0) return;

  const defaultPasswordHash = hashPassword('caseflow123');

  const seedUsers = [
    { role: 'attorney', first: 'Juan', last: 'Mercado', username: 'attorney1' },
    { role: 'head', first: 'Maria', last: 'Bautista', username: 'head1' },
    { role: 'it', first: 'Carlo', last: 'Navarro', username: 'it1' },
    { role: 'it', first: 'Nina', last: 'Torres', username: 'it2' },
    { role: 'employee', first: 'Paolo', last: 'Ramirez', username: 'employee1' },
    { role: 'employee', first: 'Joanna', last: 'Castillo', username: 'employee2' },
    { role: 'employee', first: 'Mark', last: 'Domingo', username: 'employee3' }
  ].map(u => ({
    id: generateId('USER'),
    firstName: u.first,
    lastName: u.last,
    username: u.username,
    email: `${u.username}@caseflow.demo`,
    passwordHash: defaultPasswordHash,
    role: u.role,
    isLocked: false,
    isApproved: true,
    lastActiveAt: null,
    createdAt: nowISO()
  }));

  saveUsers(seedUsers);
  console.info('[storage.js] Seeded 7 default accounts. Default password: caseflow123');
}

/* ---------- RUN INIT ON LOAD ---------- */
initStorage();