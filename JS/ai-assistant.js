/* ============================================================
   CASEFLOW — SMART AI-ASSISTANT.JS

   Hybrid local smart assistant
   • Tagalog / English / Taglish
   • Common typo and shortcut correction
   • Flexible intent detection
   • Fuzzy matching for names and case titles
   • Conversation context / follow-up questions
   • Reads existing LocalStorage data

   IMPORTANT:
   This is still a LOCAL smart assistant. It does NOT use a
   cloud LLM/API — everything runs from pattern matching over
   this firm's own LocalStorage data. It must never claim to
   be a real/cloud AI.

   UPDATED (AI Document Intelligence):
   • Document questions are handed to doc-intelligence.js:
     "hanapin affidavit of loss ni Santos March 2026"
     -> typo-tolerant search inside every scanned file, with
        "View File" (opens Document Manager + highlights it)
        and "History" buttons right in the chat.
   • Movement questions: "sino nag-upload ng affidavit ni Santos",
     "ano ginawa ni employee1 kahapon", "sino nag-delete ng SPA".
   • Follow-ups: "buksan yung pangalawa", "sino nag-upload nyan".
   • Chat bubbles can now render rich HTML (addAiHtmlMessage).
   • FIX: clients use a single "name" field — client lookups,
     client info, case details and next-hearing now read it.
   • FIX: hearings are linked by caseId — "next hearing ni X"
     now finds them through the client's cases.
   • FIX: "hearing bukas/today" used UTC dates (off by one day in
     the Philippines) — now compares local dates.

   UPDATED (AI Case Summary):
   • Case questions are handed to case-intelligence.js FIRST:
     "summary ng case ni Santos", "ano next sa 2026-001",
     "ano na-miss sa case ni Reyes", "anong document pa kulang
     kay Dela Cruz", "ano mga na-miss sa lahat ng case".
     -> compact card (stage, na-miss, next steps, kulang na
        documents) + "Buksan ang buong AI Summary" button.
   ============================================================ */


/* ============================================================
   GLOBAL STATE
============================================================ */

let aiPanelInjected = false;
let aiPanelOpen = false;

const aiConversationContext = {
    lastIntent: null,
    lastClient: null,
    lastCase: null,
    lastEmployee: null,
    lastHearing: null,
    lastResults: [],
    lastQuery: '',
    history: []
};


/* ============================================================
   TYPO + TAGLISH NORMALIZATION
============================================================ */

const AI_REPLACEMENTS = {
    // Pronouns / shortcuts
    'aq': 'ako',
    'akoq': 'ako',
    'akoo': 'ako',
    'q': 'ko',
    'koq': 'ko',
    'ikawq': 'ikaw',

    // Common Tagalog shortcuts
    'bkt': 'bakit',
    'bat': 'bakit',
    'ung': 'yung',
    'yun': 'iyon',
    'yon': 'iyon',
    'd': 'hindi',
    'di': 'hindi',
    'nde': 'hindi',
    'hnde': 'hindi',
    'wla': 'wala',
    'walaa': 'wala',
    'meronb': 'meron ba',
    'mayb': 'may ba',
    'b': 'ba',
    'nmn': 'naman',
    'plss': 'please',
    'pls': 'please',
    'pacheck': 'paki check',
    'pa check': 'paki check',
    'checknga': 'check nga',
    'tingnan': 'check',
    'tingin': 'check',
    'tgnan': 'check',

    // Time
    'tom': 'tomorrow',
    'tmrw': 'tomorrow',
    'tmorrow': 'tomorrow',
    '2moro': 'tomorrow',
    '2mrw': 'tomorrow',
    'todayy': 'today',
    '2day': 'today',
    'mamya': 'mamaya',
    'mamayang': 'mamaya',
    'nextweek': 'next week',

    // System words
    'kase': 'case',
    'kaso': 'case',
    'casse': 'case',
    'cas': 'case',
    'hearng': 'hearing',
    'hearin': 'hearing',
    'hring': 'hearing',
    'sched': 'schedule',
    'sked': 'schedule',
    'schedulee': 'schedule',
    'clint': 'client',
    'clientt': 'client',

    // Status
    'actve': 'active',
    'activ': 'active',
    'actv': 'active',
    'pendingg': 'pending',
    'pendng': 'pending',
    'pend': 'pending',
    'complet': 'completed',
    'finish': 'completed',
    'done': 'completed',
    'tapos': 'completed',
    'ongoingg': 'ongoing',
    'on going': 'ongoing',

    // Question words
    'ilan': 'how many',
    'ilang': 'how many',
    'hm': 'how many',
    'sino': 'who',
    'sinong': 'who',
    'san': 'where',
    'saan': 'where',
    'ano': 'what',
    'anu': 'what',
    'anoo': 'what',
    'kelan': 'when',
    'kailan': 'when'
};


/* ============================================================
   TEXT NORMALIZER
============================================================ */

function normalizeAiQuery(rawQuery) {
    if (!rawQuery) return '';

    let q = String(rawQuery)
        .toLowerCase()
        .trim();

    q = q
        .replace(/[?!.,]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const words = q.split(' ');

    const normalizedWords = words.map(word => {
        return AI_REPLACEMENTS[word] || word;
    });

    q = normalizedWords.join(' ');

    // Phrase replacements
    q = q
        .replace(/\bmay hearing ba ako\b/g, 'my hearing')
        .replace(/\bmay hearing ako\b/g, 'my hearing')
        .replace(/\bhearing ko\b/g, 'my hearing')
        .replace(/\bcase ko\b/g, 'my cases')
        .replace(/\bmga case ko\b/g, 'my cases')
        .replace(/\bpaki check\b/g, 'check')
        .replace(/\bcheck nga\b/g, 'check')
        .replace(/\btingnan nga\b/g, 'check')
        .replace(/\bshow mo\b/g, 'show')
        .replace(/\bpakita mo\b/g, 'show')
        .replace(/\bmeron ba\b/g, 'is there')
        .replace(/\bmayroon ba\b/g, 'is there')
        .replace(/\bmay ba\b/g, 'is there')
        .replace(/\bilan ang\b/g, 'how many')
        .replace(/\bhow many na\b/g, 'how many')
        .replace(/\bwhat about\b/g, 'show')
        .replace(/\bniya\b/g, 'that person')
        .replace(/\bnya\b/g, 'that person')
        .replace(/\s+/g, ' ')
        .trim();

    return q;
}


/* ============================================================
   SIMPLE SPELL CORRECTION
============================================================ */

const AI_KNOWN_WORDS = [
    'active', 'pending', 'completed', 'ongoing',
    'case', 'cases', 'client', 'clients',
    'hearing', 'hearings',
    'document', 'documents', 'calendar', 'schedule',
    'today', 'tomorrow', 'bukas', 'ngayon',
    'employee', 'employees', 'court',
    'show', 'check', 'next', 'upcoming',
    'how', 'many', 'total', 'all'
];

function aiLevenshtein(a, b) {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

function aiCorrectKnownTypos(query) {
    const words = query.split(' ');

    return words.map(word => {
        if (word.length < 4) return word;

        let bestWord = word;
        let bestDistance = Infinity;

        for (const known of AI_KNOWN_WORDS) {
            const distance = aiLevenshtein(word, known);

            const allowedDistance =
                word.length <= 5 ? 1 :
                word.length <= 8 ? 2 : 3;

            if (distance <= allowedDistance && distance < bestDistance) {
                bestDistance = distance;
                bestWord = known;
            }
        }

        return bestWord;
    }).join(' ');
}


/* ============================================================
   PANEL
============================================================ */

function injectAiAssistantPanel() {
    if (aiPanelInjected || document.getElementById('aiAssistantPanel')) return;

    aiPanelInjected = true;

    injectAiAssistantStyles();

    const panel = document.createElement('div');
    panel.id = 'aiAssistantPanel';
    panel.className = 'ai-panel';

    panel.innerHTML = `
        <div class="ai-panel-header">
            <div class="ai-panel-header-title">
                <i class="fa-solid fa-brain"></i>
                <div>
                    <h4>CaseFlow AI Assistant</h4>
                    <p>Local smart helper · Taglish ready</p>
                </div>
            </div>
            <button id="aiPanelCloseBtn" class="ai-panel-close-btn" title="Close" type="button">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>

        <div class="ai-panel-body" id="aiPanelBody"></div>

        <form class="ai-panel-input-row" id="aiPanelForm" autocomplete="off">
            <input type="text" id="aiPanelInput" placeholder="Ask anything… e.g. hanapin affidavit ni Santos">
            <button type="submit" title="Send">
                <i class="fa-solid fa-paper-plane"></i>
            </button>
        </form>
    `;

    document.body.appendChild(panel);

    addAiMessage('assistant',
`Hi! 👋 I'm the CaseFlow AI Assistant.

Local lang ako — walang internet/cloud connection, binabasa ko lang yung data ng firm dito sa app.

Pwede kang mag-Tagalog, English, o Taglish. Kahit may typo, susubukan kong intindihin.

Examples:
- "ilan active na kaso?"
- "may hearing ba ako bukas?"
- "upcoming hearings"
- "check client Santos"
- "show case ni Santos"
- "hanapin affidavit of loss ni Santos"
- "sino nag-upload ng SPA?"
- "summary ng case ni Santos"
- "ano mga na-miss sa lahat ng case?"

Follow-up questions also work. 👍`
    );

    const closeBtn = document.getElementById('aiPanelCloseBtn');
    const form = document.getElementById('aiPanelForm');

    if (closeBtn) closeBtn.addEventListener('click', closeAiAssistantPanel);
    if (form) form.addEventListener('submit', handleAiPanelSubmit);
}


/* ============================================================
   STYLES
============================================================ */

function injectAiAssistantStyles() {
    if (document.getElementById('aiAssistantStyles')) return;

    const style = document.createElement('style');
    style.id = 'aiAssistantStyles';

    style.textContent = `
        .ai-panel {
            position: fixed;
            bottom: 24px;
            right: 24px;
            width: 380px;
            max-width: calc(100vw - 32px);
            height: 520px;
            max-height: calc(100vh - 100px);
            background: var(--color-white);
            border-radius: 18px;
            box-shadow: 0 20px 60px rgba(0,0,0,.25);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            z-index: 999;
            opacity: 0;
            transform: translateY(20px) scale(.97);
            pointer-events: none;
            transition: opacity .25s ease, transform .25s ease;
        }
        .ai-panel.open {
            opacity: 1;
            transform: translateY(0) scale(1);
            pointer-events: auto;
        }
        .ai-panel-header {
            background: linear-gradient(135deg, #111, #2b2b2b);
            color: white;
            padding: 16px 18px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
        }
        .ai-panel-header-title { display: flex; align-items: center; gap: 11px; }
        .ai-panel-header-title > i { color: var(--color-gold); font-size: 20px; }
        .ai-panel-header-title h4 { margin: 0; color: white; font-size: 14px; }
        .ai-panel-header-title p { margin: 3px 0 0; color: rgba(255,255,255,.65); font-size: 10px; }
        .ai-panel-close-btn {
            width: 32px; height: 32px; border-radius: 50%; border: none;
            background: transparent; color: white; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
        }
        .ai-panel-close-btn:hover { background: rgba(255,255,255,.12); }
        .ai-panel-body {
            flex: 1; overflow-y: auto; padding: 16px;
            display: flex; flex-direction: column; gap: 12px;
            background: var(--color-gray-bg);
        }
        .ai-msg-row { display: flex; }
        .ai-msg-row.user { justify-content: flex-end; }
        .ai-msg-row.assistant { justify-content: flex-start; }
        .ai-msg-bubble {
            max-width: 88%; padding: 10px 13px; border-radius: 14px;
            font-size: 12.5px; line-height: 1.55;
            white-space: pre-line; word-break: break-word;
        }
        .ai-msg-bubble.ai-html {
            white-space: normal;
            max-width: 96%;
            width: 96%;
        }
        .ai-msg-row.user .ai-msg-bubble {
            background: linear-gradient(135deg, var(--color-gold-light), var(--color-gold));
            color: #111;
            border-bottom-right-radius: 4px;
        }
        .ai-msg-row.assistant .ai-msg-bubble {
            background: white;
            border: 1px solid var(--color-gray-border);
            color: #111;
            border-bottom-left-radius: 4px;
        }
        .ai-panel-input-row {
            display: flex; gap: 8px; padding: 12px;
            background: white; border-top: 1px solid var(--color-gray-border);
        }
        .ai-panel-input-row input {
            flex: 1; min-width: 0; padding: 10px 14px; border-radius: 22px;
            border: 1.5px solid var(--color-gray-border); outline: none;
            font-size: 12.5px; background: var(--color-gray-bg);
        }
        .ai-panel-input-row input:focus { border-color: var(--color-gold); background: white; }
        .ai-panel-input-row button {
            width: 40px; height: 40px; border-radius: 50%; border: none;
            flex-shrink: 0; cursor: pointer;
            background: var(--color-gold); color: #111;
            display: flex; align-items: center; justify-content: center;
        }
        .ai-panel-input-row button:hover { transform: scale(1.05); }
        @media (max-width: 480px) {
            .ai-panel {
                left: 12px; right: 12px; bottom: 12px;
                width: auto; height: min(560px, calc(100vh - 80px));
            }
        }
    `;

    document.head.appendChild(style);
}


/* ============================================================
   OPEN / CLOSE
============================================================ */

function toggleAiAssistantPanel() {
    if (!document.getElementById('aiAssistantPanel')) injectAiAssistantPanel();
    aiPanelOpen ? closeAiAssistantPanel() : openAiAssistantPanel();
}

function openAiAssistantPanel() {
    const panel = document.getElementById('aiAssistantPanel');
    if (!panel) return;

    panel.classList.add('open');
    aiPanelOpen = true;

    const input = document.getElementById('aiPanelInput');
    if (input) setTimeout(() => input.focus(), 100);
}

function closeAiAssistantPanel() {
    const panel = document.getElementById('aiAssistantPanel');
    if (!panel) return;

    panel.classList.remove('open');
    aiPanelOpen = false;
}


/* ============================================================
   MESSAGE RENDERING
============================================================ */

function addAiMessage(role, text) {
    const body = document.getElementById('aiPanelBody');
    if (!body) return;

    const row = document.createElement('div');
    row.className = `ai-msg-row ${role}`;
    row.innerHTML = `<div class="ai-msg-bubble">${aiEscapeHtml(text)}</div>`;

    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
}

/**
 * Rich HTML bubble (document result cards, View File buttons, history).
 * ONLY pass HTML built by this app with escaped user data
 * (doc-intelligence.js / case-intelligence.js escape everything).
 */
function addAiHtmlMessage(role, html) {
    const body = document.getElementById('aiPanelBody');
    if (!body) return;

    const row = document.createElement('div');
    row.className = `ai-msg-row ${role}`;
    row.innerHTML = `<div class="ai-msg-bubble ai-html">${html}</div>`;

    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
}

/**
 * Shows any response type:
 *  - string          -> plain text bubble
 *  - { html: '...' } -> rich HTML bubble
 */
function addAiResponse(response) {
    if (response && typeof response === 'object' && response.html) {
        addAiHtmlMessage('assistant', response.html);
    } else {
        addAiMessage('assistant', String(response ?? ''));
    }
}


/* ============================================================
   SUBMIT
============================================================ */

function handleAiPanelSubmit(e) {
    e.preventDefault();

    const input = document.getElementById('aiPanelInput');
    if (!input) return;

    const query = input.value.trim();
    if (!query) return;

    addAiMessage('user', query);
    input.value = '';

    const response = getAiResponse(query);

    setTimeout(() => addAiResponse(response), 300);
}


/* ============================================================
   MAIN SMART RESPONSE ENGINE

   FIX: topic-keyword routing now happens BEFORE the follow-up
   memory check. Previously, follow-up context could hijack a
   brand-new question just because it contained a word like
   "status" — now context is only consulted when the current
   message carries no topic keywords of its own.
============================================================ */

function getAiResponse(rawQuery) {
    try {
        let normalized = normalizeAiQuery(rawQuery);
        normalized = aiCorrectKnownTypos(normalized);

        aiConversationContext.lastQuery = normalized;
        aiConversationContext.history.push({ user: rawQuery, normalized, time: Date.now() });
        if (aiConversationContext.history.length > 20) aiConversationContext.history.shift();


        /* ---------------- GREETING ---------------- */
        if (
            /\b(hi|hello|hey|pre|bro|boss|good morning|good afternoon|good evening)\b/.test(normalized) &&
            normalized.split(' ').length <= 5
        ) {
            return `Hello! 👋 Ano kailangan mo?

Pwede mong itanong kahit Taglish, halimbawa:
- "ilan active cases?"
- "may hearing ba bukas?"
- "upcoming hearings"
- "check client Santos"
- "hanapin affidavit of loss ni Santos"`;
        }


        /* ---------------- HELP ---------------- */
        if (/\b(help|tulong|commands|what can you do|ano kaya mo)\b/.test(normalized)) {
            return aiHelpText();
        }


        /* ---------------- IDENTITY ---------------- */
        if (/\b(who are you|what are you|sino ka|ano ka)\b/.test(normalized)) {
            return `I'm the CaseFlow AI Assistant. 🧠

Local lang ako — walang cloud/internet connection. Binabasa ko lang yung firm's own LocalStorage data, kaya kaya kong mag-check ng:
- Cases
- Clients
- Hearings
- Documents (binabasa ko pati laman ng mga na-upload na file)
- Galaw ng files (sino nag-upload, nag-view, nag-rename, nag-delete)
- AI Case Summary (stage ng kaso, mga na-miss, susunod na gagawin, kulang na documents)

Pwede ka rin mag-Tagalog, English, o Taglish.`;
        }


        /* ---------------- AI CASE SUMMARY (case-intelligence.js) ----------------
           Checked FIRST so "ano kulang na document sa case ni Santos"
           gives the case checklist, not a plain file search.
           Returns null when it is not a case-summary question.
        ------------------------------------------------------------------------ */
        if (typeof caseAiHandleQuery === 'function') {
            const caseReply = caseAiHandleQuery(rawQuery);
            if (caseReply) {
                aiConversationContext.lastIntent = 'case_summary';
                if (typeof docAiContext !== 'undefined') docAiContext.lastResults = [];
                return caseReply;
            }
        }


        /* ---------------- DOCUMENTS + MOVEMENTS (doc-intelligence.js) ----------------
           Checked BEFORE the other topics so "affidavit ni Santos"
           is treated as a document search, not a client lookup.
           Returns null when the question is not about files, so
           everything else below still works exactly as before.
        ------------------------------------------------------------------------------ */
        if (typeof docAiHandleQuery === 'function') {
            const docReply = docAiHandleQuery(rawQuery);
            if (docReply) {
                aiConversationContext.lastIntent = 'documents';
                return docReply;
            }
            // different topic now -> forget last file results so "yun/yan" follow-ups
            // about hearings/cases are not mistaken for file follow-ups
            if (typeof docAiContext !== 'undefined') docAiContext.lastResults = [];
        }


        /* ---------------- TOPIC DETECTION (used for routing) ---------------- */
        const hasHearingWords = aiHasAny(normalized, ['hearing', 'court', 'schedule', 'my hearing']);
        const hasCaseWords = aiHasAny(normalized, ['case', 'cases', 'kaso', 'my cases']);
        const hasClientWords = aiHasAny(normalized, ['client', 'clients']);
        const hasAnyTopicWords = hasHearingWords || hasCaseWords || hasClientWords;


        /* ---------------- HEARING INTENT ---------------- */
        if (hasHearingWords) {
            const client = aiFindBestClientFromQuery(normalized);

            if (client) {
                aiConversationContext.lastClient = client;
                aiConversationContext.lastIntent = 'client_hearing';
                return aiNextHearingForClientObject(client, normalized);
            }

            const dateIntent = aiDetectDateIntent(normalized);

            if (dateIntent) {
                aiConversationContext.lastIntent = 'date_hearing';
                return aiHearingsForDateIntent(dateIntent);
            }

            if (aiHasAny(normalized, ['next', 'upcoming', 'susunod', 'darating'])) {
                aiConversationContext.lastIntent = 'upcoming_hearings';
                return aiUpcomingHearings();
            }

            if (aiHasAny(normalized, ['how many', 'total', 'all', 'ilan'])) {
                aiConversationContext.lastIntent = 'count_hearings';
                return aiCountAllHearings();
            }
        }


        /* ---------------- CASE INTENT ---------------- */
        if (hasCaseWords) {
            const foundCase = aiFindBestCaseFromQuery(normalized);

            if (foundCase && !aiIsPureCountQuestion(normalized)) {
                aiConversationContext.lastCase = foundCase;
                aiConversationContext.lastIntent = 'show_case';
                return aiFormatCaseDetails(foundCase);
            }

            if (aiHasAny(normalized, ['active', 'ongoing', 'in progress', 'open'])) {
                aiConversationContext.lastIntent = 'active_cases';
                return aiCountCasesByStatus(['active', 'ongoing', 'in-progress', 'open']);
            }

            if (aiHasAny(normalized, ['pending', 'awaiting'])) {
                aiConversationContext.lastIntent = 'pending_cases';
                return aiCountCasesByStatus(['pending']);
            }

            if (aiHasAny(normalized, ['completed', 'closed', 'finished'])) {
                aiConversationContext.lastIntent = 'completed_cases';
                return aiCountCasesByStatus(['completed', 'closed']);
            }

            if (aiIsPureCountQuestion(normalized)) {
                aiConversationContext.lastIntent = 'count_cases';
                return aiCountAllCases();
            }

            if (aiHasAny(normalized, ['show', 'check', 'list', 'lahat'])) {
                return aiListCases();
            }
        }


        /* ---------------- CLIENT INTENT ---------------- */
        if (hasClientWords) {
            const client = aiFindBestClientFromQuery(normalized);

            if (client) {
                aiConversationContext.lastClient = client;
                aiConversationContext.lastIntent = 'client_info';
                return aiFormatClientInfo(client);
            }

            if (aiIsPureCountQuestion(normalized)) {
                aiConversationContext.lastIntent = 'count_clients';
                return aiCountAllClients();
            }

            return aiListClients();
        }


        /* ---------------- FOLLOW-UP MEMORY ----------------
           Only consulted when THIS message has no topic
           keywords of its own — e.g. a bare "kelan?" after
           asking about a client. Prevents hijacking fresh,
           unrelated questions that happen to share a word
           like "status" or "details" with the trigger list.
        ------------------------------------------------- */
        if (!hasAnyTopicWords) {
            const followUpResponse = aiHandleFollowUp(normalized);
            if (followUpResponse) return followUpResponse;
        }


        /* ---------------- DIRECT NAME SEARCH ----------------
           Gated: only attempted when the raw message actually
           looks like it's naming someone (a name-marker word,
           or a capitalized word in the original text) AND uses
           a stricter similarity threshold. Otherwise ordinary
           chit-chat could fuzzy-match a random client name.
        ------------------------------------------------- */
        if (aiLooksLikeNameQuery(rawQuery, normalized)) {
            const client = aiFindBestClientFromQuery(normalized, 0.7);

            if (client) {
                aiConversationContext.lastClient = client;
                aiConversationContext.lastIntent = 'client_info';
                return aiFormatClientInfo(client);
            }
        }


        /* ---------------- FALLBACK ---------------- */
        return aiSmartFallback(normalized);

    } catch (error) {
        console.error('[CaseFlow AI] Error:', error);

        return `May nangyaring error habang chine-check ko yung data. 😅

Try mo ulit, halimbawa:
- "ilan active cases?"
- "check hearing ni Santos"
- "upcoming hearings"`;
    }
}


/* ============================================================
   FOLLOW-UP MEMORY
============================================================ */

function aiHandleFollowUp(q) {
    const isFollowUp = aiHasAny(q, [
        'when', 'kailan', 'kelan', 'what time', 'anong oras',
        'status', 'niya', 'that person', 'yung case', 'yung client',
        'details', 'more'
    ]);

    if (!isFollowUp) return null;

    if (
        aiConversationContext.lastClient &&
        aiHasAny(q, ['when', 'kailan', 'kelan', 'hearing', 'schedule', 'anong oras'])
    ) {
        return aiNextHearingForClientObject(aiConversationContext.lastClient, q);
    }

    if (aiConversationContext.lastCase) {
        if (aiHasAny(q, ['status', 'details', 'yung case'])) {
            return aiFormatCaseDetails(aiConversationContext.lastCase);
        }
    }

    return null;
}


/* ============================================================
   UTILITY
============================================================ */

function aiHasAny(text, words) {
    return words.some(word => text.includes(word));
}

function aiIsPureCountQuestion(q) {
    return aiHasAny(q, ['how many', 'total', 'ilan', 'ilang', 'count']);
}

function aiPick(obj, keys) {
    for (const key of keys) {
        if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
            return obj[key];
        }
    }
    return null;
}

// Clients are saved with a single "name" field; older/other data may use first/last.
function aiClientName(client) {
    if (!client) return '';
    return (client.name || `${client.firstName || ''} ${client.lastName || ''}`).trim();
}

// Local YYYY-MM-DD (toISOString() is UTC and shifts the day in the Philippines)
function aiLocalDateKey(value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && value.length <= 10) return value.slice(0, 10);
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d)) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function aiEscapeHtml(value) {
    if (value === null || value === undefined) return '';

    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Decides whether a raw message is worth attempting a fuzzy
 * client-name lookup on. Requires either an explicit Filipino
 * name-marker ("ni", "si", "kay", "mr", "mrs", "ms") in the
 * normalized text, or a capitalized word in the ORIGINAL text
 * (a likely proper noun) — prevents random chit-chat from
 * accidentally matching a client name.
 */
function aiLooksLikeNameQuery(rawQuery, normalized) {
    const hasNameMarker = /\b(ni|si|kay|mr|mrs|ms)\b/.test(normalized);
    const hasCapitalizedWord = /\b[A-Z][a-z]{2,}\b/.test(String(rawQuery || ''));
    return hasNameMarker || hasCapitalizedWord;
}


/* ============================================================
   FUZZY MATCHING
============================================================ */

function aiSimilarity(a, b) {
    a = String(a || '').toLowerCase();
    b = String(b || '').toLowerCase();

    if (!a || !b) return 0;
    if (a.includes(b) || b.includes(a)) return 1;

    const distance = aiLevenshtein(a, b);
    const longest = Math.max(a.length, b.length);

    return 1 - (distance / longest);
}

function aiFindBestMatch(query, items, getText, minScore = 0.55) {
    if (!items || !items.length) return null;

    const cleanQuery = query
        .replace(/\b(show|check|case|client|hearing|task|tasks|ni|si|kay|mr|mrs|ms|about|for|next|status|details)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleanQuery) return null;

    let bestItem = null;
    let bestScore = 0;

    for (const item of items) {
        const text = String(getText(item) || '').toLowerCase();
        if (!text) continue;

        const score = aiSimilarity(cleanQuery, text);
        if (score > bestScore) {
            bestScore = score;
            bestItem = item;
        }

        const queryWords = cleanQuery.split(' ');
        for (const word of queryWords) {
            if (word.length < 3) continue;

            const wordScore = aiSimilarity(word, text);
            if (wordScore > bestScore) {
                bestScore = wordScore;
                bestItem = item;
            }
        }
    }

    return bestScore >= minScore ? bestItem : null;
}

function aiFindBestClientFromQuery(query, minScore = 0.55) {
    const clients = getClients();

    return aiFindBestMatch(
        query,
        clients,
        client => aiClientName(client),
        minScore
    );
}

function aiFindBestEmployeeFromQuery(query, minScore = 0.55) {
    const users = getUsers();

    return aiFindBestMatch(
        query,
        users,
        user => `${user.firstName || ''} ${user.lastName || ''}`,
        minScore
    );
}

function aiFindBestCaseFromQuery(query, minScore = 0.55) {
    const cases = getCases();

    return aiFindBestMatch(
        query,
        cases,
        item => `${aiPick(item, ['title', 'caseTitle', 'caseName', 'caseNumber', 'id']) || ''}`,
        minScore
    );
}


/* ============================================================
   DATE UNDERSTANDING
============================================================ */

function aiDetectDateIntent(q) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (aiHasAny(q, ['today', 'ngayon'])) {
        return { type: 'today', date: today };
    }

    if (aiHasAny(q, ['tomorrow', 'bukas'])) {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return { type: 'tomorrow', date: tomorrow };
    }

    if (aiHasAny(q, ['next week', 'susunod na linggo'])) {
        return { type: 'next_week', date: null };
    }

    return null;
}

function aiHearingsForDateIntent(intent) {
    const hearings = getHearings();

    if (intent.type === 'next_week') {
        const now = new Date();
        const end = new Date();
        end.setDate(now.getDate() + 7);

        const results = hearings.filter(item => {
            const value = aiPick(item, ['hearingDate', 'date']);
            const date = value ? new Date(value) : null;
            return date && !isNaN(date) && date >= now && date <= end;
        });

        return aiFormatHearingList(results, 'next week');
    }

    const target = intent.date;
    const targetKey = aiLocalDateKey(target);

    const results = hearings.filter(item => {
        const value = aiPick(item, ['hearingDate', 'date']);
        if (!value) return false;
        return aiLocalDateKey(value) === targetKey;
    });

    const label = intent.type === 'today' ? 'today' : 'tomorrow';

    return aiFormatHearingList(results, label);
}


/* ============================================================
   CASE FUNCTIONS
============================================================ */

function aiCountAllCases() {
    const cases = getCases();
    return `May ${cases.length} case${cases.length === 1 ? '' : 's'} currently on record.`;
}

function aiCountCasesByStatus(statusList) {
    const cases = getCases().filter(item => {
        const status = String(aiPick(item, ['status', 'caseStatus']) || '').toLowerCase();
        return statusList.includes(status);
    });

    return `May ${cases.length} ${statusList[0]} case${cases.length === 1 ? '' : 's'}.`;
}

function aiListCases() {
    const cases = getCases();
    if (!cases.length) return 'Wala pang cases na naka-record.';

    const lines = cases.slice(0, 10).map(item => {
        const title = aiPick(item, ['title', 'caseTitle', 'caseName']) || 'Untitled Case';
        const status = aiPick(item, ['status', 'caseStatus']) || 'Unknown';
        return `• ${title} — ${status}`;
    });

    return `Cases (${cases.length}):\n${lines.join('\n')}${
        cases.length > 10 ? `\n...at ${cases.length - 10} more.` : ''
    }`;
}

function aiFormatCaseDetails(item) {
    const title = aiPick(item, ['title', 'caseTitle', 'caseName']) || 'Untitled Case';
    const status = aiPick(item, ['status', 'caseStatus']) || 'Unknown';
    const caseNumber = aiPick(item, ['caseNumber', 'caseId', 'id']);
    const clientId = aiPick(item, ['clientId', 'client']);

    let clientName = 'Unassigned';

    if (clientId && typeof findClientById === 'function') {
        const client = findClientById(clientId);
        if (client) {
            clientName = aiClientName(client) || 'Unassigned';
        }
    }

    return `📁 Case Details

Case: ${title}
${caseNumber ? `Case No.: ${caseNumber}\n` : ''}Status: ${status}
Client: ${clientName}`;
}


/* ============================================================
   CLIENT FUNCTIONS
============================================================ */

function aiCountAllClients() {
    const clients = getClients();
    return `May ${clients.length} client${clients.length === 1 ? '' : 's'} currently on record.`;
}

function aiListClients() {
    const clients = getClients();
    if (!clients.length) return 'Wala pang clients na naka-record.';

    const lines = clients.slice(0, 10).map(client =>
        `• ${aiClientName(client)}`
    );

    return `Clients (${clients.length}):\n${lines.join('\n')}`;
}

function aiFormatClientInfo(client) {
    const name = aiClientName(client);
    const phone = aiPick(client, ['phone', 'contact', 'contactNumber', 'contactNo', 'mobile']);
    const email = aiPick(client, ['email']);

    return `👤 Client Information

Name: ${name}
${phone ? `Contact: ${phone}\n` : ''}${email ? `Email: ${email}` : ''}`.trim();
}


function getStatusLabelForAi(status) {
    const labels = {
        'pending': 'Pending',
        'in-progress': 'In Progress',
        'awaiting-approval': 'Awaiting Approval',
        'completed': 'Completed'
    };

    return labels[status] || status || 'Unknown';
}


/* ============================================================
   HEARING FUNCTIONS
============================================================ */

function aiCountAllHearings() {
    const hearings = getHearings();
    return `May ${hearings.length} hearing${hearings.length === 1 ? '' : 's'} on the calendar.`;
}

function aiUpcomingHearings() {
    const now = new Date();

    const hearings = getHearings()
        .filter(item => {
            const value = aiPick(item, ['hearingDate', 'date']);
            const date = value ? new Date(value) : null;
            return date && !isNaN(date) && date >= now;
        })
        .sort((a, b) => {
            const aDate = new Date(aiPick(a, ['hearingDate', 'date']));
            const bDate = new Date(aiPick(b, ['hearingDate', 'date']));
            return aDate - bDate;
        });

    return aiFormatHearingList(hearings, 'upcoming');
}

function aiFormatHearingList(hearings, label) {
    if (!hearings.length) return `Walang hearing scheduled ${label}.`;

    const lines = hearings.slice(0, 10).map(item => {
        const date = aiPick(item, ['hearingDate', 'date']);
        const caseObj = item.caseId && typeof findCaseById === 'function' ? findCaseById(item.caseId) : null;
        const title = aiPick(item, ['hearingName', 'title', 'caseTitle', 'courtName']) || 'Hearing';
        return `• ${formatDate(date)} — ${title}${caseObj ? ` (${caseObj.caseNumber})` : ''}`;
    });

    return `Hearings ${label} (${hearings.length}):\n\n${lines.join('\n')}`;
}

function aiNextHearingForClientObject(client, query = '') {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const clientId = client.id;

    // Hearings are saved per CASE (caseId), so collect this client's case IDs
    const clientCaseIds = getCases().filter(c => c.clientId === clientId).map(c => c.id);

    const hearings = getHearings()
        .filter(item => aiPick(item, ['clientId']) === clientId || clientCaseIds.includes(item.caseId))
        .filter(item => {
            const value = aiPick(item, ['hearingDate', 'date']);
            const date = value ? new Date(value) : null;
            return date && !isNaN(date) && date >= now;
        })
        .sort((a, b) =>
            new Date(aiPick(a, ['hearingDate', 'date'])) - new Date(aiPick(b, ['hearingDate', 'date']))
        );

    const name = aiClientName(client);

    if (!hearings.length) return `Walang upcoming hearing scheduled for ${name}.`;

    const hearing = hearings[0];
    aiConversationContext.lastHearing = hearing;

    const caseObj = hearing.caseId && typeof findCaseById === 'function' ? findCaseById(hearing.caseId) : null;
    const title = aiPick(hearing, ['hearingName', 'title', 'caseTitle', 'courtName']) || 'Hearing';
    const date = aiPick(hearing, ['hearingDate', 'date']);

    return `⚖️ Next Hearing for ${name}

Hearing: ${title}
${caseObj ? `Case: ${caseObj.caseNumber} — ${caseObj.caseName}\n` : ''}Date: ${formatDate(date)}`;
}


/* ============================================================
   SMART FALLBACK
============================================================ */

function aiSmartFallback(q) {
    const suggestions = [];

    if (aiHasAny(q, ['case', 'kaso'])) suggestions.push('try "ilan active cases?"');
    if (aiHasAny(q, ['hearing', 'court', 'bukas', 'tomorrow'])) suggestions.push('try "may hearing ba bukas?"');
    if (aiHasAny(q, ['client', 'kliyente'])) suggestions.push('try "check client Santos"');

    if (!suggestions.length) {
        suggestions.push(
            'try "ilan active cases?"',
            'try "may hearing ba bukas?"',
            'try "check client Santos"',
            'try "hanapin affidavit of loss ni Santos"'
        );
    }

    return `Gets ko na may gusto kang i-check, pero hindi ko pa sigurado kung anong data ang hinahanap mo. 😅

Pwede mong sabihin nang ganito:
- ${suggestions.join('\n• ')}

Pwede rin kahit Taglish o may konting typo.`;
}


/* ============================================================
   HELP
============================================================ */

function aiHelpText() {
    return `🧠 CASEFLOW AI ASSISTANT

CASES
- "ilan active cases?"
- "show case ni Santos"
- "ilan pending na kaso?"
- "pakita lahat ng cases"

HEARINGS
- "may hearing ba bukas?"
- "next hearing ni Santos"
- "upcoming hearings"
- "ilan hearings?"

CLIENTS
- "ilan clients?"
- "check client Santos"

DOCUMENTS (binabasa ng AI ang laman ng file)
- "hanapin affidavit of loss ni Santos"
- "SPA ni Dela Cruz March 2026"
- "files ni Santos"
- "ilan affidavit?"
- "may deed of sale ba si Reyes?"
Kahit may typo ("afidavit of los ni santoz"), itatama ko.
May "View File" button — bubuksan ang Document Manager at naka-highlight ang file.

FILE MOVEMENTS
- "sino nag-upload ng affidavit ni Santos?"
- "sino nag-delete ng SPA?"
- "history ng deed of sale ni Reyes"
- "ano ginawa ni employee1 kahapon?"
- "movements this week"
Follow-up: "buksan yung pangalawa", "sino nag-view nyan?"

AI CASE SUMMARY (helper per kaso)
- "summary ng case ni Santos"
- "ano next sa kaso 2026-001?"
- "ano na-miss sa case ni Reyes?"
- "anong document pa kulang kay Dela Cruz?"
- "ano mga na-miss sa lahat ng case?"
May 🤖 button din sa bawat case sa Dashboard para sa buong summary.

Pwede ka rin mag-follow-up:
User: "check hearing ni Santos"
AI: "..."
User: "kelan?"
AI: Maiintindihan ko na si Santos pa rin ang tinutukoy mo.`;
}