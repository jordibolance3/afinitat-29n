const main = document.querySelector('#main');
const dialog = document.querySelector('#auth-dialog');
const state = { content: null, user: null, quizId: 'curt', answers: {}, weights: {}, step: 0, result: null, resultId: null, resultDate: null, lastAnswers: {}, lastWeights: {}, lastDraftId: null, draftId: null, pendingReuse: null, dirty: false, pendingDraftSave: false, authMode: 'login', busy: false };
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const button = (action, label, classes = '', extra = '') => `<button class="button ${classes}" data-action="${action}" ${extra}>${label}</button>`;
const date = value => new Intl.DateTimeFormat('ca-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const quizzes = () => state.content.quizzes ?? [{id:'curt',name:'Test curt',questionIds:state.content.questions.map(q=>q.id),estimatedMinutes:{min:6,max:8}}];
const activeQuiz = () => quizzes().find(q=>q.id === state.quizId) ?? quizzes()[0];
const questions = () => { const bank=new Map(state.content.questions.map(q=>[q.id,q])); return activeQuiz().questionIds.map(id=>bank.get(id)); };
const partyName = p => p.id === 'psc' ? 'PSOE' : p.shortName;
const currentRoute = () => location.hash.slice(1) || 'inici';
const statusName = party => party.programStatus === 'partial' ? 'Proposta parcial publicada' : party.comparisonBasis === 'reference' ? 'Document de referència' : party.programStatus === 'missing' ? 'Programa no localitzat' : party.programStatus === 'reference' ? 'Programa amb matisos' : 'Programa disponible';
let renderId = 0;
let toastTimer;
// Versió pública estàtica (GitHub Pages): sense servidor ni comptes. El càlcul es fa al navegador
// i l'esborrany es desa només en aquest navegador (localStorage).
const STATIC = document.querySelector('meta[name="afinitat-mode"]')?.content === 'static';
const LOCAL_KEY = 'afinitat-esborrany';
const docHref = (doc, page) => STATIC || !doc.localFile ? (/^https:\/\//.test(doc.url) ? doc.url : '#')
  : `/documents/${encodeURIComponent(doc.id)}${String(doc.localFile).endsWith('.pdf') && page ? `#page=${Number(page)}` : ''}`;
function storeLocal() {
  if (!STATIC || !state.content) return;
  try {
    if (Object.keys(state.answers).length) localStorage.setItem(LOCAL_KEY, JSON.stringify({ quizId: state.quizId, answers: state.answers, weights: state.weights, step: state.step, version: state.content.version, savedAt: new Date().toISOString() }));
    else localStorage.removeItem(LOCAL_KEY);
  } catch { /* Sense emmagatzematge disponible: el test continua funcionant a la pestanya. */ }
}
function loadLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    if (saved?.answers && Object.keys(saved.answers).length) loadSelection(saved.quizId, saved.answers, saved.weights, saved.step);
  } catch { /* Esborrany il·legible: es comença de zero. */ }
}
async function staticApi(route, data) {
  if (route === '/api/content') { const res = await fetch('contingut.json'); if (!res.ok) throw new Error('No s’ha pogut carregar el contingut del test.'); return res.json(); }
  if (route === '/api/me') return { user: null };
  if (route === '/api/results') { const result = window.AfinitatScoring.scoreQuiz(state.content, data.answers, data.weights, data.quizId); result.documents = state.content.documents; return { id: null, result }; }
  throw new Error('Aquesta funció no està disponible a la versió pública.');
}

async function api(route, data, method = data === undefined ? 'GET' : 'POST') {
  if (STATIC) return staticApi(route, data);
  const res = await fetch(route, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  const body = await res.json();
  if (!res.ok) {
    if (res.status === 401 && (route === '/api/results' || route.startsWith('/api/history') || route.startsWith('/api/drafts'))) {
      state.user = null;
      accountNav();
    }
    throw Object.assign(new Error(body.error || 'No s’ha pogut completar l’operació.'), { status: res.status });
  }
  return body;
}
function toast(message) {
  const element = document.querySelector('#toast'); element.textContent = message; element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, 5500);
}
function go(route) { if (currentRoute() === route) render(); else location.hash = route; }
function focusMain() { main.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
function accountNav() {
  document.querySelector('#account-nav').innerHTML = STATIC ? '' : state.user ? `<a class="button subtle" href="#compte">${h(state.user.name)} <span aria-hidden="true">↗</span></a>` : button('auth', 'Inicia sessió <span aria-hidden="true">↗</span>', 'subtle');
}
const unsavedAnswers = () => state.dirty && Object.keys(state.answers).length > 0;
const confirmReplace = () => !unsavedAnswers() || typeof window.confirm !== 'function' || window.confirm('Tens respostes sense desar en el test obert. Si continues, se substituiran. Vols continuar?');
function loadSelection(quizId, answers = {}, weights = {}, step) {
  const quiz = quizzes().find(q => q.id === quizId) ?? quizzes()[0];
  const bank = new Map(state.content.questions.map(q => [q.id, q]));
  const validAnswers = {}; let dropped = 0;
  for (const [id, option] of Object.entries(answers ?? {})) {
    if (quiz.questionIds.includes(id) && bank.get(id)?.options.some(o => o.id === option)) validAnswers[id] = option; else dropped++;
  }
  const validWeights = {};
  for (const [id, weight] of Object.entries(weights ?? {})) if (quiz.questionIds.includes(id) && [1, 2].includes(weight)) validWeights[id] = weight;
  const firstPending = quiz.questionIds.findIndex(id => !validAnswers[id]);
  state.quizId = quiz.id; state.answers = validAnswers; state.weights = validWeights; state.dirty = false; state.pendingReuse = null;
  state.step = Number.isInteger(step) && step >= 0 && step <= quiz.questionIds.length ? step : firstPending === -1 ? quiz.questionIds.length : firstPending;
  return dropped;
}
const droppedNote = dropped => dropped ? ` ${dropped} ${dropped === 1 ? 'resposta ja no és al test actual i no s’ha pogut recuperar' : 'respostes ja no són al test actual i no s’han pogut recuperar'}.` : '';
async function saveDraft() {
  if (!state.user) {
    state.pendingDraftSave = true; authForm();
    toast('Inicia sessió o crea un compte per desar el test. Les respostes es mantenen en aquesta pestanya.'); return;
  }
  state.pendingDraftSave = false;
  const body = { ...(state.draftId ? { id: state.draftId } : {}), quizId: state.quizId, answers: structuredClone(state.answers), weights: structuredClone(state.weights), step: state.step, version: state.content.version };
  try {
    const data = await api('/api/drafts', body);
    state.draftId = data.draft.id; state.dirty = false;
    toast('Test desat. El pots continuar més endavant des de «El teu compte» → Tests pendents.');
    if (currentRoute() === 'test') render();
  } catch (e) {
    if (e.status === 404 && state.draftId) { state.draftId = null; return saveDraft(); }
    if (e.status === 401) { state.pendingDraftSave = true; authForm(); toast('La sessió ja no és vàlida. Inicia sessió per desar el test; les respostes es conserven en aquesta pestanya.'); return; }
    throw e;
  }
}
function hemicycle() {
  let seats = '';
  const colors = ['#a56961', '#b88c76', '#dfbd62', '#a3ad99', '#788b86'];
  for (let row = 0; row < 5; row++) {
    const count = 17 + row * 5;
    for (let i = 0; i < count; i++) {
      const angle = Math.PI + Math.PI * i / (count - 1);
      const radius = 62 + row * 23;
      seats += `<circle cx="${(185 + Math.cos(angle) * radius).toFixed(1)}" cy="${(187 + Math.sin(angle) * radius).toFixed(1)}" r="${row < 2 ? 5.2 : 5.7}" fill="${colors[Math.min(4, Math.floor(i / count * 5))]}" opacity="${.75 + row * .05}"/>`;
    }
  }
  return `<svg class="hemicycle" viewBox="0 0 370 210" role="img" aria-label="Il·lustració abstracta d’un hemicicle; no representa escons ni una previsió electoral">${seats}<text x="185" y="174" text-anchor="middle" font-family="Georgia,serif" font-size="38" fill="#39443f">29N</text><text x="185" y="194" text-anchor="middle" font-family="sans-serif" font-size="8" letter-spacing="2" fill="#68716f">BARCELONA</text></svg>`;
}
function sourceLinks(refs, docs = state.content.documents) {
  return (refs ?? []).map(ref => {
    const doc = docs.find(d => d.id === ref.documentId);
    if (!doc) return '<span>Font pendent de verificació</span>';
    const url = docHref(doc, ref.page);
    return `<a class="source-link" href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(doc.title)}${ref.page ? ` · p. ${h(ref.page)}` : ''} ↗</a>${ref.section ? `<span>${h(ref.section)}</span>` : ''}`;
  }).join('<br>');
}
function home() {
  const electoral = state.content.parties.filter(p => p.comparisonBasis === 'electoral').length;
  const pending = STATIC ? Object.keys(state.answers).length : 0;
  return `<div class="container">
    ${pending ? `<div class="notice info resume-banner"><strong>Tens un test a mitges.</strong> ${h(activeQuiz().name)} · ${pending} ${pending === 1 ? 'resposta' : 'respostes'} desades en aquest navegador. ${button('start','Continua el test →','small',`data-quiz="${h(state.quizId)}"`)}</div>` : ''}
    <section class="hero"><div>
      <div class="eyebrow"><span class="dot"></span> Eleccions generals · Barcelona · 29.11.2026</div>
      <h1>Les teves idees,<br>el teu <em>punt<br>de partida.</em></h1>
      <p class="lead">Quines propostes s’acosten més al que penses? Explora la teva afinitat amb els partits a partir dels seus programes.</p>
      <div class="hero-actions"><button class="button" data-action="choose-tests">Tria el teu test <span aria-hidden="true">↓</span></button><a class="text-button" href="#metode">Coneix el mètode</a></div>
      <p class="microcopy">15, 30, 50 o 100 preguntes · Al teu ritme · Pots començar sense compte</p>
    </div><div class="hero-card"><div class="card-top"><strong>Un espai per formar-te una opinió.</strong><span class="tiny-badge">29N / BCN</span></div>
      ${hemicycle()}<h2>Primer, les propostes.<br>Després, les coincidències.</h2><p>Un test amb fonts obertes i explicacions. Tu decideixes què és important per a tu.</p><div class="card-foot"><span class="mini-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>Perspectives diferents. Criteris transparents.</span></div>
    </div></section>
    <section id="tests" tabindex="-1" aria-labelledby="tests-title"><div class="section-heading"><div><div class="eyebrow">Tu tries fins on explorar</div><h2 id="tests-title">Un test per al teu temps.</h2><p>Mateixes fonts i mateix criteri. Com més preguntes, més mesures per contrastar.</p></div></div><div class="quiz-grid">${quizzes().map((q,i)=>`<article class="quiz-card ${i===1?'featured':''}"><div class="eyebrow">${['Una primera mirada','Més perspectiva','En profunditat','Tot el banc'][i] ?? 'Format addicional'}</div><h3>${h(q.name)}</h3><div class="quiz-count">${q.questionIds.length}<span> preguntes</span></div><p class="quiz-time">${q.estimatedMinutes.min}–${q.estimatedMinutes.max} minuts aproximats</p><p class="quiz-description">${h(q.description || '')}</p>${button('start',`Comença · ${q.questionIds.length} preguntes →`,i===1?'':'light',`data-quiz="${h(q.id)}"`)}</article>`).join('')}</div><p class="microcopy">Estimació orientativa: pots ometre preguntes o consultar el resultat en qualsevol moment. Si canvies de format, et proposarem aprofitar les respostes que ja hagis donat a les mateixes preguntes.</p></section>
    <section><div class="section-heading"><div><div class="eyebrow">De les idees a les fonts</div><h2>Decidir comença per entendre.</h2></div><a href="#programes" class="text-button">Explora els programes ↗</a></div>
    <div class="steps"><div class="step"><h3><span class="step-number">01</span> Tria mesures concretes</h3><p>Habitatge, economia, immigració, serveis públics… Tria la proposta que prioritzaries.</p></div><div class="step"><h3><span class="step-number">02</span> Dona pes al que t’importa</h3><p>Pots destacar un tema o ometre una pregunta. No cal tenir una opinió formada sobre tot.</p></div><div class="step"><h3><span class="step-number">03</span> Entén cada coincidència</h3><p>Consulta els documents i les pàgines que sostenen cada resultat, amb els seus límits visibles.</p></div></div></section>
    <div class="notice"><strong>Una fotografia documental del 16 de novembre, actualitzada el 17.</strong> ${electoral} candidatures tenen una base electoral incorporada al test. Tots els partits comparteixen classificació; cada fitxa identifica el tipus i la data de les fonts. El qüestionari és una primera versió experimental. <a href="#programes">Consulta l’estat de les fonts.</a></div>
  </div>`;
}
// En començar un format, s'ofereix aprofitar les respostes ja donades a les mateixes preguntes
// (en aquesta pestanya o, amb sessió iniciada, en resultats desats i tests pendents).
async function startWithReuse(id) {
  const target = new Set(quizzes().find(q => q.id === id).questionIds);
  const found = {};
  if (state.user) {
    try {
      const previous = await api('/api/previous-answers');
      for (const [qid, a] of Object.entries(previous.answers ?? {})) if (target.has(qid)) found[qid] = { option: a.option, weight: a.weight, source: a.quizName };
    } catch { /* Sense respostes anteriors disponibles: es comença normalment. */ }
  }
  for (const [qid, option] of Object.entries(state.answers)) if (target.has(qid)) found[qid] = { option, weight: state.weights[qid] === 2 ? 2 : 1, source: 'tab' };
  state.quizId = id; state.answers = {}; state.weights = {}; state.step = 0; state.draftId = null; state.dirty = false;
  state.pendingReuse = Object.keys(found).length ? { quizId: id, found } : null;
  return go('test');
}
function reusePrompt() {
  const found = Object.values(state.pendingReuse.found);
  const names = [...new Set(found.map(f => f.source).filter(s => s !== 'tab'))];
  const fromTab = found.some(f => f.source === 'tab');
  const origin = fromTab && names.length ? 'en aquesta pestanya i en tests anteriors' : fromTab ? 'en aquesta pestanya' : `en tests anteriors (${h(names.join(', '))})`;
  return `<section class="test-shell" aria-labelledby="reuse-title"><div class="eyebrow">${h(activeQuiz().name)}</div><h1 id="reuse-title" class="question-title">Vols aprofitar les respostes que ja has donat?</h1>
    <p class="question-context">Ja has respost <strong>${found.length} de les ${questions().length} preguntes</strong> d’aquest test ${origin}. Si les aprofites, començaràs per la primera pregunta pendent i podràs revisar o canviar qualsevol resposta.</p>
    <div class="test-controls">${button('reuse-no','No, comença de zero','light')}${button('reuse-yes','Sí, aprofita-les →')}</div></section>`;
}
function quiz() {
  if (state.pendingReuse) return reusePrompt();
  if (state.step >= questions().length) return review();
  const q = questions()[state.step]; const answered = Object.keys(state.answers).length;
  return `<section class="test-shell" aria-labelledby="question-title"><div class="test-top"><a href="#inici">← Tornar a l’inici</a><span>${h(activeQuiz().name)} <strong>${state.step + 1} / ${questions().length}</strong></span></div><progress value="${state.step + 1}" max="${questions().length}" aria-label="Progrés del test"></progress>
    <div class="question-meta"><span class="topic-chip">${h(q.topic)}</span><span>Pregunta ${String(state.step + 1).padStart(2,'0')}</span></div>
    <h1 id="question-title" class="question-title">${h(q.title)}</h1><p class="question-context">${h(q.context || 'Tria la mesura que prioritzaries. Pots ometre la pregunta si cap opció et representa.')}</p>
    <fieldset class="options"><legend class="sr-only">${h(q.title)}</legend>${q.options.map((o, i) => `<label class="option"><input type="radio" name="answer" value="${h(o.id)}" ${state.answers[q.id] === o.id ? 'checked' : ''}><span class="option-letter">${String.fromCharCode(65 + i)}</span><span class="option-text">${h(o.text)}</span></label>`).join('')}</fieldset>
    <div class="importance"><label><input type="checkbox" id="important" ${state.weights[q.id] === 2 ? 'checked' : ''}> Aquest tema és especialment important per a mi</label><span>Compta el doble</span></div>
    <div class="test-controls">${button('previous', '← Anterior', 'light', state.step === 0 ? 'disabled' : '')}<div class="control-right"><button class="text-button" data-action="skip">Omet la pregunta</button>${button('next', `${state.step === questions().length - 1 ? 'Revisa' : 'Següent'} <span aria-hidden="true">→</span>`, '', state.answers[q.id] ? '' : 'disabled')}</div></div>
    <div class="question-dots" aria-label="Navega entre preguntes">${questions().map((item, i) => `<button class="question-dot ${state.answers[item.id] ? 'done' : ''} ${i === state.step ? 'current' : ''}" data-action="jump" data-index="${i}" aria-label="Pregunta ${i+1}${state.answers[item.id] ? ', resposta' : ', pendent'}" ${i === state.step ? 'aria-current="step"' : ''}>${i+1}</button>`).join('')}</div>
    <div class="draft-actions"><button class="text-button" data-action="review">Revisa i mostra el resultat ara →</button>${STATIC ? '' : button('save-draft','Desa i continua més tard','light small')}</div>
    <details class="source-details"><summary>Origen de les opcions i criteri de lectura</summary><p>Les opcions són síntesis en català, no cites literals. Poden ser compatibles entre si: escull quina prioritzaries. Les puntuacions són interpretacions editorials documentades.</p><ol type="A">${q.options.map(o=>`<li>${sourceLinks(o.sourceRefs)}</li>`).join('')}</ol></details>
    <p class="microcopy"><span id="response-count">${answered}</span> respostes · ${STATIC ? 'Les respostes es desen automàticament en aquest navegador i no s’envien enlloc.' : state.draftId ? (state.dirty ? 'Hi ha canvis sense desar. Torna a desar el test per guardar-los.' : 'Test pendent desat al teu compte.') : state.user ? 'Esborrany en aquesta pestanya. Desa’l per continuar-lo més endavant des del teu compte.' : 'Mode convidat: cap resposta desada al disc. Inicia sessió per desar el test i continuar-lo més endavant.'}</p>
  </section>`;
}
function review() {
  const count = Object.keys(state.answers).length;
  return `<section class="test-shell"><div class="eyebrow">Un últim cop d’ull</div><h1 class="question-title">Aquestes són les teves prioritats.</h1><p class="question-context">Has respost ${count} de ${questions().length} preguntes. Les omeses no afecten el resultat. Pots canviar qualsevol resposta.</p>
    <div class="review-grid">${questions().map((q,i)=>`<div class="review-item"><div><strong>${i+1}. ${h(q.topic)}${state.weights[q.id] === 2 && state.answers[q.id] ? ' · doble pes' : ''}</strong><p>${h(q.options.find(o=>o.id === state.answers[q.id])?.text || 'Pregunta omesa')}</p></div><button class="text-button" data-action="jump" data-index="${i}">Canvia</button></div>`).join('')}</div>
    ${STATIC ? '<div class="notice info">Les teves respostes no surten d’aquest navegador: el resultat es calcula aquí mateix.</div>' : state.user ? `<label class="save-choice"><input type="checkbox" id="save-result" checked> Guarda aquestes respostes i el resultat al meu historial.</label>` : `<div class="notice info">Pots veure el resultat sense compte. <button class="text-button" data-action="auth">Inicia sessió o registra’t</button> si vols guardar-lo.</div>`}
    ${count === 0 ? '<p class="small-note">Encara no has respost cap pregunta. Pots consultar les fonts; no hi haurà percentatges fins que hi hagi alguna resposta comparable.</p>' : ''}<div id="result-error" role="alert"></div>
    <div class="test-controls">${button('previous','← Torna al test','light')}<div class="control-right">${STATIC ? '' : button('save-draft','Desa i continua més tard','light')}${button('calculate','Descobreix les coincidències →')}</div></div>
  </section>`;
}
// Escala 2 (des de 2026-11-17.3): 0,25 = mesura diferent però compatible; 0 = oposició documentada.
// Els resultats calculats abans conserven l'etiqueta neutra «Mesura diferent» per al 0.
function matchBadge(similarity, scaleVersion = 1) {
  // Escala 4 (des de 2026-11-21.5): 0 = compatible, −1 = oposada. Escala 3: −0,5 = oposada. Escala 2: 0,25 = compatible, 0 = oposada. Escala 1: 0 = diferent.
  const [cls, label] = similarity === 1 ? ['', 'Coincidència'] : similarity === .5 ? ['partial', 'Coincidència parcial']
    : similarity < 0 ? ['opposed', 'Mesura oposada']
    : scaleVersion >= 3 ? ['compatible', 'Mesura compatible']
    : similarity === .25 ? ['compatible', 'Mesura compatible'] : scaleVersion >= 2 ? ['opposed', 'Mesura oposada'] : ['different', 'Mesura diferent'];
  return `<span class="match-badge ${cls}">${label}`;
}
// No es mostren percentatges negatius (decisió de l'usuari, 21-11-2026).
const pct = score => `${Math.max(0, score)}`;
const rankKey = p => p.score === null || p.score === undefined ? -1e9 : (p.rawScore ?? p.score);
const LOW_COVERAGE = 50;
function partyResult(p, result) {
  const max = result.answeredCount;
  const low = p.score !== null && p.coverage < LOW_COVERAGE;
  return `<article class="party-result"><div class="party-result-head"><div><h3>${h(partyName(p))}</h3><p>${h(p.name)}</p></div><div class="party-score"><div class="party-percent${p.score !== null && p.score < 0 ? ' negative' : ''}">${p.score === null ? '—' : `${pct(p.score)}<small>%</small>`}</div>${p.score !== null ? `<span class="coverage-pill${low ? ' low' : ''}">Cobertura ${p.coverage}%</span>` : ''}</div></div>
    ${p.score !== null ? `<progress value="${Math.max(0, p.score)}" max="100" aria-label="Índex d’afinitat amb ${h(partyName(p))}: ${pct(p.score)}%"></progress>` : ''}
    <div class="coverage-line"><span>${p.score === null ? (p.details.length ? 'Només mesures compatibles: cap coincidència ni oposició per calcular l’índex' : 'Sense posició documentada per a les teves respostes') : `${p.knownCount} de ${max} respostes comparables`}</span><span>${(() => { if (p.score === null && !p.details.length) return ''; const compat = result.scaleVersion >= 3 && result.compatibleWeight === 0 ? p.details.filter(d => d.similarity === 0).length : 0; const none = max - p.knownCount; return compat ? `${compat} ${compat === 1 ? 'compatible (no suma ni resta)' : 'compatibles (no sumen ni resten)'} · ${none} sense posició` : `${none} sense posició documentada`; })()}</span></div>
    ${low ? `<p class="coverage-warning">Comparació amb menys de la meitat de les teves respostes: l’índex es basa en poques mesures i és menys sòlid.</p>` : ''}
    ${p.note ? `<p class="microcopy">${h(p.note)}</p>` : ''}
    ${p.score === null ? `<div class="program-links">${(p.documentIds ?? []).map(id=>{const doc=(result.documents || state.content.documents).find(d=>d.id===id);return doc && (doc.localFile || STATIC) ? `<a href="${h(docHref(doc))}" target="_blank" rel="noopener noreferrer">Llegeix ${h(doc.title)} ↗</a>` : '';}).join('')}<a href="#programes">Consulta la fitxa i l’estat de les fonts ↗</a></div>` : ''}
    ${p.details.length ? `<details><summary>Per què aquest resultat? · ${p.details.length} ${p.details.length === 1 ? 'comparació' : 'comparacions'}</summary>${p.details.map(detail=>`<div class="match-detail"><h4>${h(detail.questionTitle)}</h4>${matchBadge(detail.similarity, result.scaleVersion)}${detail.weight === 2 ? ' · doble pes' : ''}</span><p><strong>Has prioritzat:</strong> ${h(detail.selectedText)}</p><p>${h(detail.rationale)}</p>${sourceLinks(detail.sourceRefs,result.documents || state.content.documents)}</div>`).join('')}</details>` : ''}
  </article>`;
}
// Exportar el resultat: resum de text per compartir i versió per imprimir o desar en PDF.
const PUBLIC_URL = 'https://jordibolance3.github.io/afinitat-29n/';
const rankParties = r => [...r.parties].sort((a,b)=>rankKey(b)-rankKey(a) || partyName(a).localeCompare(partyName(b),'ca'));
function resultSummary(r) {
  const parties = rankParties(r).filter(p => Number.isFinite(p.score)).map(p => `${partyName(p)} ${pct(p.score)}%`).join(' · ');
  return `Afinitat 29N · ${r.quizName ?? 'Test curt'} (${r.answeredCount}/${r.totalQuestions ?? 15} respostes): ${parties || 'sense comparacions documentades'}. Fes el test: ${PUBLIC_URL}`;
}
function results() {
  if (!state.result) return `<div class="container"><div class="page-head"><h1>El teu resultat comença amb les teves idees.</h1><p>Completa el test per explorar les coincidències.</p></div>${button('start','Comença el test →')}</div>`;
  const r = state.result;
  const ranked = rankParties(r);
  const leaders = ranked.filter(p=>Number.isFinite(p.score) && rankKey(p) === rankKey(ranked[0]));
  return `<div class="container"><div class="print-only print-header"><strong>Afinitat 29N</strong> · ${h(r.quizName ?? 'Test curt')} · ${r.answeredCount}/${r.totalQuestions ?? 15} respostes · ${h(date(state.resultDate ?? Date.now()))} · Versió ${h(r.version)}<br>${h(PUBLIC_URL)}</div><div class="page-head"><div class="eyebrow"><span class="dot"></span> El teu mapa de coincidències</div><h1>Les respostes, amb perspectiva.</h1><p>${state.resultId ? `Resultat desat${state.resultDate ? ` · ${h(date(state.resultDate))}` : ''}` : 'Resultat de la sessió · encara no desat'} · ${h(r.quizName ?? 'Test curt')} · Versió ${h(r.version)}</p></div>
    ${r.version !== state.content.version ? `<div class="notice info">Aquest resultat es va calcular amb una versió anterior. Pots aplicar les fonts i els criteris actuals a les mateixes respostes. ${button('recalculate','Actualitza el resultat','light small')}</div>` : ''}
    <section class="result-hero"><div><div class="eyebrow">${leaders.length > 1 ? 'Índex d’afinitat més alt, compartit' : 'Índex d’afinitat més alt'}</div><h2>${leaders.length ? h(leaders.map(p=>partyName(p)).join(' · ')) : 'Encara no hi ha respostes comparables.'}</h2><p>${leaders.length ? `Amb les respostes comparables, ${leaders.length > 1 ? 'aquestes candidatures comparteixen' : 'aquesta candidatura té'} la puntuació més alta. Mira la cobertura i les explicacions abans de treure conclusions.` : 'Encara no hi ha coincidències documentades amb les respostes triades. Pots consultar la informació i les fonts de cada candidatura a continuació.'}</p></div><div class="result-numbers"><div><strong>${leaders.length ? pct(leaders[0].score) + '%' : '—'}</strong><span>índex d’afinitat més alt</span></div><div><strong>${r.answeredCount}<small>/${r.totalQuestions ?? 15}</small></strong><span>preguntes respostes</span></div></div></section>
    <div class="results-layout"><div><div class="section-heading"><div><h2>Afinitat amb els partits</h2><p>Tots els partits, ordenats per índex d’afinitat: les coincidències sumen, les mesures compatibles no compten i les oposades resten. Mira la cobertura de cada fitxa: indica amb quantes de les teves respostes s’ha pogut comparar. Els partits sense dades comparables apareixen al final.</p></div></div><div class="ranking">${ranked.map(p=>partyResult(p,r)).join('')}</div></div>
    <aside class="result-aside"><div class="aside-card"><h3>L’índex té context.</h3><ol><li>Va de 0% a 100% (coincidència en totes les teves respostes que compten). Si les oposicions pesen tant o més que les coincidències, l’índex és 0%. No mesura tot el programa.</li><li>La cobertura indica quina part de les teves respostes s’ha pogut contrastar.</li><li>La puntuació és una interpretació editorial. Cada font es pot consultar.</li></ol><a class="text-button" href="#metode">Llegeix la metodologia ↗</a></div><div class="aside-card no-print"><h3>Guarda o comparteix.</h3><p>Desa el resultat en PDF (amb les explicacions desplegades) o copia un resum per enviar-lo.</p>${button('print-result','Desa en PDF o imprimeix','small')}${button('copy-summary','Copia el resum','light small')}</div><div class="aside-card no-print"><h3>Continua explorant.</h3><p>Pots tornar al test i canviar prioritats, o llegir els programes pel teu compte.</p>${button('resume-result', r.answeredCount < (r.totalQuestions ?? 15) ? 'Continua aquest test →' : 'Edita les respostes →', 'small')}${button('restart','Torna a fer el test des de zero','light small')}${STATIC ? '' : !state.resultId ? button(state.user ? 'save-last' : 'auth', state.user ? 'Guarda el resultat' : 'Inicia sessió per guardar-lo', 'light small') : '<a class="button light small" href="#compte">Consulta l’historial</a>'}<a href="#programes" class="text-button">Consulta els programes</a></div></aside></div>
  </div>`;
}
const ofName = name => /^[aeiouàèéíïòóúüh]/i.test(name) ? `d’${name}` : `de ${name}`;
const partyLogo = p => /^[a-z0-9-]+\.(svg|png|webp)$/.test(p.logo ?? '')
  ? `<div class="program-avatar has-logo${p.logoBackground === 'dark' ? ' dark' : ''}"><img src="logos/${h(p.logo)}" alt="Logotip ${h(ofName(partyName(p)))}" width="56" height="56" loading="lazy" decoding="async"></div>`
  : `<div class="program-avatar" aria-hidden="true">${h(partyName(p).slice(0,5))}</div>`;
function programCards(filter = '') {
  const needle = filter.toLocaleLowerCase('ca');
  const parties = state.content.parties.filter(p => `${p.name} ${p.shortName} ${partyName(p)}`.toLocaleLowerCase('ca').includes(needle)).sort((a, b) => partyName(a).localeCompare(partyName(b), 'ca', { sensitivity: 'base' }));
  return parties.map(p => `<article class="program-card">${partyLogo(p)}<h2>${h(partyName(p))}</h2><p class="full-name">${h(p.name)}</p><span class="status ${p.programStatus === 'missing' ? 'missing' : p.comparisonBasis === 'reference' || p.programStatus === 'reference' ? 'reference' : ''}">${statusName(p)}</span><p class="program-note">${h(p.note || '')}</p><div class="program-links">${(p.documentIds ?? []).map(id=>{const d=state.content.documents.find(doc=>doc.id===id);return d ? `${d.localFile && !STATIC ? `<a href="/documents/${encodeURIComponent(id)}" target="_blank" rel="noopener">Llegeix ${h(d.title)} ↗</a>` : ''}${/^https:\/\//.test(d.url) ? `<a href="${h(d.url)}" target="_blank" rel="noopener noreferrer">${STATIC ? `Llegeix ${h(d.title)} ↗` : 'Consulta la font d’origen ↗'}</a>` : ''}` : '';}).join('')}${!(p.documentIds ?? []).length ? '<span class="microcopy">No s’assignen posicions sense un document.</span>' : ''}</div></article>`).join('') || '<p class="empty-state">No hi ha coincidències amb aquesta cerca.</p>';
}
function programs() {
  return `<div class="container"><div class="page-head"><div class="eyebrow">La base de cada comparació</div><h1>Els programes, a la vista.</h1><p>Totes les candidatures proclamades al Congrés per Barcelona i les fonts que hem pogut comprovar. Revisió documental: <strong>16 de novembre de 2026, actualitzada el 17 de novembre.</strong></p></div><div class="notice"><strong>Publicat, de referència o no localitzat.</strong> Aquestes categories tenen significats diferents. No trobar un programa no demostra que no existeixi. No s’atribueixen als partits les propostes que no podem documentar. ${STATIC ? '' : '<a href="/documents/inventari" target="_blank" rel="noopener">Llegeix l’informe complet de fonts ↗</a>'}</div><div class="toolbar"><label class="sr-only" for="party-search">Cerca un partit</label><input class="search-field" type="search" id="party-search" placeholder="Cerca un partit…"><span id="party-count">${state.content.parties.length} candidatures · circumscripció de Barcelona</span></div><div class="program-grid" id="program-grid">${programCards()}</div><div class="notice info spaced"><strong>Quina llista s’ha utilitzat?</strong> La proclamació del BOE del 3 de novembre i la correcció del 7 de novembre. PACMA i Por un Mundo Más Justo hi consten com a no proclamades a Barcelona; no formen part del test. <a href="https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-23103" target="_blank" rel="noopener noreferrer">Consulta el BOE ↗</a></div></div>`;
}
function method() {
  return `<div class="container article"><div class="page-head"><div class="eyebrow">Un mètode que pots examinar</div><h1>Les fonts són el punt de partida.</h1><p>Afinitat compara mesures, mostra què sap i fa explícit què queda per documentar.</p></div>
  <h2>1. Preguntes sobre mesures reals</h2><p>Pots triar entre el test curt de 15 preguntes (6–8 minuts), l’ampliat de 30 (12–15 minuts), el complet de 50 (20–25 minuts) i l’extens de 100 (40–50 minuts). Cada format inclou totes les preguntes de l’anterior; si ja n’has respost algunes, abans de començar et proposarem aprofitar-les. Comparteixen un banc de preguntes amb entre 2 i 5 opcions. Les opcions són síntesis en català de propostes identificades als documents, amb la pàgina o apartat d’origen. No són cites literals. Diverses mesures poden ser compatibles: se’t demana quina prioritzaries.</p>
  ${state.content.topicAnalysis ? `<h3>Com hem seleccionat els temes?</h3><p>${h(state.content.topicAnalysis.method)}</p><div class="theme-list">${state.content.topicAnalysis.topics.map(t=>`<details><summary>${h(t.name)} <span>${t.partyIds.length} candidatures · ${t.questionIds.length} preguntes</span></summary><p>${t.partyIds.map(id=>h(partyName(state.content.parties.find(p=>p.id===id)))).join(' · ')}</p>${t.evidence.map(e=>`<div class="theme-evidence"><strong>${h(partyName(state.content.parties.find(p=>p.id===e.partyId)))}</strong> ${sourceLinks(e.sourceRefs)}</div>`).join('')}</details>`).join('')}</div>` : ''}
  <h2>2. Una valoració editorial visible</h2><p>Per a cada partit amb una posició documentada, interpretem la relació entre la mesura que has triat i la seva proposta:</p><ul><li><strong>1:</strong> coincidència directa amb la mesura central.</li><li><strong>0,5:</strong> coincidència parcial.</li><li><strong>0:</strong> una mesura diferent però compatible amb la teva: podrien conviure. No suma ni resta i queda fora del càlcul, perquè no sabem si el partit hi està d’acord. Es mostra a l’explicació.</li><li><strong>−1:</strong> una mesura oposada. Resta tant com suma una coincidència. Només quan la font la rebutja, en demana la derogació o proposa una alternativa que l’exclou.</li><li><strong>Sense dades:</strong> no es puntua ni entra al denominador.</li></ul><p>Les explicacions dels resultats mostren la justificació de cada valoració. Aquesta primera versió és experimental i necessita revisió editorial humana per detectar biaixos o matisos perduts en la síntesi.</p>
  <h2>3. El càlcul i la cobertura</h2><div class="formula">Índex d’afinitat = 100 × suma de valors ponderats / suma de pesos comparables (les mesures compatibles en queden fora, com les preguntes sense posició).</div><p>L’índex va de 0% a 100%. Quan les mesures oposades pesen tant o més que les coincidències, es mostra 0%; els partits que hi queden s’ordenen pel balanç real. Un tema normal pesa 1 i un tema destacat pesa 2, també quan resta. Ometre una pregunta no penalitza ningú. Pots consultar els resultats amb qualsevol nombre de respostes. Una sola comparació documentada permet mostrar el percentatge i entrar a l’ordenació principal, sense llindar de cobertura. Si no hi ha cap comparació, es mostren la informació i les fonts disponibles sense inventar un percentatge. En cas d’empat, les candidatures comparteixen resultat.</p><p>La cobertura és el nombre de respostes que podem comparar amb el partit dividit pel nombre que has contestat. Un 90% amb poca cobertura i un 80% amb cobertura completa no són equivalents. El percentatge no és una probabilitat de vot ni una valoració del compliment de les promeses.</p>
  <h2>4. Programes i documents relacionats</h2><p>Les referències polítiques generals, els programes d’altres eleccions, els esborranys i els programes d’una formació vinculada no es presenten com a programes propis confirmats. Tots els partits s’ordenen junts per afinitat, independentment del tipus de document. Cada document té una nota de procedència, i les absències continuen visibles al catàleg.</p><p>Per a PSOE (candidatura PSC–PSOE a Barcelona), el comparador utilitza el programa electoral estatal del PSOE com a programa del PSC i l’inclou en l’ordenació principal. Les cites conserven l’autoria del document original.</p><p>La llista és la de candidatures al Congrés per Barcelona, no la del Senat. Els programes, les interpretacions i els resultats tenen versió: el teu historial conserva la puntuació que vas obtenir en aquell moment i es mostra amb la mateixa classificació unificada.</p>
  <h2>5. Les teves dades</h2>${STATIC ? `<p>Aquesta és la versió pública. No té comptes ni servidor: el càlcul es fa al teu dispositiu i les respostes es guarden només en aquest navegador, perquè puguis continuar el test més tard. No s’envien enlloc i ningú, ni tan sols qui ha publicat la pàgina, les pot veure. Per esborrar-les, torna a fer el test des de zero o esborra les dades d’aquest lloc al navegador. No hi ha analítica.</p>` : `<p>Pots fer el test sense compte: les respostes es mantenen només a la memòria de la pestanya i el servidor les utilitza per calcular el resultat, sense desar-les. En tancar o recarregar la pàgina es perd aquest esborrany. Amb compte, pots prémer «Desa i continua més tard» per guardar un test a mitges i reprendre’l des de «Tests pendents».</p><p>Si et registres, et demanem pseudònim, nom a mostrar, contrasenya i consentiment per guardar respostes i afinitats polítiques. Pots decidir no guardar un test, eliminar els tests pendents, exportar les dades del teu compte o esborrar-lo amb el seu historial. No hi ha analítica ni peticions a serveis externs durant el test.</p><p>La base JSON és a «Base de dades», al teu ordinador. Les contrasenyes es deriven amb scrypt; les respostes i els resultats són llegibles en el JSON per qui tingui accés a aquesta carpeta. Com que el projecte és dins de OneDrive, la seva sincronització depèn de la configuració de OneDrive. Aquesta versió escolta només a 127.0.0.1.</p>`}<a class="button" href="#programes">Consulta totes les fonts ↗</a></div>`;
}
async function account(id) {
  if (!state.user) return `<div class="container"><div class="page-head"><h1>Les teves idees, al llarg del temps.</h1><p>Inicia sessió per consultar els resultats que has guardat.</p></div>${button('auth','Inicia sessió →')}</div>`;
  const [data, pending] = await Promise.all([api('/api/history'), api('/api/drafts').catch(e => { if (e.status === 401) throw e; return { drafts: [], error: e.message }; })]);
  if (id !== renderId) return null;
  const pendingRow = d => `<article class="history-row"><div><strong>${h(d.quizName)} · ${d.answeredCount}/${d.totalQuestions} respostes</strong><p>Desat ${h(date(d.updatedAt))} · Pregunta ${Math.min(d.step + 1, d.totalQuestions)} de ${d.totalQuestions}</p>${d.contentVersion !== state.content.version ? `<p class="small-note">Desat amb la versió ${h(d.contentVersion)}. Es recuperaran les respostes que encara formin part del test.</p>` : ''}</div><div class="row-actions">${button('resume-draft','Continua el test →','small',`data-id="${h(d.id)}"`)}<button class="text-button" data-action="delete-draft" data-id="${h(d.id)}">Elimina</button></div></article>`;
  const pendingPanel = `<section class="account-panel pending-panel"><h2>Tests pendents</h2><p class="small-note">Tests que has desat a mitges. Continua’ls on els vas deixar.</p>${pending.error ? `<p class="error-box">${h(pending.error)}</p>` : pending.drafts.length ? pending.drafts.map(pendingRow).join('') : '<p class="small-note">No tens cap test pendent. Mentre fas un test, prem «Desa i continua més tard».</p>'}</section>`;
  return `<div class="container"><div class="page-head"><div class="eyebrow">El teu espai personal</div><h1>Hola, ${h(state.user.name)}.</h1><p>Consulta els teus tests i decideix quines dades vols conservar.</p></div>${pendingPanel}<div class="account-grid"><section class="account-panel"><h2>El teu historial</h2>${data.attempts.length ? data.attempts.map(a=>`<article class="history-row"><div><strong>${h(date(a.createdAt))}</strong><p>${h(a.quizName ?? 'Test curt')} · ${a.answeredCount}/${a.totalQuestions ?? 15} respostes · Versió ${h(a.contentVersion)}</p><p>${a.leaders.length ? a.leaders.map(p=>`${h(partyName(p))} ${p.score}%`).join(' · ') : 'Sense comparacions documentades'}</p></div><div class="row-actions"><button class="text-button" data-action="open-result" data-id="${h(a.id)}">Consulta ↗</button><button class="text-button" data-action="resume-attempt" data-id="${h(a.id)}">${a.answeredCount < (a.totalQuestions ?? 15) ? 'Continua' : 'Edita'} les respostes</button></div></article>`).join('') : '<p class="small-note">Encara no has guardat cap test. El primer serà el teu punt de partida.</p>'}${button('restart','Fes un nou test →','small')}</section><section class="account-panel"><h2>Tu controles les dades.</h2><p class="small-note">Usuari: <strong>${h(state.user.username)}</strong><br>Consentiment registrat: ${h(date(state.user.consentAt))}</p><a class="button light small" href="/api/account/export" download>Exporta les meves dades ↓</a><p class="small-note">Un JSON amb el teu compte, les respostes, els resultats i els tests pendents. Sense la contrasenya ni les sessions.</p>${button('logout','Tanca la sessió','subtle small')}<details class="danger-zone"><summary>Esborra el compte i l’historial</summary><p>S’eliminaran el compte, totes les respostes, els resultats i les sessions. Aquesta acció no es pot desfer.</p><form id="delete-form"><label class="field">Confirma la contrasenya<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label><div class="form-error" role="alert"></div><button class="button danger small" type="submit">Esborra definitivament el compte</button></form></details></section></div></div>`;
}
async function render() {
  if (!state.content) return;
  storeLocal();
  const id = ++renderId; const route = currentRoute();
  accountNav();
  document.querySelectorAll('[data-nav]').forEach(el=> { if(el.dataset.nav === route) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current'); });
  try {
    let html;
    switch(route) {
      case 'test': html=quiz(); break;
      case 'resultats': html=results(); break;
      case 'programes': html=programs(); break;
      case 'metode': html=method(); break;
      case 'compte': main.innerHTML='<div class="loading">Carregant el teu historial…</div>'; html=await account(id); break;
      default: html=home();
    }
    if(id !== renderId || html === null) return;
    main.innerHTML=html; focusMain();
  } catch(e) {
    if(id !== renderId)return;
    if(e.status === 401 && route === 'compte') {
      main.innerHTML=await account(id);focusMain();
      toast('La sessió ja no és vàlida. Torna a iniciar-la; les respostes del test es conserven en aquesta pestanya.');
    } else main.innerHTML=`<div class="container"><div class="page-head"><h1>No s’ha pogut carregar.</h1><p class="error-box">${h(e.message)}</p><a href="#inici">Torna a l’inici</a></div></div>`;
  }
}
function authForm(mode='login') {
  state.authMode=mode;
  const signup=mode==='register';
  document.querySelector('#auth-content').innerHTML=`<div class="dialog-header"><h2 id="auth-title">${signup ? 'Crea el teu espai.' : 'Benvingut de nou.'}</h2><button class="close-button" data-action="close-auth" aria-label="Tanca">×</button></div><p class="auth-subtitle">${signup ? 'Un compte local per guardar i comparar els teus resultats.' : 'Recupera els teus resultats i continua explorant.'}</p><form id="auth-form">${signup ? '<label class="field">Nom a mostrar<input name="name" autocomplete="nickname" required maxlength="60" placeholder="Com vols que et diguem?"></label>' : ''}<label class="field">Nom d’usuari<input name="username" autocomplete="username" required minlength="3" maxlength="40" placeholder="El teu pseudònim"><small>Lletres sense accents, números, punts o guions. No cal correu.</small></label><label class="field">Contrasenya<input type="password" name="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required ${signup ? 'minlength="10"' : ''} maxlength="128">${signup ? '<small>Com a mínim 10 caràcters. No hi ha recuperació per correu en aquesta versió local.</small>' : ''}</label>${signup ? '<label class="consent"><input type="checkbox" name="consent" required><span>Consento explícitament que aquesta aplicació guardi les meves respostes i afinitats polítiques associades al compte. Puc exportar-les i esborrar-les. La base és a la carpeta local del projecte, que pot sincronitzar-se amb OneDrive.</span></label>' : ''}<div class="form-error" role="alert"></div><button class="button auth-submit" type="submit">${signup ? 'Crea el compte' : 'Inicia sessió'} →</button></form><div class="dialog-switch">${signup ? 'Ja tens un compte?' : 'És el primer cop?'} <button class="text-button" data-action="${signup ? 'show-login' : 'show-register'}">${signup ? 'Inicia sessió' : 'Crea un compte'}</button></div>`;
  if(!dialog.open) dialog.showModal();
  dialog.querySelector('input')?.focus();
}
function setResult(data, answers=state.answers, weights=state.weights) {
  state.result=data.result;state.resultId=data.id;state.resultDate=data.createdAt;
  state.lastAnswers=structuredClone(answers);state.lastWeights=structuredClone(weights);
}
document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action]');if(!el || el.disabled)return;
  const action=el.dataset.action;
  if(action==='skip-content'){event.preventDefault();return focusMain();}
  if(action==='auth')return authForm();
  if(action==='close-auth'){state.pendingDraftSave=false;return dialog.close();}
  if(action==='show-login')return authForm('login');
  if(action==='show-register')return authForm('register');
  if(action==='print-result'){
    // S'obren totes les explicacions perquè surtin al PDF; després de imprimir es tornen a plegar.
    const closed=[...document.querySelectorAll('#main details:not([open])')];closed.forEach(d=>{d.open=true;});
    window.addEventListener('afterprint',()=>closed.forEach(d=>{d.open=false;}),{once:true});
    return window.print();
  }
  if(action==='copy-summary'){
    if(!state.result)return;
    const text=resultSummary(state.result);
    let ok=false;
    try{await navigator.clipboard.writeText(text);ok=true;}
    catch{
      // Alternativa per a navegadors que no deixen fer servir l'API del porta-retalls.
      try{const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();ok=document.execCommand('copy');area.remove();}catch{ok=false;}
    }
    toast(ok?'Resum copiat. Ja el pots enganxar on vulguis.':`No s’ha pogut copiar automàticament. Resum: ${text}`);
    return;
  }
  if(action==='choose-tests'){document.querySelector('#tests')?.scrollIntoView({behavior:'smooth'});document.querySelector('#tests')?.focus({preventScroll:true});return;}
  if(action==='start'){const id=el.dataset.quiz ?? state.quizId;if(!quizzes().some(q=>q.id===id))return;if(id===state.quizId&&Object.keys(state.answers).length){state.pendingReuse=null;if(state.step>=questions().length)state.step=0;return go('test');}return startWithReuse(id);}
  if(action==='reuse-yes'){const r=state.pendingReuse;if(!r)return;const answers={},weights={};for(const [id,f] of Object.entries(r.found)){answers[id]=f.option;if(f.weight===2)weights[id]=2;}loadSelection(r.quizId,answers,weights);state.dirty=Object.values(r.found).some(f=>f.source==='tab');go('test');return toast(`S’han recuperat ${Object.keys(answers).length} respostes. Pots revisar-les i canviar-les quan vulguis.`);}
  if(action==='reuse-no'){state.pendingReuse=null;state.step=0;return render();}
  if(action==='restart'){if(!confirmReplace())return;if(currentRoute()==='resultats')state.quizId=state.result?.quizId ?? 'curt';state.answers={};state.weights={};state.step=0;state.draftId=null;state.dirty=false;return go('test');}
  if(action==='resume-result'){if(!state.result||!confirmReplace())return;const dropped=loadSelection(state.result.quizId ?? 'curt',state.lastAnswers,state.lastWeights);state.draftId=null;go('test');return toast(`Respostes recuperades. Si guardes el resultat, se’n crearà un de nou i l’original es conservarà.${droppedNote(dropped)}`);}
  if(action==='jump'){state.step=Number(el.dataset.index);return go('test');}
  if(action==='review'){state.step=questions().length;return go('test');}
  if(action==='previous'){state.step=Math.max(0,state.step-1);return render();}
  if(action==='next'){if(!state.answers[questions()[state.step].id])return;state.step++;return render();}
  if(action==='skip'){if(state.answers[questions()[state.step].id])state.dirty=true;delete state.answers[questions()[state.step].id];delete state.weights[questions()[state.step].id];state.step++;return render();}
  if(state.busy)return;state.busy=true;el.disabled=true;
  try{
    if(action==='calculate'){
      const save=Boolean(document.querySelector('#save-result')?.checked);
      const answers=structuredClone(state.answers);const weights=structuredClone(state.weights);const quizId=state.quizId;const draftId=state.draftId;
      let data;
      try {
        data=await api('/api/results',{answers,weights,quizId,version:state.content.version,save,...(save&&draftId?{draftId}:{})});
      } catch(e) {
        if(e.status !== 401 || !save)throw e;
        data=await api('/api/results',{answers,weights,quizId,version:state.content.version,save:false});
        toast('El resultat no s’ha desat perquè la sessió ja no és vàlida. Inicia sessió per guardar-lo; les respostes es conserven en aquesta pestanya.');
      }
      setResult(data,answers,weights);state.lastDraftId=data.id?null:draftId;
      if(data.id&&draftId&&state.draftId===draftId){state.draftId=null;state.dirty=false;}
      go('resultats');
    }else if(action==='save-draft'){
      await saveDraft();
    }else if(action==='resume-draft'||action==='resume-attempt'){
      if(!confirmReplace())return;
      if(action==='resume-draft'){
        const draft=await api(`/api/drafts/${encodeURIComponent(el.dataset.id)}`);
        const dropped=loadSelection(draft.quizId,draft.answers,draft.weights,draft.step);state.draftId=draft.id;
        go('test');toast(`Has recuperat el test on el vas deixar.${droppedNote(dropped)}`);
      }else{
        const attempt=await api(`/api/history/${encodeURIComponent(el.dataset.id)}`);
        const dropped=loadSelection(attempt.result?.quizId ?? attempt.quizId ?? 'curt',attempt.answers,attempt.weights);state.draftId=null;
        go('test');toast(`Respostes recuperades. Si guardes el resultat, se’n crearà un de nou i l’original es conservarà.${droppedNote(dropped)}`);
      }
    }else if(action==='delete-draft'){
      if(typeof window.confirm==='function'&&!window.confirm('Vols eliminar aquest test pendent? Aquesta acció no es pot desfer.'))return;
      await api(`/api/drafts/${encodeURIComponent(el.dataset.id)}/delete`,{});
      if(state.draftId===el.dataset.id){state.draftId=null;state.dirty=true;}
      await render();toast('Test pendent eliminat.');
    }else if(action==='recalculate'){
      const answers=structuredClone(state.lastAnswers);const weights=structuredClone(state.lastWeights);
      const data=await api('/api/results',{answers,weights,quizId:state.result.quizId ?? 'curt',version:state.content.version,save:false});
      setResult(data,answers,weights);await render();toast('Resultat actualitzat amb les mateixes respostes. El pots guardar al teu historial.');
    }else if(action==='save-last'){
      const draftId=state.lastDraftId;const data=await api('/api/results',{answers:state.lastAnswers,weights:state.lastWeights,quizId:state.result.quizId ?? 'curt',version:state.result.version,save:true,...(draftId?{draftId}:{})});setResult(data,state.lastAnswers,state.lastWeights);state.lastDraftId=null;if(draftId&&state.draftId===draftId)state.draftId=null;render();toast('Resultat desat al teu historial.');
    }else if(action==='logout'){
      await api('/api/logout',{});state.user=null;state.result=null;state.resultId=null;state.answers={};state.weights={};state.step=0;state.draftId=null;state.lastDraftId=null;state.dirty=false;go('inici');toast('Has tancat la sessió.');
    }else if(action==='open-result'){
      const data=await api(`/api/history/${encodeURIComponent(el.dataset.id)}`);setResult(data,data.answers,data.weights);go('resultats');
    }
  }catch(e){
    if(e.status === 401 && ['save-last','open-result','resume-draft','resume-attempt','delete-draft'].includes(action)) {
      await render();toast('La sessió ja no és vàlida. Inicia sessió per continuar; les respostes es conserven en aquesta pestanya.');
    } else { const box=document.querySelector('#result-error');if(box)box.innerHTML=`<p class="error-box">${h(e.message)}</p>`;else toast(e.message); }
  }
  finally{state.busy=false;el.disabled=false;}
});
document.addEventListener('change',event=>{
  if(currentRoute()!=='test' || state.step>=questions().length)return;
  const q=questions()[state.step];
  if(event.target.name==='answer'){
    state.answers[q.id]=event.target.value;state.dirty=true;
    document.querySelector('[data-action="next"]').disabled=false;
    const dot=document.querySelector(`[data-action="jump"][data-index="${state.step}"]`);
    if(dot){dot.classList.add('done');dot.ariaLabel=`Pregunta ${state.step+1}, resposta`;}
    const counter=document.querySelector('#response-count');if(counter)counter.textContent=String(Object.keys(state.answers).length);
  }
  if(event.target.id==='important'){state.weights[q.id]=event.target.checked?2:1;state.dirty=true;}
  storeLocal();
});
document.addEventListener('input',event=>{
  if(event.target.id==='party-search'){
    document.querySelector('#program-grid').innerHTML=programCards(event.target.value);
    const count = document.querySelectorAll('.program-card').length;
    document.querySelector('#party-count').textContent=`${count} ${count === 1 ? 'candidatura' : 'candidatures'}`;
  }
});
document.addEventListener('submit',async event=>{
  if(!['auth-form','delete-form'].includes(event.target.id))return;
  event.preventDefault();const form=event.target;const submit=form.querySelector('[type="submit"]');if(submit.disabled)return;
  const formData=new FormData(form);const error=form.querySelector('.form-error');error.innerHTML='';submit.disabled=true;
  try{
    if(form.id==='auth-form'){
      const register=state.authMode==='register';
      const data=await api(register?'/api/register':'/api/login',{username:formData.get('username'),password:formData.get('password'),...(register?{name:formData.get('name'),consent:formData.get('consent')==='on'}:{})});
      const session=await api('/api/me');
      if(!session.user || session.user.id !== data.user.id) {
        state.user=null;accountNav();
        if(register)authForm('login');
        throw new Error(`${register ? 'El compte s’ha creat, però no s’ha pogut mantenir la sessió. ' : ''}El navegador no ha conservat la sessió. Comprova que permet les galetes d’aquest lloc i inicia sessió de nou. Les respostes del test continuen en aquesta pestanya.`);
      }
      state.user=session.user;form.reset();dialog.close();render();toast(register?'Compte creat. Ja pots guardar els teus resultats.':'Sessió iniciada.');
      if(state.pendingDraftSave){try{await saveDraft();}catch(saveError){toast(saveError.message);}}
    }else{
      await api('/api/account/delete',{password:formData.get('password')});state.user=null;state.result=null;state.resultId=null;state.answers={};state.weights={};state.step=0;state.draftId=null;state.lastDraftId=null;state.dirty=false;go('inici');toast('Compte, respostes i resultats esborrats.');
    }
  }catch(e){
    const target=form.id === 'auth-form' ? dialog.querySelector('.form-error') : error;
    target.innerHTML=`<p class="error-box">${h(e.message)}</p>`;
  }
  finally{submit.disabled=false;}
});
window.addEventListener('hashchange',render);
window.addEventListener('beforeunload',event=>{if(!STATIC&&unsavedAnswers()){event.preventDefault();event.returnValue='';}});
try{
  const [content,me]=await Promise.all([api('/api/content'),api('/api/me')]);state.content=content;state.user=me.user;if(STATIC)loadLocal();render();
}catch(e){main.innerHTML=`<div class="container"><div class="page-head"><h1>No hem pogut obrir Afinitat.</h1><p class="error-box">${h(e.message)}</p><p>${STATIC ? 'Recarrega la pàgina d’aquí a uns moments.' : 'Comprova que el servidor local està en marxa i recarrega la pàgina.'}</p></div></div>`;}
