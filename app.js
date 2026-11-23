const main = document.querySelector('#main');
const dialog = document.querySelector('#auth-dialog');
const state = { content: null, user: null, quizId: 'curt', answers: {}, weights: {}, step: 0, result: null, resultId: null, resultDate: null, lastAnswers: {}, lastWeights: {}, lastDraftId: null, draftId: null, pendingReuse: null, dirty: false, pendingDraftSave: false, authMode: 'login', busy: false };
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const button = (action, label, classes = '', extra = '') => `<button class="button ${classes}" data-action="${action}" ${extra}>${label}</button>`;
// Idioma de la interfície: català per defecte; castellà si la persona l'ha triat (preferència desada al navegador).
const LANG_KEY = 'afinitat-llengua';
let LANG = (() => { try { return localStorage.getItem(LANG_KEY) === 'es' ? 'es' : 'ca'; } catch { return 'ca'; } })();
const L = (ca, es) => LANG === 'es' ? es : ca;
const locale = () => L('ca-ES', 'es-ES');
const langField = () => LANG === 'es' ? { lang: 'es' } : {};
const date = value => new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const quizzes = () => state.content.quizzes ?? [{id:'curt',name:L('Test curt','Test corto'),questionIds:state.content.questions.map(q=>q.id),estimatedMinutes:{min:6,max:8}}];
const activeQuiz = () => quizzes().find(q=>q.id === state.quizId) ?? quizzes()[0];
const questions = () => { const bank=new Map(state.content.questions.map(q=>[q.id,q])); return activeQuiz().questionIds.map(id=>bank.get(id)); };
const partyName = p => p.id === 'psc' ? 'PSOE' : p.shortName;
// Data de la darrera revisió de fonts, presa del contingut (p. ex. «22 de novembre»).
const reviewDate = (withYear = false) => { const d = state.content?.sourcesReviewedAt; if (!d) return ''; return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)); };
const currentRoute = () => location.hash.slice(1) || 'inici';
const statusName = party => party.programStatus === 'partial' ? L('Proposta parcial publicada', 'Propuesta parcial publicada') : party.comparisonBasis === 'reference' ? L('Document de referència', 'Documento de referencia') : party.programStatus === 'missing' ? L('Programa no localitzat', 'Programa no localizado') : party.programStatus === 'reference' ? L('Programa amb matisos', 'Programa con matices') : L('Programa disponible', 'Programa disponible');
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
  if (route === '/api/content') { const res = await fetch('contingut.json', { cache: 'no-cache' }); if (!res.ok) throw new Error(L('No s’ha pogut carregar el contingut del test.', 'No se ha podido cargar el contenido del test.')); return res.json(); }
  if (route === '/api/content-es') { const res = await fetch('contingut.es.json', { cache: 'no-cache' }); if (!res.ok) throw new Error(L('No s’ha pogut carregar la traducció al castellà.', 'No se ha podido cargar la traducción al castellano.')); return res.json(); }
  if (route === '/api/me') return { user: null };
  // El contingut ja és el traduït si l'idioma és el castellà: el camp lang no cal aquí.
  if (route === '/api/results') { const result = window.AfinitatScoring.scoreQuiz(state.content, data.answers, data.weights, data.quizId); result.documents = state.content.documents; return { id: null, result }; }
  throw new Error(L('Aquesta funció no està disponible a la versió pública.', 'Esta función no está disponible en la versión pública.'));
}
// Superposició en castellà: substitueix els textos que tinguin traducció i deixa la resta en català.
function mergeTexts(target, source) {
  if (!target || typeof target !== 'object' || !source || typeof source !== 'object') return;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && (target[key] === undefined || typeof target[key] === 'string')) target[key] = value;
    else if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object') mergeTexts(target[key], value);
  }
}
function applyOverlay(ca, es) {
  const out = structuredClone(ca);
  if (!es || typeof es !== 'object') return out;
  const text = (value, fallback) => typeof value === 'string' && value ? value : fallback;
  const families = es.topicAnalysis?.families ?? {};
  for (const quiz of out.quizzes ?? []) { const t = es.quizzes?.[quiz.id]; if (t) { quiz.name = text(t.name, quiz.name); quiz.description = text(t.description, quiz.description); } }
  for (const party of out.parties ?? []) { const t = es.parties?.[party.id]; if (t) party.note = text(t.note, party.note); }
  for (const doc of out.documents ?? []) { const t = es.documents?.[doc.id]; if (t) doc.title = text(t.title, doc.title); }
  for (const q of out.questions ?? []) {
    const t = es.questions?.[q.id] ?? {};
    q.topic = text(t.topic, q.topic); q.title = text(t.title, q.title); q.context = text(t.context, q.context);
    if (q.temaGeneral !== undefined) q.temaGeneral = text(t.temaGeneral, text(families[q.temaGeneral], q.temaGeneral));
    for (const option of q.options ?? []) option.text = text(t.options?.[option.id], option.text);
    for (const [partyId, position] of Object.entries(q.positions ?? {})) position.rationale = text(t.rationales?.[partyId], position.rationale);
  }
  if (es.methodology) mergeTexts(out.methodology, es.methodology);
  if (out.topicAnalysis) {
    out.topicAnalysis.method = text(es.topicAnalysis?.method, out.topicAnalysis.method);
    for (const topic of out.topicAnalysis.topics ?? []) topic.name = text(families[topic.name], topic.name);
  }
  return out;
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
    throw Object.assign(new Error(body.error || L('No s’ha pogut completar l’operació.', 'No se ha podido completar la operación.')), { status: res.status });
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
  document.querySelector('#account-nav').innerHTML = STATIC ? '' : state.user ? `<a class="button subtle" href="#compte">${h(state.user.name)} <span aria-hidden="true">↗</span></a>` : button('auth', `${L('Inicia sessió', 'Inicia sesión')} <span aria-hidden="true">↗</span>`, 'subtle');
}
// Selector d'idioma de la capçalera.
function langSwitch() {
  const el = document.querySelector('#lang-switch'); if (!el) return;
  const opt = (code, label, title) => `<button type="button" class="lang-option" data-action="set-lang" data-lang="${code}" aria-pressed="${LANG === code}" title="${title}" lang="${code}">${label}</button>`;
  el.innerHTML = opt('ca', 'CA', 'Català') + opt('es', 'ES', 'Castellano');
  el.setAttribute?.('role', 'group'); el.setAttribute?.('aria-label', L('Idioma', 'Idioma'));
}
// Textos fixos d'index.html (capçalera i peu) en l'idioma actiu.
function applyStaticTexts() {
  if (document.documentElement) document.documentElement.lang = LANG;
  document.title = L('Afinitat · Eleccions 29N', 'Afinitat · Elecciones 29N');
  const set = (selector, text) => { const el = document.querySelector(selector); if (el) el.textContent = text; };
  const attr = (selector, name, value) => document.querySelector(selector)?.setAttribute?.(name, value);
  const nav = { inici: L('Inici', 'Inicio'), programes: L('Els programes', 'Los programas'), metode: L('Com funciona', 'Cómo funciona') };
  document.querySelectorAll('[data-nav]').forEach(el => { if (nav[el.dataset.nav]) el.textContent = nav[el.dataset.nav]; });
  set('.skip-link', L('Salta al contingut', 'Saltar al contenido'));
  attr('.brand', 'aria-label', L('Afinitat, inici', 'Afinitat, inicio'));
  attr('#main-nav', 'aria-label', L('Navegació principal', 'Navegación principal'));
  set('#footer-tagline', L('Entendre abans de decidir.', 'Entender antes de decidir.'));
  set('.local-indicator', STATIC ? L('Versió pública · les respostes no surten del teu navegador', 'Versión pública · las respuestas no salen de tu navegador') : L('Aplicació local', 'Aplicación local'));
  set('#footer-election', L('Barcelona · Congrés dels Diputats · 29 novembre 2026', 'Barcelona · Congreso de los Diputados · 29 noviembre 2026'));
  set('#footer-method', L('Fonts, criteris i privacitat ↗', 'Fuentes, criterios y privacidad ↗'));
}
async function setLang(lang) {
  if (lang !== 'ca' && lang !== 'es') return;
  if (lang === 'es' && state.contentCa) {
    try {
      if (!state.overlayEs) state.overlayEs = await api('/api/content-es');
      state.content = applyOverlay(state.contentCa, state.overlayEs);
    } catch (e) {
      langSwitch();
      return toast(L(`No s’ha pogut carregar la versió en castellà. La interfície continua en català. (${e.message})`, `No se ha podido cargar la versión en castellano. La interfaz sigue en catalán. (${e.message})`));
    }
  } else if (state.contentCa) state.content = state.contentCa;
  LANG = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* Sense emmagatzematge: l'idioma només dura aquesta visita. */ }
  langSwitch(); applyStaticTexts();
  if (dialog?.open) authForm(state.authMode);
  return render();
}
const unsavedAnswers = () => state.dirty && Object.keys(state.answers).length > 0;
const confirmReplace = () => !unsavedAnswers() || typeof window.confirm !== 'function' || window.confirm(L('Tens respostes sense desar en el test obert. Si continues, se substituiran. Vols continuar?', 'Tienes respuestas sin guardar en el test abierto. Si continúas, se sustituirán. ¿Quieres continuar?'));
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
const droppedNote = dropped => dropped ? ` ${dropped} ${dropped === 1 ? L('resposta ja no és al test actual i no s’ha pogut recuperar', 'respuesta ya no está en el test actual y no se ha podido recuperar') : L('respostes ja no són al test actual i no s’han pogut recuperar', 'respuestas ya no están en el test actual y no se han podido recuperar')}.` : '';
async function saveDraft() {
  if (!state.user) {
    state.pendingDraftSave = true; authForm();
    toast(L('Inicia sessió o crea un compte per desar el test. Les respostes es mantenen en aquesta pestanya.', 'Inicia sesión o crea una cuenta para guardar el test. Las respuestas se mantienen en esta pestaña.')); return;
  }
  state.pendingDraftSave = false;
  const body = { ...(state.draftId ? { id: state.draftId } : {}), quizId: state.quizId, answers: structuredClone(state.answers), weights: structuredClone(state.weights), step: state.step, version: state.content.version };
  try {
    const data = await api('/api/drafts', body);
    state.draftId = data.draft.id; state.dirty = false;
    toast(L('Test desat. El pots continuar més endavant des de «El teu compte» → Tests pendents.', 'Test guardado. Puedes continuarlo más adelante desde «Tu cuenta» → Tests pendientes.'));
    if (currentRoute() === 'test') render();
  } catch (e) {
    if (e.status === 404 && state.draftId) { state.draftId = null; return saveDraft(); }
    if (e.status === 401) { state.pendingDraftSave = true; authForm(); toast(L('La sessió ja no és vàlida. Inicia sessió per desar el test; les respostes es conserven en aquesta pestanya.', 'La sesión ya no es válida. Inicia sesión para guardar el test; las respuestas se conservan en esta pestaña.')); return; }
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
  return `<svg class="hemicycle" viewBox="0 0 370 210" role="img" aria-label="${L('Il·lustració abstracta d’un hemicicle; no representa escons ni una previsió electoral', 'Ilustración abstracta de un hemiciclo; no representa escaños ni una previsión electoral')}">${seats}<text x="185" y="174" text-anchor="middle" font-family="Georgia,serif" font-size="38" fill="#39443f">29N</text><text x="185" y="194" text-anchor="middle" font-family="sans-serif" font-size="8" letter-spacing="2" fill="#68716f">BARCELONA</text></svg>`;
}
function sourceLinks(refs, docs = state.content.documents) {
  return (refs ?? []).map(ref => {
    const doc = docs.find(d => d.id === ref.documentId);
    if (!doc) return `<span>${L('Font pendent de verificació', 'Fuente pendiente de verificación')}</span>`;
    const url = docHref(doc, ref.page);
    return `<a class="source-link" href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(doc.title)}${ref.page ? ` · p. ${h(ref.page)}` : ''} ↗</a>${ref.section ? `<span>${h(ref.section)}</span>` : ''}`;
  }).join('<br>');
}
function home() {
  const electoral = state.content.parties.filter(p => p.comparisonBasis === 'electoral').length;
  const pending = STATIC ? Object.keys(state.answers).length : 0;
  return `<div class="container">
    ${pending ? `<div class="notice info resume-banner"><strong>${L('Tens un test a mitges.', 'Tienes un test a medias.')}</strong> ${h(activeQuiz().name)} · ${pending} ${pending === 1 ? L('resposta', 'respuesta') : L('respostes', 'respuestas')} ${L('desades en aquest navegador.', 'guardadas en este navegador.')} ${button('start',L('Continua el test →', 'Continúa el test →'),'small',`data-quiz="${h(state.quizId)}"`)}</div>` : ''}
    <section class="hero"><div>
      <div class="eyebrow"><span class="dot"></span> ${L('Eleccions generals · Barcelona · 29.11.2026', 'Elecciones generales · Barcelona · 29.11.2026')}</div>
      <h1>${L('Les teves idees,<br>el teu <em>punt<br>de partida.</em>', 'Tus ideas,<br>tu <em>punto<br>de partida.</em>')}</h1>
      <p class="lead">${L('Quines propostes s’acosten més al que penses? Explora la teva afinitat amb els partits a partir dels seus programes.', '¿Qué propuestas se acercan más a lo que piensas? Explora tu afinidad con los partidos a partir de sus programas.')}</p>
      <div class="hero-actions"><button class="button" data-action="choose-tests">${L('Tria el teu test', 'Elige tu test')} <span aria-hidden="true">↓</span></button><a class="text-button" href="#metode">${L('Coneix el mètode', 'Conoce el método')}</a></div>
      <p class="microcopy">${L('15, 30, 50 o 100 preguntes · Al teu ritme · Pots començar sense compte', '15, 30, 50 o 100 preguntas · A tu ritmo · Puedes empezar sin cuenta')}</p>
    </div><div class="hero-card"><div class="card-top"><strong>${L('Un espai per formar-te una opinió.', 'Un espacio para formarte una opinión.')}</strong><span class="tiny-badge">29N / BCN</span></div>
      ${hemicycle()}<h2>${L('Primer, les propostes.<br>Després, les coincidències.', 'Primero, las propuestas.<br>Después, las coincidencias.')}</h2><p>${L('Un test amb fonts obertes i explicacions. Tu decideixes què és important per a tu.', 'Un test con fuentes abiertas y explicaciones. Tú decides qué es importante para ti.')}</p><div class="card-foot"><span class="mini-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${L('Perspectives diferents. Criteris transparents.', 'Perspectivas diferentes. Criterios transparentes.')}</span></div>
    </div></section>
    <section id="tests" tabindex="-1" aria-labelledby="tests-title"><div class="section-heading"><div><div class="eyebrow">${L('Tu tries fins on explorar', 'Tú eliges hasta dónde explorar')}</div><h2 id="tests-title">${L('Un test per al teu temps.', 'Un test para tu tiempo.')}</h2><p>${L('Mateixes fonts i mateix criteri. Com més preguntes, més mesures per contrastar.', 'Mismas fuentes y mismo criterio. Cuantas más preguntas, más medidas para contrastar.')}</p></div></div><div class="quiz-grid">${quizzes().map((q,i)=>`<article class="quiz-card ${i===1?'featured':''}"><div class="eyebrow">${L(['Una primera mirada','Més perspectiva','En profunditat','Tot el banc'], ['Una primera mirada','Más perspectiva','En profundidad','Todo el banco'])[i] ?? L('Format addicional', 'Formato adicional')}</div><h3>${h(q.name)}</h3><div class="quiz-count">${q.questionIds.length}<span> ${L('preguntes', 'preguntas')}</span></div><p class="quiz-time">${q.estimatedMinutes.min}–${q.estimatedMinutes.max} ${L('minuts aproximats', 'minutos aproximados')}</p><p class="quiz-description">${h(q.description || '')}</p>${button('start',L(`Comença · ${q.questionIds.length} preguntes →`, `Empieza · ${q.questionIds.length} preguntas →`),i===1?'':'light',`data-quiz="${h(q.id)}"`)}</article>`).join('')}</div><p class="microcopy">${L('Estimació orientativa: pots ometre preguntes o consultar el resultat en qualsevol moment. Si canvies de format, et proposarem aprofitar les respostes que ja hagis donat a les mateixes preguntes.', 'Estimación orientativa: puedes omitir preguntas o consultar el resultado en cualquier momento. Si cambias de formato, te propondremos aprovechar las respuestas que ya hayas dado a las mismas preguntas.')}</p></section>
    <section><div class="section-heading"><div><div class="eyebrow">${L('De les idees a les fonts', 'De las ideas a las fuentes')}</div><h2>${L('Decidir comença per entendre.', 'Decidir empieza por entender.')}</h2></div><a href="#programes" class="text-button">${L('Explora els programes ↗', 'Explora los programas ↗')}</a></div>
    <div class="steps"><div class="step"><h3><span class="step-number">01</span> ${L('Tria mesures concretes', 'Elige medidas concretas')}</h3><p>${L('Habitatge, economia, immigració, serveis públics… Tria la proposta que prioritzaries.', 'Vivienda, economía, inmigración, servicios públicos… Elige la propuesta que priorizarías.')}</p></div><div class="step"><h3><span class="step-number">02</span> ${L('Dona pes al que t’importa', 'Da peso a lo que te importa')}</h3><p>${L('Pots destacar un tema o ometre una pregunta. No cal tenir una opinió formada sobre tot.', 'Puedes destacar un tema u omitir una pregunta. No hace falta tener una opinión formada sobre todo.')}</p></div><div class="step"><h3><span class="step-number">03</span> ${L('Entén cada coincidència', 'Entiende cada coincidencia')}</h3><p>${L('Consulta els documents i les pàgines que sostenen cada resultat, amb els seus límits visibles.', 'Consulta los documentos y las páginas que sostienen cada resultado, con sus límites visibles.')}</p></div></div></section>
    <div class="notice"><strong>${L(`Una fotografia documental del ${h(reviewDate())}.`, `Una fotografía documental del ${h(reviewDate())}.`)}</strong> ${L(`${electoral} candidatures tenen una base electoral incorporada al test. Tots els partits comparteixen classificació; cada fitxa identifica el tipus i la data de les fonts. El qüestionari és una primera versió experimental.`, `${electoral} candidaturas tienen una base electoral incorporada al test. Todos los partidos comparten clasificación; cada ficha identifica el tipo y la fecha de las fuentes. El cuestionario es una primera versión experimental.`)} <a href="#programes">${L('Consulta l’estat de les fonts.', 'Consulta el estado de las fuentes.')}</a></div>
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
  const origin = fromTab && names.length ? L('en aquesta pestanya i en tests anteriors', 'en esta pestaña y en tests anteriores') : fromTab ? L('en aquesta pestanya', 'en esta pestaña') : L(`en tests anteriors (${h(names.join(', '))})`, `en tests anteriores (${h(names.join(', '))})`);
  return `<section class="test-shell" aria-labelledby="reuse-title"><div class="eyebrow">${h(activeQuiz().name)}</div><h1 id="reuse-title" class="question-title">${L('Vols aprofitar les respostes que ja has donat?', '¿Quieres aprovechar las respuestas que ya has dado?')}</h1>
    <p class="question-context">${L(`Ja has respost <strong>${found.length} de les ${questions().length} preguntes</strong> d’aquest test ${origin}. Si les aprofites, començaràs per la primera pregunta pendent i podràs revisar o canviar qualsevol resposta.`, `Ya has respondido <strong>${found.length} de las ${questions().length} preguntas</strong> de este test ${origin}. Si las aprovechas, empezarás por la primera pregunta pendiente y podrás revisar o cambiar cualquier respuesta.`)}</p>
    <div class="test-controls">${button('reuse-no',L('No, comença de zero', 'No, empieza de cero'),'light')}${button('reuse-yes',L('Sí, aprofita-les →', 'Sí, aprovéchalas →'))}</div></section>`;
}
function quiz() {
  if (state.pendingReuse) return reusePrompt();
  if (state.step >= questions().length) return review();
  const q = questions()[state.step]; const answered = Object.keys(state.answers).length;
  return `<section class="test-shell" aria-labelledby="question-title"><div class="test-top"><a href="#inici">${L('← Tornar a l’inici', '← Volver al inicio')}</a><span>${h(activeQuiz().name)} <strong>${state.step + 1} / ${questions().length}</strong></span></div><progress value="${state.step + 1}" max="${questions().length}" aria-label="${L('Progrés del test', 'Progreso del test')}"></progress>
    <div class="question-meta"><span class="topic-chip">${h(q.topic)}</span><span>Pregunta ${String(state.step + 1).padStart(2,'0')}</span></div>
    <h1 id="question-title" class="question-title">${h(q.title)}</h1><p class="question-context">${h(q.context || L('Tria la mesura que prioritzaries. Pots ometre la pregunta si cap opció et representa.', 'Elige la medida que priorizarías. Puedes omitir la pregunta si ninguna opción te representa.'))}</p>
    <fieldset class="options"><legend class="sr-only">${h(q.title)}</legend>${q.options.map((o, i) => `<label class="option"><input type="radio" name="answer" value="${h(o.id)}" ${state.answers[q.id] === o.id ? 'checked' : ''}><span class="option-letter">${String.fromCharCode(65 + i)}</span><span class="option-text">${h(o.text)}</span></label>`).join('')}</fieldset>
    <div class="importance"><label><input type="checkbox" id="important" ${state.weights[q.id] === 2 ? 'checked' : ''}> ${L('Aquest tema és especialment important per a mi', 'Este tema es especialmente importante para mí')}</label><span>${L('Compta el doble', 'Cuenta el doble')}</span></div>
    <div class="test-controls">${button('previous', '← Anterior', 'light', state.step === 0 ? 'disabled' : '')}<div class="control-right"><button class="text-button" data-action="skip">${L('Omet la pregunta', 'Omite la pregunta')}</button>${button('next', `${state.step === questions().length - 1 ? L('Revisa', 'Revisa') : L('Següent', 'Siguiente')} <span aria-hidden="true">→</span>`, '', state.answers[q.id] ? '' : 'disabled')}</div></div>
    <div class="question-dots" aria-label="${L('Navega entre preguntes', 'Navega entre preguntas')}">${questions().map((item, i) => `<button class="question-dot ${state.answers[item.id] ? 'done' : ''} ${i === state.step ? 'current' : ''}" data-action="jump" data-index="${i}" aria-label="Pregunta ${i+1}${state.answers[item.id] ? L(', resposta', ', respondida') : L(', pendent', ', pendiente')}" ${i === state.step ? 'aria-current="step"' : ''}>${i+1}</button>`).join('')}</div>
    <div class="draft-actions"><button class="text-button" data-action="review">${L('Revisa i mostra el resultat ara →', 'Revisa y muestra el resultado ahora →')}</button>${STATIC ? '' : button('save-draft',L('Desa i continua més tard', 'Guarda y continúa más tarde'),'light small')}</div>
    <details class="source-details"><summary>${L('Origen de les opcions i criteri de lectura', 'Origen de las opciones y criterio de lectura')}</summary><p>${L('Les opcions són síntesis en català, no cites literals. Poden ser compatibles entre si: escull quina prioritzaries. Les puntuacions són interpretacions editorials documentades.', 'Las opciones son síntesis, no citas literales. Pueden ser compatibles entre sí: elige cuál priorizarías. Las puntuaciones son interpretaciones editoriales documentadas.')}</p><ol type="A">${q.options.map(o=>`<li>${sourceLinks(o.sourceRefs)}</li>`).join('')}</ol></details>
    <p class="microcopy"><span id="response-count">${answered}</span> ${L('respostes', 'respuestas')} · ${STATIC ? L('Les respostes es desen automàticament en aquest navegador i no s’envien enlloc.', 'Las respuestas se guardan automáticamente en este navegador y no se envían a ningún sitio.') : state.draftId ? (state.dirty ? L('Hi ha canvis sense desar. Torna a desar el test per guardar-los.', 'Hay cambios sin guardar. Vuelve a guardar el test para conservarlos.') : L('Test pendent desat al teu compte.', 'Test pendiente guardado en tu cuenta.')) : state.user ? L('Esborrany en aquesta pestanya. Desa’l per continuar-lo més endavant des del teu compte.', 'Borrador en esta pestaña. Guárdalo para continuarlo más adelante desde tu cuenta.') : L('Mode convidat: cap resposta desada al disc. Inicia sessió per desar el test i continuar-lo més endavant.', 'Modo invitado: ninguna respuesta guardada en el disco. Inicia sesión para guardar el test y continuarlo más adelante.')}</p>
  </section>`;
}
function review() {
  const count = Object.keys(state.answers).length;
  return `<section class="test-shell"><div class="eyebrow">${L('Un últim cop d’ull', 'Un último vistazo')}</div><h1 class="question-title">${L('Aquestes són les teves prioritats.', 'Estas son tus prioridades.')}</h1><p class="question-context">${L(`Has respost ${count} de ${questions().length} preguntes. Les omeses no afecten el resultat. Pots canviar qualsevol resposta.`, `Has respondido ${count} de ${questions().length} preguntas. Las omitidas no afectan al resultado. Puedes cambiar cualquier respuesta.`)}</p>
    <div class="review-grid">${questions().map((q,i)=>`<div class="review-item"><div><strong>${i+1}. ${h(q.topic)}${state.weights[q.id] === 2 && state.answers[q.id] ? L(' · doble pes', ' · doble peso') : ''}</strong><p>${h(q.options.find(o=>o.id === state.answers[q.id])?.text || L('Pregunta omesa', 'Pregunta omitida'))}</p></div><button class="text-button" data-action="jump" data-index="${i}">${L('Canvia', 'Cambia')}</button></div>`).join('')}</div>
    ${STATIC ? `<div class="notice info">${L('Les teves respostes no surten d’aquest navegador: el resultat es calcula aquí mateix.', 'Tus respuestas no salen de este navegador: el resultado se calcula aquí mismo.')}</div>` : state.user ? `<label class="save-choice"><input type="checkbox" id="save-result" checked> ${L('Guarda aquestes respostes i el resultat al meu historial.', 'Guarda estas respuestas y el resultado en mi historial.')}</label>` : `<div class="notice info">${L('Pots veure el resultat sense compte.', 'Puedes ver el resultado sin cuenta.')} <button class="text-button" data-action="auth">${L('Inicia sessió o registra’t', 'Inicia sesión o regístrate')}</button> ${L('si vols guardar-lo.', 'si quieres guardarlo.')}</div>`}
    ${count === 0 ? `<p class="small-note">${L('Encara no has respost cap pregunta. Pots consultar les fonts; no hi haurà percentatges fins que hi hagi alguna resposta comparable.', 'Aún no has respondido ninguna pregunta. Puedes consultar las fuentes; no habrá porcentajes hasta que haya alguna respuesta comparable.')}</p>` : ''}<div id="result-error" role="alert"></div>
    <div class="test-controls">${button('previous',L('← Torna al test', '← Vuelve al test'),'light')}<div class="control-right">${STATIC ? '' : button('save-draft',L('Desa i continua més tard', 'Guarda y continúa más tarde'),'light')}${button('calculate',L('Descobreix les coincidències →', 'Descubre las coincidencias →'))}</div></div>
  </section>`;
}
// Escala 2 (des de 2026-11-17.3): 0,25 = mesura diferent però compatible; 0 = oposició documentada.
// Els resultats calculats abans conserven l'etiqueta neutra «Mesura diferent» per al 0.
function matchBadge(similarity, scaleVersion = 1) {
  // Escala 4 (des de 2026-11-21.5): 0 = compatible, −1 = oposada. Escala 3: −0,5 = oposada. Escala 2: 0,25 = compatible, 0 = oposada. Escala 1: 0 = diferent.
  const [cls, label] = similarity === 1 ? ['', L('Coincidència', 'Coincidencia')] : similarity === .5 ? ['partial', L('Coincidència parcial', 'Coincidencia parcial')]
    : similarity < 0 ? ['opposed', L('Mesura oposada', 'Medida opuesta')]
    : scaleVersion >= 3 ? ['compatible', L('Mesura compatible', 'Medida compatible')]
    : similarity === .25 ? ['compatible', L('Mesura compatible', 'Medida compatible')] : scaleVersion >= 2 ? ['opposed', L('Mesura oposada', 'Medida opuesta')] : ['different', L('Mesura diferent', 'Medida diferente')];
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
    ${p.score !== null ? `<progress value="${Math.max(0, p.score)}" max="100" aria-label="${L(`Índex d’afinitat amb ${h(partyName(p))}: ${pct(p.score)}%`, `Índice de afinidad con ${h(partyName(p))}: ${pct(p.score)}%`)}"></progress>` : ''}
    <div class="coverage-line"><span>${p.score === null ? (p.details.length ? L('Només mesures compatibles: cap coincidència ni oposició per calcular l’índex', 'Solo medidas compatibles: ninguna coincidencia ni oposición para calcular el índice') : L('Sense posició documentada per a les teves respostes', 'Sin posición documentada para tus respuestas')) : L(`${p.knownCount} de ${max} respostes comparables`, `${p.knownCount} de ${max} respuestas comparables`)}</span><span>${(() => { if (p.score === null && !p.details.length) return ''; const compat = result.scaleVersion >= 3 && result.compatibleWeight === 0 ? p.details.filter(d => d.similarity === 0).length : 0; const none = max - p.knownCount; return compat ? `${compat} ${compat === 1 ? L('compatible (no suma ni resta)', 'compatible (no suma ni resta)') : L('compatibles (no sumen ni resten)', 'compatibles (no suman ni restan)')} · ${none} ${L('sense posició', 'sin posición')}` : `${none} ${L('sense posició documentada', 'sin posición documentada')}`; })()}</span></div>
    ${low ? `<p class="coverage-warning">${L('Comparació amb menys de la meitat de les teves respostes: l’índex es basa en poques mesures i és menys sòlid.', 'Comparación con menos de la mitad de tus respuestas: el índice se basa en pocas medidas y es menos sólido.')}</p>` : ''}
    ${p.note ? `<p class="microcopy">${h(p.note)}</p>` : ''}
    ${p.score === null ? `<div class="program-links">${(p.documentIds ?? []).map(id=>{const doc=(result.documents || state.content.documents).find(d=>d.id===id);return doc && (doc.localFile || STATIC) ? `<a href="${h(docHref(doc))}" target="_blank" rel="noopener noreferrer">${L('Llegeix', 'Lee')} ${h(doc.title)} ↗</a>` : '';}).join('')}<a href="#programes">${L('Consulta la fitxa i l’estat de les fonts ↗', 'Consulta la ficha y el estado de las fuentes ↗')}</a></div>` : ''}
    ${p.details.length ? `<details><summary>${L('Per què aquest resultat?', '¿Por qué este resultado?')} · ${p.details.length} ${p.details.length === 1 ? L('comparació', 'comparación') : L('comparacions', 'comparaciones')}</summary>${p.details.map(detail=>`<div class="match-detail"><h4>${h(detail.questionTitle)}</h4>${matchBadge(detail.similarity, result.scaleVersion)}${detail.weight === 2 ? L(' · doble pes', ' · doble peso') : ''}</span><p><strong>${L('Has prioritzat:', 'Has priorizado:')}</strong> ${h(detail.selectedText)}</p><p>${h(detail.rationale)}</p>${sourceLinks(detail.sourceRefs,result.documents || state.content.documents)}</div>`).join('')}</details>` : ''}
  </article>`;
}
// Exportar el resultat: resum de text per compartir i versió per imprimir o desar en PDF.
const PUBLIC_URL = 'https://jordibolance3.github.io/afinitat-29n/';
const rankParties = r => [...r.parties].sort((a,b)=>rankKey(b)-rankKey(a) || partyName(a).localeCompare(partyName(b),'ca'));
const quizLabel = r => r.quizName ?? L('Test curt', 'Test corto');
function resultSummary(r) {
  const parties = rankParties(r).filter(p => Number.isFinite(p.score)).map(p => `${partyName(p)} ${pct(p.score)}%`).join(' · ');
  return L(`Afinitat 29N · ${quizLabel(r)} (${r.answeredCount}/${r.totalQuestions ?? 15} respostes): ${parties || 'sense comparacions documentades'}. Fes el test: ${PUBLIC_URL}`,
    `Afinitat 29N · ${quizLabel(r)} (${r.answeredCount}/${r.totalQuestions ?? 15} respuestas): ${parties || 'sin comparaciones documentadas'}. Haz el test: ${PUBLIC_URL}`);
}
function results() {
  if (!state.result) return `<div class="container"><div class="page-head"><h1>${L('El teu resultat comença amb les teves idees.', 'Tu resultado empieza con tus ideas.')}</h1><p>${L('Completa el test per explorar les coincidències.', 'Completa el test para explorar las coincidencias.')}</p></div>${button('start',L('Comença el test →', 'Empieza el test →'))}</div>`;
  const r = state.result;
  const ranked = rankParties(r);
  const leaders = ranked.filter(p=>Number.isFinite(p.score) && rankKey(p) === rankKey(ranked[0]));
  return `<div class="container"><div class="print-only print-header"><strong>Afinitat 29N</strong> · ${h(quizLabel(r))} · ${r.answeredCount}/${r.totalQuestions ?? 15} ${L('respostes', 'respuestas')} · ${h(date(state.resultDate ?? Date.now()))} · ${L('Versió', 'Versión')} ${h(r.version)}<br>${h(PUBLIC_URL)}</div><div class="page-head"><div class="eyebrow"><span class="dot"></span> ${L('El teu mapa de coincidències', 'Tu mapa de coincidencias')}</div><h1>${L('Les respostes, amb perspectiva.', 'Las respuestas, con perspectiva.')}</h1><p>${state.resultId ? `${L('Resultat desat', 'Resultado guardado')}${state.resultDate ? ` · ${h(date(state.resultDate))}` : ''}` : L('Resultat de la sessió · encara no desat', 'Resultado de la sesión · aún no guardado')} · ${h(quizLabel(r))} · ${L('Versió', 'Versión')} ${h(r.version)}</p></div>
    ${r.version !== state.content.version ? `<div class="notice info">${L('Aquest resultat es va calcular amb una versió anterior. Pots aplicar les fonts i els criteris actuals a les mateixes respostes.', 'Este resultado se calculó con una versión anterior. Puedes aplicar las fuentes y los criterios actuales a las mismas respuestas.')} ${button('recalculate',L('Actualitza el resultat', 'Actualiza el resultado'),'light small')}</div>` : ''}
    <section class="result-hero"><div><div class="eyebrow">${leaders.length > 1 ? L('Índex d’afinitat més alt, compartit', 'Índice de afinidad más alto, compartido') : L('Índex d’afinitat més alt', 'Índice de afinidad más alto')}</div><h2>${leaders.length ? h(leaders.map(p=>partyName(p)).join(' · ')) : L('Encara no hi ha respostes comparables.', 'Aún no hay respuestas comparables.')}</h2><p>${leaders.length ? L(`Amb les respostes comparables, ${leaders.length > 1 ? 'aquestes candidatures comparteixen' : 'aquesta candidatura té'} la puntuació més alta. Mira la cobertura i les explicacions abans de treure conclusions.`, `Con las respuestas comparables, ${leaders.length > 1 ? 'estas candidaturas comparten' : 'esta candidatura tiene'} la puntuación más alta. Mira la cobertura y las explicaciones antes de sacar conclusiones.`) : L('Encara no hi ha coincidències documentades amb les respostes triades. Pots consultar la informació i les fonts de cada candidatura a continuació.', 'Aún no hay coincidencias documentadas con las respuestas elegidas. Puedes consultar la información y las fuentes de cada candidatura a continuación.')}</p></div><div class="result-numbers"><div><strong>${leaders.length ? pct(leaders[0].score) + '%' : '—'}</strong><span>${L('índex d’afinitat més alt', 'índice de afinidad más alto')}</span></div><div><strong>${r.answeredCount}<small>/${r.totalQuestions ?? 15}</small></strong><span>${L('preguntes respostes', 'preguntas respondidas')}</span></div></div></section>
    <div class="results-layout"><div><div class="section-heading"><div><h2>${L('Afinitat amb els partits', 'Afinidad con los partidos')}</h2><p>${L('Tots els partits, ordenats per índex d’afinitat: les coincidències sumen, les mesures compatibles no compten i les oposades resten. Mira la cobertura de cada fitxa: indica amb quantes de les teves respostes s’ha pogut comparar. Els partits sense dades comparables apareixen al final.', 'Todos los partidos, ordenados por índice de afinidad: las coincidencias suman, las medidas compatibles no cuentan y las opuestas restan. Mira la cobertura de cada ficha: indica con cuántas de tus respuestas se ha podido comparar. Los partidos sin datos comparables aparecen al final.')}</p></div></div><div class="ranking">${ranked.map(p=>partyResult(p,r)).join('')}</div></div>
    <aside class="result-aside"><div class="aside-card"><h3>${L('L’índex té context.', 'El índice tiene contexto.')}</h3><ol>${L('<li>Va de 0% a 100% (coincidència en totes les teves respostes que compten). Si les oposicions pesen tant o més que les coincidències, l’índex és 0%. No mesura tot el programa.</li><li>La cobertura indica quina part de les teves respostes s’ha pogut contrastar.</li><li>La puntuació és una interpretació editorial. Cada font es pot consultar.</li>', '<li>Va del 0% al 100% (coincidencia en todas tus respuestas que cuentan). Si las oposiciones pesan tanto o más que las coincidencias, el índice es 0%. No mide todo el programa.</li><li>La cobertura indica qué parte de tus respuestas se ha podido contrastar.</li><li>La puntuación es una interpretación editorial. Cada fuente se puede consultar.</li>')}</ol><a class="text-button" href="#metode">${L('Llegeix la metodologia ↗', 'Lee la metodología ↗')}</a></div><div class="aside-card no-print"><h3>${L('Guarda o comparteix.', 'Guarda o comparte.')}</h3><p>${L('Desa el resultat en PDF (amb les explicacions desplegades) o copia un resum per enviar-lo.', 'Guarda el resultado en PDF (con las explicaciones desplegadas) o copia un resumen para enviarlo.')}</p>${button('print-result',L('Desa en PDF o imprimeix', 'Guarda en PDF o imprime'),'small')}${button('copy-summary',L('Copia el resum', 'Copia el resumen'),'light small')}</div><div class="aside-card no-print"><h3>${L('Continua explorant.', 'Sigue explorando.')}</h3><p>${L('Pots tornar al test i canviar prioritats, o llegir els programes pel teu compte.', 'Puedes volver al test y cambiar prioridades, o leer los programas por tu cuenta.')}</p>${button('resume-result', r.answeredCount < (r.totalQuestions ?? 15) ? L('Continua aquest test →', 'Continúa este test →') : L('Edita les respostes →', 'Edita las respuestas →'), 'small')}${button('restart',L('Torna a fer el test des de zero', 'Vuelve a hacer el test desde cero'),'light small')}${STATIC ? '' : !state.resultId ? button(state.user ? 'save-last' : 'auth', state.user ? L('Guarda el resultat', 'Guarda el resultado') : L('Inicia sessió per guardar-lo', 'Inicia sesión para guardarlo'), 'light small') : `<a class="button light small" href="#compte">${L('Consulta l’historial', 'Consulta el historial')}</a>`}<a href="#programes" class="text-button">${L('Consulta els programes', 'Consulta los programas')}</a></div></aside></div>
  </div>`;
}
const ofName = name => /^[aeiouàèéíïòóúüh]/i.test(name) ? `d’${name}` : `de ${name}`;
const partyLogo = p => /^[a-z0-9-]+\.(svg|png|webp)$/.test(p.logo ?? '')
  ? `<div class="program-avatar has-logo${p.logoBackground === 'dark' ? ' dark' : ''}"><img src="logos/${h(p.logo)}" alt="${L(`Logotip ${h(ofName(partyName(p)))}`, `Logotipo de ${h(partyName(p))}`)}" width="56" height="56" loading="lazy" decoding="async"></div>`
  : `<div class="program-avatar" aria-hidden="true">${h(partyName(p).slice(0,5))}</div>`;
function programCards(filter = '') {
  const needle = filter.toLocaleLowerCase('ca');
  const parties = state.content.parties.filter(p => `${p.name} ${p.shortName} ${partyName(p)}`.toLocaleLowerCase('ca').includes(needle)).sort((a, b) => partyName(a).localeCompare(partyName(b), 'ca', { sensitivity: 'base' }));
  return parties.map(p => `<article class="program-card">${partyLogo(p)}<h2>${h(partyName(p))}</h2><p class="full-name">${h(p.name)}</p><span class="status ${p.programStatus === 'missing' ? 'missing' : p.comparisonBasis === 'reference' || p.programStatus === 'reference' ? 'reference' : ''}">${statusName(p)}</span><p class="program-note">${h(p.note || '')}</p><div class="program-links">${(p.documentIds ?? []).map(id=>{const d=state.content.documents.find(doc=>doc.id===id);return d ? `${d.localFile && !STATIC ? `<a href="/documents/${encodeURIComponent(id)}" target="_blank" rel="noopener">${L('Llegeix', 'Lee')} ${h(d.title)} ↗</a>` : ''}${/^https:\/\//.test(d.url) ? `<a href="${h(d.url)}" target="_blank" rel="noopener noreferrer">${STATIC ? `${L('Llegeix', 'Lee')} ${h(d.title)} ↗` : L('Consulta la font d’origen ↗', 'Consulta la fuente de origen ↗')}</a>` : ''}` : '';}).join('')}${!(p.documentIds ?? []).length ? `<span class="microcopy">${L('No s’assignen posicions sense un document.', 'No se asignan posiciones sin un documento.')}</span>` : ''}</div></article>`).join('') || `<p class="empty-state">${L('No hi ha coincidències amb aquesta cerca.', 'No hay coincidencias con esta búsqueda.')}</p>`;
}
function programs() {
  return `<div class="container"><div class="page-head"><div class="eyebrow">${L('La base de cada comparació', 'La base de cada comparación')}</div><h1>${L('Els programes, a la vista.', 'Los programas, a la vista.')}</h1><p>${L('Totes les candidatures proclamades al Congrés per Barcelona i les fonts que hem pogut comprovar. Revisió documental:', 'Todas las candidaturas proclamadas al Congreso por Barcelona y las fuentes que hemos podido comprobar. Revisión documental:')} <strong>${h(reviewDate(true))}.</strong></p></div><div class="notice"><strong>${L('Publicat, de referència o no localitzat.', 'Publicado, de referencia o no localizado.')}</strong> ${L('Aquestes categories tenen significats diferents. No trobar un programa no demostra que no existeixi. No s’atribueixen als partits les propostes que no podem documentar.', 'Estas categorías tienen significados diferentes. No encontrar un programa no demuestra que no exista. No se atribuyen a los partidos las propuestas que no podemos documentar.')} ${STATIC ? '' : `<a href="/documents/inventari" target="_blank" rel="noopener">${L('Llegeix l’informe complet de fonts ↗', 'Lee el informe completo de fuentes ↗')}</a>`}</div><div class="toolbar"><label class="sr-only" for="party-search">${L('Cerca un partit', 'Busca un partido')}</label><input class="search-field" type="search" id="party-search" placeholder="${L('Cerca un partit…', 'Busca un partido…')}"><span id="party-count">${state.content.parties.length} ${L('candidatures · circumscripció de Barcelona', 'candidaturas · circunscripción de Barcelona')}</span></div><div class="program-grid" id="program-grid">${programCards()}</div><div class="notice info spaced"><strong>${L('Quina llista s’ha utilitzat?', '¿Qué lista se ha utilizado?')}</strong> ${L('La proclamació del BOE del 3 de novembre i la correcció del 7 de novembre. PACMA i Por un Mundo Más Justo hi consten com a no proclamades a Barcelona; no formen part del test.', 'La proclamación del BOE del 3 de noviembre y la corrección del 7 de noviembre. PACMA y Por un Mundo Más Justo constan como no proclamadas en Barcelona; no forman parte del test.')} <a href="https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-23103" target="_blank" rel="noopener noreferrer">${L('Consulta el BOE ↗', 'Consulta el BOE ↗')}</a></div></div>`;
}
function method() {
  return `<div class="container article"><div class="page-head"><div class="eyebrow">${L('Un mètode que pots examinar', 'Un método que puedes examinar')}</div><h1>${L('Les fonts són el punt de partida.', 'Las fuentes son el punto de partida.')}</h1><p>${L('Afinitat compara mesures, mostra què sap i fa explícit què queda per documentar.', 'Afinitat compara medidas, muestra lo que sabe y hace explícito lo que queda por documentar.')}</p></div>
  ${L(`<h2>1. Preguntes sobre mesures reals</h2><p>Pots triar entre el test curt de 15 preguntes (6–8 minuts), l’ampliat de 30 (12–15 minuts), el complet de 50 (20–25 minuts) i l’extens de 100 (40–50 minuts). Cada format inclou totes les preguntes de l’anterior; si ja n’has respost algunes, abans de començar et proposarem aprofitar-les. Comparteixen un banc de preguntes amb entre 2 i 5 opcions. Les opcions són síntesis en català de propostes identificades als documents, amb la pàgina o apartat d’origen. No són cites literals. Diverses mesures poden ser compatibles: se’t demana quina prioritzaries.</p>`,
  `<h2>1. Preguntas sobre medidas reales</h2><p>Puedes elegir entre el test corto de 15 preguntas (6–8 minutos), el ampliado de 30 (12–15 minutos), el completo de 50 (20–25 minutos) y el extenso de 100 (40–50 minutos). Cada formato incluye todas las preguntas del anterior; si ya has respondido algunas, antes de empezar te propondremos aprovecharlas. Comparten un banco de preguntas con entre 2 y 5 opciones. Las opciones son síntesis de propuestas identificadas en los documentos, con la página o el apartado de origen; se redactaron en catalán y esta versión es una traducción. No son citas literales. Varias medidas pueden ser compatibles: se te pide cuál priorizarías.</p>`)}
  ${state.content.topicAnalysis ? `<h3>${L('Com hem seleccionat els temes?', '¿Cómo hemos seleccionado los temas?')}</h3><p>${h(state.content.topicAnalysis.method)}</p><div class="theme-list">${state.content.topicAnalysis.topics.map(t=>`<details><summary>${h(t.name)} <span>${t.partyIds.length} ${L('candidatures', 'candidaturas')} · ${t.questionIds.length} ${L('preguntes', 'preguntas')}</span></summary><p>${t.partyIds.map(id=>h(partyName(state.content.parties.find(p=>p.id===id)))).join(' · ')}</p>${t.evidence.map(e=>`<div class="theme-evidence"><strong>${h(partyName(state.content.parties.find(p=>p.id===e.partyId)))}</strong> ${sourceLinks(e.sourceRefs)}</div>`).join('')}</details>`).join('')}</div>` : ''}
  ${L(`<h2>2. Una valoració editorial visible</h2><p>Per a cada partit amb una posició documentada, interpretem la relació entre la mesura que has triat i la seva proposta:</p><ul><li><strong>1:</strong> coincidència directa amb la mesura central.</li><li><strong>0,5:</strong> coincidència parcial.</li><li><strong>0:</strong> una mesura diferent però compatible amb la teva: podrien conviure. No suma ni resta i queda fora del càlcul, perquè no sabem si el partit hi està d’acord. Es mostra a l’explicació.</li><li><strong>−1:</strong> una mesura oposada. Resta tant com suma una coincidència. Només quan la font la rebutja, en demana la derogació o proposa una alternativa que l’exclou.</li><li><strong>Sense dades:</strong> no es puntua ni entra al denominador.</li></ul><p>Les explicacions dels resultats mostren la justificació de cada valoració. Aquesta primera versió és experimental i necessita revisió editorial humana per detectar biaixos o matisos perduts en la síntesi.</p>`,
  `<h2>2. Una valoración editorial visible</h2><p>Para cada partido con una posición documentada, interpretamos la relación entre la medida que has elegido y su propuesta:</p><ul><li><strong>1:</strong> coincidencia directa con la medida central.</li><li><strong>0,5:</strong> coincidencia parcial.</li><li><strong>0:</strong> una medida diferente pero compatible con la tuya: podrían convivir. No suma ni resta y queda fuera del cálculo, porque no sabemos si el partido está de acuerdo. Se muestra en la explicación.</li><li><strong>−1:</strong> una medida opuesta. Resta tanto como suma una coincidencia. Solo cuando la fuente la rechaza, pide su derogación o propone una alternativa que la excluye.</li><li><strong>Sin datos:</strong> no se puntúa ni entra en el denominador.</li></ul><p>Las explicaciones de los resultados muestran la justificación de cada valoración. Esta primera versión es experimental y necesita revisión editorial humana para detectar sesgos o matices perdidos en la síntesis.</p>`)}
  ${L(`<h2>3. El càlcul i la cobertura</h2><div class="formula">Índex d’afinitat = 100 × suma de valors ponderats / suma de pesos comparables (les mesures compatibles en queden fora, com les preguntes sense posició).</div><p>L’índex va de 0% a 100%. Quan les mesures oposades pesen tant o més que les coincidències, es mostra 0%; els partits que hi queden s’ordenen pel balanç real. Un tema normal pesa 1 i un tema destacat pesa 2, també quan resta. Ometre una pregunta no penalitza ningú. Pots consultar els resultats amb qualsevol nombre de respostes. Una sola comparació documentada permet mostrar el percentatge i entrar a l’ordenació principal, sense llindar de cobertura. Si no hi ha cap comparació, es mostren la informació i les fonts disponibles sense inventar un percentatge. En cas d’empat, les candidatures comparteixen resultat.</p><p>La cobertura és el nombre de respostes que podem comparar amb el partit dividit pel nombre que has contestat. Un 90% amb poca cobertura i un 80% amb cobertura completa no són equivalents. El percentatge no és una probabilitat de vot ni una valoració del compliment de les promeses.</p>`,
  `<h2>3. El cálculo y la cobertura</h2><div class="formula">Índice de afinidad = 100 × suma de valores ponderados / suma de pesos comparables (las medidas compatibles quedan fuera, como las preguntas sin posición).</div><p>El índice va del 0% al 100%. Cuando las medidas opuestas pesan tanto o más que las coincidencias, se muestra 0%; los partidos que quedan ahí se ordenan por el balance real. Un tema normal pesa 1 y un tema destacado pesa 2, también cuando resta. Omitir una pregunta no penaliza a nadie. Puedes consultar los resultados con cualquier número de respuestas. Una sola comparación documentada permite mostrar el porcentaje y entrar en la ordenación principal, sin umbral de cobertura. Si no hay ninguna comparación, se muestran la información y las fuentes disponibles sin inventar un porcentaje. En caso de empate, las candidaturas comparten resultado.</p><p>La cobertura es el número de respuestas que podemos comparar con el partido dividido por el número que has contestado. Un 90% con poca cobertura y un 80% con cobertura completa no son equivalentes. El porcentaje no es una probabilidad de voto ni una valoración del cumplimiento de las promesas.</p>`)}
  ${L(`<h2>4. Programes i documents relacionats</h2><p>Les referències polítiques generals, els programes d’altres eleccions, els esborranys i els programes d’una formació vinculada no es presenten com a programes propis confirmats. Tots els partits s’ordenen junts per afinitat, independentment del tipus de document. Cada document té una nota de procedència, i les absències continuen visibles al catàleg.</p><p>Per a PSOE (candidatura PSC–PSOE a Barcelona), el comparador utilitza el programa electoral estatal del PSOE com a programa del PSC i l’inclou en l’ordenació principal. Les cites conserven l’autoria del document original.</p><p>La llista és la de candidatures al Congrés per Barcelona, no la del Senat. Els programes, les interpretacions i els resultats tenen versió: el teu historial conserva la puntuació que vas obtenir en aquell moment i es mostra amb la mateixa classificació unificada.</p>`,
  `<h2>4. Programas y documentos relacionados</h2><p>Las referencias políticas generales, los programas de otras elecciones, los borradores y los programas de una formación vinculada no se presentan como programas propios confirmados. Todos los partidos se ordenan juntos por afinidad, independientemente del tipo de documento. Cada documento tiene una nota de procedencia, y las ausencias siguen visibles en el catálogo.</p><p>Para el PSOE (candidatura PSC–PSOE en Barcelona), el comparador utiliza el programa electoral estatal del PSOE como programa del PSC y lo incluye en la ordenación principal. Las citas conservan la autoría del documento original.</p><p>La lista es la de candidaturas al Congreso por Barcelona, no la del Senado. Los programas, las interpretaciones y los resultados tienen versión: tu historial conserva la puntuación que obtuviste en aquel momento y se muestra con la misma clasificación unificada.</p>`)}
  <h2>${L('5. Les teves dades', '5. Tus datos')}</h2>${STATIC ? L(`<p>Aquesta és la versió pública. No té comptes ni servidor: el càlcul es fa al teu dispositiu i les respostes es guarden només en aquest navegador, perquè puguis continuar el test més tard. No s’envien enlloc i ningú, ni tan sols qui ha publicat la pàgina, les pot veure. Per esborrar-les, torna a fer el test des de zero o esborra les dades d’aquest lloc al navegador. No hi ha analítica.</p>`,
    `<p>Esta es la versión pública. No tiene cuentas ni servidor: el cálculo se hace en tu dispositivo y las respuestas se guardan solo en este navegador, para que puedas continuar el test más tarde. No se envían a ningún sitio y nadie, ni siquiera quien ha publicado la página, puede verlas. Para borrarlas, vuelve a hacer el test desde cero o borra los datos de este sitio en el navegador. No hay analítica.</p>`)
    : L(`<p>Pots fer el test sense compte: les respostes es mantenen només a la memòria de la pestanya i el servidor les utilitza per calcular el resultat, sense desar-les. En tancar o recarregar la pàgina es perd aquest esborrany. Amb compte, pots prémer «Desa i continua més tard» per guardar un test a mitges i reprendre’l des de «Tests pendents».</p><p>Si et registres, et demanem pseudònim, nom a mostrar, contrasenya i consentiment per guardar respostes i afinitats polítiques. Pots decidir no guardar un test, eliminar els tests pendents, exportar les dades del teu compte o esborrar-lo amb el seu historial. No hi ha analítica ni peticions a serveis externs durant el test.</p><p>La base JSON és a «Base de dades», al teu ordinador. Les contrasenyes es deriven amb scrypt; les respostes i els resultats són llegibles en el JSON per qui tingui accés a aquesta carpeta. Com que el projecte és dins de OneDrive, la seva sincronització depèn de la configuració de OneDrive. Aquesta versió escolta només a 127.0.0.1.</p>`,
    `<p>Puedes hacer el test sin cuenta: las respuestas se mantienen solo en la memoria de la pestaña y el servidor las utiliza para calcular el resultado, sin guardarlas. Al cerrar o recargar la página se pierde este borrador. Con cuenta, puedes pulsar «Guarda y continúa más tarde» para guardar un test a medias y retomarlo desde «Tests pendientes».</p><p>Si te registras, te pedimos seudónimo, nombre visible, contraseña y consentimiento para guardar respuestas y afinidades políticas. Puedes decidir no guardar un test, eliminar los tests pendientes, exportar los datos de tu cuenta o borrarla con su historial. No hay analítica ni peticiones a servicios externos durante el test.</p><p>La base JSON está en «Base de dades», en tu ordenador. Las contraseñas se derivan con scrypt; las respuestas y los resultados son legibles en el JSON para quien tenga acceso a esa carpeta. Como el proyecto está dentro de OneDrive, su sincronización depende de la configuración de OneDrive. Esta versión escucha solo en 127.0.0.1.</p>`)}<a class="button" href="#programes">${L('Consulta totes les fonts ↗', 'Consulta todas las fuentes ↗')}</a></div>`;
}
async function account(id) {
  if (!state.user) return `<div class="container"><div class="page-head"><h1>${L('Les teves idees, al llarg del temps.', 'Tus ideas, a lo largo del tiempo.')}</h1><p>${L('Inicia sessió per consultar els resultats que has guardat.', 'Inicia sesión para consultar los resultados que has guardado.')}</p></div>${button('auth',L('Inicia sessió →', 'Inicia sesión →'))}</div>`;
  const [data, pending] = await Promise.all([api('/api/history'), api('/api/drafts').catch(e => { if (e.status === 401) throw e; return { drafts: [], error: e.message }; })]);
  if (id !== renderId) return null;
  // El servidor retorna el nom del format en català; en castellà es pren del contingut traduït.
  const draftName = d => (LANG === 'es' && quizzes().find(q => q.id === d.quizId)?.name) || d.quizName;
  const pendingRow = d => `<article class="history-row"><div><strong>${h(draftName(d))} · ${d.answeredCount}/${d.totalQuestions} ${L('respostes', 'respuestas')}</strong><p>${L('Desat', 'Guardado')} ${h(date(d.updatedAt))} · Pregunta ${Math.min(d.step + 1, d.totalQuestions)} de ${d.totalQuestions}</p>${d.contentVersion !== state.content.version ? `<p class="small-note">${L(`Desat amb la versió ${h(d.contentVersion)}. Es recuperaran les respostes que encara formin part del test.`, `Guardado con la versión ${h(d.contentVersion)}. Se recuperarán las respuestas que aún formen parte del test.`)}</p>` : ''}</div><div class="row-actions">${button('resume-draft',L('Continua el test →', 'Continúa el test →'),'small',`data-id="${h(d.id)}"`)}<button class="text-button" data-action="delete-draft" data-id="${h(d.id)}">${L('Elimina', 'Elimina')}</button></div></article>`;
  const pendingPanel = `<section class="account-panel pending-panel"><h2>${L('Tests pendents', 'Tests pendientes')}</h2><p class="small-note">${L('Tests que has desat a mitges. Continua’ls on els vas deixar.', 'Tests que has guardado a medias. Continúalos donde los dejaste.')}</p>${pending.error ? `<p class="error-box">${h(pending.error)}</p>` : pending.drafts.length ? pending.drafts.map(pendingRow).join('') : `<p class="small-note">${L('No tens cap test pendent. Mentre fas un test, prem «Desa i continua més tard».', 'No tienes ningún test pendiente. Mientras haces un test, pulsa «Guarda y continúa más tarde».')}</p>`}</section>`;
  return `<div class="container"><div class="page-head"><div class="eyebrow">${L('El teu espai personal', 'Tu espacio personal')}</div><h1>Hola, ${h(state.user.name)}.</h1><p>${L('Consulta els teus tests i decideix quines dades vols conservar.', 'Consulta tus tests y decide qué datos quieres conservar.')}</p></div>${pendingPanel}<div class="account-grid"><section class="account-panel"><h2>${L('El teu historial', 'Tu historial')}</h2>${data.attempts.length ? data.attempts.map(a=>`<article class="history-row"><div><strong>${h(date(a.createdAt))}</strong><p>${h(quizLabel(a))} · ${a.answeredCount}/${a.totalQuestions ?? 15} ${L('respostes', 'respuestas')} · ${L('Versió', 'Versión')} ${h(a.contentVersion)}</p><p>${a.leaders.length ? a.leaders.map(p=>`${h(partyName(p))} ${p.score}%`).join(' · ') : L('Sense comparacions documentades', 'Sin comparaciones documentadas')}</p></div><div class="row-actions"><button class="text-button" data-action="open-result" data-id="${h(a.id)}">${L('Consulta ↗', 'Consulta ↗')}</button><button class="text-button" data-action="resume-attempt" data-id="${h(a.id)}">${a.answeredCount < (a.totalQuestions ?? 15) ? L('Continua les respostes', 'Continúa las respuestas') : L('Edita les respostes', 'Edita las respuestas')}</button></div></article>`).join('') : `<p class="small-note">${L('Encara no has guardat cap test. El primer serà el teu punt de partida.', 'Aún no has guardado ningún test. El primero será tu punto de partida.')}</p>`}${button('restart',L('Fes un nou test →', 'Haz un nuevo test →'),'small')}</section><section class="account-panel"><h2>${L('Tu controles les dades.', 'Tú controlas los datos.')}</h2><p class="small-note">${L('Usuari:', 'Usuario:')} <strong>${h(state.user.username)}</strong><br>${L('Consentiment registrat:', 'Consentimiento registrado:')} ${h(date(state.user.consentAt))}</p><a class="button light small" href="/api/account/export" download>${L('Exporta les meves dades ↓', 'Exporta mis datos ↓')}</a><p class="small-note">${L('Un JSON amb el teu compte, les respostes, els resultats i els tests pendents. Sense la contrasenya ni les sessions.', 'Un JSON con tu cuenta, las respuestas, los resultados y los tests pendientes. Sin la contraseña ni las sesiones.')}</p>${button('logout',L('Tanca la sessió', 'Cierra la sesión'),'subtle small')}<details class="danger-zone"><summary>${L('Esborra el compte i l’historial', 'Borra la cuenta y el historial')}</summary><p>${L('S’eliminaran el compte, totes les respostes, els resultats i les sessions. Aquesta acció no es pot desfer.', 'Se eliminarán la cuenta, todas las respuestas, los resultados y las sesiones. Esta acción no se puede deshacer.')}</p><form id="delete-form"><label class="field">${L('Confirma la contrasenya', 'Confirma la contraseña')}<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label><div class="form-error" role="alert"></div><button class="button danger small" type="submit">${L('Esborra definitivament el compte', 'Borra definitivamente la cuenta')}</button></form></details></section></div></div>`;
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
      case 'compte': main.innerHTML=`<div class="loading">${L('Carregant el teu historial…', 'Cargando tu historial…')}</div>`; html=await account(id); break;
      default: html=home();
    }
    if(id !== renderId || html === null) return;
    main.innerHTML=html; focusMain();
  } catch(e) {
    if(id !== renderId)return;
    if(e.status === 401 && route === 'compte') {
      main.innerHTML=await account(id);focusMain();
      toast(L('La sessió ja no és vàlida. Torna a iniciar-la; les respostes del test es conserven en aquesta pestanya.', 'La sesión ya no es válida. Vuelve a iniciarla; las respuestas del test se conservan en esta pestaña.'));
    } else main.innerHTML=`<div class="container"><div class="page-head"><h1>${L('No s’ha pogut carregar.', 'No se ha podido cargar.')}</h1><p class="error-box">${h(e.message)}</p><a href="#inici">${L('Torna a l’inici', 'Vuelve al inicio')}</a></div></div>`;
  }
}
function authForm(mode='login') {
  state.authMode=mode;
  const signup=mode==='register';
  document.querySelector('#auth-content').innerHTML=`<div class="dialog-header"><h2 id="auth-title">${signup ? L('Crea el teu espai.', 'Crea tu espacio.') : L('Benvingut de nou.', 'Bienvenido de nuevo.')}</h2><button class="close-button" data-action="close-auth" aria-label="${L('Tanca', 'Cerrar')}">×</button></div><p class="auth-subtitle">${signup ? L('Un compte local per guardar i comparar els teus resultats.', 'Una cuenta local para guardar y comparar tus resultados.') : L('Recupera els teus resultats i continua explorant.', 'Recupera tus resultados y sigue explorando.')}</p><form id="auth-form">${signup ? `<label class="field">${L('Nom a mostrar', 'Nombre visible')}<input name="name" autocomplete="nickname" required maxlength="60" placeholder="${L('Com vols que et diguem?', '¿Cómo quieres que te llamemos?')}"></label>` : ''}<label class="field">${L('Nom d’usuari', 'Nombre de usuario')}<input name="username" autocomplete="username" required minlength="3" maxlength="40" placeholder="${L('El teu pseudònim', 'Tu seudónimo')}"><small>${L('Lletres sense accents, números, punts o guions. No cal correu.', 'Letras sin acentos, números, puntos o guiones. No hace falta correo.')}</small></label><label class="field">${L('Contrasenya', 'Contraseña')}<input type="password" name="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required ${signup ? 'minlength="10"' : ''} maxlength="128">${signup ? `<small>${L('Com a mínim 10 caràcters. No hi ha recuperació per correu en aquesta versió local.', 'Como mínimo 10 caracteres. No hay recuperación por correo en esta versión local.')}</small>` : ''}</label>${signup ? `<label class="consent"><input type="checkbox" name="consent" required><span>${L('Consento explícitament que aquesta aplicació guardi les meves respostes i afinitats polítiques associades al compte. Puc exportar-les i esborrar-les. La base és a la carpeta local del projecte, que pot sincronitzar-se amb OneDrive.', 'Consiento explícitamente que esta aplicación guarde mis respuestas y afinidades políticas asociadas a la cuenta. Puedo exportarlas y borrarlas. La base está en la carpeta local del proyecto, que puede sincronizarse con OneDrive.')}</span></label>` : ''}<div class="form-error" role="alert"></div><button class="button auth-submit" type="submit">${signup ? L('Crea el compte', 'Crea la cuenta') : L('Inicia sessió', 'Inicia sesión')} →</button></form><div class="dialog-switch">${signup ? L('Ja tens un compte?', '¿Ya tienes una cuenta?') : L('És el primer cop?', '¿Es la primera vez?')} <button class="text-button" data-action="${signup ? 'show-login' : 'show-register'}">${signup ? L('Inicia sessió', 'Inicia sesión') : L('Crea un compte', 'Crea una cuenta')}</button></div>`;
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
  if(action==='set-lang'){if(el.dataset.lang===LANG)return;return setLang(el.dataset.lang);}
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
    toast(ok?L('Resum copiat. Ja el pots enganxar on vulguis.', 'Resumen copiado. Ya puedes pegarlo donde quieras.'):L(`No s’ha pogut copiar automàticament. Resum: ${text}`, `No se ha podido copiar automáticamente. Resumen: ${text}`));
    return;
  }
  if(action==='choose-tests'){document.querySelector('#tests')?.scrollIntoView({behavior:'smooth'});document.querySelector('#tests')?.focus({preventScroll:true});return;}
  if(action==='start'){const id=el.dataset.quiz ?? state.quizId;if(!quizzes().some(q=>q.id===id))return;if(id===state.quizId&&Object.keys(state.answers).length){state.pendingReuse=null;if(state.step>=questions().length)state.step=0;return go('test');}return startWithReuse(id);}
  if(action==='reuse-yes'){const r=state.pendingReuse;if(!r)return;const answers={},weights={};for(const [id,f] of Object.entries(r.found)){answers[id]=f.option;if(f.weight===2)weights[id]=2;}loadSelection(r.quizId,answers,weights);state.dirty=Object.values(r.found).some(f=>f.source==='tab');go('test');return toast(L(`S’han recuperat ${Object.keys(answers).length} respostes. Pots revisar-les i canviar-les quan vulguis.`, `Se han recuperado ${Object.keys(answers).length} respuestas. Puedes revisarlas y cambiarlas cuando quieras.`));}
  if(action==='reuse-no'){state.pendingReuse=null;state.step=0;return render();}
  if(action==='restart'){if(!confirmReplace())return;if(currentRoute()==='resultats')state.quizId=state.result?.quizId ?? 'curt';state.answers={};state.weights={};state.step=0;state.draftId=null;state.dirty=false;return go('test');}
  if(action==='resume-result'){if(!state.result||!confirmReplace())return;const dropped=loadSelection(state.result.quizId ?? 'curt',state.lastAnswers,state.lastWeights);state.draftId=null;go('test');return toast(`${L('Respostes recuperades. Si guardes el resultat, se’n crearà un de nou i l’original es conservarà.', 'Respuestas recuperadas. Si guardas el resultado, se creará uno nuevo y el original se conservará.')}${droppedNote(dropped)}`);}
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
        data=await api('/api/results',{answers,weights,quizId,version:state.content.version,save,...(save&&draftId?{draftId}:{}),...langField()});
      } catch(e) {
        if(e.status !== 401 || !save)throw e;
        data=await api('/api/results',{answers,weights,quizId,version:state.content.version,save:false,...langField()});
        toast(L('El resultat no s’ha desat perquè la sessió ja no és vàlida. Inicia sessió per guardar-lo; les respostes es conserven en aquesta pestanya.', 'El resultado no se ha guardado porque la sesión ya no es válida. Inicia sesión para guardarlo; las respuestas se conservan en esta pestaña.'));
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
        go('test');toast(`${L('Has recuperat el test on el vas deixar.', 'Has recuperado el test donde lo dejaste.')}${droppedNote(dropped)}`);
      }else{
        const attempt=await api(`/api/history/${encodeURIComponent(el.dataset.id)}`);
        const dropped=loadSelection(attempt.result?.quizId ?? attempt.quizId ?? 'curt',attempt.answers,attempt.weights);state.draftId=null;
        go('test');toast(`${L('Respostes recuperades. Si guardes el resultat, se’n crearà un de nou i l’original es conservarà.', 'Respuestas recuperadas. Si guardas el resultado, se creará uno nuevo y el original se conservará.')}${droppedNote(dropped)}`);
      }
    }else if(action==='delete-draft'){
      if(typeof window.confirm==='function'&&!window.confirm(L('Vols eliminar aquest test pendent? Aquesta acció no es pot desfer.', '¿Quieres eliminar este test pendiente? Esta acción no se puede deshacer.')))return;
      await api(`/api/drafts/${encodeURIComponent(el.dataset.id)}/delete`,{});
      if(state.draftId===el.dataset.id){state.draftId=null;state.dirty=true;}
      await render();toast(L('Test pendent eliminat.', 'Test pendiente eliminado.'));
    }else if(action==='recalculate'){
      const answers=structuredClone(state.lastAnswers);const weights=structuredClone(state.lastWeights);
      const data=await api('/api/results',{answers,weights,quizId:state.result.quizId ?? 'curt',version:state.content.version,save:false,...langField()});
      setResult(data,answers,weights);await render();toast(L('Resultat actualitzat amb les mateixes respostes. El pots guardar al teu historial.', 'Resultado actualizado con las mismas respuestas. Puedes guardarlo en tu historial.'));
    }else if(action==='save-last'){
      const draftId=state.lastDraftId;const data=await api('/api/results',{answers:state.lastAnswers,weights:state.lastWeights,quizId:state.result.quizId ?? 'curt',version:state.result.version,save:true,...(draftId?{draftId}:{}),...langField()});setResult(data,state.lastAnswers,state.lastWeights);state.lastDraftId=null;if(draftId&&state.draftId===draftId)state.draftId=null;render();toast(L('Resultat desat al teu historial.', 'Resultado guardado en tu historial.'));
    }else if(action==='logout'){
      await api('/api/logout',{});state.user=null;state.result=null;state.resultId=null;state.answers={};state.weights={};state.step=0;state.draftId=null;state.lastDraftId=null;state.dirty=false;go('inici');toast(L('Has tancat la sessió.', 'Has cerrado la sesión.'));
    }else if(action==='open-result'){
      const data=await api(`/api/history/${encodeURIComponent(el.dataset.id)}`);setResult(data,data.answers,data.weights);go('resultats');
    }
  }catch(e){
    if(e.status === 401 && ['save-last','open-result','resume-draft','resume-attempt','delete-draft'].includes(action)) {
      await render();toast(L('La sessió ja no és vàlida. Inicia sessió per continuar; les respostes es conserven en aquesta pestanya.', 'La sesión ya no es válida. Inicia sesión para continuar; las respuestas se conservan en esta pestaña.'));
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
    if(dot){dot.classList.add('done');dot.ariaLabel=`Pregunta ${state.step+1}${L(', resposta', ', respondida')}`;}
    const counter=document.querySelector('#response-count');if(counter)counter.textContent=String(Object.keys(state.answers).length);
  }
  if(event.target.id==='important'){state.weights[q.id]=event.target.checked?2:1;state.dirty=true;}
  storeLocal();
});
document.addEventListener('input',event=>{
  if(event.target.id==='party-search'){
    document.querySelector('#program-grid').innerHTML=programCards(event.target.value);
    const count = document.querySelectorAll('.program-card').length;
    document.querySelector('#party-count').textContent=`${count} ${count === 1 ? 'candidatura' : L('candidatures', 'candidaturas')}`;
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
        throw new Error(`${register ? L('El compte s’ha creat, però no s’ha pogut mantenir la sessió. ', 'La cuenta se ha creado, pero no se ha podido mantener la sesión. ') : ''}${L('El navegador no ha conservat la sessió. Comprova que permet les galetes d’aquest lloc i inicia sessió de nou. Les respostes del test continuen en aquesta pestanya.', 'El navegador no ha conservado la sesión. Comprueba que permite las cookies de este sitio e inicia sesión de nuevo. Las respuestas del test siguen en esta pestaña.')}`);
      }
      state.user=session.user;form.reset();dialog.close();render();toast(register?L('Compte creat. Ja pots guardar els teus resultats.', 'Cuenta creada. Ya puedes guardar tus resultados.'):L('Sessió iniciada.', 'Sesión iniciada.'));
      if(state.pendingDraftSave){try{await saveDraft();}catch(saveError){toast(saveError.message);}}
    }else{
      await api('/api/account/delete',{password:formData.get('password')});state.user=null;state.result=null;state.resultId=null;state.answers={};state.weights={};state.step=0;state.draftId=null;state.lastDraftId=null;state.dirty=false;go('inici');toast(L('Compte, respostes i resultats esborrats.', 'Cuenta, respuestas y resultados borrados.'));
    }
  }catch(e){
    const target=form.id === 'auth-form' ? dialog.querySelector('.form-error') : error;
    target.innerHTML=`<p class="error-box">${h(e.message)}</p>`;
  }
  finally{submit.disabled=false;}
});
window.addEventListener('hashchange',render);
window.addEventListener('beforeunload',event=>{if(!STATIC&&unsavedAnswers()){event.preventDefault();event.returnValue='';}});
langSwitch();
if(LANG==='es'){applyStaticTexts();main.innerHTML='<div class="loading">Preparando las fuentes del test…</div>';}
try{
  // Si la persona havia triat el castellà, la superposició es carrega abans del primer render.
  const overlay=LANG==='es'?api('/api/content-es').catch(e=>({failed:e})):null;
  const [content,me,es]=await Promise.all([api('/api/content'),api('/api/me'),overlay]);
  state.contentCa=content;state.content=content;state.user=me.user;
  let overlayError=null;
  if(es?.failed){overlayError=es.failed;LANG='ca';langSwitch();applyStaticTexts();}
  else if(es){state.overlayEs=es;state.content=applyOverlay(content,es);}
  if(STATIC)loadLocal();render();
  if(overlayError)toast(`No s’ha pogut carregar la versió en castellà; la interfície es mostra en català. (${overlayError.message})`);
}catch(e){main.innerHTML=`<div class="container"><div class="page-head"><h1>${L('No hem pogut obrir Afinitat.', 'No hemos podido abrir Afinitat.')}</h1><p class="error-box">${h(e.message)}</p><p>${STATIC ? L('Recarrega la pàgina d’aquí a uns moments.', 'Recarga la página dentro de unos momentos.') : L('Comprova que el servidor local està en marxa i recarrega la pàgina.', 'Comprueba que el servidor local está en marcha y recarga la página.')}</p></div></div>`;}
