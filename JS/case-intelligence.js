/* ============================================================
   CASEFLOW — CASE-INTELLIGENCE.JS
   AI Case Summary / Case Helper (per case). English UI.

   WHAT IT DOES (per case):
   - Detects the case type (Civil, Family, Criminal, Labor,
     Notarial...) from case name, court, custom fields and
     uploaded documents. Can be overridden in the modal.
   - Figures out which STAGE the case is in (Filing, Summons,
     Pre-trial, Trial, Decision...) from progress entries,
     hearing names/notes and uploaded documents.
   - Lists what was MISSED (hearing with no update after, no
     next hearing, stale case, missing documents for stages
     already passed, estimated deadlines passed).
   - Lists NEXT STEPS and a DOCUMENT CHECKLIST (✔ with View
     File / ✘ missing) using the AI document scan
     (doc-intelligence.js).
   - Works in the Dashboard (🤖 button per case) and in the AI
     chat ("summary of Santos case", "what was missed in 2026-001").
     Tagalog/Taglish questions are still understood; answers are
     in English.

   HONEST LIMITS
   - Rule-based guide (Philippine procedure in general terms),
     NOT a cloud LLM and NOT legal advice. Deadlines shown are
     ESTIMATES — always verify with the handling attorney and
     the court's orders.

   Depends on: storage.js, modal.js
   Optional:   doc-intelligence.js, documents.js, progress.js,
               auth.js, navigation.js, ai-assistant.js
   ============================================================ */

/* ---------- CONFIG ---------- */
const CASE_AI_CONFIG = {
  STALE_DAYS: 30,                   // no activity for this long = "stale"
  HEARING_SOON_DAYS: 7,             // upcoming hearing warning window
  NO_UPDATE_AFTER_HEARING_DAYS: 7,  // expected progress update after a hearing
  PENDING_TOO_LONG_DAYS: 30         // case stuck in "pending" status
};

/* ============================================================
   PLAYBOOK BUILDING BLOCKS
   D() = a required document, S() = a stage of the process
   ============================================================ */
function D(label, types = [], words = [], optional = false, note = '') {
  return { label, types, words, optional, note };
}

function S(key, label, signals, docs, next, deadline = null) {
  return { key, label, signals, docs, next, deadline };
}

const CASE_AI_DOCS = {
  DEMAND: D('Demand Letter (with proof of receipt)', ['Demand Letter'], ['demand letter', 'final demand', 'demand to pay']),
  BRGY: D('Barangay Certification to File Action', [], ['certification to file action', 'certificate to file action', 'lupon tagapamayapa', 'katarungang pambarangay'], true, 'Only required if the parties live in the same city/municipality.'),
  CONTRACT: D('Contract / Promissory Note / Proof of Debt', ['Contract', 'Memorandum of Agreement', 'Invoice'], ['promissory note', 'contract', 'agreement', 'kasunduan', 'acknowledgment receipt']),
  COMPLAINT: D('Complaint', ['Complaint'], ['complaint']),
  VERIF: D('Verification and Certification Against Forum Shopping', [], ['forum shopping', 'verification and certification']),
  JA: D('Judicial Affidavits of Witnesses', [], ['judicial affidavit']),
  DOCKET: D('Official Receipt for Docket / Filing Fees', ['Official Receipt'], ['docket', 'filing fee', 'official receipt']),
  SUMMONS: D('Summons', ['Summons'], ['summons']),
  ANSWER: D('Answer', [], ['answer with', 'verified answer', 'answer']),
  PTB: D('Pre-Trial Brief', [], ['pre trial brief', 'pretrial brief']),
  NOTICE_PT: D('Notice of Pre-Trial / Mediation', ['Notice of Hearing'], ['notice of pre trial', 'notice of pretrial', 'mediation']),
  EXHIBITS: D('Exhibits / Evidence', ['Evidence'], ['exhibit', 'annex']),
  FOE: D('Formal Offer of Evidence', [], ['formal offer']),
  DECISION: D('Decision / Judgment', ['Decision'], ['decision', 'judgment']),
  FINALITY: D('Certificate of Finality / Entry of Judgment', [], ['certificate of finality', 'entry of judgment']),
  WRIT: D('Writ of Execution', [], ['writ of execution']),
  VALID_ID: D('Client Valid IDs (2 IDs)', ['Valid ID'], ['valid id', 'identification card', 'passport', 'drivers license', 'umid', 'philsys']),
  TITLE: D('Land Title (TCT/OCT)', ['Land Title'], ['transfer certificate of title', 'original certificate of title', 'tct', 'oct']),
  TAXDEC: D('Tax Declaration', ['Tax Declaration'], ['tax declaration']),
  DEED: D('Deed of Sale / Donation', ['Deed of Absolute Sale', 'Deed of Sale', 'Deed of Donation'], ['deed of sale', 'deed of absolute sale', 'deed of donation']),
  SURVEY: D('Survey / Sketch Plan', [], ['survey plan', 'sketch plan', 'lot plan'], true),
  LEASE: D('Contract of Lease', ['Contract of Lease'], ['contract of lease', 'lease contract', 'lease agreement', 'upa']),
  PSA_BIRTH: D('PSA Birth Certificate', ['Birth Certificate'], ['birth certificate', 'certificate of live birth']),
  PSA_MARRIAGE: D('PSA Marriage Certificate', ['Marriage Certificate'], ['marriage certificate', 'certificate of marriage', 'marriage contract']),
  PSYCH: D('Psychological Evaluation Report', [], ['psychological evaluation', 'psychological report', 'psychological incapacity']),
  PETITION: D('Petition', ['Petition'], ['petition']),
  PUBLICATION: D('Affidavit of Publication', [], ['affidavit of publication', 'publication']),
  COLLUSION: D('Prosecutor\'s Report (no collusion)', [], ['collusion']),
  DECREE: D('Decree / Annotated PSA Certificate', [], ['decree of', 'annotated', 'annotation']),
  INCOME: D('Proof of Income / Expenses (payslips, receipts)', ['Official Receipt', 'Invoice'], ['payslip', 'income tax return', 'itr', 'receipt', 'tuition']),
  COMPLAINT_AFF: D('Complaint-Affidavit', ['Affidavit'], ['complaint affidavit', 'sinumpaang salaysay', 'affidavit complaint']),
  WITNESS_AFF: D('Witness Affidavits', ['Affidavit', 'Joint Affidavit'], ['affidavit of witness', 'witness affidavit', 'joint affidavit']),
  SUBPOENA: D('Subpoena (Preliminary Investigation)', ['Subpoena'], ['subpoena']),
  COUNTER_AFF: D('Counter-Affidavit / Reply', [], ['counter affidavit', 'reply affidavit', 'rejoinder']),
  RESOLUTION: D('Prosecutor\'s Resolution', ['Resolution'], ['resolution']),
  INFORMATION: D('Information (filed in court)', [], ['information']),
  BAIL: D('Bail / Warrant / Commitment Papers', [], ['bail bond', 'warrant of arrest', 'recognizance', 'bail']),
  CHECK: D('Dishonored Check + Bank Return Slip', [], ['check', 'return slip', 'dishonor', 'account closed', 'drawn against insufficient funds', 'daif'], true, 'For BP 22 / Estafa involving checks.'),
  NOTICE_DISHONOR: D('Notice of Dishonor (with proof of receipt)', [], ['notice of dishonor'], true, 'For BP 22.'),
  MEDICAL: D('Medical Certificate / Medico-Legal Report', [], ['medical certificate', 'medico legal', 'medicolegal']),
  PROTECTION: D('Protection Order (BPO/TPO/PPO)', [], ['protection order', 'barangay protection', 'temporary protection', 'permanent protection']),
  EMPLOYMENT: D('Proof of Employment (contract, ID, payslips)', ['Contract', 'Valid ID'], ['employment contract', 'appointment', 'payslip', 'company id', 'certificate of employment']),
  TERMINATION: D('Notice to Explain / Notice of Termination', [], ['notice to explain', 'notice of termination', 'termination letter', 'memo']),
  SENA: D('SEnA Request for Assistance / Referral', [], ['request for assistance', 'single entry approach', 'sena', 'referral']),
  NLRC_COMPLAINT: D('NLRC Complaint Form', ['Complaint'], ['nlrc', 'complaint']),
  POSITION: D('Position Paper', [], ['position paper']),
  REPLY: D('Reply / Rejoinder', [], ['reply', 'rejoinder'], true),
  APPEAL_MEMO: D('Memorandum of Appeal / Appeal Bond', [], ['memorandum of appeal', 'appeal bond', 'notice of appeal'], true),
  NOTARIZED: D('Notarized Copy (with Doc/Page/Book No.)', [], ['notary public', 'doc no', 'page no', 'book no', 'series of']),
  DRAFT: D('Draft Document (Affidavit / SPA / Deed / Contract)', ['Affidavit', 'Affidavit of Loss', 'Special Power of Attorney', 'General Power of Attorney', 'Deed of Absolute Sale', 'Deed of Sale', 'Deed of Donation', 'Contract', 'Joint Affidavit'], ['affidavit', 'power of attorney', 'deed', 'contract']),
  STATEMENT_CLAIM: D('Statement of Claim (Form 1-SCC)', [], ['statement of claim', 'form 1 scc']),
  RESPONSE_SC: D('Response (Form 3-SCC)', [], ['form 3 scc', 'response'], true)
};

const DOCS = CASE_AI_DOCS;

/* ---------- Generic court stages shared by civil-type cases ---------- */
function caseAiCourtStages(opts = {}) {
  const answerDays = opts.answerDays || 30;
  return [
    S('filing', 'Filing of Complaint / Petition',
      ['complaint', 'petition', 'filed', 'na file', 'docket', 'raffle', 'nag file'],
      opts.filingDocs || [DOCS.COMPLAINT, DOCS.VERIF, DOCS.JA, DOCS.DOCKET],
      ['File the Complaint/Petition with the Verification and Certification Against Forum Shopping and the Judicial Affidavits of witnesses.',
       'Pay the docket fees and keep the Official Receipt.',
       'Record the filing date and the assigned branch in Progress.']),
    S('summons', `Summons and Answer (${answerDays} days)`,
      ['summons', 'answer', 'sagot', 'served', 'service of summons', 'default'],
      [DOCS.SUMMONS, DOCS.ANSWER],
      ['Monitor whether the summons has been served on the other party.',
       `If our client is the defendant: file the Answer within ${answerDays} days from receipt of summons.`,
       'If no Answer is filed after the deadline, consider a Motion to Declare Defendant in Default.'],
      { fromTypes: ['Summons'], fromWords: ['summons'], days: answerDays, label: `Answer (${answerDays} days from service of summons)`, doneWords: ['answer'] }),
    S('pretrial', 'Pre-Trial / Mediation (CAM / JDR)',
      ['pre trial', 'pretrial', 'mediation', 'jdr', 'cam', 'preliminary conference'],
      [DOCS.PTB, DOCS.NOTICE_PT],
      ['File the Pre-Trial Brief before the pre-trial (usually at least 3 days before) and make sure the other party receives it.',
       'Pre-mark all exhibits and prepare the client for Court-Annexed Mediation — the case may settle here.']),
    S('trial', 'Trial (Presentation of Evidence)',
      ['trial', 'testimony', 'witness', 'cross examination', 'direct examination', 'formal offer', 'presentation of evidence'],
      [DOCS.EXHIBITS, DOCS.FOE],
      ['Prepare and brief witnesses before each trial date.',
       'After presentation of evidence, file the Formal Offer of Evidence within the period set by the court.']),
    S('decision', 'Decision / Motion for Reconsideration / Appeal',
      ['decision', 'judgment', 'ruling', 'motion for reconsideration', 'appeal', 'notice of appeal'],
      [DOCS.DECISION],
      ['Review the Decision with the client immediately.',
       'If unfavorable: file a Motion for Reconsideration or Notice of Appeal within 15 days from receipt of the Decision.'],
      { fromTypes: ['Decision'], fromWords: ['decision', 'judgment'], days: 15, label: 'MR / Notice of Appeal (15 days from receipt of Decision)', doneWords: ['motion for reconsideration', 'notice of appeal', 'certificate of finality', 'entry of judgment'] }),
    S('execution', 'Finality and Execution',
      ['finality', 'entry of judgment', 'writ of execution', 'execution', 'sheriff', 'garnish', 'levy'],
      [DOCS.FINALITY, DOCS.WRIT],
      ['Secure the Certificate of Finality / Entry of Judgment.',
       'File a Motion for Issuance of a Writ of Execution and coordinate with the sheriff.'])
  ];
}

/* ============================================================
   PLAYBOOKS (one per case type)
   ============================================================ */
const CASE_AI_PLAYBOOKS = [
  /* ---------------- CIVIL ---------------- */
  {
    key: 'civil-collection', label: 'Civil — Collection of Sum of Money / Damages', category: 'Civil',
    detect: ['collection', 'sum of money', 'utang', 'unpaid', 'damages', 'breach of contract', 'specific performance', 'rescission'],
    stages: [
      S('prefiling', 'Pre-Filing (Demand and Barangay)',
        ['demand letter', 'final demand', 'barangay', 'lupon', 'certification to file action'],
        [DOCS.DEMAND, DOCS.CONTRACT, DOCS.BRGY],
        ['Make sure the other party received the demand letter (keep proof of receipt).',
         'If the parties live in the same city/municipality, go through Barangay conciliation first to get a Certification to File Action.',
         'Gather all proof of the debt (contract, promissory note, receipts, chats/texts).']),
      ...caseAiCourtStages()
    ]
  },
  {
    key: 'civil-ejectment', label: 'Civil — Ejectment (Unlawful Detainer / Forcible Entry)', category: 'Civil',
    detect: ['ejectment', 'unlawful detainer', 'forcible entry', 'pagpapaalis', 'eviction', 'palayasin'],
    stages: [
      S('prefiling', 'Demand to Pay & Vacate and Barangay',
        ['demand to vacate', 'demand letter', 'vacate', 'barangay', 'lupon'],
        [DOCS.DEMAND, DOCS.LEASE, DOCS.TITLE, DOCS.BRGY],
        ['Send a demand to pay AND vacate and keep proof that it was received.',
         'If the parties are in the same barangay/city, get a Certification to File Action.',
         'Note: Unlawful Detainer must be filed within 1 year from the last demand.']),
      ...caseAiCourtStages({ answerDays: 10 }).map(s => {
        if (s.key === 'pretrial') return { ...s, label: 'Preliminary Conference / Position Papers', signals: [...s.signals, 'position paper'], docs: [DOCS.POSITION, DOCS.NOTICE_PT], next: ['Attend the Preliminary Conference (Summary Procedure).', 'File the Position Paper and affidavits within the period set by the court.'] };
        if (s.key === 'trial') return null;
        if (s.key === 'decision') return { ...s, next: ['If the judgment favors the plaintiff: it is immediately executory unless the defendant appeals, posts a supersedeas bond and deposits the monthly rentals.', 'Appeal to the RTC within 15 days.'] };
        return s;
      }).filter(Boolean)
    ]
  },
  {
    key: 'civil-small-claims', label: 'Civil — Small Claims', category: 'Civil',
    detect: ['small claims', 'small claim'],
    stages: [
      S('prefiling', 'Preparing the Claim', ['demand letter', 'statement of claim'],
        [DOCS.DEMAND, DOCS.CONTRACT],
        ['Gather the demand letter and proof of the debt.', 'Note: lawyers cannot appear on behalf of a party at the small claims hearing (unless they are the party).']),
      S('filing', 'Filing of Statement of Claim', ['statement of claim', 'filed', 'docket'],
        [DOCS.STATEMENT_CLAIM, DOCS.VERIF, DOCS.DOCKET],
        ['File the Statement of Claim (Form 1-SCC) with the Certification of Non-Forum Shopping and supporting documents.']),
      S('summons', 'Summons and Response (10 days)', ['summons', 'response'],
        [DOCS.SUMMONS, DOCS.RESPONSE_SC],
        ['If our client is the defendant: file the Response within 10 days from receipt of summons.'],
        { fromTypes: ['Summons'], fromWords: ['summons'], days: 10, label: 'Response (10 days from summons)', doneWords: ['response', 'form 3 scc'] }),
      S('hearing', 'Hearing (one day)', ['hearing', 'jdr', 'settlement'],
        [],
        ['Prepare the client and all original documents for the hearing.']),
      S('decision', 'Decision (final and unappealable)', ['decision', 'judgment'],
        [DOCS.DECISION],
        ['Small claims decisions are final, executory and unappealable — prepare for execution if the debtor does not pay voluntarily.']),
      S('execution', 'Execution', ['writ of execution', 'execution', 'sheriff'],
        [DOCS.WRIT],
        ['File a Motion for Execution if payment is still not made.'])
    ]
  },
  {
    key: 'civil-property', label: 'Civil — Land / Property (Quieting, Recovery, Partition)', category: 'Civil',
    detect: ['quieting of title', 'recovery of possession', 'accion', 'partition', 'reconveyance', 'lupa', 'land', 'property', 'titulo', 'ownership'],
    stages: [
      S('prefiling', 'Gathering Property Documents',
        ['title', 'tax declaration', 'survey', 'barangay', 'demand'],
        [DOCS.TITLE, DOCS.TAXDEC, DOCS.DEED, DOCS.SURVEY, DOCS.BRGY],
        ['Get a Certified True Copy of the title from the Registry of Deeds and the Tax Declaration from the Assessor\'s Office.',
         'If needed, request a survey / relocation survey.',
         'If the parties are in the same barangay/city, go through Barangay conciliation first.']),
      ...caseAiCourtStages()
    ]
  },

  /* ---------------- FAMILY ---------------- */
  {
    key: 'family-nullity', label: 'Family — Annulment / Declaration of Nullity', category: 'Family',
    detect: ['annulment', 'nullity', 'psychological incapacity', 'article 36', 'art 36', 'void marriage'],
    stages: [
      S('evaluation', 'Psychological Evaluation and Records',
        ['psychological', 'psychologist', 'evaluation', 'psa'],
        [DOCS.PSA_MARRIAGE, DOCS.PSA_BIRTH, DOCS.PSYCH, DOCS.VALID_ID],
        ['Get the PSA Marriage Certificate and PSA Birth Certificates (client and children).',
         'Schedule the psychological evaluation and wait for the written report.']),
      S('filing', 'Filing of Petition', ['petition', 'filed', 'docket', 'raffle'],
        [DOCS.PETITION, DOCS.VERIF, DOCS.JA, DOCS.DOCKET],
        ['File the Petition in the Family Court (RTC) together with the Judicial Affidavits.',
         'Furnish copies to the Office of the Solicitor General and the Public Prosecutor.']),
      S('collusion', 'Summons and Collusion Investigation', ['summons', 'collusion', 'prosecutor', 'investigation'],
        [DOCS.SUMMONS, DOCS.COLLUSION],
        ['Monitor service of summons on the respondent.',
         'Wait for the Public Prosecutor\'s report finding no collusion before pre-trial.']),
      S('pretrial', 'Pre-Trial', ['pre trial', 'pretrial'],
        [DOCS.PTB],
        ['File the Pre-Trial Brief and prepare the list of witnesses (client, psychologist, others).']),
      S('trial', 'Trial', ['trial', 'testimony', 'witness', 'psychologist testified', 'formal offer'],
        [DOCS.EXHIBITS, DOCS.FOE],
        ['Schedule the testimonies of the psychologist and the client.', 'File the Formal Offer of Evidence after presentation.']),
      S('decision', 'Decision / MR / Appeal', ['decision', 'judgment', 'appeal', 'motion for reconsideration'],
        [DOCS.DECISION],
        ['Review the Decision with the client. The OSG may still appeal — wait for finality.'],
        { fromTypes: ['Decision'], fromWords: ['decision'], days: 15, label: 'MR / Appeal (15 days from receipt of Decision)', doneWords: ['certificate of finality', 'entry of judgment', 'motion for reconsideration', 'notice of appeal'] }),
      S('registration', 'Finality, Decree and PSA Annotation', ['finality', 'entry of judgment', 'decree', 'annotated', 'annotation', 'civil registrar'],
        [DOCS.FINALITY, DOCS.DECREE],
        ['Secure the Certificate of Finality and the Decree.',
         'Register them with the Local Civil Registrar and PSA so the Marriage Certificate gets annotated.'])
    ]
  },
  {
    key: 'family-support-custody', label: 'Family — Support / Custody', category: 'Family',
    detect: ['support', 'sustento', 'custody', 'visitation', 'child support'],
    stages: [
      S('prep', 'Gathering Records', ['birth certificate', 'income', 'expenses', 'demand'],
        [DOCS.PSA_BIRTH, DOCS.INCOME, DOCS.DEMAND],
        ['Get the PSA Birth Certificates of the children.', 'List and collect receipts of expenses (tuition, medicine, food) and proof of the other party\'s income.']),
      ...caseAiCourtStages().filter(s => s.key !== 'execution')
    ]
  },
  {
    key: 'family-correction', label: 'Family — Adoption / Correction of Entry / Change of Name', category: 'Family',
    detect: ['adoption', 'correction of entry', 'change of name', 'rule 108', 'ra 9048', 'clerical error', 'cancellation of entry'],
    stages: [
      S('prep', 'Gathering Records', ['psa', 'baptismal', 'school record', 'records'],
        [DOCS.PSA_BIRTH, DOCS.VALID_ID],
        ['Get the PSA Birth Certificate and supporting records (baptismal, school, medical, voter records).',
         'Note: simple clerical errors can be corrected at the Local Civil Registrar (RA 9048/10172) without going to court.']),
      S('filing', 'Filing of Petition', ['petition', 'filed', 'docket'],
        [DOCS.PETITION, DOCS.VERIF, DOCS.DOCKET],
        ['File the Petition and furnish copies to the Civil Registrar and the OSG.']),
      S('publication', 'Publication (3 consecutive weeks)', ['publication', 'published', 'newspaper'],
        [DOCS.PUBLICATION],
        ['Publish the order in a newspaper of general circulation once a week for 3 consecutive weeks.', 'Get the Affidavit of Publication and copies of the newspaper.']),
      S('hearing', 'Hearing', ['hearing', 'testimony', 'jurisdictional'],
        [DOCS.EXHIBITS],
        ['Prepare the jurisdictional requirements (publication, notices) for the first hearing.']),
      S('decision', 'Decision and Annotation', ['decision', 'finality', 'annotated', 'annotation'],
        [DOCS.DECISION, DOCS.FINALITY, DOCS.DECREE],
        ['Once final, register the Decision with the Local Civil Registrar and PSA for annotation.'])
    ]
  },

  /* ---------------- CRIMINAL ---------------- */
  {
    key: 'criminal-vawc', label: 'Criminal — VAWC (RA 9262)', category: 'Criminal',
    detect: ['vawc', 'ra 9262', '9262', 'violence against women', 'protection order', 'bpo', 'tpo', 'ppo'],
    stages: [
      S('protection', 'Protection Order and Complaint', ['protection order', 'bpo', 'tpo', 'ppo', 'complaint affidavit', 'medico'],
        [DOCS.PROTECTION, DOCS.COMPLAINT_AFF, DOCS.MEDICAL, DOCS.EXHIBITS],
        ['If there is danger, apply for a Protection Order immediately (BPO at the barangay, TPO/PPO in court).',
         'Collect the medical certificate, photos, messages and other evidence.']),
      S('pi', 'Preliminary Investigation', ['subpoena', 'preliminary investigation', 'counter affidavit'],
        [DOCS.SUBPOENA, DOCS.COUNTER_AFF],
        ['Respond to the subpoena: Counter-Affidavit within 10 days from receipt.'],
        { fromTypes: ['Subpoena'], fromWords: ['subpoena'], days: 10, label: 'Counter-Affidavit (10 days from subpoena)', doneWords: ['counter affidavit'] }),
      S('resolution', 'Prosecutor\'s Resolution', ['resolution', 'probable cause', 'dismissed'],
        [DOCS.RESOLUTION],
        ['If the Resolution is unfavorable: MR with the prosecutor or Petition for Review with the DOJ within 15 days.'],
        { fromTypes: ['Resolution'], fromWords: ['resolution'], days: 15, label: 'MR / Petition for Review (15 days)', doneWords: ['motion for reconsideration', 'petition for review', 'information'] }),
      S('arraignment', 'Information, Warrant/Bail and Arraignment', ['information', 'warrant', 'bail', 'arraignment', 'arraigned'],
        [DOCS.INFORMATION, DOCS.BAIL],
        ['Monitor the filing of the Information and the warrant/bail.', 'Prepare the client for arraignment.']),
      S('pretrial', 'Pre-Trial', ['pre trial', 'pretrial', 'plea bargaining'], [DOCS.PTB],
        ['File the Pre-Trial Brief and pre-mark the exhibits.']),
      S('trial', 'Trial', ['trial', 'testimony', 'witness', 'formal offer'], [DOCS.EXHIBITS, DOCS.FOE],
        ['Prepare witnesses and evidence for each trial date.']),
      S('judgment', 'Promulgation / Judgment / Appeal', ['promulgation', 'judgment', 'decision', 'appeal', 'convicted', 'acquitted'],
        [DOCS.DECISION],
        ['Attend the promulgation. If convicted, file a Notice of Appeal / MR within 15 days.'],
        { fromTypes: ['Decision'], fromWords: ['decision', 'judgment'], days: 15, label: 'Appeal / MR (15 days from promulgation)', doneWords: ['notice of appeal', 'motion for reconsideration', 'entry of judgment'] })
    ]
  },
  {
    key: 'criminal-general', label: 'Criminal — Estafa / BP 22 / Theft / Others', category: 'Criminal',
    detect: ['people of the philippines', 'people v', 'people vs', 'criminal', 'estafa', 'bp 22', 'bp22', 'bouncing check', 'theft', 'qualified theft', 'physical injuries', 'libel', 'cyberlibel', 'robbery', 'homicide', 'murder', 'swindling', 'falsification', 'kriminal', 'illegal drugs', 'ra 9165'],
    stages: [
      S('complaint', 'Complaint-Affidavit and Evidence', ['complaint affidavit', 'affidavit', 'evidence', 'police', 'blotter', 'fiscal', 'prosecutor'],
        [DOCS.COMPLAINT_AFF, DOCS.WITNESS_AFF, DOCS.EXHIBITS, DOCS.CHECK, DOCS.NOTICE_DISHONOR],
        ['Prepare the Complaint-Affidavit and witness affidavits, and attach all evidence.',
         'For BP 22: make sure the drawer received a written Notice of Dishonor (they have 5 banking days to pay).']),
      S('pi', 'Preliminary Investigation', ['subpoena', 'preliminary investigation', 'counter affidavit', 'reply'],
        [DOCS.SUBPOENA, DOCS.COUNTER_AFF],
        ['If our client is the respondent: file the Counter-Affidavit within 10 days from receipt of the subpoena.',
         'If our client is the complainant: monitor and prepare a Reply if allowed.'],
        { fromTypes: ['Subpoena'], fromWords: ['subpoena'], days: 10, label: 'Counter-Affidavit (10 days from subpoena)', doneWords: ['counter affidavit'] }),
      S('resolution', 'Prosecutor\'s Resolution', ['resolution', 'probable cause', 'dismissed'],
        [DOCS.RESOLUTION],
        ['If unfavorable: MR with the prosecutor or Petition for Review with the DOJ within 15 days.'],
        { fromTypes: ['Resolution'], fromWords: ['resolution'], days: 15, label: 'MR / Petition for Review (15 days)', doneWords: ['motion for reconsideration', 'petition for review', 'information'] }),
      S('arraignment', 'Information, Warrant/Bail and Arraignment', ['information', 'warrant', 'bail', 'arraignment', 'arraigned'],
        [DOCS.INFORMATION, DOCS.BAIL],
        ['Monitor the filing of the Information in court and the warrant/bail.', 'Prepare the client for arraignment (and plea bargaining if applicable).']),
      S('pretrial', 'Pre-Trial', ['pre trial', 'pretrial', 'plea bargaining'], [DOCS.PTB],
        ['File the Pre-Trial Brief and pre-mark the exhibits.']),
      S('trial', 'Trial', ['trial', 'testimony', 'witness', 'formal offer', 'demurrer'], [DOCS.EXHIBITS, DOCS.FOE],
        ['Prepare witnesses and evidence for each trial date.', 'If defense: assess whether there is basis for a Demurrer to Evidence.']),
      S('judgment', 'Promulgation / Judgment / Appeal', ['promulgation', 'judgment', 'decision', 'appeal', 'convicted', 'acquitted'],
        [DOCS.DECISION],
        ['Attend the promulgation. If convicted, file a Notice of Appeal / MR within 15 days.'],
        { fromTypes: ['Decision'], fromWords: ['decision', 'judgment'], days: 15, label: 'Appeal / MR (15 days from promulgation)', doneWords: ['notice of appeal', 'motion for reconsideration', 'entry of judgment'] })
    ]
  },

  /* ---------------- LABOR ---------------- */
  {
    key: 'labor-nlrc', label: 'Labor — Illegal Dismissal / Money Claims (NLRC)', category: 'Labor',
    detect: ['illegal dismissal', 'nlrc', 'labor', 'money claims', 'backwages', 'separation pay', '13th month', 'constructive dismissal', 'sena', 'dole', 'labor arbiter'],
    stages: [
      S('sena', 'SEnA (Request for Assistance)', ['sena', 'single entry', 'request for assistance', 'dole', 'referral'],
        [DOCS.SENA, DOCS.EMPLOYMENT, DOCS.TERMINATION],
        ['File a Request for Assistance (SEnA) — 30-day conciliation-mediation.',
         'Collect proof of employment and all notices from the employer.']),
      S('complaint', 'Complaint with the NLRC', ['nlrc', 'labor arbiter', 'complaint', 'filed'],
        [DOCS.NLRC_COMPLAINT],
        ['If there is no settlement at SEnA, file the Complaint with the NLRC using the referral.']),
      S('conciliation', 'Mandatory Conciliation-Mediation Conference', ['mandatory conference', 'conciliation', 'mediation', 'conference'],
        [],
        ['Attend every mandatory conference — the complaint may be dismissed if the complainant fails to appear twice.']),
      S('position', 'Position Paper and Reply', ['position paper', 'reply', 'rejoinder'],
        [DOCS.POSITION, DOCS.REPLY],
        ['File the Position Paper (with affidavits and evidence) on the date set by the Labor Arbiter.']),
      S('decision', 'Labor Arbiter Decision / Appeal', ['decision', 'award', 'appeal', 'memorandum of appeal'],
        [DOCS.DECISION, DOCS.APPEAL_MEMO],
        ['Appeal to the NLRC Commission within 10 calendar days from receipt of the Decision.',
         'If the employer appeals a monetary award: a cash or surety bond equal to the award is required.'],
        { fromTypes: ['Decision'], fromWords: ['decision'], days: 10, label: 'Appeal to NLRC (10 calendar days)', doneWords: ['memorandum of appeal', 'appeal', 'finality', 'entry of judgment'] }),
      S('execution', 'Finality and Execution', ['finality', 'entry of judgment', 'writ of execution', 'execution', 'sheriff'],
        [DOCS.FINALITY, DOCS.WRIT],
        ['File a Motion for Issuance of a Writ of Execution once final.'])
    ]
  },

  /* ---------------- NOTARIAL ---------------- */
  {
    key: 'notarial', label: 'Notarial — Affidavit / SPA / Deed / Contract', category: 'Notarial',
    detect: ['affidavit of loss', 'affidavit', 'special power of attorney', 'spa', 'power of attorney', 'deed', 'notarial', 'notarize', 'notary', 'acknowledgment', 'jurat', 'contract of lease', 'kasunduan'],
    stages: [
      S('intake', 'Intake (Client Details and IDs)', ['intake', 'id', 'details', 'request', 'inquiry'],
        [DOCS.VALID_ID],
        ['Get 2 valid IDs of the client and of every signatory.', 'Collect complete details (name, address, details of the lost item / authority granted / property sold).']),
      S('drafting', 'Drafting', ['draft', 'drafted', 'prepared', 'ginawa'],
        [DOCS.DRAFT],
        ['Draft the document and have the client review it before signing.']),
      S('signing', 'Signing and Notarization', ['signed', 'pirmado', 'notarized', 'notaryo', 'notarial register'],
        [DOCS.NOTARIZED],
        ['All signatories must personally appear before the notary public with their IDs.', 'Enter it in the Notarial Register (Doc/Page/Book No., Series).']),
      S('release', 'Release / Delivery to Client', ['released', 'claimed', 'nakuha', 'sent', 'courier', 'delivered', 'pinadala'],
        [],
        ['Release the notarized copy to the client or send it via courier and record the tracking number.'])
    ]
  },

  /* ---------------- GENERAL (fallback) ---------------- */
  {
    key: 'general', label: 'General / Others', category: 'General',
    detect: [],
    stages: [
      S('intake', 'Intake and Document Gathering', ['intake', 'consultation', 'documents'],
        [DOCS.VALID_ID],
        ['Complete the client\'s details and IDs.', 'Select the correct Case Type above for more accurate guidance.']),
      ...caseAiCourtStages()
    ]
  }
];

/* ============================================================
   SMALL HELPERS
   ============================================================ */
function caseAiEsc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function caseAiNorm(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function caseAiHasPhrase(normText, phrase) {
  const p = caseAiNorm(phrase);
  return !!p && (` ${normText} `).includes(` ${p} `);
}

function caseAiLev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function caseAiSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - caseAiLev(a, b) / Math.max(a.length, b.length);
}

function caseAiToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// "2026-03-05" -> local midnight Date (avoids UTC off-by-one)
function caseAiDay(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(value);
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function caseAiDaysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function caseAiFmt(d) {
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function caseAiPlural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function caseAiGetPlaybook(key) {
  return CASE_AI_PLAYBOOKS.find(p => p.key === key) || CASE_AI_PLAYBOOKS.find(p => p.key === 'general');
}

function caseAiClientName(client) {
  if (!client) return 'Unknown client';
  return (client.name || `${client.firstName || ''} ${client.lastName || ''}`).trim() || 'Unknown client';
}

/* ============================================================
   DOCUMENT MATCHING (uses AI scan from doc-intelligence.js)
   ============================================================ */
function caseAiDocMatches(doc, req) {
  const type = doc.aiDocType || '';
  if (type && req.types && req.types.length) {
    const typeHit = req.types.some(t => type === t ||
      (typeof docAiTypeMatches === 'function' && docAiTypeMatches(type, t)));
    if (typeHit) return true;
  }
  // filename + only the TOP of the file (title area) to avoid false hits
  const hay = caseAiNorm(`${doc.fileName} ${type} ${String(doc.aiText || '').slice(0, 400)}`);
  return (req.words || []).some(w => caseAiHasPhrase(hay, w));
}

function caseAiFindDoc(docs, req) {
  return docs.find(d => caseAiDocMatches(d, req)) || null;
}

/* ============================================================
   CASE TYPE DETECTION
   ============================================================ */
function caseAiDetectType(caseObj, docs) {
  if (caseObj.caseType && CASE_AI_PLAYBOOKS.some(p => p.key === caseObj.caseType)) {
    return { playbook: caseAiGetPlaybook(caseObj.caseType), auto: false };
  }

  const nameText = caseAiNorm(`${caseObj.caseName} ${caseObj.caseNumber}`);
  const otherText = caseAiNorm([
    caseObj.courtName,
    Object.values(caseObj.customFields || {}).join(' '),
    docs.map(d => `${d.aiDocType || ''} ${d.fileName}`).join(' ')
  ].join(' '));

  let best = null, bestScore = 0;
  CASE_AI_PLAYBOOKS.forEach(p => {
    let score = 0;
    p.detect.forEach(k => {
      if (caseAiHasPhrase(nameText, k)) score += 3 + k.split(' ').length;
      else if (caseAiHasPhrase(otherText, k)) score += 1;
    });
    if (score > bestScore) { bestScore = score; best = p; }
  });

  // court hints
  const court = caseAiNorm(caseObj.courtName);
  if (!best || bestScore < 2) {
    if (caseAiHasPhrase(court, 'nlrc') || caseAiHasPhrase(court, 'labor')) best = caseAiGetPlaybook('labor-nlrc');
    else if (caseAiHasPhrase(court, 'prosecutor') || caseAiHasPhrase(court, 'fiscal')) best = caseAiGetPlaybook('criminal-general');
    else if (caseAiHasPhrase(court, 'family court')) best = caseAiGetPlaybook('family-nullity');
  }

  return { playbook: best || caseAiGetPlaybook('general'), auto: true };
}

/* ============================================================
   MAIN ANALYSIS
   ============================================================ */
function caseAiAnalyze(caseId) {
  const caseObj = findCaseById(caseId);
  if (!caseObj) return null;

  const today = caseAiToday();
  const client = caseObj.clientId ? findClientById(caseObj.clientId) : null;
  const clientName = caseAiClientName(client);
  const docs = getDocuments().filter(d => d.caseId === caseId);
  const progress = getProgressEntries()
    .filter(p => p.caseId === caseId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // hearings (+ the case's own hearingDate if it has no hearing record)
  let hearings = getHearings().filter(h => h.caseId === caseId).map(h => ({ ...h, day: caseAiDay(h.hearingDate) }));
  if (caseObj.hearingDate && !hearings.some(h => h.hearingDate === caseObj.hearingDate)) {
    hearings.push({ id: 'case-hearing', hearingName: 'Hearing', hearingDate: caseObj.hearingDate, notes: '', day: caseAiDay(caseObj.hearingDate) });
  }
  hearings = hearings.filter(h => h.day).sort((a, b) => a.day - b.day);
  const pastHearings = hearings.filter(h => h.day < today);
  const upcomingHearings = hearings.filter(h => h.day >= today);
  const nextHearing = upcomingHearings[0] || null;

  const { playbook, auto } = caseAiDetectType(caseObj, docs);

  // ---------- STAGE DETECTION ----------
  const blob = caseAiNorm([
    progress.map(p => `${p.title} ${p.details}`).join(' '),
    hearings.map(h => `${h.hearingName} ${h.notes || ''}`).join(' '),
    docs.map(d => `${d.fileName} ${d.aiDocType || ''}`).join(' ')
  ].join(' '));

  let currentIdx = 0;
  playbook.stages.forEach((st, i) => {
    const signalHit = st.signals.some(sg => caseAiHasPhrase(blob, sg));
    const docHit = st.docs.some(req => !req.optional && caseAiFindDoc(docs, req));
    if (signalHit || docHit) currentIdx = Math.max(currentIdx, i);
  });
  const isClosed = ['completed', 'closed'].includes(String(caseObj.status || '').toLowerCase());
  if (isClosed) currentIdx = playbook.stages.length - 1;

  const stages = playbook.stages.map((st, i) => ({
    ...st,
    state: isClosed || i < currentIdx ? 'done' : (i === currentIdx ? 'current' : 'upcoming')
  }));
  const currentStage = stages[currentIdx];
  const nextStage = stages[currentIdx + 1] || null;

  // ---------- DOCUMENT CHECKLIST ----------
  const checklist = [];
  const seenLabels = new Set();
  stages.forEach((st, i) => {
    if (i > currentIdx + 1) return;
    st.docs.forEach(req => {
      if (seenLabels.has(req.label)) return;
      seenLabels.add(req.label);
      const found = caseAiFindDoc(docs, req);
      let status = 'present';
      if (!found) {
        if (req.optional) status = 'optional';
        else if (i < currentIdx) status = 'missed';
        else if (i === currentIdx) status = 'needed';
        else status = 'prepare';
      }
      checklist.push({ req, doc: found, status, stageLabel: st.label });
    });
  });

  // ---------- ESTIMATED DEADLINES ----------
  const deadlines = [];
  stages.forEach((st, i) => {
    if (!st.deadline || i > currentIdx) return;
    const dl = st.deadline;
    const src = caseAiFindDoc(docs, { types: dl.fromTypes, words: dl.fromWords });
    if (!src) return;
    const doneDoc = docs.some(d => d !== src && (dl.doneWords || []).some(w => caseAiHasPhrase(caseAiNorm(`${d.fileName} ${d.aiDocType || ''}`), w)));
    const doneProgress = (dl.doneWords || []).some(w => caseAiHasPhrase(caseAiNorm(progress.map(p => `${p.title} ${p.details}`).join(' ')), w));
    // start date: latest date written INSIDE the doc (not in the future), else upload date
    const inside = (src.aiDates || []).map(caseAiDay).filter(d => d && d <= today).sort((a, b) => b - a)[0];
    const start = inside || caseAiDay(src.uploadedAt);
    if (!start) return;
    const due = new Date(start);
    due.setDate(due.getDate() + dl.days);
    deadlines.push({
      label: dl.label, start, due, fromDoc: src,
      done: doneDoc || doneProgress,
      daysLeft: caseAiDaysBetween(today, due),
      basedOn: inside ? 'the date written inside the file' : 'the upload date'
    });
  });

  // ---------- MISSED / ISSUES ----------
  const issues = []; // { level: 'high'|'medium'|'low', text }
  const addIssue = (level, text) => issues.push({ level, text });

  checklist.filter(c => c.status === 'missed').forEach(c =>
    addIssue('high', `No <b>${caseAiEsc(c.req.label)}</b> on file even though the case is past the "${caseAiEsc(c.stageLabel)}" stage.`));

  deadlines.filter(d => !d.done && d.daysLeft < 0).forEach(d =>
    addIssue('high', `The estimated deadline for <b>${caseAiEsc(d.label)}</b> passed on ${caseAiFmt(d.due)} — no file or progress entry shows it was done.`));

  pastHearings.forEach(h => {
    const after = progress.some(p => {
      const pd = caseAiDay(p.createdAt);
      return pd && pd >= h.day && caseAiDaysBetween(h.day, pd) <= CASE_AI_CONFIG.NO_UPDATE_AFTER_HEARING_DAYS + 30;
    });
    const daysAgo = caseAiDaysBetween(h.day, today);
    if (!after && daysAgo >= 1 && daysAgo <= 180) {
      addIssue('medium', `No progress update after the "<b>${caseAiEsc(h.hearingName || 'Hearing')}</b>" hearing on ${caseAiFmt(h.day)}.`);
    }
  });

  if (!isClosed && !nextHearing && hearings.length) {
    addIssue('medium', 'No next hearing is scheduled. Follow up with the court or check the latest Order.');
  }

  const lastActivity = [
    ...progress.map(p => caseAiDay(p.createdAt)),
    ...docs.map(d => caseAiDay(d.uploadedAt)),
    caseAiDay(caseObj.updatedAt), caseAiDay(caseObj.createdAt)
  ].filter(Boolean).sort((a, b) => b - a)[0];
  const idleDays = lastActivity ? caseAiDaysBetween(lastActivity, today) : 0;
  if (!isClosed && idleDays >= CASE_AI_CONFIG.STALE_DAYS) {
    addIssue('medium', `No activity for ${caseAiPlural(idleDays, 'day')} (no new progress entries or files).`);
  }

  if (!docs.length) addIssue('medium', 'No documents have been uploaded to this case yet.');
  if (!progress.length && !isClosed) addIssue('low', 'No Progress entries yet. Record what happens so the case can be tracked.');
  if (!caseObj.drawerNumber) addIssue('low', 'No drawer assigned for the physical case file.');
  if (client && !client.contact && !client.email) addIssue('low', 'The client has no contact number or email on record.');

  const createdDay = caseAiDay(caseObj.createdAt);
  if (String(caseObj.status).toLowerCase() === 'pending' && createdDay && caseAiDaysBetween(createdDay, today) > CASE_AI_CONFIG.PENDING_TOO_LONG_DAYS) {
    addIssue('low', `The status has been "pending" for ${caseAiPlural(caseAiDaysBetween(createdDay, today), 'day')} — update it if the case is already active.`);
  }
  if (isClosed && nextHearing) {
    addIssue('medium', `The case is marked completed but still has a hearing scheduled on ${caseAiFmt(nextHearing.day)}. Check if the status is correct.`);
  }

  // ---------- NEXT STEPS ----------
  const nextSteps = [];
  if (nextHearing) {
    const inDays = caseAiDaysBetween(today, nextHearing.day);
    if (inDays <= CASE_AI_CONFIG.HEARING_SOON_DAYS) {
      const hn = caseAiNorm(nextHearing.hearingName);
      let prep = 'Prepare the case folder and copies of the pleadings, and remind the client.';
      if (caseAiHasPhrase(hn, 'pre trial') || caseAiHasPhrase(hn, 'pretrial')) prep = 'Make sure the Pre-Trial Brief is filed, exhibits are pre-marked, and the client will attend.';
      else if (caseAiHasPhrase(hn, 'trial')) prep = 'Brief the witnesses and prepare the Judicial Affidavits and original evidence.';
      else if (caseAiHasPhrase(hn, 'arraignment')) prep = 'Prepare the client (and bail papers, if any) for arraignment.';
      else if (caseAiHasPhrase(hn, 'mediation')) prep = 'Discuss settlement options and limits with the client before mediation.';
      const when = inDays === 0 ? 'TODAY' : inDays === 1 ? 'TOMORROW' : `In ${inDays} days`;
      nextSteps.push({ urgent: true, text: `<b>${when}</b>: "${caseAiEsc(nextHearing.hearingName || 'Hearing')}" (${caseAiFmt(nextHearing.day)}). ${prep}` });
    }
  }
  deadlines.filter(d => !d.done && d.daysLeft >= 0).forEach(d =>
    nextSteps.push({ urgent: d.daysLeft <= 5, text: `Deadline for <b>${caseAiEsc(d.label)}</b>: ${caseAiFmt(d.due)} (${caseAiPlural(d.daysLeft, 'day')} left). <i>Estimated from ${d.basedOn}.</i>` }));
  checklist.filter(c => c.status === 'needed').forEach(c =>
    nextSteps.push({ urgent: false, text: `Complete / upload the <b>${caseAiEsc(c.req.label)}</b>.` }));
  if (!isClosed) {
    currentStage.next.forEach(t => nextSteps.push({ urgent: false, text: caseAiEsc(t) }));
    if (nextStage) nextSteps.push({ urgent: false, text: `Prepare for the next stage: <b>${caseAiEsc(nextStage.label)}</b> — ${caseAiEsc(nextStage.next[0] || '')}` });
    if (!nextHearing && hearings.length) nextSteps.push({ urgent: false, text: 'Ask the court for the next schedule and add it to the Calendar.' });
  }

  // ---------- HEALTH SCORE ----------
  const penalty = { high: 15, medium: 8, low: 3 };
  const health = Math.max(0, 100 - issues.reduce((sum, i) => sum + penalty[i.level], 0));
  const healthLabel = health >= 80 ? 'On track' : health >= 50 ? 'Needs attention' : 'Urgent action needed';

  return {
    caseObj, client, clientName, docs, progress, hearings, pastHearings, upcomingHearings, nextHearing,
    playbook, autoType: auto, stages, currentIdx, currentStage, nextStage, isClosed,
    checklist, deadlines, issues, nextSteps,
    idleDays, lastActivity, health, healthLabel,
    ageDays: createdDay ? caseAiDaysBetween(createdDay, today) : null
  };
}

/* ============================================================
   RENDER — FULL MODAL
   ============================================================ */
function caseAiHealthClass(h) {
  return h >= 80 ? 'good' : h >= 50 ? 'warn' : 'bad';
}

const CASE_AI_LEVEL_ORDER = { high: 0, medium: 1, low: 2 };
const CASE_AI_LEVEL_LABEL = { high: 'CRITICAL', medium: 'ATTENTION', low: 'REMINDER' };

function caseAiRenderFull(a) {
  const c = a.caseObj;

  const typeOptions = CASE_AI_PLAYBOOKS.map(p =>
    `<option value="${p.key}" ${p.key === a.playbook.key ? 'selected' : ''}>${caseAiEsc(p.label)}</option>`).join('');

  const stagesHtml = a.stages.map((st, i) => `
    <div class="caseai-stage caseai-stage-${st.state}">
      <span class="caseai-stage-dot">${st.state === 'done' ? '<i class="fa-solid fa-check"></i>' : i + 1}</span>
      <span class="caseai-stage-label">${caseAiEsc(st.label)}</span>
    </div>`).join('');

  const issuesHtml = a.issues.length
    ? a.issues.sort((x, y) => CASE_AI_LEVEL_ORDER[x.level] - CASE_AI_LEVEL_ORDER[y.level])
        .map(i => `<li class="caseai-issue caseai-issue-${i.level}"><span class="caseai-level">${CASE_AI_LEVEL_LABEL[i.level]}</span> ${i.text}</li>`).join('')
    : '<li class="caseai-ok"><i class="fa-solid fa-circle-check"></i> Nothing missed. 👍</li>';

  const nextHtml = a.nextSteps.length
    ? a.nextSteps.map(n => `<li class="${n.urgent ? 'caseai-urgent' : ''}">${n.urgent ? '<i class="fa-solid fa-bolt"></i> ' : ''}${n.text}</li>`).join('')
    : '<li>Nothing to do right now.</li>';

  const statusIcon = { present: 'fa-circle-check', missed: 'fa-circle-xmark', needed: 'fa-circle-exclamation', prepare: 'fa-hourglass-half', optional: 'fa-circle-minus' };
  const statusText = { present: 'On file', missed: 'Missing (should already be on file)', needed: 'Needed now', prepare: 'Prepare next', optional: 'Optional' };
  const checklistHtml = a.checklist.length ? a.checklist.map(ch => `
    <li class="caseai-doc caseai-doc-${ch.status}">
      <i class="fa-solid ${statusIcon[ch.status]}"></i>
      <div class="caseai-doc-info">
        <b>${caseAiEsc(ch.req.label)}</b>
        <small>${statusText[ch.status]} · ${caseAiEsc(ch.stageLabel)}${ch.req.note ? ` · ${caseAiEsc(ch.req.note)}` : ''}</small>
        ${ch.doc ? `<small class="caseai-doc-file"><i class="fa-solid fa-paperclip"></i> ${caseAiEsc(ch.doc.fileName)}</small>` : ''}
      </div>
      ${ch.doc ? `<button type="button" class="docai-link-btn" data-docai-open="${caseAiEsc(ch.doc.id)}">View File</button>` : ''}
    </li>`).join('') : '<li>No checklist for this stage.</li>';

  const hearingsHtml = `
    ${a.nextHearing
      ? `<div class="caseai-next-hearing"><i class="fa-solid fa-calendar-day"></i> Next: <b>${caseAiEsc(a.nextHearing.hearingName || 'Hearing')}</b> — ${caseAiFmt(a.nextHearing.day)} <span class="caseai-countdown">${caseAiPlural(caseAiDaysBetween(caseAiToday(), a.nextHearing.day), 'day')}</span></div>`
      : '<div class="caseai-next-hearing none"><i class="fa-solid fa-calendar-xmark"></i> No next hearing scheduled.</div>'}
    ${a.pastHearings.length ? `<ul class="caseai-past">${a.pastHearings.slice(-5).reverse().map(h => `<li>${caseAiFmt(h.day)} — ${caseAiEsc(h.hearingName || 'Hearing')}${h.notes ? ` <small>(${caseAiEsc(h.notes)})</small>` : ''}</li>`).join('')}</ul>` : ''}
  `;

  const lastProgress = a.progress[0];
  const highCount = a.issues.filter(i => i.level === 'high').length;
  const quickButtons = [];
  if (typeof openDocumentsModal === 'function' && document.getElementById('documentsModalOverlay')) {
    quickButtons.push(`<button type="button" class="btn-outline" data-caseai-docs="${caseAiEsc(c.id)}"><i class="fa-solid fa-folder-open"></i> Documents (${a.docs.length})</button>`);
  }
  if (typeof openProgressModal === 'function' && document.getElementById('progressModalOverlay')) {
    quickButtons.push(`<button type="button" class="btn-outline" data-caseai-progress="${caseAiEsc(c.id)}"><i class="fa-solid fa-chart-line"></i> Progress (${a.progress.length})</button>`);
  }

  return `
    <div class="caseai-top">
      <div class="caseai-health caseai-health-${caseAiHealthClass(a.health)}">
        <span class="caseai-health-num">${a.health}</span>
        <span class="caseai-health-label">${caseAiEsc(a.healthLabel)}</span>
      </div>
      <div class="caseai-overview">
        <h3>${caseAiEsc(c.caseName)}</h3>
        <p><b>${caseAiEsc(c.caseNumber)}</b> · ${caseAiEsc(a.clientName)} · ${caseAiEsc(c.courtName || 'No court set')}</p>
        <p>Status: <span class="badge badge-${caseAiEsc(c.status)}">${caseAiEsc(c.status)}</span>
           ${a.ageDays !== null ? ` · Open for ${caseAiPlural(a.ageDays, 'day')}` : ''}
           ${a.lastActivity ? ` · Last activity: ${caseAiFmt(a.lastActivity)}` : ''}</p>
        <label class="caseai-type-row">
          <span>Case Type ${a.autoType ? '<small>(auto-detected)</small>' : '<small>(set manually)</small>'}:</span>
          <select data-caseai-type="${caseAiEsc(c.id)}">
            <option value="">— Auto-detect —</option>
            ${typeOptions}
          </select>
        </label>
      </div>
    </div>

    <div class="caseai-summary-line">
      <i class="fa-solid fa-robot"></i>
      Currently at the <b>${caseAiEsc(a.currentStage.label)}</b> stage${a.isClosed ? ' (case closed)' : ''}.
      ${highCount ? `<b>${caseAiPlural(highCount, 'critical item')}</b> missed.` : ''}
      ${a.nextHearing ? `Next hearing: <b>${caseAiFmt(a.nextHearing.day)}</b>.` : ''}
      ${lastProgress ? `Latest update: "${caseAiEsc(lastProgress.title)}" (${caseAiFmt(caseAiDay(lastProgress.createdAt))}).` : ''}
    </div>

    <div class="caseai-section">
      <h4><i class="fa-solid fa-route"></i> Case Progress</h4>
      <div class="caseai-stages">${stagesHtml}</div>
    </div>

    <div class="caseai-grid">
      <div class="caseai-section">
        <h4><i class="fa-solid fa-triangle-exclamation"></i> Missed / Needs Attention (${a.issues.length})</h4>
        <ul class="caseai-list">${issuesHtml}</ul>
      </div>
      <div class="caseai-section">
        <h4><i class="fa-solid fa-forward"></i> Next Steps</h4>
        <ol class="caseai-list caseai-next">${nextHtml}</ol>
      </div>
    </div>

    <div class="caseai-grid">
      <div class="caseai-section">
        <h4><i class="fa-solid fa-list-check"></i> Documents Checklist</h4>
        <ul class="caseai-list">${checklistHtml}</ul>
      </div>
      <div class="caseai-section">
        <h4><i class="fa-solid fa-gavel"></i> Hearings</h4>
        ${hearingsHtml}
      </div>
    </div>

    ${quickButtons.length ? `<div class="caseai-actions">${quickButtons.join('')}</div>` : ''}

    <p class="caseai-disclaimer"><i class="fa-solid fa-circle-info"></i>
      This is a guide based on general Philippine procedure and the data in this system. Deadlines are <b>estimates</b> —
      always verify with the handling attorney and the court's actual Orders.</p>
  `;
}

/* ============================================================
   MODAL
   ============================================================ */
let _caseAiModalInjected = false;
let _caseAiCurrentCaseId = null;

function caseAiInjectModal() {
  if (_caseAiModalInjected || document.getElementById('caseAiModalOverlay')) return;
  _caseAiModalInjected = true;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'caseAiModalOverlay';
  overlay.innerHTML = `
    <div class="modal-box modal-lg glass caseai-modal">
      <div class="modal-header">
        <h2><i class="fa-solid fa-robot"></i> AI Case Summary — <span id="caseAiModalTitle"></span></h2>
        <button class="modal-close" id="closeCaseAiModal">&times;</button>
      </div>
      <div class="modal-body" id="caseAiModalBody"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('closeCaseAiModal').addEventListener('click', () => closeModal('caseAiModalOverlay'));
  if (typeof enableClickOutsideClose === 'function') enableClickOutsideClose('caseAiModalOverlay');
}

function openCaseSummaryModal(caseId) {
  const analysis = caseAiAnalyze(caseId);
  if (!analysis) {
    if (typeof showToast === 'function') showToast('Case not found.', 'error');
    return;
  }
  caseAiInjectModal();
  _caseAiCurrentCaseId = caseId;
  document.getElementById('caseAiModalTitle').textContent = analysis.caseObj.caseNumber;
  document.getElementById('caseAiModalBody').innerHTML = caseAiRenderFull(analysis);
  openModal('caseAiModalOverlay');

  if (typeof logActivity === 'function' && typeof getCurrentUser === 'function') {
    const u = getCurrentUser();
    if (u) logActivity(u.id, 'case-ai-summary', `Viewed AI summary of case "${analysis.caseObj.caseNumber}".`);
  }
}

function caseAiRefreshModal() {
  const overlay = document.getElementById('caseAiModalOverlay');
  if (!overlay || !overlay.classList.contains('active') || !_caseAiCurrentCaseId) return;
  const analysis = caseAiAnalyze(_caseAiCurrentCaseId);
  if (analysis) document.getElementById('caseAiModalBody').innerHTML = caseAiRenderFull(analysis);
}

function caseAiSaveType(caseId, typeKey) {
  const cases = getCases();
  const idx = cases.findIndex(c => c.id === caseId);
  if (idx === -1) return;
  cases[idx].caseType = typeKey || null;
  cases[idx].updatedAt = nowISO();
  saveCases(cases);
  if (typeof showToast === 'function') showToast(typeKey ? 'Case type saved.' : 'Case type set to auto-detect.', 'success');
}

/* Opens the full summary from anywhere (AI chat, other pages) */
function caseAiOpenFromAnywhere(caseId) {
  const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  const onDashboard = !!document.getElementById('caseTableBody');
  if (onDashboard) {
    if (typeof closeAiAssistantPanel === 'function' && window.innerWidth < 768) closeAiAssistantPanel();
    openCaseSummaryModal(caseId);
    return;
  }
  if (user && typeof getVisibleNavItemsForUser === 'function' &&
      !getVisibleNavItemsForUser(user).some(i => i.key === 'dashboard')) {
    // no dashboard access -> still show it on this page
    openCaseSummaryModal(caseId);
    return;
  }
  setPendingNavTarget(`case:${caseId}`);
  window.location.href = 'dashboard.html';
}

// Called by dashboard.js with the pending nav target (e.g. "case:CASE-123")
function caseAiHandleNavTarget(target) {
  if (!target || !String(target).startsWith('case:')) return false;
  const caseId = String(target).slice(5);
  setTimeout(() => openCaseSummaryModal(caseId), 300);
  return true;
}

/* ============================================================
   AI CHAT — compact card + intent handler
   (understands English AND Tagalog/Taglish questions)
   ============================================================ */
const CASE_AI_INTENT_WORDS = [
  // English
  'summary', 'summarize', 'summarise', 'overview', 'update', 'status of', 'progress',
  'next', 'next step', 'next steps', 'to do', 'todo', 'missed', 'missing', 'lacking', 'overdue',
  'deadline', 'due', 'stage', 'process', 'advice', 'helper', 'health', 'checklist', 'what now',
  'how is', 'hows',
  // Tagalog / Taglish
  'buod', 'lagay', 'kalagayan', 'status ng', 'susunod', 'gagawin', 'gawin', 'na miss', 'namiss', 'miss',
  'nakaligtaan', 'kulang', 'proseso', 'payo', 'ano na', 'kamusta', 'kumusta',
  'kailangang document', 'kailangan na document', 'kailangang dokumento', 'kailangan pang', 'need pa'
];

// words that clearly ask for the full summary (so plain hearing questions stay with the hearing logic)
const CASE_AI_SUMMARY_WORDS = [
  'summary', 'summarize', 'summarise', 'overview', 'missed', 'missing', 'lacking', 'overdue', 'next step',
  'next steps', 'to do', 'deadline', 'stage', 'process', 'checklist', 'advice', 'how is', 'hows',
  'buod', 'na miss', 'namiss', 'nakaligtaan', 'kulang', 'gagawin', 'proseso', 'kamusta', 'kumusta',
  'lagay', 'kalagayan', 'payo'
];

function caseAiFindCaseFromQuery(rawQuery) {
  const q = caseAiNorm(rawQuery);
  const qCompact = q.replace(/ /g, '');
  const words = q.split(' ').filter(w => w.length >= 3);
  const cases = getCases();
  const clients = getClients();

  // 1) case number
  const byNumber = cases.find(c => {
    const n = caseAiNorm(c.caseNumber).replace(/ /g, '');
    return n.length >= 3 && qCompact.includes(n);
  });
  if (byNumber) return { cases: [byNumber], note: null };

  // 2) client name (fuzzy, surname alone works)
  let bestClient = null, bestScore = 0, typed = '';
  clients.forEach(cl => {
    const tokens = caseAiNorm(cl.name).split(' ').filter(t => t.length >= 3);
    tokens.forEach(tok => words.forEach(w => {
      const s = caseAiSim(w, tok);
      if (s > bestScore) { bestScore = s; bestClient = cl; typed = w; }
    }));
  });
  if (bestClient && bestScore >= 0.8) {
    const list = cases.filter(c => c.clientId === bestClient.id)
      .sort((a, b) => {
        const ac = ['completed', 'closed'].includes(a.status) ? 1 : 0;
        const bc = ['completed', 'closed'].includes(b.status) ? 1 : 0;
        return ac - bc || new Date(b.createdAt) - new Date(a.createdAt);
      });
    const note = bestScore < 1 ? `No exact match for "<b>${caseAiEsc(typed)}</b>" — the closest client is <b>${caseAiEsc(bestClient.name)}</b>.` : null;
    if (list.length) return { cases: list, note };
  }

  // 3) case name words
  let bestCase = null, bestHits = 0;
  cases.forEach(c => {
    const cw = caseAiNorm(c.caseName).split(' ').filter(t => t.length >= 4);
    const hits = cw.filter(t => words.some(w => caseAiSim(w, t) >= 0.85)).length;
    if (hits > bestHits) { bestHits = hits; bestCase = c; }
  });
  if (bestCase && bestHits >= 2) return { cases: [bestCase], note: null };

  return { cases: [], note: null };
}

function caseAiRenderCompact(a, note, otherCases) {
  const c = a.caseObj;
  const topIssues = [...a.issues].sort((x, y) => CASE_AI_LEVEL_ORDER[x.level] - CASE_AI_LEVEL_ORDER[y.level]).slice(0, 3);
  const topNext = a.nextSteps.slice(0, 3);
  const missingDocs = a.checklist.filter(ch => ch.status === 'missed' || ch.status === 'needed');

  return `
    <div class="docai-reply caseai-chat">
      ${note ? `<div class="docai-note"><i class="fa-solid fa-wand-magic-sparkles"></i> ${note}</div>` : ''}
      <div class="caseai-chat-head">
        <span class="caseai-chat-health caseai-health-${caseAiHealthClass(a.health)}">${a.health}</span>
        <div>
          <b>${caseAiEsc(c.caseNumber)} — ${caseAiEsc(c.caseName)}</b>
          <small>${caseAiEsc(a.clientName)} · ${caseAiEsc(a.playbook.label)}</small>
        </div>
      </div>
      <p><i class="fa-solid fa-route"></i> Stage: <b>${caseAiEsc(a.currentStage.label)}</b> (${a.currentIdx + 1} of ${a.stages.length})</p>
      <p><i class="fa-solid fa-calendar-day"></i> ${a.nextHearing ? `Next hearing: <b>${caseAiFmt(a.nextHearing.day)}</b> — ${caseAiEsc(a.nextHearing.hearingName || 'Hearing')}` : 'No next hearing scheduled.'}</p>
      ${topIssues.length ? `<div><b>⚠ Missed / Needs attention:</b><ul class="caseai-chat-list">${topIssues.map(i => `<li class="caseai-issue-${i.level}">${i.text}</li>`).join('')}</ul></div>` : '<p>✅ Nothing missed.</p>'}
      ${topNext.length ? `<div><b>➡ Next steps:</b><ol class="caseai-chat-list">${topNext.map(n => `<li>${n.text}</li>`).join('')}</ol></div>` : ''}
      ${missingDocs.length ? `<div><b>📄 Missing documents:</b> ${missingDocs.map(m => caseAiEsc(m.req.label)).join(', ')}</div>` : ''}
      ${otherCases && otherCases.length ? `<div class="docai-hint">This client has ${caseAiPlural(otherCases.length, 'other case')}: ${otherCases.map(o => `<button type="button" class="docai-link-btn" data-caseai-open="${caseAiEsc(o.id)}">${caseAiEsc(o.caseNumber)}</button>`).join(' ')}</div>` : ''}
      <div class="docai-actions">
        <button type="button" class="docai-view-btn" data-caseai-open="${caseAiEsc(c.id)}"><i class="fa-solid fa-robot"></i> Open Full AI Summary</button>
      </div>
    </div>`;
}

function caseAiRenderPortfolio() {
  const all = getCases()
    .filter(c => !['completed', 'closed'].includes(String(c.status).toLowerCase()))
    .map(c => caseAiAnalyze(c.id))
    .filter(Boolean)
    .sort((a, b) => a.health - b.health);

  if (!all.length) return `<div class="docai-reply"><p>There are no open cases right now.</p></div>`;

  const rows = all.slice(0, 6).map(a => `
    <li>
      <span class="caseai-chat-health caseai-health-${caseAiHealthClass(a.health)}">${a.health}</span>
      <b>${caseAiEsc(a.caseObj.caseNumber)}</b> — ${caseAiEsc(a.clientName)}
      <small>· ${caseAiEsc(a.currentStage.label)} · ${caseAiPlural(a.issues.length, 'issue')}</small>
      <button type="button" class="docai-link-btn" data-caseai-open="${caseAiEsc(a.caseObj.id)}">Open</button>
    </li>`).join('');

  return `<div class="docai-reply caseai-chat">
    <p><i class="fa-solid fa-briefcase"></i> ${caseAiPlural(all.length, 'open case')}. These need attention first:</p>
    <ul class="caseai-portfolio">${rows}</ul>
  </div>`;
}

/**
 * Called by ai-assistant.js BEFORE the document handler.
 * Returns null when the question is not a case-summary question.
 */
function caseAiHandleQuery(rawQuery) {
  const q = caseAiNorm(rawQuery);
  if (!q) return null;

  const hasIntent = CASE_AI_INTENT_WORDS.some(w => caseAiHasPhrase(q, w));
  if (!hasIntent) return null;

  // plain hearing questions ("next hearing ni Santos") stay with the normal hearing logic
  if (/\bhearing\b/.test(q) && !CASE_AI_SUMMARY_WORDS.some(w => caseAiHasPhrase(q, w))) return null;

  // avoid stealing document-movement questions ("who uploaded...", "sino nag-upload...")
  if (/\b(sino|who)\b/.test(q) && /\b(upload|uploaded|delete|deleted|rename|renamed|view|viewed|download|downloaded|binura)\b/.test(q)) return null;

  const found = caseAiFindCaseFromQuery(rawQuery);
  const caseWord = /\b(case|cases|kaso|mga kaso|lahat|all)\b/.test(q);

  if (!found.cases.length) {
    if (caseWord && /\b(lahat|all|mga|cases|portfolio|firm|every)\b/.test(q)) return { html: caseAiRenderPortfolio() };
    if (caseWord) {
      return { html: `<div class="docai-reply"><p>Which case do you mean? Give the <b>case number</b> or the <b>client's name</b>, for example: <i>"summary of Santos case"</i>.</p>
        <p>Or ask: <i>"what was missed in all cases?"</i></p></div>` };
    }
    return null;
  }

  const main = found.cases[0];
  const analysis = caseAiAnalyze(main.id);
  if (!analysis) return null;
  return { html: caseAiRenderCompact(analysis, found.note, found.cases.slice(1, 4)) };
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
// capture phase: close the summary modal BEFORE another modal opens on top
document.addEventListener('click', (e) => {
  const inModal = e.target.closest('#caseAiModalOverlay');
  if (!inModal) return;
  if (e.target.closest('[data-docai-open]') || e.target.closest('[data-caseai-docs]') || e.target.closest('[data-caseai-progress]')) {
    closeModal('caseAiModalOverlay');
  }
}, true);

document.addEventListener('click', (e) => {
  const openBtn = e.target.closest('[data-caseai-open]');
  if (openBtn) {
    e.preventDefault();
    caseAiOpenFromAnywhere(openBtn.dataset.caseaiOpen);
    return;
  }
  const docsBtn = e.target.closest('[data-caseai-docs]');
  if (docsBtn && typeof openDocumentsModal === 'function') {
    openDocumentsModal(docsBtn.dataset.caseaiDocs);
    return;
  }
  const progBtn = e.target.closest('[data-caseai-progress]');
  if (progBtn && typeof openProgressModal === 'function') {
    openProgressModal(progBtn.dataset.caseaiProgress);
  }
});

document.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-caseai-type]');
  if (!sel) return;
  caseAiSaveType(sel.dataset.caseaiType, sel.value);
  caseAiRefreshModal();
});

// keep the summary fresh when the AI finishes scanning a file
window.addEventListener('docai:updated', () => caseAiRefreshModal());