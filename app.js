/* ---- 01-core.js ---- */
'use strict';
/* 진학 나침반 — 학생부는 이 기기 밖으로 나가지 않는다.
   네트워크 요청 0 (CSP connect-src 'none'), 외부 AI 호출 0, 분석 수집 0. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rxEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nsp = s => String(s ?? '').replace(/\s+/g, '');
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const fmt = (v, d = 2) => (v == null || !isFinite(v)) ? '-' : Number(v).toFixed(d);

const NOW = new Date();
const SCHOOL_YEAR = NOW.getMonth() >= 2 ? NOW.getFullYear() : NOW.getFullYear() - 1;
const GRADES = ['고1', '고2', '고3', '졸업생'];
const entryFromGrade = g => ({ '고1': SCHOOL_YEAR, '고2': SCHOOL_YEAR - 1, '고3': SCHOOL_YEAR - 2, '졸업생': SCHOOL_YEAR - 3 }[g] ?? SCHOOL_YEAR - 1);
const currFromEntry = y => (Number(y) >= 2025 ? '2022' : '2015');
const sysOf = curr => (curr === '2022' ? 5 : 9);
const currLabel = c => (c === '2022' ? '2022 개정 · 5등급' : '2015 개정 · 9등급');
const MOE_URL = 'https://www.korea.kr/news/policyNewsView.do?newsId=148967564';
const ADIGA_URL = 'https://www.adiga.kr';

/* ---------- 비민감 설정만 localStorage ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('jn.v1.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('jn.v1.' + k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem('jn.v1.' + k); } catch { } }
};
function defaultProfile() {
  return { grade: '고2', entry: entryFromGrade('고2'), curr: currFromEntry(entryFromGrade('고2')), currManual: false, rural: false, interest: '', set: false };
}
function newRec() {
  return { step: 1, raw: '', masked: '', hits: {}, extra: '', confirmed: false, demo: false, pdfName: '', analyzed: false,
    areas: {}, items: [], grades: [], subjects: [], evidence: null, system: null, tab: 'grade', fit: { univ: '', unit: '' } };
}
const S = {
  profile: Object.assign(defaultProfile(), LS.get('profile', {})),
  cands: LS.get('cands', []),
  rec: newRec(),
  check: { univ: '', answers: {}, shown: {} },
  mj: { q: '', dept: null, keys: [], univ: null, uq: '', bu: false, view: 'search' },
  iv: { univ: '', dept: '', picks: {}, queue: [], i: 0, phase: '', answers: [], mode: 'write', think: 30, tab: 'gichul' },
  rural: { type: '6', checks: {} },
  teacher: { cases: [], conv: { mode: 'mean', v: '' } }
};
function saveProfile() { LS.set('profile', S.profile); }
function saveCands() { LS.set('cands', S.cands); }

/* ---------- 데이터: gzip+base64 → DecompressionStream ---------- */
const DS = {};
async function gunzipB64(b64) {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const st = new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(st).text();
}
async function ds(name) {
  if (DS[name]) return DS[name];
  const src = (window.JN_DATA || {})[name];
  if (!src) return (DS[name] = []);
  const j = JSON.parse(await gunzipB64(src));
  return (DS[name] = j.r.map(r => { const o = {}; j.h.forEach((h, i) => (o[h] = r[i] ?? '')); return o; }));
}
async function need(names) { for (const n of names) await ds(n); }

/* ---------- 이름 맞추기 ---------- */
const uniNorm = s => nsp(s).replace(/대학교/g, '대').replace(/^국립/, '');
const uniBase = s => uniNorm(s).replace(/\(.*?\)/g, '');
function sameUni(a, b) { if (!a || !b) return false; const x = uniNorm(a), y = uniNorm(b); return x === y || uniBase(a) === uniBase(b); }
function deptKey(n) {
  const s = nsp(n).replace(/\(.*?\)/g, '');
  let k = s.replace(/(학과|학부|전공|과)$/, '');
  if (k.length < 2) k = s;
  return k;
}
const BUK = ['경상국립대', '창원대', '경남대', '인제대', '부산대', '부경대', '동아대', '동의대', '경성대', '신라대', '부산외대', '부산외국어대', '한국해양대',
  '울산대', '영산대', '가야대', '동서대', '고신대', '부산가톨릭대', '진주교대', '부산교대', '창신대', '울산과학기술원', 'UNIST', '부산장신대', '한국국제대', '경남정보대', '동명대'];
const isBUK = u => BUK.some(b => uniBase(u).startsWith(b));
// 전형 이름 비교용
const tkNorm = s => nsp(s).replace(/\(.*?\)|전형|학생부|교과|종합|논술|정원내|정원외|[_\-·.]/g, '');
function sameTrack(a, b) {
  const x = tkNorm(a), y = tkNorm(b);
  if (!x || !y) return nsp(a) === nsp(b);
  return x === y || (x.length >= 2 && y.includes(x)) || (y.length >= 2 && x.includes(y));
}

/* ---------- 등급 환산(참고) ---------- */
const NINE_BOUNDS = [0, 4, 11, 23, 40, 60, 77, 89, 96, 100], FIVE_BOUNDS = [0, 10, 34, 66, 90, 100];
function gradeBand9(g) {
  if (!Number.isInteger(g) || g < 1 || g > 9) return null;
  const lo = NINE_BOUNDS[g - 1], hi = NINE_BOUNDS[g]; const overlaps = []; let ref = 0;
  for (let j = 1; j <= 5; j++) { const w = Math.max(0, Math.min(hi, FIVE_BOUNDS[j]) - Math.max(lo, FIVE_BOUNDS[j - 1])); if (w > 0) { overlaps.push(j); ref += w * j; } }
  return { lo, hi, overlaps, reference: ref / (hi - lo) };
}
function gradeMean9(g) {
  g = Number(g); if (!Number.isFinite(g) || g < 1 || g > 9) return null;
  const a = Math.floor(g), b = Math.ceil(g), x = gradeBand9(a).reference, y = gradeBand9(b).reference;
  return x + (g - a) * (y - x);
}
function percentileFive(p) { if (!Number.isFinite(p) || p < 0 || p > 100) return null; for (let i = 1; i <= 5; i++) if (p <= FIVE_BOUNDS[i]) return i; return 5; }
function wavg(rows) {
  let s = 0, w = 0;
  rows.forEach(r => { const g = Number(r.등급), c = Number(r.학점); if (g >= 1 && g <= 9 && c > 0) { s += g * c; w += c; } });
  return w ? { avg: s / w, credits: w } : null;
}
/* 과목별: 홀수 등급은 (g+1)/2 고정, 짝수 등급은 g/2 ~ g/2+1 두 구간 → 학점 가중 최소~최대 */
function band5(rows) {
  let lo = 0, hi = 0, w = 0;
  rows.forEach(r => {
    const g = Math.round(Number(r.등급)), c = Number(r.학점);
    if (g >= 1 && g <= 9 && c > 0) { const a = g % 2 ? (g + 1) / 2 : g / 2, b = g % 2 ? (g + 1) / 2 : g / 2 + 1; lo += a * c; hi += b * c; w += c; }
  });
  return w ? { lo: lo / w, hi: hi / w } : null;
}

/* ---------- 작은 도구 ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
function copyText(text) {
  const done = () => toast('복사했어요.');
  const fallback = () => {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { } ta.remove();
    ok ? done() : toast('복사가 막혔어요. 직접 선택해서 복사해 주세요.');
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}
function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const R = []; let r = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { r.push(f.trim()); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; r.push(f.trim()); f = ''; if (r.some(x => x)) R.push(r); r = []; }
    else f += c;
  }
  if (f || r.length) { r.push(f.trim()); if (r.some(x => x)) R.push(r); }
  return R;
}

/* ---------- 로고 ---------- */
function logoSVG(cls = 'logo') {
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="32" cy="32" r="30" fill="#14213D"/><circle cx="32" cy="32" r="24" fill="none" stroke="#21C3B0" stroke-width="4"/>
  <g fill="#FFC93C"><circle cx="32" cy="5.5" r="2.6"/><circle cx="58.5" cy="32" r="2"/><circle cx="32" cy="58.5" r="2"/><circle cx="5.5" cy="32" r="2"/></g>
  <path d="M32 11 L38.5 32 L32 29 L25.5 32 Z" fill="#FF8F5A"/><path d="M32 53 L25.5 32 L32 35 L38.5 32 Z" fill="#FFFFFF"/>
  <circle cx="32" cy="32" r="4" fill="#FFC93C" stroke="#14213D" stroke-width="2"/></svg>`;
}
const ICON = {
  rec: '<svg class="ic" viewBox="0 0 64 64" aria-hidden="true"><rect x="12" y="6" width="36" height="48" rx="6" fill="rgba(255,255,255,.95)"/><rect x="18" y="16" width="24" height="4" rx="2" fill="#0B8F81"/><rect x="18" y="25" width="20" height="4" rx="2" fill="#21C3B0"/><rect x="18" y="34" width="22" height="4" rx="2" fill="#21C3B0"/><circle cx="46" cy="46" r="10" fill="#FFC93C"/><path d="M53 53l6 6" stroke="#14213D" stroke-width="5" stroke-linecap="round"/></svg>',
  major: '<svg class="ic" viewBox="0 0 64 64" aria-hidden="true"><path d="M6 24 L32 12 L58 24 L32 36 Z" fill="rgba(255,255,255,.95)"/><path d="M16 30v12c0 4 8 8 16 8s16-4 16-8V30L32 38Z" fill="#FFC93C"/><path d="M54 26v16" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>',
  iv: '<svg class="ic" viewBox="0 0 64 64" aria-hidden="true"><path d="M8 12h34a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6H24l-10 8v-8H8a6 6 0 0 1-6-6V18a6 6 0 0 1 6-6z" fill="rgba(255,255,255,.95)"/><path d="M30 32h22a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6h-2v7l-9-7H30a6 6 0 0 1-6-6V38" fill="#FFC93C"/></svg>'
};

/* ---- 02-record.js ---- */
/* ===== 학생부 읽기: 가리기 → 영역 나누기 → 성적 → 근거 (규칙 기반, AI 없음) ===== */

/* --- 개인정보 가리기 --- */
const TAIL = '(?=[\\s,.)\\]·]|은|는|이|가|을|를|과|와|의|도|만|께|랑|에|$)';
const MASK_LABELS = ['이름', '성명', '주민번호', '출력정보', '전화번호', '이메일', '학번', '학적', '학교', '주소', '날짜', '가림'];
function findNames(t) {
  const out = new Set(); let m;
  const re = /(?:성\s*명|학생명|이\s*름)\s*[:：]?\s*\n?\s*([가-힣]{2,4})(?![가-힣])/g;
  while ((m = re.exec(t))) if (!/^(학번|학년|성별|주소|생년|번호|주민)/.test(m[1])) out.add(m[1]);
  return [...out];
}
function maskText(text, extra) {
  let t = String(text || ''); const hits = {};
  const rep = (re, label) => { t = t.replace(re, () => { hits[label] = (hits[label] || 0) + 1; return '[' + label + ']'; }); };
  const extras = String(extra || '').split(/[,\n]/).map(s => s.trim()).filter(s => s.length >= 2).sort((a, b) => b.length - a.length);
  extras.forEach(w => rep(new RegExp(rxEsc(w), 'g'), '가림'));
  findNames(t).sort((a, b) => b.length - a.length).forEach(n => {
    rep(new RegExp(rxEsc(n), 'g'), '이름');
    if (n.length >= 3) rep(new RegExp('(?<![가-힣])' + rxEsc(n.slice(1)) + TAIL, 'g'), '이름');
  });
  rep(/\d{6}\s*[-–]\s*[1-4][\d*]{6}/g, '주민번호');
  rep(/\d{1,3}\.\d{1,3}\.[\d*]{1,3}\.[\d*]{1,3}(?:\s*\/\s*[가-힣]{2,4})?/g, '출력정보');
  rep(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, '전화번호');
  rep(/\b0\d{1,2}[-)]\s?\d{3,4}-\d{4}\b/g, '전화번호');
  rep(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '이메일');
  rep(/(?:학\s*번|학적\s*번호)\s*[:：]?\s*\d{4,10}/g, '학번');
  rep(/(?:성\s*명|학생명)\s*[:：]?\s*[가-힣]{2,4}(?![가-힣])/g, '성명');
  rep(/\d\s*학년\s*\d{1,2}\s*반\s*\d{1,2}\s*번(?:\s*[가-힣]{2,4}(?![가-힣]))?/g, '학적');
  rep(/반\s*\d{1,2}\s*번호\s*\d{1,3}/g, '학적');
  rep(/[가-힣]{2,10}(?:여자고등학교|고등학교|여자중학교|중학교|초등학교|여고)/g, '학교');
  rep(/주\s*소\s*[:：]?\s*\n?\s*[^\n]{6,90}/g, '주소');
  rep(/(?:19|20)\d{2}\s*[년.]\s*\d{1,2}\s*[월.]\s*\d{1,2}\s*일?/g, '날짜');
  rep(/(?:^|\n)[ \t]*\d{1,2}[ \t]+\d{1,2}[ \t]+\d{1,3}[ \t]+[가-힣]{2,4}[ \t]*(?=\n|$)/g, '학적');
  return { text: t, hits };
}
function markMasked(t) {
  const re = new RegExp('\\[(' + MASK_LABELS.join('|') + ')\\]', 'g');
  return esc(t).replace(re, '<mark>[$1]</mark>');
}

/* --- 영역 나누기 (기존 Analyzer.gs 교훈 이식) --- */
const AREA_PATTERNS = [
  { key: '자율', re: /자율\s*활동|자율·?자치활동|자율자치활동/ },
  { key: '동아리', re: /동아리\s*활동/ },
  { key: '진로', re: /진로\s*활동/ },
  { key: '봉사', re: /봉사\s*활동/ },
  { key: '행특', re: /행동\s*특성\s*(및|과)?\s*종합\s*의견|행동특성및종합의견/ },
  { key: '세특', re: /세부\s*능력\s*(및|과)?\s*특기\s*사항|세부능력및특기사항|과목별\s*세부/ },
  { key: '봉사실적', re: /일자\s*또는\s*기간|장소\s*또는\s*주관기관/ },
  { key: '교과성적', re: /교과\s*학습\s*발달\s*상황|성취도\s*\(수강자수\)|석차등급|원점수/ },
  { key: '독서', re: /독서\s*활동\s*상황/ },
  { key: '수상', re: /수상\s*경력/ },
  { key: '출결', re: /출결\s*상황/ },
  { key: '창체', re: /창의적\s*체험\s*활동\s*상황/ }
];
const AREA_NAME = { 세특: '세특', 자율: '자율활동', 동아리: '동아리활동', 진로: '진로활동', 봉사: '봉사활동', 행특: '행동특성', 교과성적: '교과성적' };
function pageHeader(line) {
  const t = String(line || '').trim(); if (!t) return false;
  if (/^\[출력정보\]/.test(t)) return true;
  if (/\d{1,3}\.\d{1,3}\.[*\d]+\.[*\d]+/.test(t)) return true;
  if (/반\s*\d+\s*번호\s*\d+\s*성명/.test(t)) return true;
  if (/^\/?\d{1,3}\s*\/\s*\d{1,3}\b/.test(t)) return true;
  return false;
}
function normalizeLines(text) {
  const src = String(text || '').split(/\r?\n/), out = []; let buf = [];
  const flush = () => { if (buf.length) { out.push(buf.join('')); buf = []; } };
  for (const ln of src) {
    if (pageHeader(ln)) { flush(); continue; }
    const t = ln.trim();
    if (t.length === 1 && /[가-힣]/.test(t)) { buf.push(t); continue; }
    flush(); out.push(ln);
  }
  flush(); return out;
}
function tableRowLine(head, joined) {
  if (/^\d{4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}/.test(head)) return true;
  if (/[(（]\s*(?:자율|동아리|진로|봉사)/.test(joined)) return true;
  if (/[(（](?:학교|개인)[)）]/.test(joined)) return true;
  return false;
}
const RE_GRADE_LINE = /^\[?\s*([1-3])\s*학년\s*\]?$/;
function splitAreas(text) {
  const lines = normalizeLines(text), areas = { 미분류: [] };
  AREA_PATTERNS.forEach(p => (areas[p.key] = []));
  let cur = '미분류', grade = null, stamped = {};
  for (const ln of lines) {
    const head = ln.trim();
    const gm = head.match(RE_GRADE_LINE);
    if (gm) { grade = Number(gm[1]); stamped = {}; continue; }
    if (cur !== '세특' && cur !== '교과성적' && /^[1-3]$/.test(head)) { grade = Number(head); stamped = {}; continue; }
    const joined = head.replace(/\s+/g, '');
    if (joined.length <= 40 && !tableRowLine(head, joined)) {
      for (const p of AREA_PATTERNS) if (p.re.test(head) || p.re.test(joined)) { cur = p.key; break; }
    }
    if (grade && !stamped[cur]) { areas[cur].push('[' + grade + '학년]'); stamped[cur] = 1; }
    areas[cur].push(ln);
  }
  const out = {};
  for (const k of Object.keys(areas)) { const s = areas[k].join('\n').trim(); if (s) out[k] = s; }
  return out;
}
function splitByGrade(text) {
  const out = []; let cur = { 학년: null, 글: [] };
  String(text || '').split(/\r?\n/).forEach(ln => {
    const m = ln.trim().match(RE_GRADE_LINE);
    if (m) { if (cur.글.length) out.push({ 학년: cur.학년, 글: cur.글.join('\n') }); cur = { 학년: Number(m[1]), 글: [] }; return; }
    cur.글.push(ln);
  });
  if (cur.글.length) out.push({ 학년: cur.학년, 글: cur.글.join('\n') });
  return out.length ? out : [{ 학년: null, 글: String(text || '') }];
}
function isTableHead(s) {
  const t = String(s).replace(/\s+/g, ' ').trim(), front = t.slice(0, 40);
  if (/세부\s*능력\s*(및|과)?\s*특기\s*사항|일자\s*또는\s*기간|행동특성\s*및\s*종합의견/.test(front)) return true;
  if (/^(?:\d+\s*)?학기\s*교과\s*과목/.test(t)) return true;
  const end = t.replace(/[^가-힣]+$/, '');
  if (end) { const c = end.charCodeAt(end.length - 1); if (c >= 0xAC00 && c <= 0xD7A3 && ((c - 0xAC00) % 28) === 16) return false; }
  return !/(하였음|였음|함\.|임\.|음\.)/.test(t);
}
function joinBody(s) {
  const L = String(s).split(/\n/).map(x => x.trim()).filter(x => x && !RE_GRADE_LINE.test(x));
  if (!L.length) return '';
  const mx = Math.max(...L.map(x => x.length)); let out = L[0];
  for (let i = 1; i < L.length; i++) {
    const p = L[i - 1], c = L[i];
    out += (p.length >= Math.max(20, mx * 0.85) && /[가-힣]$/.test(p) && /^[가-힣]/.test(c)) ? '' : ' ';
    out += c;
  }
  return out.replace(/\s+/g, ' ').trim();
}
const RE_SUBJ_HEAD = /^[\s(]*(?:\(?([1-3])학년\)?)?\s*(?:\(?([1-2])학기\)?)?\s*([가-힣A-ZⅠⅡa-z0-9·\s]{2,20})\s*[:：]\s*/;
function guessGrade(s) { const m = String(s).match(/^[\s\[(]*([1-3])\s*학년/); return m ? Number(m[1]) : null; }
function splitItems1(area, text) {
  const items = []; if (!text) return items;
  if (area === '세특') {
    text = String(text).replace(/\n[^\n]{0,20}과\s*목\s+세부\s*능력[^\n]*/g, '');
    const blocks = text.split(/\n(?=[\s(]*(?:\(?[1-3]학년\)?)?\s*(?:\(?[1-2]학기\)?)?\s*[가-힣A-ZⅠⅡ][가-힣A-ZⅠⅡa-z0-9·\s]{1,19}\s*[:：])/);
    for (let b of blocks) {
      b = b.trim(); if (b.length < 25) continue;
      const m = b.match(RE_SUBJ_HEAD);
      const subj = m ? String(m[3]).trim() : '';
      let body = m ? b.slice(m[0].length) : b;
      body = body.split(/\n\s*(?:<[^>\n]{2,14}>|과\s*목\s*세부\s*능력|학기\s*교과\s*과목|이수학점\s*합계|\[[1-3]학년\])/)[0];
      if (body.length < 25 || isTableHead(body)) continue;
      items.push({ 영역: '세특', 학년: m && m[1] ? Number(m[1]) : guessGrade(b), 과목: subj, 내용: joinBody(body) });
    }
  } else {
    for (let b of text.split(/\n\s*\n|\n(?=\(?[1-3]학년)/)) {
      b = joinBody(b);
      b = b.replace(/^(?:창의적\s*체험\s*활동\s*상황\s*)?(?:자율(?:[·・]?\s*자치)?|동아리|진로|봉사)\s*활동\s*\d{0,4}\s*/, '');
      b = b.replace(/^행동\s*특성\s*및\s*종합\s*의견\s*/, '');
      if (b.length < 25 || isTableHead(b)) continue;
      items.push({ 영역: area, 학년: guessGrade(b), 과목: '', 내용: b });
    }
  }
  if (!items.length && text.replace(/\s+/g, '').length > 40) items.push({ 영역: area, 학년: guessGrade(text), 과목: '', 내용: joinBody(text) });
  return items;
}
function splitItems(area, text) {
  const segs = splitByGrade(text), items = [];
  if (segs.length > 1 || segs[0].학년) {
    segs.forEach(s => splitItems1(area, s.글).forEach(it => { if (s.학년) it.학년 = s.학년; items.push(it); }));
    return items;
  }
  return splitItems1(area, text);
}
function sentences(t) {
  return String(t || '').split(/(?<=[.!?。])\s+/).map(s => s.trim()).filter(s => s.replace(/\s/g, '').length >= 6);
}

/* --- 성적표 읽기 (Path.gs parseGrades_ 이식) --- */
const RE_SCORE = /^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*\(\s*\d+(?:\.\d+)?\s*\)$/;
const RE_ACHIEVE = /^([A-E])\s*\(\s*\d+\s*\)$/;
const RE_ROW = /^(.*?)\s*(\d{1,2})\s+(\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?(?:\s*\(\s*\d+(?:\.\d+)?\s*\))?)\s+([A-E])\s*\(\s*\d+\s*\)(?:\s+([1-9]))?\s*(?:[A-E]\(\d+(?:\.\d+)?\)\s*)*$/;
const RE_HEADROW = /^이수학점|^학기\s*교과|^원점수|^성취도|^석차등|^\(표준편차|^\(수강자|^학점|^비고|세부능력/;
const RE4_MAIN = /^(.*?)\s*(\d{1,2})\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+([A-E])\s*$/;
const RE4_DIST = /^(?:[A-E]\(\s*\d+(?:\.\d+)?\s*\)\s*)+$/;
const RE4_GRADE = /^([1-5])\s+(\d{1,4})\s*$/;
const RE4_NOGRADE = /^(.*?)\s+(\S+)\s+(\d{1,2})\s+([A-E])\s*$/;
const RE4_HEAD = /^(?:학기|교과|과목|학점|원점수|과목평균|성취도|석차|등급|수강|자수|비고|이수학점|이수단위|※|<|\[)/;
const GYOGWA = ['사회(역사/도덕포함)', '기술·가정/정보', '기술・가정/정보', '제2외국어/한문', '한국사', '국어', '수학', '영어', '사회', '과학', '체육', '예술', '교양', '정보'];
function splitGyogwa(head) {
  const t = String(head || '').replace(/^\s+/, '');
  for (const g of GYOGWA) if (t.indexOf(g) === 0 && t.length > g.length) return [g, t.slice(g.length).trim()];
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(' ')];
  return ['', parts[0] || ''];
}
function parseGrades4(text) {
  const out = [];
  splitByGrade(text).forEach(seg => {
    const L = seg.글.split(/\r?\n/).map(x => x.trim()); let term = null, pre = [];
    for (let i = 0; i < L.length; i++) {
      const ln = L[i]; if (!ln) continue;
      if (/^[1-2]$/.test(ln)) { term = Number(ln); pre = []; continue; }
      if (RE4_HEAD.test(ln)) { pre = []; continue; }
      const m = ln.match(RE4_MAIN);
      if (m) {
        let head = pre.join('') + m[1].trim(); pre = [];
        const hm = head.match(/^([1-2])\s+(.+)$/); if (hm) { term = Number(hm[1]); head = hm[2]; }
        const pr = splitGyogwa(head); if (!pr[1]) continue;
        let j = i + 1, grade = null;
        while (j < L.length && RE4_DIST.test(L[j])) j++;
        const g2 = (L[j] || '').match(RE4_GRADE); if (g2) { grade = Number(g2[1]); i = j; }
        out.push({ 학년: seg.학년, 학기: term, 교과: pr[0], 과목: pr[1], 학점: Number(m[2]), 등급: grade, 성취도: m[5] });
        continue;
      }
      const n2 = ln.match(RE4_NOGRADE);
      if (n2 && !/[\/()]/.test(ln)) {
        const pr = splitGyogwa(n2[1].trim() + ' ' + n2[2].trim());
        if (pr[1]) out.push({ 학년: seg.학년, 학기: term, 교과: pr[0], 과목: pr[1], 학점: Number(n2[3]), 등급: null, 성취도: n2[4] });
        pre = []; continue;
      }
      if (ln.length <= 16) { pre.push(ln); if (pre.length > 6) pre.shift(); } else pre = [];
    }
  });
  return out;
}
function parseGrades(text) {
  const out = [];
  splitByGrade(text).forEach(seg => {
    const L = seg.글.split(/\r?\n/).map(x => x.trim()); let term = null, pre = [];
    for (let i = 0; i < L.length; i++) {
      const ln = L[i]; if (!ln) continue;
      if (/^[1-2]$/.test(ln)) { term = Number(ln); pre = []; continue; }
      if (RE_HEADROW.test(ln)) { pre = []; continue; }
      if (/\sP\s+P\s*$|^P\s+P$/.test(ln)) { pre = []; continue; }
      const m = ln.match(RE_ROW);
      if (m) {
        let head = m[1].trim(), t = term;
        const hm = head.match(/^([1-2])\s+(.+)$/); if (hm) { t = Number(hm[1]); head = hm[2].trim(); }
        let gy, sj; const carried = pre.join('').replace(/\s/g, '');
        if (carried) { gy = carried; sj = head; } else { const pr = splitGyogwa(head); gy = pr[0]; sj = pr[1] || pr[0]; }
        pre = []; if (!sj) continue;
        out.push({ 학년: seg.학년, 학기: t, 교과: gy, 과목: sj, 학점: Number(m[2]), 등급: m[5] ? Number(m[5]) : null, 성취도: m[4] });
        continue;
      }
      if (RE_SCORE.test(ln)) {
        let ach = '', grade = null; const am = (L[i + 1] || '').match(RE_ACHIEVE); if (am) ach = am[1];
        const gtxt = am ? L[i + 2] : L[i + 1]; if (/^[1-9]$/.test(gtxt || '')) grade = Number(gtxt);
        let j = i - 1; const credit = /^\d{1,2}$/.test(L[j] || '') ? Number(L[j--]) : null; const parts = [];
        while (j >= 0 && !/^[1-2]$/.test(L[j]) && parts.length < 8) { if (L[j] && !/^(등|급|비|고|급비고|비고)$/.test(L[j])) parts.unshift(L[j]); j--; }
        if (!parts.length) continue;
        const t2 = /^[1-2]$/.test(L[j] || '') ? Number(L[j]) : term;
        const gy = parts[0], sj = parts.slice(1).join('') || parts[0];
        if (gy.length > 14 || sj.length > 24) continue;
        out.push({ 학년: seg.학년, 학기: t2, 교과: gy, 과목: sj, 학점: credit, 등급: grade, 성취도: ach });
        pre = []; continue;
      }
      if (ln.length <= 20) { pre.push(ln); if (pre.length > 3) pre.shift(); } else pre = [];
    }
  });
  const g4 = parseGrades4(text);
  return g4.length > out.length ? g4 : out;
}

/* --- 루브릭 3역량 10항목 근거 (낱말 규칙) --- */
const COMP_ITEMS = {
  '학업역량': ['학업성취도', '학업태도', '탐구력'],
  '진로역량': ['전공(계열) 관련 교과 이수 노력', '전공(계열) 관련 교과 성취도', '진로 탐색 활동과 경험'],
  '공동체역량': ['협업과 소통능력', '나눔과 배려', '성실성과 규칙준수', '리더십']
};
const TAG_RULES = {
  '학업성취도': ['성취', '성적', '향상', '등급', '우수한 성취', '학업 성취'],
  '학업태도': ['스스로', '자발적', '주도적으로', '꾸준히', '적극적으로 참여', '예습', '복습', '보충', '심화 학습', '자기주도', '더 알아보', '찾아 읽', '추가로 학습', '의문을 가지'],
  '탐구력': ['탐구', '실험', '보고서', '조사', '분석', '가설', '검증', '연구', '프로젝트', '자료를 수집', '논문', '호기심', '원리', '고찰', '설계'],
  '전공(계열) 관련 교과 이수 노력': ['공동교육과정', '온라인 공동', '소인수', '진로선택', '심화 과목', '추가로 수강', '방과후', '선택하여 이수', '수강 신청', '이수하였', '학교 밖', '대학 연계'],
  '전공(계열) 관련 교과 성취도': ['성취도 A', '최고 수준', '상위', '우수한 성적'],
  '진로 탐색 활동과 경험': ['진로', '희망', '전공', '직업', '멘토', '탐방', '특강', '진학', '장래', '관심 분야'],
  '협업과 소통능력': ['협력', '협업', '모둠', '팀', '조원', '토론', '함께', '의견을 조율', '소통', '발표', '공동', '역할을 나누'],
  '나눔과 배려': ['배려', '도움을 주', '봉사', '나눔', '멘토링', '가르쳐', '챙기', '돕는', '어려움을 겪는', '먼저 다가', '또래 학습', '학습 도우미', '설명해 주'],
  '성실성과 규칙준수': ['성실', '책임감', '개근', '꾸준', '맡은 바', '규칙', '약속', '빠짐없이', '끝까지', '묵묵히'],
  '리더십': ['회장', '부회장', '반장', '실장', '부장', '팀장', '조장', '이끌', '주도하여', '기획하고', '동아리장', '학생회', '대표']
};
function buildEvidence(items) {
  const ev = {}; Object.keys(TAG_RULES).forEach(k => (ev[k] = []));
  items.forEach((it, idx) => {
    sentences(it.내용).forEach(sent => {
      for (const [k, kws] of Object.entries(TAG_RULES)) {
        const found = kws.filter(w => sent.includes(w));
        if (found.length && ev[k].length < 40) ev[k].push({ idx, sent, kws: found, 영역: it.영역, 학년: it.학년, 과목: it.과목 });
      }
    });
  });
  return ev;
}
function hlSent(sent, kws) {
  if (!kws.length) return esc(sent);
  const re = new RegExp('(' + [...kws].sort((a, b) => b.length - a.length).map(rxEsc).join('|') + ')', 'g');
  return String(sent).split(re).map((p, i) => i % 2 ? '<em>' + esc(p) + '</em>' : esc(p)).join('');
}
/* --- 키워드(면접 질문용) --- */
const STOP = new Set(['활동', '내용', '수업', '과정', '자신', '학생', '이해', '생각', '친구', '모습', '태도', '능력', '자료', '결과', '관련', '다양한', '통해', '대한', '위해', '이를', '바탕', '자신의', '보임', '학습', '시간', '주제']);
function keywords(text) {
  const t = String(text || ''), out = [];
  const pats = [/'([^'\n]{2,22})'/g, /‘([^’\n]{2,22})’/g, /“([^”\n]{2,24})”/g, /"([^"\n]{2,24})"/g, /「([^」\n]{2,24})」/g, /『([^』\n]{2,24})』/g,
    /([가-힣A-Za-z0-9·]{2,14}(?:\s[가-힣A-Za-z0-9·]{2,10})?)(?:을|를)\s*주제로/g, /([가-힣A-Za-z0-9·]{2,14})에\s*(?:대해|대한|관한|관하여)/g];
  for (const re of pats) { let m; while ((m = re.exec(t))) { const w = m[1].trim(); if (!STOP.has(w) && !out.includes(w)) out.push(w); } }
  return out.slice(0, 4);
}

/* --- 과목 이름 맞추기 --- */
const subjNorm = s => nsp(s).replace(/II$/, 'Ⅱ').replace(/I$/, 'Ⅰ').replace(/·|ㆍ/g, '');
const EQUIV = [['미적분', '미적분Ⅰ', '미적분Ⅱ'], ['수학Ⅰ', '대수'], ['수학Ⅱ', '미적분Ⅰ'], ['물리학Ⅰ', '물리학'], ['화학Ⅰ', '화학'], ['생명과학Ⅰ', '생명과학'], ['지구과학Ⅰ', '지구과학'],
  ['물리학Ⅱ', '역학과에너지', '전자기와양자'], ['화학Ⅱ', '물질과에너지', '화학반응의세계'], ['생명과학Ⅱ', '세포와물질대사', '생물의유전'], ['지구과학Ⅱ', '지구시스템과학', '행성우주과학'],
  ['화법과작문', '화법과언어', '독서와작문'], ['언어와매체', '화법과언어', '매체의사소통'], ['독서', '독서와작문'], ['생활과윤리', '현대사회와윤리'], ['한국지리', '한국지리탐구'], ['세계지리', '세계시민과지리'],
  ['정치와법', '정치', '법과사회'], ['사회문화', '사회와문화'], ['통합사회', '통합사회1', '통합사회2'], ['통합과학', '통합과학1', '통합과학2'], ['국어', '공통국어1', '공통국어2'], ['수학', '공통수학1', '공통수학2'], ['영어', '공통영어1', '공통영어2'],
  ['영어독해와작문', '영어Ⅱ'], ['고급수학Ⅰ', '전문수학'], ['기하', '기하'], ['확률과통계', '확률과통계']];
const GYOGWA_WORDS = { 국어: 1, 수학: 1, 영어: 1, 사회: 1, 과학: 1, 한국사: 1, 정보: 1, 체육: 1, 예술: 1 };
function subjStatus(rec, taken, takenGy) {
  const r = subjNorm(rec);
  if (!r) return null;
  if (taken.has(r)) return 'ok';
  if (GYOGWA_WORDS[r] && takenGy.has(r)) return 'ok';
  for (const g of EQUIV) { if (g.map(subjNorm).includes(r) && g.some(x => taken.has(subjNorm(x)) && subjNorm(x) !== r)) return 'chk'; }
  for (const t of taken) { if ((t.startsWith(r) || r.startsWith(t)) && Math.abs(t.length - r.length) <= 2 && Math.min(t.length, r.length) >= 2) return 'chk'; }
  return 'no';
}
function splitSubjects(v) {
  return String(v || '').replace(/-?\s*(일반선택|진로선택|융합선택|공통과목|핵심권장과목|권장과목)\s*(과목)?\s*[:：]/g, '|')
    .split(/[|,\/\n]/).map(s => s.trim()).filter(s => s && s.length <= 16);
}

/* 한쪽 교육과정에만 있는 과목 이름 (Path.gs 등급제_ 교훈) */
const ONLY_2015 = '화법과작문 언어와매체 실용국어 심화국어 고전읽기 수학Ⅰ 수학Ⅱ 미적분 물리학Ⅰ 물리학Ⅱ 화학Ⅰ 화학Ⅱ 생명과학Ⅰ 생명과학Ⅱ 지구과학Ⅰ 지구과학Ⅱ 통합사회 통합과학 과학탐구실험 생활과윤리 한국지리 세계지리 동아시아사 정치와법 사회·문화 독서'.split(' ');
const ONLY_2022 = '공통국어1 공통국어2 공통수학1 공통수학2 공통영어1 공통영어2 기본수학1 기본수학2 기본영어1 기본영어2 통합사회1 통합사회2 통합과학1 통합과학2 과학탐구실험1 과학탐구실험2 한국사1 한국사2 대수 미적분Ⅰ 미적분Ⅱ 화법과언어 독서와작문 문학과영상 주제탐구독서 매체의사소통 세계시민과지리 한국지리탐구 현대사회와윤리 법과사회 사회와문화 세포와물질대사 물질과에너지 전자기와양자 역학과에너지 화학반응의세계 지구시스템과학'.split(' ');
/* --- 전체 분석 --- */
function analyzeRecord() {
  const R = S.rec, text = R.masked;
  R.areas = splitAreas(text);
  const items = [];
  ['세특', '자율', '동아리', '진로', '봉사', '행특'].forEach(a => { if (R.areas[a]) items.push(...splitItems(a, R.areas[a])); });
  R.items = items;
  let g = parseGrades(R.areas['교과성적'] || '');
  const g2 = parseGrades(text); if (g2.length > g.length) g = g2;
  R.grades = g.map(r => ({ 학년: r.학년 || '', 학기: r.학기 || '', 교과: r.교과 || '', 과목: r.과목 || '', 학점: r.학점 ?? '', 등급: r.등급 ?? '', 성취도: r.성취도 || '' }));
  const maxG = Math.max(0, ...R.grades.map(r => Number(r.등급) || 0));
  const seen = new Set([...R.grades.map(r => nsp(r.과목)), ...items.map(i => nsp(i.과목))]);
  const n15 = ONLY_2015.filter(s => seen.has(s)).length, n22 = ONLY_2022.filter(s => seen.has(s)).length;
  const guess = maxG >= 6 ? 9 : n15 >= n22 + 2 ? 9 : n22 >= n15 + 2 ? 5 : null;
  R.system = guess || sysOf(S.profile.curr);
  R.sysAuto = !!guess && guess !== sysOf(S.profile.curr);
  R.sysWhy = maxG >= 6 ? '성적에 6등급 이상이 있어요' : guess === 9 ? '2015 개정 과목 이름이 보여요' : '2022 개정 과목 이름이 보여요';
  R.evidence = buildEvidence(items);
  R.analyzed = true;
}
function takenSets() {
  const taken = new Set(), gy = new Set();
  S.rec.grades.forEach(r => { if (r.과목) taken.add(subjNorm(r.과목)); if (r.교과) gy.add(subjNorm(String(r.교과).replace(/\(.*$/, ''))); });
  S.rec.items.forEach(it => { if (it.과목) taken.add(subjNorm(it.과목)); });
  return { taken, gy };
}

/* ---- 03-home-record.js ---- */
/* ===== 상단·홈·내 정보·학생부 화면 ===== */
const ACT = {}, IN = {};

function renderTop() {
  const p = S.profile;
  $('#top').innerHTML = `<button class="brand" data-act="go" data-to="home" aria-label="진학 나침반 처음으로">${logoSVG()}<b>진학 나침반</b></button>
  <div class="chips">
    <button class="chip" data-act="profile" aria-label="내 정보 바꾸기">👤 ${esc(p.grade)} <small>${esc(currLabel(p.curr))}</small></button>
    ${p.rural ? '<button class="chip on" data-act="profile">농어촌</button>' : ''}
    ${p.interest ? `<button class="chip ghost" data-act="profile">${esc(p.interest)}</button>` : ''}
  </div>`;
}
function renderFoot() {
  $('#foot').innerHTML = `<p>무료·비영리 · 학생부는 서버로 보내지 않고, 저장·AI 학습도 하지 않아요 · <a href="${MOE_URL}" target="_blank" rel="noopener noreferrer">교육부 안내(학생부 열람·상담)</a></p>
  <p><button class="tlink" data-act="go" data-to="teacher">선생님용 도구</button> · <button class="tlink" data-act="wipe">이 화면 다 지우기</button></p>`;
}
function vhead(color, title, sub, back = 'home') {
  return `<div class="vhead ${color}"><button class="back" data-act="go" data-to="${back}" aria-label="뒤로">←</button><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div></div>`;
}

/* ---------- 홈 ---------- */
function viewHome() {
  const n = (window.JN_META || {}).counts || {};
  return `<section class="hero">
    <h1>진학 나침반</h1>
    <p>내 학생부로, 내 길을 스스로 찾아요.</p>
    <div class="tags"><span>학생부는 이 기기 안에서만</span><span>학과 ${(n['학과사전'] || 0).toLocaleString()}개</span><span>기출 질문 ${(n['기출면접'] || 0).toLocaleString()}개</span></div>
    ${logoSVG('big-logo')}
  </section>
  <div class="cards">
    <button class="bigcard c-mint" data-act="go" data-to="record"><span class="num">1</span><h2>내 학생부 살펴보기</h2><p>성적·기록 근거·권장과목</p>${ICON.rec}</button>
    <button class="bigcard c-apri" data-act="go" data-to="major"><span class="num">2</span><h2>학과·전형 찾기</h2><p>학과 → 대학 → 2028 전형·입결</p>${ICON.major}</button>
    <button class="bigcard c-vio" data-act="go" data-to="interview"><span class="num">3</span><h2>면접 연습</h2><p>기출 질문 · 타이머 · 셀프 체크</p>${ICON.iv}</button>
  </div>
  <div class="demo-row">
    ${S.rec.analyzed ? `<button class="btn mint" data-act="go" data-to="record">내 학생부 결과 이어 보기</button>` : `<button class="btn sun" data-act="demo">가상 학생으로 둘러보기</button>`}
    ${S.profile.rural ? `<button class="btn white" data-act="go" data-to="rural">농어촌 전형 체크</button>` : ''}
    ${S.cands.length ? `<button class="btn white" data-act="go" data-to="compare">내 후보 ${S.cands.length}개 비교</button>` : ''}
  </div>`;
}

/* ---------- 내 정보 ---------- */
function openDialog(title, body) {
  const d = $('#dlg'); d.classList.remove('wide');
  d.innerHTML = `<div class="dh"><h2 id="dlgTitle">${title}</h2><button data-act="dlgClose" aria-label="닫기">✕</button></div><div class="db">${body}</div>`;
  if (!d.open) d.showModal();
}
ACT.dlgClose = () => { const d = $('#dlg'); d.classList.remove('wide'); d.close(); };
ACT.profile = () => {
  const p = S.profile;
  openDialog('내 정보', `
    <label class="f" id="lg">학년</label>
    <div class="seg" role="group" aria-labelledby="lg">${GRADES.map(g => `<button data-act="pGrade" data-v="${g}" aria-pressed="${p.grade === g}">${g}</button>`).join('')}</div>
    <label class="f" for="pEntry">고등학교 입학연도</label>
    <input id="pEntry" type="number" min="2015" max="2035" value="${esc(p.entry)}" data-in="pEntry">
    <label class="f" id="lc">교육과정 <span class="tiny">(입학연도로 자동, 직접 바꿀 수 있어요)</span></label>
    <div class="seg" role="group" aria-labelledby="lc">
      <button data-act="pCurr" data-v="2022" aria-pressed="${p.curr === '2022'}">2022 개정 · 5등급</button>
      <button data-act="pCurr" data-v="2015" aria-pressed="${p.curr === '2015'}">2015 개정 · 9등급</button></div>
    <label class="toggle" style="margin-top:12px"><input type="checkbox" data-in="pRural" ${p.rural ? 'checked' : ''}><span class="sw"></span>농어촌 학교·지역에 살아요</label>
    <label class="f" for="pInt">관심 분야</label>
    <input id="pInt" type="text" maxlength="40" placeholder="예: 간호, 컴퓨터, 교육" value="${esc(p.interest)}" data-in="pInt">
    <p class="tiny">이 정보만 이 기기에 저장돼요. 학생부는 저장하지 않아요.</p>
    <div class="row end"><button class="btn mint" data-act="pDone">좋아요</button></div>`);
};
function refreshProfileDlg() { if ($('#dlg').open) ACT.profile(); }
ACT.pGrade = el => { const p = S.profile; p.grade = el.dataset.v; p.entry = entryFromGrade(p.grade); if (!p.currManual) p.curr = currFromEntry(p.entry); p.set = true; saveProfile(); refreshProfileDlg(); renderTop(); };
IN.pEntry = el => { const p = S.profile; const y = Number(el.value); if (y >= 2015 && y <= 2035) { p.entry = y; if (!p.currManual) p.curr = currFromEntry(y); saveProfile(); renderTop(); $$('[data-act=pCurr]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === p.curr)); } };
ACT.pCurr = el => { S.profile.curr = el.dataset.v; S.profile.currManual = true; saveProfile(); refreshProfileDlg(); renderTop(); };
IN.pRural = el => { S.profile.rural = el.checked; saveProfile(); renderTop(); };
IN.pInt = el => { S.profile.interest = el.value.trim().slice(0, 40); saveProfile(); };
ACT.pDone = () => { $('#dlg').close(); S.profile.set = true; saveProfile(); render(); };

/* ---------- ① 학생부 ---------- */
function viewRecord() {
  const R = S.rec;
  const st = (n, t, sub) => `<button class="step ${R.step === n ? 'on' : ''}" data-act="recStep" data-n="${n}" ${n === 2 && !R.raw ? 'disabled' : ''}${n === 3 && !R.analyzed ? ' disabled' : ''}><b>${n}단계</b>${t}</button>`;
  let body = '';
  if (R.step === 1) body = recStep1(); else if (R.step === 2) body = recStep2(); else body = recStep3();
  return vhead('mint', '내 학생부 살펴보기', R.demo ? '<span class="badge sun">가상 학생 · 실제 사람 아님</span>' : '원문은 이 기기 밖으로 나가지 않아요.') +
    `<div class="steps">${st(1, '올리기')}${st(2, '가리기 확인')}${st(3, '결과 보기')}</div>` + body;
}
function recStep1() {
  return `<section class="panel mint">
    <h2>학생부 넣기</h2>
    <p class="one">PDF는 이 브라우저 안에서만 읽어요.</p>
    <label class="drop" tabindex="-1"><input type="file" accept="application/pdf,.pdf" data-in="pdf" aria-label="학생부 PDF 고르기"><strong>📄 PDF 고르기</strong><span class="muted">나이스·정부24에서 받은 학생부 PDF</span></label>
    <div id="pdfStatus" class="muted" aria-live="polite" style="margin-top:8px">${S.rec.pdfName ? esc(S.rec.pdfName) + ' 읽음' : ''}</div>
    <div class="or">또는</div>
    <label class="f" for="rawText">글자 붙여넣기</label>
    <textarea id="rawText" data-in="raw" placeholder="학생부 내용을 복사해서 붙여넣어 주세요.">${esc(S.rec.raw)}</textarea>
    <div class="row" style="margin-top:12px"><button class="btn sun" data-act="demo">가상 학생으로 둘러보기</button><span class="spacer"></span><button class="btn mint" data-act="toMask">다음: 개인정보 가리기 →</button></div>
  </section>`;
}
function recStep2() {
  const R = S.rec, hits = Object.entries(R.hits);
  return `<section class="panel sun">
    <h2>가려진 내용 확인</h2>
    <p class="one">노란 칸이 가려졌어요. 빠진 이름이 있으면 아래에 적어 주세요.</p>
    <div class="hitchips">${hits.length ? hits.map(([k, v]) => `<span>${esc(k)} ${v}</span>`).join('') : '<span>자동으로 가린 곳 없음</span>'}</div>
    <div class="masked" tabindex="0" aria-label="가려진 학생부 미리보기">${markMasked(R.masked.slice(0, 20000))}${R.masked.length > 20000 ? '\n…(뒤는 생략해서 보여요)' : ''}</div>
    <label class="f" for="maskExtra">더 가릴 말 <span class="tiny">(친구·선생님 이름 등, 쉼표로)</span></label>
    <div class="row"><input id="maskExtra" type="text" value="${esc(R.extra)}" data-in="maskExtra" style="flex:1;min-width:200px"><button class="btn white" data-act="remask">다시 가리기</button></div>
    <label class="confirm"><input type="checkbox" data-in="maskOk" ${R.confirmed ? 'checked' : ''}>이름·학교·번호가 다 가려진 걸 확인했어요</label>
    <div class="row"><button class="btn white" data-act="recStep" data-n="1">← 다시 넣기</button><span class="spacer"></span><button class="btn mint" data-act="analyze" id="btnAnalyze" ${R.confirmed ? '' : 'disabled'}>결과 보기 →</button></div>
  </section>`;
}
function recStep3() {
  const R = S.rec, tab = R.tab;
  const t = (k, label) => `<button class="tab mint ${tab === k ? 'on' : ''}" data-act="recTab" data-k="${k}">${label}</button>`;
  let inner = '';
  if (tab === 'grade') inner = recGrade(); else if (tab === 'ev') inner = recEvidence(); else if (tab === 'check') inner = '<div id="checkBox">불러오는 중…</div>'; else inner = '<div id="fitBox">불러오는 중…</div>';
  return `<div class="tabs" role="tablist">${t('grade', '📊 성적')}${t('ev', '🔎 기록 근거')}${t('check', '✍️ 스스로 점검')}${t('fit', '📚 권장과목')}</div>${inner}
  <section class="panel navy"><div class="row">
    <button class="btn" data-act="printSum">🖨 상담 요약 1장</button>
    <button class="btn white" data-act="saveDlg">🔒 암호 파일로 저장</button>
    <span class="spacer"></span><button class="btn danger" data-act="wipe">다 지우기</button></div>
    <p class="tiny" style="margin:8px 0 0">지금은 이 탭의 메모리에만 있어요. 탭을 닫으면 사라져요.</p></section>`;
}

/* 성적 */
function gradeStatsHTML() {
  const R = S.rec, sys = R.system || sysOf(S.profile.curr);
  const w = wavg(R.grades), b = sys === 9 ? band5(R.grades) : null;
  const terms = {};
  R.grades.forEach(r => { const k = (r.학년 || '?') + '-' + (r.학기 || '?'); (terms[k] = terms[k] || []).push(r); });
  const termRows = Object.keys(terms).sort().map(k => { const x = wavg(terms[k]); return x ? `<span class="badge vio">${k.replace('-', '학년 ')}학기 ${fmt(x.avg)}</span>` : ''; }).join(' ');
  return `<div class="stats">
    <div class="stat mint"><span>학점 가중 평균 (${sys}등급제)</span><b>${w ? fmt(w.avg) : '-'}</b><span class="tiny">${w ? w.credits + '학점 반영' : '등급 있는 과목이 없어요'}</span></div>
    ${b ? `<div class="stat apri"><span>5등급 눈금 참고 범위</span><b>${fmt(b.lo)} ~ ${fmt(b.hi)}</b><span class="tiny">공식 환산 아님</span></div>` : ''}
    <div class="stat sun"><span>읽은 과목</span><b>${R.grades.length}</b><span class="tiny">틀리면 표에서 고쳐 주세요</span></div>
  </div>${termRows ? `<p>${termRows}</p>` : ''}`;
}
function recGrade() {
  const R = S.rec, sys = R.system || sysOf(S.profile.curr);
  const rows = R.grades.map((r, i) => `<tr>
    <td><input aria-label="${i + 1}행 학년" data-in="g" data-i="${i}" data-k="학년" value="${esc(r.학년)}" size="2"></td>
    <td><input aria-label="${i + 1}행 학기" data-in="g" data-i="${i}" data-k="학기" value="${esc(r.학기)}" size="2"></td>
    <td><input aria-label="${i + 1}행 과목" data-in="g" data-i="${i}" data-k="과목" value="${esc(r.과목)}" size="12"></td>
    <td><input aria-label="${i + 1}행 학점" data-in="g" data-i="${i}" data-k="학점" value="${esc(r.학점)}" size="2" inputmode="numeric"></td>
    <td><input aria-label="${i + 1}행 등급" data-in="g" data-i="${i}" data-k="등급" value="${esc(r.등급)}" size="2" inputmode="numeric"></td>
    <td><input aria-label="${i + 1}행 성취도" data-in="g" data-i="${i}" data-k="성취도" value="${esc(r.성취도)}" size="2"></td>
    <td><button class="btn danger small" data-act="gDel" data-i="${i}" aria-label="${i + 1}행 지우기">✕</button></td></tr>`).join('');
  return `<section class="panel mint"><h2>내 성적</h2>
    ${R.sysAuto ? `<div class="warn">${esc(R.sysWhy)}. 그래서 ${sys}등급제로 계산했어요. <button class="btn small white" data-act="profile">내 정보 확인</button></div>` : ''}
    <div class="seg" style="max-width:420px;margin-bottom:8px" role="group" aria-label="등급제">
      <button data-act="gSys" data-v="9" aria-pressed="${sys === 9}">9등급제</button><button data-act="gSys" data-v="5" aria-pressed="${sys === 5}">5등급제</button></div>
    <div id="gstats">${gradeStatsHTML()}</div>
    ${R.grades.length ? '' : '<div class="note">성적표를 자동으로 못 읽었어요. 아래에서 직접 넣을 수 있어요.</div>'}
    <div class="tbl-wrap"><table><thead><tr><th>학년</th><th>학기</th><th>과목</th><th>학점</th><th>등급</th><th>성취도</th><th><span class="tiny">지우기</span></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="row" style="margin-top:10px"><button class="btn white small" data-act="gAdd">+ 과목 추가</button><span class="tiny">진로선택처럼 등급 없는 과목은 평균에서 빠져요.</span></div>
  </section>`;
}
IN.g = el => { const r = S.rec.grades[+el.dataset.i]; if (!r) return; r[el.dataset.k] = el.value.trim(); $('#gstats').innerHTML = gradeStatsHTML(); };
ACT.gDel = el => { S.rec.grades.splice(+el.dataset.i, 1); render(); };
ACT.gAdd = () => { S.rec.grades.push({ 학년: '', 학기: '', 교과: '', 과목: '', 학점: '', 등급: '', 성취도: '' }); render(); setTimeout(() => { const ins = $$('input[data-k=과목]'); ins.length && ins[ins.length - 1].focus(); }, 0); };
ACT.gSys = el => { S.rec.system = +el.dataset.v; S.rec.sysAuto = false; render(); };

/* 기록 근거 */
function recEvidence() {
  const R = S.rec, ev = R.evidence || {};
  const areaCount = ['세특', '자율', '동아리', '진로', '봉사', '행특'].map(a => { const n = R.items.filter(i => i.영역 === a).length; return n ? `<span class="badge">${AREA_NAME[a]} ${n}</span>` : ''; }).join(' ');
  const comps = Object.entries(COMP_ITEMS).map(([comp, list], ci) => `<div class="comp c${ci + 1}"><h3>${comp}</h3>${list.map(k => {
    const arr = ev[k] || [];
    const show = arr.slice(0, 3).map(evHTML).join('');
    const more = arr.length > 3 ? `<details><summary>문장 더 보기 (${arr.length - 3})</summary>${arr.slice(3, 15).map(evHTML).join('')}</details>` : '';
    return `<div class="item"><h4>${esc(k)}</h4>${arr.length ? show + more : '<p class="muted" style="margin:0">이 항목 문장은 못 찾았어요. 표현이 달라서일 수 있어요.</p>'}</div>`;
  }).join('')}</div>`).join('');
  return `<section class="panel mint"><h2>기록 근거</h2><p class="one">평가 항목별로 내 학생부 문장을 모았어요. 점수는 매기지 않아요. 문장 옆 버튼으로 원본과 대조해 보세요.</p>
    ${ORIG ? '<div class="row"><button class="btn small white" data-act="origShow" data-s="">내 학생부 원본 PDF 펼치기</button></div>' : ''}
    <p>${areaCount || '<span class="badge rose">영역을 못 나눴어요</span>'}</p>${comps}</section>`;
}
function evHTML(e) {
  const where = [e.학년 ? e.학년 + '학년' : '', AREA_NAME[e.영역] || e.영역, e.과목].filter(Boolean).join(' · ');
  return `<div class="ev"><span class="where">${esc(where)}<button class="origbtn" data-act="origShow" data-s="${esc(e.sent)}">${ORIG ? '원본 PDF에서 보기' : '원문에서 보기'}</button></span>${hlSent(e.sent, e.kws)}</div>`;
}

/* 스스로 점검: 학생이 먼저 쓰고, 그다음 내 기록 근거를 본다 */
async function fillCheck() {
  const box = $('#checkBox'); if (!box) return;
  const cp = await ds('체크포인트');
  const univs = [...new Set(cp.map(r => r.대학))].sort();
  if (!S.check.univ) { const c = S.cands.find(c => univs.some(u => sameUni(u, c.univ))); if (c) S.check.univ = univs.find(u => sameUni(u, c.univ)); }
  const u = S.check.univ;
  const rows = u ? cp.filter(r => r.대학 === u) : [];
  const groups = {}; rows.forEach(r => { const k = r.세부항목; (groups[k] = groups[k] || []).push(r); });
  let cards = '';
  Object.entries(COMP_ITEMS).forEach(([comp, list]) => {
    list.forEach(item => {
      const qs = (groups[item] || []).slice(0, 2);
      qs.forEach((r, qi) => {
        const id = u + '|' + item + '|' + qi, ans = S.check.answers[id] || '', shown = S.check.shown[id];
        const ev = (S.rec.evidence || {})[item] || [];
        cards += `<div class="qcard"><div class="row"><span class="badge vio">${esc(comp)}</span><span class="badge">${esc(item)}</span></div>
          <p class="q">${esc(r.체크포인트)}</p>
          <label class="tiny" for="ck${esc(id)}">내 생각 먼저</label>
          <textarea id="ck${esc(id)}" data-in="ckAns" data-id="${esc(id)}" placeholder="내 활동으로 짧게 답해 보세요.">${esc(ans)}</textarea>
          <div class="row" style="margin-top:8px"><button class="btn small vio" data-act="ckShow" data-id="${esc(id)}" ${ans.trim().length >= 10 ? '' : 'disabled'}>내 기록 근거 보기</button><span class="tiny">10자 이상 쓰면 열려요</span></div>
          ${shown ? `<div style="margin-top:8px">${ev.length ? ev.slice(0, 3).map(evHTML).join('') : '<p class="muted">이 항목 문장은 못 찾았어요.</p>'}</div>` : ''}</div>`;
      });
    });
  });
  box.innerHTML = `<section class="panel vio"><h2>스스로 점검</h2><p class="one">대학이 밝힌 체크포인트예요. 답을 먼저 써야 근거가 열려요.</p>
    <label class="f" for="ckUniv">대학 고르기</label>
    <select id="ckUniv" data-in="ckUniv"><option value="">대학을 골라 주세요 (${univs.length}곳)</option>${univs.map(x => `<option ${x === u ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
    ${u ? (cards || '<p class="muted">이 대학 체크포인트가 없어요.</p>') : '<div class="empty"><strong>대학을 고르면 질문이 나와요</strong></div>'}</section>`;
}
IN.ckUniv = el => { S.check.univ = el.value; fillCheck(); };
IN.ckAns = el => { S.check.answers[el.dataset.id] = el.value; const b = el.parentElement.querySelector('[data-act=ckShow]'); if (b) b.disabled = el.value.trim().length < 10; };
ACT.ckShow = el => { S.check.shown[el.dataset.id] = true; fillCheck(); };

/* 권장과목 */
async function fitUnits() {
  const a = await ds('학과별권장과목'), b = await ds('권장과목');
  const units = [];
  a.forEach(r => units.push({ univ: r.대학, unit: r.모집단위, core: splitSubjects(r.핵심권장과목), rec: splitSubjects(r.권장과목), note: [r.핵심권장과목, r.권장과목].filter(x => x && splitSubjects(x).length === 0).join(' / ') || r.비고 }));
  b.forEach(r => { if (!units.some(u => u.univ === r.대학 && u.unit === r.모집단위)) units.push({ univ: r.대학, unit: r.모집단위, core: splitSubjects(r.핵심권장과목), rec: splitSubjects(r.권장과목), note: r.비고 }); });
  return units;
}
async function fillFit() {
  const box = $('#fitBox'); if (!box) return;
  const units = await fitUnits(), dict = await ds('학과사전');
  const F = S.rec.fit, univs = [...new Set(units.map(u => u.univ))].sort();
  const unitList = F.univ ? units.filter(u => u.univ === F.univ) : [];
  let target = null, source = '';
  if (F.univ && F.unit) { target = unitList.find(u => u.unit === F.unit); source = F.univ + ' 발표 자료'; }
  else if (F.dept) { const d = dict.find(x => x.학과명 === F.dept); if (d) { target = { core: [], rec: [...splitSubjects(d.일반선택), ...splitSubjects(d.진로선택), ...splitSubjects(d.융합선택)], note: '' }; source = '학과사전(학과 일반 기준)'; } }
  const { taken, gy } = takenSets();
  const later = S.profile.grade === '고1' || S.profile.grade === '고2';
  const chip = s => { const st = subjStatus(s, taken, gy); if (!st) return ''; const lab = st === 'ok' ? '들었어요' : st === 'chk' ? '확인 필요' : '아직 안 보여요'; return `<span class="sub ${st}" title="${lab}">${esc(s)} <span class="tiny">· ${lab}</span></span>`; };
  let res = '';
  if (target) {
    res = `<h3>${esc(source)}</h3>
      <div class="legend"><span class="sub ok">들었어요</span><span class="sub no">아직 안 보여요</span><span class="sub chk">확인 필요(이름이 비슷하거나 교육과정이 달라요)</span></div>
      ${target.core.length ? `<p><b>핵심 권장</b></p><div class="subs">${target.core.map(chip).join('')}</div>` : ''}
      ${target.rec.length ? `<p><b>권장</b></p><div class="subs">${target.rec.map(chip).join('')}</div>` : ''}
      ${!target.core.length && !target.rec.length ? `<p class="note">${esc(target.note || '과목 이름을 따로 밝히지 않았어요.')}</p>` : ''}
      <p class="note">학교에 개설되지 않은 과목일 수 있어요. 공동교육과정·온라인학교도 확인해 보세요.${later ? ' 앞으로 들을 수 있는 과목도 있어요.' : ''}</p>
      ${S.rec.system === 9 || S.profile.curr === '2015' ? '<p class="tiny">자료 대부분이 2022 개정 과목 이름이라, 2015 개정 과목은 \'확인 필요\'로 보일 수 있어요.</p>' : ''}`;
  }
  box.innerHTML = `<section class="panel mint"><h2>권장과목 비교</h2><p class="one">희망 대학·모집단위를 고르면 내 이수 과목과 나란히 보여요.</p>
    <div class="grid2"><div><label class="f" for="fitU">대학</label><select id="fitU" data-in="fitU"><option value="">대학 (${univs.length}곳)</option>${univs.map(x => `<option ${x === F.univ ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
    <div><label class="f" for="fitN">모집단위</label><select id="fitN" data-in="fitN" ${F.univ ? '' : 'disabled'}><option value="">모집단위</option>${unitList.map(x => `<option ${x.unit === F.unit ? 'selected' : ''}>${esc(x.unit)}</option>`).join('')}</select></div></div>
    <label class="f" for="fitD">또는 학과 일반 기준</label>
    <select id="fitD" data-in="fitD"><option value="">학과사전에서 고르기</option>${dict.map(d => `<option ${d.학과명 === F.dept ? 'selected' : ''}>${esc(d.학과명)}</option>`).join('')}</select>
    ${res || '<div class="empty"><strong>대학·모집단위나 학과를 골라 주세요</strong></div>'}</section>`;
}
IN.fitU = el => { S.rec.fit = { univ: el.value, unit: '', dept: '' }; fillFit(); };
IN.fitN = el => { S.rec.fit.unit = el.value; S.rec.fit.dept = ''; fillFit(); };
IN.fitD = el => { S.rec.fit = { univ: '', unit: '', dept: el.value }; fillFit(); };

/* 단계 이동 */
ACT.recStep = el => { S.rec.step = +el.dataset.n; render(); };
ACT.recTab = el => { S.rec.tab = el.dataset.k; render(); };
IN.raw = el => { S.rec.raw = el.value; S.rec.demo = false; };
ACT.toMask = () => {
  const R = S.rec; const t = ($('#rawText') || {}).value ?? R.raw;
  if (t.replace(/\s/g, '').length < 30) { toast('학생부 내용을 먼저 넣어 주세요.'); return; }
  R.raw = t; const m = maskText(R.raw, R.extra); R.masked = m.text; R.hits = m.hits; R.confirmed = false; R.analyzed = false; R.step = 2; render();
};
IN.maskExtra = el => { S.rec.extra = el.value; };
ACT.remask = () => { const R = S.rec; const m = maskText(R.raw, R.extra); R.masked = m.text; R.hits = m.hits; R.confirmed = false; render(); toast('다시 가렸어요.'); };
IN.maskOk = el => { S.rec.confirmed = el.checked; const b = $('#btnAnalyze'); if (b) b.disabled = !el.checked; };
ACT.analyze = () => { if (!S.rec.confirmed) return; analyzeRecord(); S.rec.step = 3; S.rec.tab = 'grade'; render(); toast('다 읽었어요. 표가 맞는지 확인해 주세요.'); };

/* PDF 읽기: pdf.js (인라인 or vendor) — 워커가 막히면 pdf.js가 메인 스레드로 대신 돈다 */
let PDFJS = null;
async function loadPdfJs() {
  if (PDFJS) return PDFJS;
  let lib, worker;
  if (window.JN_PDF) {
    lib = URL.createObjectURL(new Blob([await gunzipB64(window.JN_PDF.lib)], { type: 'text/javascript' }));
    worker = URL.createObjectURL(new Blob([await gunzipB64(window.JN_PDF.worker)], { type: 'text/javascript' }));
  } else {
    lib = new URL('vendor/pdf.min.mjs', location.href).href;
    worker = new URL('vendor/pdf.worker.min.mjs', location.href).href;
  }
  const m = await import(lib);
  m.GlobalWorkerOptions.workerSrc = worker;
  PDFJS = { m, worker };
  return PDFJS;
}
function joinItems(items) {
  let out = '', lastY = null, lastX = null;
  for (const it of items) {
    if (!it.str) { if (it.hasEOL) { out += '\n'; lastY = null; lastX = null; } continue; }
    const y = it.transform ? Math.round(it.transform[5]) : null, x = it.transform ? it.transform[4] : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) out += '\n';
    else if (lastX !== null && x !== null && x - lastX > 12) out += ' ';
    out += it.str; lastY = y; lastX = x !== null && it.width ? x + it.width : x;
    if (it.hasEOL) { out += '\n'; lastY = null; lastX = null; }
  }
  return out;
}
async function readPdf(file, onProg) {
  const P = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const open = async () => P.m.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false }).promise;
  let doc;
  try { doc = await open(); }
  catch (e) {
    if (/password/i.test(e && e.name || '') || /password/i.test(String(e))) throw new Error('암호가 걸린 PDF예요. 암호를 풀고 다시 올려 주세요.');
    // 워커 실패 대비: 워커 모듈을 메인 스레드에 올려 fake worker로 다시 시도
    globalThis.pdfjsWorker = await import(P.worker);
    doc = await open();
  }
  const parts = [], pageItems = []; let empty = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i); const tc = await pg.getTextContent();
    const t = joinItems(tc.items); if (t.replace(/\s/g, '').length < 15) empty++;
    pageItems.push(tc.items.filter(it => typeof it.str === 'string').map(it => ({ str: it.str, transform: it.transform, width: it.width, height: it.height })));
    parts.push(t); onProg && onProg(i, doc.numPages);
  }
  return { text: parts.join('\n'), pages: doc.numPages, empty, doc, pageItems };
}
IN.pdf = async el => {
  const f = el.files && el.files[0]; if (!f) return;
  const st = $('#pdfStatus');
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { st.textContent = 'PDF 파일만 열 수 있어요.'; return; }
  st.innerHTML = '읽는 중… <div class="bar"><i id="pbar"></i></div>';
  try {
    const r = await readPdf(f, (i, n) => { const b = $('#pbar'); if (b) b.style.width = Math.round(i / n * 100) + '%'; });
    const chars = r.text.replace(/\s/g, '').length;
    if (r.empty >= r.pages * 0.7 || chars < 200) { try { r.doc.destroy(); } catch (e) { } origReset(); st.innerHTML = '<span class="badge rose">글자를 거의 못 찾았어요</span> 사진(스캔) PDF 같아요. 글자를 붙여넣어 주세요.'; return; }
    S.rec.raw = r.text; S.rec.pdfName = f.name; S.rec.demo = false; origKeep(r.doc, r.pageItems, f.name);
    const ta = $('#rawText'); if (ta) ta.value = r.text;
    st.innerHTML = `<b>${esc(f.name)}</b> · ${r.pages}쪽 · ${chars.toLocaleString()}자 읽음`;
    el.value = '';
  } catch (e) {
    st.innerHTML = '<span class="badge rose">못 읽었어요</span> ' + esc(e && e.message ? e.message : String(e)) + ' 글자를 붙여넣어도 돼요.';
  }
};

/* ---- 04-major.js ---- */
/* ===== ② 학과·전형 찾기 ===== */
const MJ_DATA = ['학과사전', '모집2028', '최저2028', '면접기준', '전형결과', '공식입결', '2028출처'];
let MOJIP_IDX = null;
function mojipIndex() {
  if (MOJIP_IDX) return MOJIP_IDX;
  const byKey = new Map();
  DS['모집2028'].forEach(r => { if (!byKey.has(r.모집단위키)) byKey.set(r.모집단위키, []); byKey.get(r.모집단위키).push(r); });
  return (MOJIP_IDX = { byKey });
}
const isRural = s => /농어촌|농어업/.test(s || '');
const myGrade = () => { const w = S.rec.analyzed ? wavg(S.rec.grades) : null; return w ? { avg: w.avg, sys: S.rec.system || sysOf(S.profile.curr) } : null; };

function viewMajor() {
  const M = S.mj;
  if (M.view === 'univ' && M.univ) return vhead('apri', esc(M.univ), esc(M.deptName || ''), 'major') + '<div id="mjBox">불러오는 중…</div>';
  if (M.view === 'dept' && M.dept) return vhead('apri', esc(M.deptName), '학과 → 대학 고르기', 'major') + '<div id="mjBox">불러오는 중…</div>';
  return vhead('apri', '학과·전형 찾기', '궁금한 학과를 찾아보세요.') + `<section class="panel apri">
    <label class="f" for="mjQ">학과 이름이나 관심 낱말</label>
    <input id="mjQ" type="search" data-in="mjQ" value="${esc(M.q)}" placeholder="예: 간호, 반도체, 상담, 교육" autocomplete="off">
    <div id="mjChips" class="row" style="margin-top:10px"></div></section><div id="mjBox"></div>`;
}
async function fillMajor() {
  await need(MJ_DATA);
  const M = S.mj;
  if (M.view === 'univ' && M.univ) return fillUniv();
  if (M.view === 'dept' && M.dept) return fillDept();
  const chips = $('#mjChips');
  if (chips && !chips.innerHTML) {
    const ser = [...new Set(DS['학과사전'].map(r => r.계열).filter(Boolean))];
    chips.innerHTML = (S.profile.interest ? `<button class="btn small apri" data-act="mjSet" data-q="${esc(S.profile.interest)}">${esc(S.profile.interest)}</button>` : '') +
      ser.map(s => `<button class="btn small white" data-act="mjSet" data-q="${esc(s)}">${esc(s)}</button>`).join('');
  }
  mjResults();
}
function mjResults() {
  const box = $('#mjBox'); if (!box) return;
  const q = nsp(S.mj.q);
  if (!q) { box.innerHTML = `<div class="panel apri empty"><strong>학과를 찾아보세요</strong>위 낱말을 눌러도 돼요.</div>`; return; }
  const dict = DS['학과사전'];
  const hits = dict.map(d => {
    const nm = nsp(d.학과명); let sc = 0;
    if (nm === q) sc = 10; else if (nm.includes(q)) sc = 6; else if (nsp(d.계열) === q) sc = 4; else if ((d.낱말 || '').includes(q)) sc = 2; else if ((d['관련 직업'] || '').includes(q)) sc = 1;
    return { d, sc };
  }).filter(x => x.sc).sort((a, b) => b.sc - a.sc).slice(0, 40);
  const idx = mojipIndex(); const shownKeys = new Set(hits.map(h => deptKey(h.d.학과명)));
  const extraKeys = [...idx.byKey.keys()].filter(k => k.includes(q) && !shownKeys.has(k)).slice(0, 20);
  const cnt = k => new Set((idx.byKey.get(k) || []).map(r => r.대학)).size;
  box.innerHTML = `<section class="panel apri"><h2>찾은 학과 ${hits.length + extraKeys.length}</h2><div class="list">
    ${hits.map(h => { const k = deptKey(h.d.학과명), n = cnt(k); return `<button class="li" data-act="mjDept" data-name="${esc(h.d.학과명)}"><div><div class="t">${esc(h.d.학과명)}</div><div class="s">${esc(h.d.계열)} · ${esc((h.d['관련 직업'] || '').split(',').slice(0, 3).join(', '))}</div></div><div class="r">${n ? `<span class="badge apri">2028 모집 ${n}개 대학</span>` : '<span class="badge">모집 자료 이름 다름</span>'}</div></button>`; }).join('')}
    ${extraKeys.map(k => `<button class="li" data-act="mjKey" data-key="${esc(k)}"><div><div class="t">${esc((idx.byKey.get(k)[0] || {}).모집단위 || k)}</div><div class="s">모집단위 이름으로 찾음</div></div><div class="r"><span class="badge apri">${cnt(k)}개 대학</span></div></button>`).join('')}
    ${!hits.length && !extraKeys.length ? '<div class="empty"><strong>못 찾았어요</strong>더 짧은 낱말로 찾아보세요.</div>' : ''}</div></section>`;
}
IN.mjQ = el => { S.mj.q = el.value; mjResults(); };
ACT.mjSet = el => { S.mj.q = el.dataset.q; const i = $('#mjQ'); if (i) i.value = S.mj.q; mjResults(); };
ACT.mjDept = el => { const n = el.dataset.name; Object.assign(S.mj, { dept: n, deptName: n, keys: [deptKey(n)], view: 'dept', univ: null, uq: '' }); go('major'); };
ACT.mjKey = el => { const k = el.dataset.key; const r = (mojipIndex().byKey.get(k) || [])[0]; Object.assign(S.mj, { dept: '#' + k, deptName: r ? r.모집단위 : k, keys: [k], view: 'dept', univ: null, uq: '' }); go('major'); };

function unitRows() {
  const idx = mojipIndex(); let rows = [];
  S.mj.keys.forEach(k => rows.push(...(idx.byKey.get(k) || [])));
  if (!rows.length && S.mj.keys[0] && S.mj.keys[0].length >= 2) { const k = S.mj.keys[0]; rows = DS['모집2028'].filter(r => nsp(r.모집단위).includes(k)).slice(0, 600); }
  return rows;
}
function fillDept() {
  const box = $('#mjBox'); if (!box) return;
  const M = S.mj, d = DS['학과사전'].find(x => x.학과명 === M.dept);
  const rows = unitRows();
  const by = new Map(); rows.forEach(r => { if (!by.has(r.대학)) by.set(r.대학, []); by.get(r.대학).push(r); });
  let univs = [...by.entries()].map(([u, rs]) => ({ u, rs, n: rs.reduce((s, r) => s + (parseInt(r.인원) || 0), 0), rural: rs.some(r => isRural(r.전형)), buk: isBUK(u) }));
  const uq = nsp(M.uq);
  if (uq) univs = univs.filter(x => nsp(x.u).includes(uq));
  if (M.bu) univs = univs.filter(x => x.buk);
  univs.sort((a, b) => (S.profile.rural ? (b.rural - a.rural) : 0) || (b.buk - a.buk) || a.u.localeCompare(b.u, 'ko'));
  const subj = d ? ['공통과목', '일반선택', '진로선택', '융합선택'].map(k => d[k] ? `<p style="margin:4px 0"><b>${k.replace('과목', '')}</b></p><div class="subs">${splitSubjects(d[k]).map(s => `<span class="sub plain">${esc(s)}</span>`).join('')}</div>` : '').join('') : '';
  box.innerHTML = `${d ? `<section class="panel apri"><h2>${esc(d.학과명)} <span class="badge apri">${esc(d.계열)}</span></h2>
      <p>${esc((d['학과 개요'] || '').slice(0, 140))}${(d['학과 개요'] || '').length > 140 ? '…' : ''}</p>
      <details><summary>이런 학생에게 맞아요</summary><p>${esc(d['적성과 흥미'])}</p></details>
      <details><summary>관련 직업</summary><div class="subs">${(d['관련 직업'] || '').split(',').map(s => s.trim()).filter(Boolean).map(s => `<span class="sub plain">${esc(s)}</span>`).join('')}</div></details>
      <details><summary>고교에서 들으면 좋은 과목</summary>${subj || '<p class="muted">자료 없음</p>'}</details>
      <details><summary>고교 활동 예시</summary><p>${esc(d['고교 활동'] || '자료 없음')}</p></details>
      <div class="row"><button class="btn small white" data-act="fitFromDept" data-name="${esc(d.학과명)}">내 학생부와 과목 비교</button></div></section>` : ''}
    <section class="panel sun"><h2>이 학과를 뽑는 대학 ${univs.length}곳 <span class="badge sun">2028 시행계획 기준(잠정)</span></h2>
      <div class="row"><input type="search" aria-label="대학 이름으로 거르기" placeholder="대학 이름으로 거르기" value="${esc(M.uq)}" data-in="mjUq" style="flex:1;min-width:180px">
      <label class="toggle"><input type="checkbox" data-in="mjBu" ${M.bu ? 'checked' : ''}><span class="sw"></span>부울경만</label>
      <label class="toggle"><input type="checkbox" data-in="mjRural" ${S.profile.rural ? 'checked' : ''}><span class="sw"></span>농어촌 강조</label></div>
      <div class="list" style="margin-top:10px">${univs.slice(0, 200).map(x => `<button class="li" data-act="mjUniv" data-u="${esc(x.u)}"><div><div class="t">${esc(x.u)}</div><div class="s">${esc([...new Set(x.rs.map(r => r.모집단위))].slice(0, 3).join(', '))} · 전형 ${x.rs.length}개 · ${x.n}명</div></div>
        <div class="r">${x.buk ? '<span class="badge mint">부울경</span>' : ''}${x.rural ? `<span class="badge ${S.profile.rural ? 'sun' : ''}">농어촌 전형</span>` : ''}</div></button>`).join('') || '<div class="empty"><strong>모집 자료에서 못 찾았어요</strong>학과 이름이 대학마다 달라요. 검색에서 낱말을 바꿔 보세요.</div>'}</div></section>`;
}
IN.mjUq = el => { S.mj.uq = el.value; clearTimeout(IN._uqT); IN._uqT = setTimeout(() => { fillDept(); const i = $('[data-in=mjUq]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); };
IN.mjBu = el => { S.mj.bu = el.checked; fillDept(); };
IN.mjRural = el => { S.profile.rural = el.checked; saveProfile(); renderTop(); S.mj.view === 'univ' ? fillUniv() : fillDept(); };
ACT.mjUniv = el => { S.mj.univ = el.dataset.u; S.mj.view = 'univ'; go('major'); };
ACT.fitFromDept = el => { S.rec.fit = { univ: '', unit: '', dept: el.dataset.name }; if (S.rec.analyzed) { S.rec.step = 3; S.rec.tab = 'fit'; } go('record'); };

/* 수능최저·면접 찾기 */
function minFor(univ, row) {
  const cands = DS['최저2028'].filter(m => sameUni(m.대학, univ) && m.유형 === row.유형 && sameTrack(m.전형, row.전형));
  if (!cands.length) return null;
  const unit = nsp(row.모집단위).replace(/\(.*?\)/g, ''), key = row.모집단위키;
  const hasUnit = m => { const t = nsp(m.대상); return t && (t.includes(unit) || (key.length >= 2 && t.includes(key))); };
  const spec = cands.filter(m => hasUnit(m) && !new RegExp(rxEsc(unit) + '[^,]{0,6}제외|' + rxEsc(key) + '[^,]{0,6}제외').test(nsp(m.대상)));
  if (spec.length) return spec.slice(0, 3);
  const gen = cands.filter(m => !m.대상 || /그\s*외|일반\s*모집단위|전체\s*모집단위|^전\s*모집단위|나머지|공통|전체$/.test(m.대상));
  if (gen.length) return gen.slice(0, 2);
  if (cands.length === 1) return cands;
  return [{ 대상: '', 기준: '', 안내: '이 모집단위 기준을 자료에서 못 찾았어요' }];
}
function ivFor(univ, row) {
  const typeOk = m => !m.유형 || (m.유형 === '학종' ? row.유형 === '종합' : m.유형 === '교과' ? row.유형 === '교과' : true);
  const unit = nsp(row.모집단위).replace(/\(.*?\)/g, ''), key = row.모집단위키 || '';
  const unitOk = m => { const t = nsp(m.해당모집단위); return !t || /전\s*모집단위|전체/.test(t) || t.includes(unit) || (key.length >= 2 && t.includes(key)); };
  const r = DS['면접기준'].filter(m => sameUni(m.대학, univ) && typeOk(m) && sameTrack(m.전형, row.전형) && unitOk(m));
  return r.length ? r : (/면접/.test(row.전형) ? [{ 면접방식: '전형 이름에 면접 포함' }] : null);
}function minText(ms) {
  if (!ms) return '<span class="tiny">모집요강 확인</span>';
  if (ms[0].안내) return '<span class="tiny">' + esc(ms[0].안내) + ' · 모집요강 확인</span>';
  return ms.map(m => `${m.대상 && ms.length > 1 ? `<span class="tiny">${esc(m.대상)}</span><br>` : ''}${/없음/.test(m.기준) || m.최저적용 === '미적용' ? '<span class="badge mint">없음</span>' : esc(m.기준 || '-')}${m.반영영역 ? `<br><span class="tiny">${esc(m.반영영역)}</span>` : ''}`).join('<hr style="border:0;border-top:1px dashed #ccd">');
}

/* 입결: 공식입결(원 자료) 먼저, 그다음 전형결과 3개년. 원 자료 표기 그대로 + 기준 문구 */
function officialFor(univ, keys) {
  return DS['공식입결'].filter(r => sameUni(r.대학, univ) && keys.some(k => deptKey(r.모집단위) === k || nsp(r.모집단위).includes(k)));
}
const UNI_NOTE = {
  '영남대': '영남대 안내: 대학별 산출방법이 달라 다른 대학과 비교할 수 없어요. 영남대 지원 참고용이에요.',
  '경남대': '경남대 기준은 최종합격자(충원 포함) 상위 90%예요. 등록자 기준과 달라요.'
};
function ref5(v) { const g = gradeMean9(v); return g == null ? '' : ` <span class="tiny">(5등급 눈금≈${fmt(g)})</span>`; }
function officialHTML(rows, my) {
  if (!rows.length) return '';
  const g = new Map();
  rows.forEach(r => { const k = [r.학년도, r.모집시기, r.전형유형, r.전형명, r.모집단위].join('|'); if (!g.has(k)) g.set(k, []); g.get(k).push(r); });
  const five = my && my.sys === 5;
  const out = [...g.values()].map(rs => {
    const a = rs[0];
    const vals = rs.map(r => { const v = String(r.성적값 || '').trim(); const num = v !== '' && isFinite(Number(v)); const sys9 = /9/.test(r.성적체계 || '9');
      return `<li><span class="tiny">${esc(r.성적기준 || '기준 미표기')}</span> <b>${v === '' ? '<span class="badge">미공개</span>' : esc(v)}</b>${num && five && sys9 ? ref5(Number(v)) : ''}</li>`; }).join('');
    const est = /부경대/.test(uniBase(a.대학)) ? ' <span class="badge">유형 추정</span>' : '';
    const src = /^https?:\/\//.test(a.출처URL) ? `<a href="${esc(a.출처URL)}" target="_blank" rel="noopener noreferrer">출처${a.출처페이지 ? ' p.' + esc(a.출처페이지) : ''}</a>` : esc(a.출처유형 || '');
    return `<tr><td><b>${esc(a.학년도)}</b><br><span class="tiny">${esc(a.모집시기)}</span></td><td>${esc(a.전형유형)}${est}<br><b>${esc(a.전형명)}</b><br><span class="tiny">${esc(a.모집단위)}</span></td>
      <td class="n">${esc(a.모집인원 || '-')}</td><td class="n">${esc(a.경쟁률 || '-')}</td><td class="n">${a.충원합격 !== '' ? esc(a.충원합격) : '-'}</td>
      <td><ul style="margin:0;padding-left:16px">${vals}</ul><span class="tiny">${esc(a.성적체계)} · ${esc(a.교육과정)} 교육과정</span></td><td>${src}<br><span class="tiny">${esc(a.출처유형)}</span></td></tr>`;
  }).join('');
  const notes = [...new Set(rows.map(r => UNI_NOTE[Object.keys(UNI_NOTE).find(k => uniBase(r.대학).startsWith(k))]).filter(Boolean))];
  return `<h3>대학 공식 발표 입결 <span class="badge mint">원 자료</span></h3>${notes.map(n => `<p class="note">${esc(n)}</p>`).join('')}
    <div class="tbl-wrap"><table><thead><tr><th>학년도</th><th>전형</th><th class="n">인원</th><th class="n">경쟁률</th><th class="n">충원 표기<br><span class="tiny">대학별 의미 다름</span></th><th>성적 (기준 그대로)</th><th>출처</th></tr></thead><tbody>${out}</tbody></table></div>`;
}
function sheetResults(univ, keys) { return DS['전형결과'].filter(r => sameUni(r.대학, univ) && keys.includes(r.키)); }
function sheetHTML(rows, my) {
  if (!rows.length) return '';
  const five = my && my.sys === 5;
  const cell = (v, base) => v ? `${esc(v)}${five && isFinite(Number(v)) ? ref5(Number(v)) : ''}` : '-';
  const body = rows.map(r => ['26', '25', '24'].map((y, i) => (r[y + '경쟁'] || r[y + '성적1'] || r[y + '성적2']) ? `<tr><td>${i === 0 ? `<b>${esc(r.전형)}</b><br><span class="tiny">${esc(r.대학)} · ${esc(r.모집단위)}</span>` : ''}</td><td>20${y}</td><td class="n">${esc(r[y + '모집'] || '-')}</td><td class="n">${esc(r[y + '경쟁'] || '-')}</td><td class="n">${cell(r[y + '성적1'])}</td><td class="n">${cell(r[y + '성적2'])}</td></tr>` : '').join('') ||
    `<tr><td><b>${esc(r.전형)}</b></td><td colspan="5" class="tiny">지난 결과 없음 (2027 모집 ${esc(r['27모집'] || '-')}명)</td></tr>`).join('');
  const crit = [...new Set(rows.map(r => [r.기준1, r.기준2].filter(Boolean).join(' / ')))].filter(Boolean).join(' · ');
  return `<h3>최근 3년 입결 <span class="badge">지식베이스 정리본</span></h3>
    <p class="tiny">성적1·2 기준: <b>${esc(crit || '표기 없음')}</b> · 9등급(2015 개정) 값</p>
    <div class="tbl-wrap"><table><thead><tr><th>전형</th><th>학년도</th><th class="n">모집</th><th class="n">경쟁률</th><th class="n">성적1</th><th class="n">성적2</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
function myBox(my) {
  if (!my) return `<p class="note">내 학생부를 넣으면 내 평균을 옆에 참고로 보여 줘요. <button class="btn small white" data-act="go" data-to="record">학생부 넣기</button></p>`;
  return `<div class="stats"><div class="stat vio"><span>내 평균 (${my.sys}등급제)</span><b>${fmt(my.avg)}</b><span class="tiny">참고로 나란히 볼 뿐이에요</span></div></div>
    ${my.sys === 5 ? '<div class="warn">입결은 9등급제(2015 개정)예요. 괄호 속 5등급 눈금 값은 참고용이에요.</div>' : ''}`;
}
function fillUniv() {
  const box = $('#mjBox'); if (!box) return;
  const M = S.mj, u = M.univ, rows = unitRows().filter(r => r.대학 === u);
  const src = DS['2028출처'].find(r => sameUni(r.대학, u));
  const my = myGrade();
  const trs = rows.map(r => {
    const ms = minFor(u, r), iv = ivFor(u, r), ru = isRural(r.전형);
    const inC = S.cands.some(c => c.univ === u && c.전형 === r.전형 && c.unit === r.모집단위);
    return `<tr style="${ru && S.profile.rural ? 'background:#FFF3CC' : ''}"><td><span class="badge ${r.유형 === '교과' ? 'mint' : r.유형 === '종합' ? 'vio' : r.유형 === '논술' ? 'apri' : 'sun'}">${esc(r.유형)}</span></td>
      <td><b>${esc(r.전형)}</b>${ru ? ' <span class="badge sun">농어촌</span>' : ''}<br><span class="tiny">${esc(r.모집단위)}</span></td><td class="n">${esc(r.인원)}</td>
      <td>${minText(ms)}</td><td>${iv ? `<span class="badge vio" title="${esc(iv[0].면접방식 || '')}">면접</span>` : '<span class="tiny">정보 없음</span>'}</td>
      <td><button class="btn small ${inC ? 'white' : 'apri'}" data-act="candAdd" data-u="${esc(u)}" data-t="${esc(r.전형)}" data-n="${esc(r.모집단위)}" data-y="${esc(r.유형)}" data-c="${esc(r.인원)}" data-k="${esc(r.모집단위키)}" ${inC ? 'disabled' : ''}>${inC ? '담음' : '후보 담기'}</button></td></tr>`;
  }).join('');
  const off = officialFor(u, M.keys), sh = sheetResults(u, M.keys);
  box.innerHTML = `<section class="panel apri"><h2>2028 전형 <span class="badge sun">시행계획 기준(잠정)</span></h2>
      ${src ? `<p class="tiny">출처: ${esc(src.출처)} ${src.상태 && src.상태 !== 'ok' ? '· ' + esc(src.상태) : ''}</p>` : ''}
      <div class="tbl-wrap"><table><thead><tr><th>유형</th><th>전형</th><th class="n">인원</th><th>수능최저</th><th>면접</th><th>후보</th></tr></thead><tbody>${trs}</tbody></table></div>
      <p class="tiny">수능최저·면접은 이름이 비슷한 전형을 이어 붙인 거예요. 꼭 모집요강으로 확인해 주세요.</p>
      <div class="row"><button class="btn vio" data-act="ivFrom" data-u="${esc(u)}" data-d="${esc(M.deptName || '')}">이 대학 면접 연습 →</button>
      <label class="toggle"><input type="checkbox" data-in="mjRural" ${S.profile.rural ? 'checked' : ''}><span class="sw"></span>농어촌 강조</label><button class="btn small white" data-act="go" data-to="rural">농어촌 체크</button></div></section>
    <section class="panel vio"><h2>입결 참고</h2>${myBox(my)}
      ${!off.length && /영남대/.test(uniBase(u)) ? '<p class="note">영남대 입결은 대학 안내에 따라 공식 게시물에서 확인해 주세요. <a href="https://enter.yu.ac.kr/10000023?mode=view&bbs_seq=1223&categorycode=8" target="_blank" rel="noopener noreferrer">2026 수시 입학자 성적(영남대 입학처)</a></p>' : ''}${officialHTML(off, my)}${sheetHTML(sh, my)}
      ${!off.length && !sh.length ? '<div class="empty"><strong>이 대학·학과 입결 자료가 없어요</strong>대학 입학처 자료를 확인해 주세요.</div>' : ''}
      <p class="tiny">합격 가능성을 알려 주는 게 아니에요. 대학마다 반영 과목·방식이 달라요.</p></section>`;
}

/* 후보 */
ACT.candAdd = el => {
  if (S.cands.length >= 6) { toast('후보는 6개까지예요. 비교 화면에서 빼고 담아 주세요.'); return; }
  const d = el.dataset; S.cands.push({ univ: d.u, 전형: d.t, unit: d.n, 유형: d.y, 인원: d.c, key: d.k });
  saveCands(); toast('후보에 담았어요 (' + S.cands.length + '/6)'); fillUniv(); renderCandbar();
};
function renderCandbar() {
  const b = $('#candbar'); const show = S.cands.length && (VIEW === 'major');
  b.hidden = !show; if (show) b.innerHTML = `<span>내 후보 <b>${S.cands.length}</b>/6</span><button class="btn small sun" data-act="go" data-to="compare">비교하기</button>`;
}
function viewCompare() { return vhead('apri', '내 지원 후보', '최대 6개 · 나란히 보기', 'major') + '<div id="cmpBox">불러오는 중…</div>'; }
async function fillCompare() {
  await need(MJ_DATA);
  const box = $('#cmpBox'); if (!box) return;
  const my = myGrade();
  if (!S.cands.length) { box.innerHTML = '<div class="panel apri empty"><strong>아직 후보가 없어요</strong><button class="btn apri" data-act="go" data-to="major">학과 찾으러 가기</button></div>'; return; }
  box.innerHTML = myBox(my) + `<div class="cmp">${S.cands.map((c, i) => {
    const row = { 유형: c.유형, 전형: c.전형, 모집단위: c.unit, 모집단위키: c.key };
    const ms = minFor(c.univ, row), iv = ivFor(c.univ, row);
    const off = officialFor(c.univ, [c.key]); const sh = sheetResults(c.univ, [c.key]);
    const tyOk = r => !r.전형유형 || (c.유형 === '교과' ? /교과/.test(r.전형유형) : c.유형 === '종합' ? /종합/.test(r.전형유형) : true);
    const offT = off.filter(tyOk), offM = offT.filter(r => sameTrack(r.전형명, c.전형)); const shM = sh.filter(r => sameTrack(r.전형, c.전형));
    let ip = '';
    const o = (offM.length ? offM : offT).slice(0, 3);
    if (o.length) ip = o.map(r => `<div class="tiny">${esc(r.학년도)} ${esc(r.전형명)} · ${esc(r.성적기준)} <b>${r.성적값 === '' ? '미공개' : esc(r.성적값)}</b>${my && my.sys === 5 && r.성적값 !== '' ? ref5(Number(r.성적값)) : ''}</div>`).join('');
    else { const s = (shM.length ? shM : sh)[0]; if (s && (s['26성적1'] || s['26성적2'])) ip = `<div class="tiny">2026 ${esc(s.전형)} · ${esc(s.기준1)} <b>${esc(s['26성적1'] || '-')}</b> · ${esc(s.기준2)} <b>${esc(s['26성적2'] || '-')}</b></div>`; }
    return `<article class="cmpcard"><h3>${esc(c.univ)}</h3><p class="tiny" style="margin:0">${esc(c.unit)}</p>
      <dl><dt>유형</dt><dd>${esc(c.유형)}</dd><dt>전형</dt><dd>${esc(c.전형)}${isRural(c.전형) ? ' <span class="badge sun">농어촌</span>' : ''}</dd><dt>2028 인원</dt><dd>${esc(c.인원)}명 <span class="tiny">(잠정)</span></dd>
      <dt>수능최저</dt><dd>${minText(ms)}</dd><dt>면접</dt><dd>${iv ? '있음' : '<span class="tiny">정보 없음</span>'}</dd><dt>입결</dt><dd>${ip || '<span class="tiny">자료 없음</span>'}</dd></dl>
      <button class="btn small danger" data-act="candDel" data-i="${i}">빼기</button></article>`;
  }).join('')}</div><p class="tiny">입결은 원 자료 기준 그대로예요. 합격 예측이 아니에요.</p>`;
}
ACT.candDel = el => { S.cands.splice(+el.dataset.i, 1); saveCands(); fillCompare(); };

/* 농어촌 체크 */
const RURAL = {
  6: ['중·고 6년 동안 다닌 학교가 모두 농어촌(읍·면 또는 도서·벽지)에 있어요', '그 6년 동안 나도 농어촌에 살았어요', '그 6년 동안 부모님 모두 농어촌에 살았어요', '입학·전입부터 고교 졸업까지 끊김이 없어요', '지원 제외 학교·과정(예: 일부 특목고)에 해당하지 않아요', '전학·가족 변동 등 예외가 있으면 대학에 물어봤어요', '제출 서류와 발급 시기를 확인했어요'],
  12: ['초·중·고 12년 동안 다닌 학교가 모두 농어촌에 있어요', '그 12년 동안 나도 농어촌에 살았어요', '부모님 거주 요건이 있는지 대학 기준을 확인했어요', '입학부터 고교 졸업까지 끊김이 없어요', '지원 제외 학교·과정에 해당하지 않아요', '전학 등 예외가 있으면 대학에 물어봤어요', '제출 서류와 발급 시기를 확인했어요']
};
function viewRural() {
  const R = S.rural, list = RURAL[R.type];
  return vhead('navy', '농어촌 전형 체크', '자격을 정해 주는 게 아니라, 확인할 목록이에요.') + `<section class="panel sun">
    <div class="seg" role="group" aria-label="유형"><button data-act="ruType" data-v="6" aria-pressed="${R.type === '6'}">6년형 (중·고)</button><button data-act="ruType" data-v="12" aria-pressed="${R.type === '12'}">12년형 (초·중·고)</button></div>
    <div style="margin-top:12px">${list.map((t, i) => `<label class="confirm" style="background:#fff;border:3px solid var(--line)"><input type="checkbox" data-in="ruChk" data-i="${R.type}-${i}" ${R.checks[R.type + '-' + i] ? 'checked' : ''}>${esc(t)}</label>`).join('')}</div>
    <div class="note"><b>자격 확정 판정이 아니에요.</b> 대학마다 기준이 달라요. 꼭 그 대학 모집요강을 확인하세요. <span class="badge sun">2028 시행계획 기준(잠정)</span></div>
    <a class="btn white" href="${ADIGA_URL}" target="_blank" rel="noopener noreferrer">대학 모집요강 확인 (대입정보포털)</a></section>
    <section class="panel apri"><h2>내 후보 대학의 농어촌 전형</h2><div id="ruBox">불러오는 중…</div></section>`;
}
async function fillRural() {
  await need(['모집2028']); const box = $('#ruBox'); if (!box) return;
  const us = [...new Set(S.cands.map(c => c.univ))];
  if (!us.length) { box.innerHTML = '<p class="muted">후보를 담으면 여기에 나와요.</p>'; return; }
  box.innerHTML = us.map(u => { const keys = S.cands.filter(c => c.univ === u).map(c => c.key); const rs = DS['모집2028'].filter(r => r.대학 === u && isRural(r.전형) && keys.includes(r.모집단위키));
    return `<h3>${esc(u)}</h3>${rs.length ? rs.map(r => `<span class="badge sun">${esc(r.유형)} · ${esc(r.전형)} · ${esc(r.모집단위)} ${esc(r.인원)}명</span>`).join(' ') : '<span class="tiny">이 학과 농어촌 전형을 자료에서 못 찾았어요.</span>'}`; }).join('');
}
ACT.ruType = el => { S.rural.type = el.dataset.v; render(); };
IN.ruChk = el => { S.rural.checks[el.dataset.i] = el.checked; };

/* ---- 05-interview.js ---- */
/* ===== ③ 면접 연습 — 모범답안 없음, 내가 먼저 답한다 ===== */
const IV_DATA = ['면접기준', '면접요소', '면접문항', '면접안내', '기출면접', '질문템플릿', '모집2028'];
let IV_UNIS = null;
function ivUnis() {
  if (IV_UNIS) return IV_UNIS;
  const m = new Map();
  ['면접기준', '면접문항', '기출면접', '면접요소', '면접안내'].forEach(n => DS[n].forEach(r => { if (r.대학) { const k = uniNorm(r.대학); if (!m.has(k)) m.set(k, uniNorm(r.대학)); } }));
  return (IV_UNIS = [...m.values()].sort((a, b) => a.localeCompare(b, 'ko')));
}
function viewInterview() {
  if (S.iv.phase) return vhead('vio', '면접 연습', `${S.iv.i + 1} / ${S.iv.queue.length}`, 'interview') + practiceHTML();
  return vhead('vio', '면접 연습', '대학을 고르고, 질문에 내가 먼저 답해 봐요.') + `<section class="panel vio">
    <div class="grid2"><div><label class="f" for="ivU">대학</label><input id="ivU" list="ivUList" data-in="ivU" value="${esc(S.iv.univ)}" placeholder="대학 이름 입력" autocomplete="off"><datalist id="ivUList"></datalist></div>
    <div><label class="f" for="ivD">학과 <span class="tiny">(선택)</span></label><input id="ivD" list="ivDList" data-in="ivD" value="${esc(S.iv.dept)}" placeholder="예: 간호학과" autocomplete="off"><datalist id="ivDList"></datalist></div></div>
    <div class="row" style="margin-top:10px"><button class="btn vio" data-act="ivLoad">질문 보기</button>${S.cands.length ? S.cands.slice(0, 6).map(c => `<button class="btn small white" data-act="ivFrom" data-u="${esc(c.univ)}" data-d="${esc(c.unit)}">${esc(c.univ)}</button>`).join('') : ''}</div>
  </section><div id="ivBox"></div>`;
}
async function fillInterview() {
  if (S.iv.phase) return;
  const box = $('#ivBox'); if (box) box.innerHTML = '<div class="panel empty">자료 여는 중…</div>';
  await need(IV_DATA);
  const dl = $('#ivUList'); if (dl) dl.innerHTML = ivUnis().map(u => `<option value="${esc(u)}">`).join('');
  ivDeptList();
  ivRender();
}
function ivDeptList() {
  const dl = $('#ivDList'); if (!dl || !S.iv.univ) return;
  const u = S.iv.univ; const s = new Set();
  DS['기출면접'].forEach(r => { if (sameUni(r.대학, u) && r.학과 && !/^\(/.test(r.학과)) s.add(r.학과); });
  DS['모집2028'].forEach(r => { if (sameUni(r.대학, u)) s.add(r.모집단위); });
  dl.innerHTML = [...s].slice(0, 400).map(x => `<option value="${esc(x)}">`).join('');
}
IN.ivU = el => { S.iv.univ = el.value.trim(); ivDeptList(); };
IN.ivD = el => { S.iv.dept = el.value.trim(); };
ACT.ivLoad = () => { S.iv.picks = {}; ivRender(); };
ACT.ivFrom = el => { S.iv.univ = el.dataset.u; S.iv.dept = el.dataset.d || ''; S.iv.picks = {}; S.iv.phase = ''; go('interview'); };

function ivQuestions() {
  const u = S.iv.univ, d = S.iv.dept, dk = d ? deptKey(d) : '';
  const G = DS['기출면접'];
  const mine = [], uniOther = [], same = [];
  for (const r of G) {
    const isU = u && sameUni(r.대학, u);
    const isD = dk && (r.학과키 === dk || (r.학과 && nsp(r.학과).includes(dk)));
    if (isU && isD) mine.push(r); else if (isU) uniOther.push(r); else if (isD) same.push(r);
  }
  const byYear = (a, b) => (Number(b.연도) || 0) - (Number(a.연도) || 0);
  return { mine: mine.sort(byYear).slice(0, 60), uniOther: uniOther.sort(byYear).slice(0, 40), same: same.sort(byYear).slice(0, 40) };
}
function recQuestions() {
  if (!S.rec.analyzed) return [];
  const T = DS['질문템플릿'].filter(t => t.사용 !== 'N');
  const major = S.iv.dept || S.profile.interest || '희망 전공', univ = S.iv.univ || '지원 대학';
  const items = S.rec.items, out = [];
  const exc = it => { const s = sentences(it.내용)[0] || it.내용; return s.length > 60 ? s.slice(0, 58) + '…' : s; };
  const fill = (tpl, it, kw) => tpl.replace(/\{학년\}/g, it && it.학년 ? it.학년 + '학년' : '').replace(/\{과목\}/g, it && it.과목 ? it.과목 : '')
    .replace(/\{발췌\}/g, it ? exc(it) : '').replace(/\{키워드\}/g, kw || '').replace(/\{전공\}/g, major).replace(/\{대학\}/g, univ).replace(/\s{2,}/g, ' ').trim();
  const pick = (area, n) => items.filter(i => i.영역 === area).sort((a, b) => b.내용.length - a.내용.length).slice(0, n);
  const use = (type, area) => T.filter(t => t.유형 === type && t.적용영역 === area);
  const add = (q, why, tag) => { if (q && !/\{/.test(q) && !out.some(o => o.q === q)) out.push({ q, why, tag }); };
  pick('세특', 3).forEach((it, i) => {
    const kws = keywords(it.내용);
    const a = use('생기부확인', '세특')[0]; if (a) add(fill(a.템플릿, it), a.출제의도, '세특');
    if (kws[0]) { const b = use(['개념설명', '전공연계', '심화'][i % 3], '세특')[0]; if (b) add(fill(b.템플릿, it, kws[0]), b.출제의도, '세특'); }
  });
  ['자율', '동아리', '진로'].forEach(area => { const it = pick(area, 1)[0]; if (!it) return; const a = use('생기부확인', area)[0]; if (a) add(fill(a.템플릿, it), a.출제의도, AREA_NAME[area]);
    const kw = keywords(it.내용)[0]; const b = T.find(t => t.적용영역 === area && t.유형 !== '생기부확인'); if (b && (kw || !/\{키워드\}/.test(b.템플릿))) add(fill(b.템플릿, it, kw), b.출제의도, AREA_NAME[area]); });
  const hs = pick('행특', 1)[0]; if (hs) { const a = use('공동체', '행특')[0]; if (a) add(fill(a.템플릿, hs), a.출제의도, '행동특성'); }
  const ev = S.rec.evidence || {}; const gap = Object.keys(TAG_RULES).find(k => !(ev[k] || []).length);
  if (gap) { const a = T.find(t => t.유형 === '근거공백' && t.적용영역 === '전체'); if (a) add(a.템플릿.replace('{세부항목}', gap), a.출제의도, '빈칸'); }
  T.filter(t => t.유형 === '기본').forEach(t => add(fill(t.템플릿, null), t.출제의도, '기본'));
  return out;
}
function ivRender() {
  const box = $('#ivBox'); if (!box) return;
  const u = S.iv.univ;
  if (!u && !S.iv.dept) { box.innerHTML = `<section class="panel vio empty"><strong>대학을 골라 주세요</strong>학과만 넣어도 같은 학과 기출을 볼 수 있어요.</section>${recQBlock()}`; return; }
  const crit = u ? DS['면접기준'].filter(r => sameUni(r.대학, u)) : [];
  const elem = u ? DS['면접요소'].filter(r => sameUni(r.대학, u)) : [];
  const qs = u ? DS['면접문항'].filter(r => sameUni(r.대학, u)) : [];
  const guide = u ? DS['면접안내'].filter(r => sameUni(r.대학, u)) : [];
  const elemBy = {}; elem.forEach(e => (elemBy[e.전형] = elemBy[e.전형] || []).push(e));
  const info = u ? `<section class="panel vio"><h2>${esc(u)} 면접은 이래요</h2>
    ${crit.length ? crit.map(c => `<div class="item" style="background:var(--vio-l)"><h4>${esc(c.전형)} <span class="badge">${esc(c.유형)}</span></h4>
      <p style="margin:2px 0"><b>방식</b> ${esc(c.면접방식 || '-')}</p><p style="margin:2px 0"><b>시간</b> ${esc(c.면접시간 || '-')} ${c.면접유형 ? '· ' + esc(c.면접유형) : ''}</p>
      ${c.선발방법 ? `<p style="margin:2px 0"><b>선발</b> ${esc(c.선발방법)}</p>` : ''}${c.면접일 ? `<p style="margin:2px 0"><b>면접일</b> ${esc(c.면접일)}</p>` : ''}
      ${(elemBy[c.전형] || []).length ? `<div class="subs">${elemBy[c.전형].map(e => `<span class="sub plain" title="${esc(e.설명)}">${esc(e.요소)} ${e.비율 ? esc(e.비율) + '%' : ''}</span>`).join('')}</div>` : ''}
      <p class="tiny" style="margin:4px 0 0">출처: ${esc(c.출처 || '-')}</p></div>`).join('') : '<p class="muted">면접 방식 자료가 없어요.</p>'}
    ${qs.length ? `<details><summary>전형별 면접 진행 (${qs.length})</summary>${qs.map(q => `<div class="item"><h4>${esc(q.전형명)} <span class="badge">${esc(q.유형)}</span></h4><p style="margin:2px 0" class="tiny">${esc(q.시간)} · ${esc(q.반영비율)}</p><p style="margin:2px 0">${esc(q.평가요소)}</p><p class="tiny" style="margin:2px 0">${esc(q['질문/진행방식'])}</p></div>`).join('')}</details>` : ''}
    ${guide.length ? `<details><summary>대학 안내 (${guide.length})</summary>${guide.map(g => `<p><span class="badge">${esc(g.항목)}</span> ${esc(g.내용)}</p>`).join('')}</details>` : ''}
    <p class="tiny">2028 면접은 바뀔 수 있어요. 모집요강으로 확인해 주세요.</p></section>` : '';
  const Q = ivQuestions();
  const qRow = (r, label) => { const id = 'g' + hash(r.대학 + r.학과 + r.질문); return qItem(id, r.질문, `${label ? esc(label) + ' · ' : ''}${esc(r.연도)} · ${esc(r.출처)}${r.꼬리질문 ? ' · 꼬리: ' + esc(r.꼬리질문.slice(0, 60)) : ''}`); };
  const block = (title, arr, lab) => arr.length ? `<h3>${title} <span class="badge">${arr.length}</span></h3>${arr.slice(0, 20).map(r => qRow(r, lab(r))).join('')}${arr.length > 20 ? `<details><summary>더 보기</summary>${arr.slice(20).map(r => qRow(r, lab(r))).join('')}</details>` : ''}` : '';
  box.innerHTML = info + `<section class="panel vio"><h2>기출 질문</h2><p class="one">연습할 질문을 고르세요. 모범답안은 없어요.</p>
    ${block('이 대학 · 이 학과', Q.mine, r => r.학과)}${block('이 대학 다른 학과', Q.uniOther, r => r.학과)}${block('같은 학과 · 다른 대학/자료집', Q.same, r => r.대학 || '자료집')}
    ${!Q.mine.length && !Q.uniOther.length && !Q.same.length ? '<p class="muted">기출을 못 찾았어요. 학과 이름을 바꿔 보세요.</p>' : ''}</section>${recQBlock()}
    <div class="row end" style="position:sticky;bottom:12px"><button class="btn sun" data-act="ivStart">▶ 고른 질문으로 연습 (<span id="pickN">${Object.keys(S.iv.picks).length}</span>)</button></div>`;
}
function qItem(id, q, meta) {
  const on = !!S.iv.picks[id];
  return `<label class="confirm" style="background:${on ? 'var(--vio-l)' : '#fff'};border:3px solid ${on ? 'var(--vio)' : 'var(--line)'};font-weight:600;align-items:flex-start">
    <input type="checkbox" data-in="ivPick" data-id="${esc(id)}" data-q="${esc(q)}" ${on ? 'checked' : ''}><span><b>${esc(q)}</b><br><span class="tiny">${meta}</span></span></label>`;
}
function recQBlock() {
  const rq = recQuestions();
  if (!S.rec.analyzed) return `<section class="panel mint"><h2>내 학생부로 만든 질문</h2><p class="muted">학생부를 넣으면 내 기록으로 질문을 만들어요.</p><button class="btn mint small" data-act="go" data-to="record">학생부 넣기</button> <button class="btn sun small" data-act="demo">가상 학생으로 보기</button></section>`;
  return `<section class="panel mint"><h2>내 학생부로 만든 질문 <span class="badge">${rq.length}</span></h2>${rq.map((x, i) => qItem('r' + hash(x.q), x.q, `${esc(x.tag)} · ${esc(x.why)}`)).join('')}</section>`;
}
IN.ivPick = el => {
  if (el.checked) S.iv.picks[el.dataset.id] = el.dataset.q; else delete S.iv.picks[el.dataset.id];
  const lab = el.closest('label'); lab.style.background = el.checked ? 'var(--vio-l)' : '#fff'; lab.style.borderColor = el.checked ? 'var(--vio)' : 'var(--line)';
  const n = $('#pickN'); if (n) n.textContent = Object.keys(S.iv.picks).length;
};
ACT.ivStart = () => {
  let q = Object.values(S.iv.picks);
  if (!q.length) q = $$('[data-in=ivPick]').slice(0, 5).map(i => i.dataset.q);
  if (!q.length) { toast('질문을 먼저 골라 주세요.'); return; }
  Object.assign(S.iv, { queue: q, i: 0, phase: 'think', answers: q.map(x => ({ q: x, a: '', checks: [false, false, false] })) });
  render(); startTimer();
};

/* 연습 진행 */
let TIMER = null, TLEFT = 0;
function stopTimer() { clearInterval(TIMER); TIMER = null; }
function startTimer() {
  stopTimer(); const ph = S.iv.phase;
  if (ph === 'think') TLEFT = S.iv.think; else if (ph === 'answer') TLEFT = 90; else return;
  drawRing();
  TIMER = setInterval(() => { TLEFT--; drawRing(); if (TLEFT <= 0) { stopTimer(); if (S.iv.phase === 'think') { S.iv.phase = 'answer'; render(); startTimer(); } else { const t = $('#ringT'); if (t) t.textContent = '끝'; } } }, 1000);
}
function drawRing() {
  const tot = S.iv.phase === 'think' ? S.iv.think : 90, c = 2 * Math.PI * 62, p = Math.max(0, TLEFT) / tot;
  const a = $('#ringA'), t = $('#ringT'); if (a) a.setAttribute('stroke-dashoffset', String(c * (1 - p))); if (t) t.textContent = Math.max(0, TLEFT) + '초';
}
function practiceHTML() {
  const I = S.iv, cur = I.answers[I.i], c = 2 * Math.PI * 62;
  if (I.phase === 'done') return doneHTML();
  const ring = `<svg class="ring" viewBox="0 0 150 150" role="timer" aria-label="남은 시간"><circle cx="75" cy="75" r="62" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="12"/>
    <circle id="ringA" cx="75" cy="75" r="62" fill="none" stroke="#FFC93C" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="0" transform="rotate(-90 75 75)"/><text id="ringT" x="75" y="86" text-anchor="middle">${I.phase === 'think' ? I.think : 90}초</text></svg>`;
  const prog = `<div class="progress" aria-hidden="true">${I.queue.map((_, i) => `<i class="${i <= I.i ? 'on' : ''}"></i>`).join('')}</div>`;
  let body = '';
  if (I.phase === 'think') body = `<span class="phase">① 생각하기</span><p class="qbig">${esc(cur.q)}</p>${ring}
    <div class="seg" style="max-width:420px;margin:8px auto" role="group" aria-label="생각 시간">${[15, 30, 60].map(s => `<button data-act="ivThink" data-v="${s}" aria-pressed="${I.think === s}">${s}초</button>`).join('')}</div>
    <div class="row" style="justify-content:center"><button class="btn sun" data-act="ivNextPhase">답하기 →</button></div>`;
  else if (I.phase === 'answer') body = `<span class="phase">② 답하기</span><p class="qbig">${esc(cur.q)}</p>
    <div class="seg" style="max-width:420px;margin:0 auto 10px" role="group" aria-label="답하는 방법"><button data-act="ivMode" data-v="write" aria-pressed="${I.mode === 'write'}">글로 쓰기</button><button data-act="ivMode" data-v="speak" aria-pressed="${I.mode === 'speak'}">말로 하기</button></div>
    ${ring}${I.mode === 'write' ? `<label class="tiny" for="ivA" style="color:#fff">내 답</label><textarea id="ivA" data-in="ivA" placeholder="결론부터, 내 경험으로.">${esc(cur.a)}</textarea>` : '<p>소리 내어 답해 보세요. 90초 안에!</p>'}
    <div class="row" style="justify-content:center;margin-top:10px"><button class="btn sun" data-act="ivNextPhase">셀프 체크 →</button></div>`;
  else body = `<span class="phase">③ 셀프 체크</span><p class="qbig" style="font-size:1.1rem">${esc(cur.q)}</p>
    <div class="checks">${['결론을 먼저 말했나요?', '내 경험이 근거로 들어갔나요?', '배운 점·달라진 점을 말했나요?'].map((t, k) => `<label><input type="checkbox" data-in="ivChk" data-k="${k}" ${cur.checks[k] ? 'checked' : ''}>${t}</label>`).join('')}</div>
    <div class="row" style="justify-content:center"><button class="btn white" data-act="ivRetry">다시 답하기</button><button class="btn sun" data-act="ivNextQ">${I.i + 1 < I.queue.length ? '다음 질문 →' : '마치기'}</button></div>`;
  return `<section class="practice">${prog}${body}</section><div class="row end" style="margin-top:12px"><button class="btn white" data-act="ivQuit">그만하기</button></div>`;
}
function doneHTML() {
  const A = S.iv.answers;
  return `<section class="panel vio"><h2>연습 끝! 수고했어요</h2><p class="one">AI 피드백은 선택이에요. 답을 쓴 질문만 프롬프트를 복사할 수 있어요.</p>
    ${A.map((x, i) => `<div class="qcard"><p class="q">${i + 1}. ${esc(x.q)}</p>${x.a ? `<p style="white-space:pre-wrap">${esc(x.a)}</p>` : '<p class="muted">(말로 연습)</p>'}
    <div class="subs">${['결론 먼저', '내 경험 근거', '배운 점'].map((t, k) => `<span class="sub ${x.checks[k] ? 'ok' : 'no'}">${t}</span>`).join('')}</div>
    <button class="btn small vio" data-act="ivPrompt" data-i="${i}" ${x.a.trim().length >= 20 ? '' : 'disabled'}>AI 피드백 프롬프트 복사</button></div>`).join('')}
    <p class="tiny">프롬프트에는 이름·학교 같은 정보가 가려진 내 답만 들어가요. 붙여 넣기 전에 한 번 더 확인하세요.</p>
    <div class="row"><button class="btn vio" data-act="ivAgain">같은 질문 다시</button><button class="btn white" data-act="ivQuit">질문 목록으로</button></div></section>`;
}
ACT.ivThink = el => { S.iv.think = +el.dataset.v; startTimer(); $$('[data-act=ivThink]').forEach(b => b.setAttribute('aria-pressed', b === el)); };
ACT.ivMode = el => { saveAns(); S.iv.mode = el.dataset.v; const keep = TLEFT; render(); TLEFT = keep; drawRing(); };
function saveAns() { const t = $('#ivA'); if (t) S.iv.answers[S.iv.i].a = t.value; }
IN.ivA = el => { S.iv.answers[S.iv.i].a = el.value; };
IN.ivChk = el => { S.iv.answers[S.iv.i].checks[+el.dataset.k] = el.checked; };
ACT.ivNextPhase = () => { saveAns(); S.iv.phase = S.iv.phase === 'think' ? 'answer' : 'check'; render(); startTimer(); if (S.iv.phase === 'answer') setTimeout(() => { const t = $('#ivA'); t && t.focus(); }, 0); };
ACT.ivRetry = () => { S.iv.phase = 'answer'; render(); startTimer(); };
ACT.ivNextQ = () => { stopTimer(); if (S.iv.i + 1 < S.iv.queue.length) { S.iv.i++; S.iv.phase = 'think'; render(); startTimer(); } else { S.iv.phase = 'done'; render(); } };
ACT.ivQuit = () => { stopTimer(); S.iv.phase = ''; render(); };
ACT.ivAgain = () => { S.iv.i = 0; S.iv.phase = 'think'; S.iv.answers.forEach(a => (a.checks = [false, false, false])); render(); startTimer(); };
ACT.ivPrompt = el => {
  const x = S.iv.answers[+el.dataset.i]; if (!x || x.a.trim().length < 20) return;
  const ans = maskText(x.a, S.rec.extra).text;
  copyText(`고등학생의 대입 면접 연습 답변이에요. 모범답안이나 고친 답을 써 주지 마세요.
아래 세 가지만 짧게 봐 주세요.
1) 결론을 먼저 말했는지
2) 자기 경험이 근거로 들어갔는지
3) 배운 점이나 달라진 점이 드러나는지
잘한 점 1개, 스스로 고쳐 볼 점 2개를 '질문' 형태로 알려 주세요.

[면접 질문] ${x.q}
[내 답변] ${ans}`);
};

/* ---- 06-teacher-save.js ---- */
/* ===== 선생님용 · 암호 저장 · 인쇄 · 지우기 ===== */
const CASE_COLS = ['대학', '학과', '전형', '학년도', '교육과정', '성적체계', '성적', '결과', '비식별메모'];
function viewTeacher() {
  const T = S.teacher, cv = T.conv;
  return vhead('navy', '선생님용 도구', '학교 사례 보관함 · 9→5 참고 환산') + `<section class="panel sun"><h2>9등급 → 5등급 참고 환산</h2>
    <p class="one">분포 겹침으로 낸 참고값이에요. 공식 환산이 아니에요.</p>
    <div class="seg" role="group" aria-label="환산 방식">${[['mean', '9등급 평균'], ['single', '한 과목 등급'], ['pct', '석차 누적비율(%)']].map(([k, l]) => `<button data-act="cvMode" data-v="${k}" aria-pressed="${cv.mode === k}">${l}</button>`).join('')}</div>
    <label class="f" for="cvV">값</label><input id="cvV" type="number" step="0.01" value="${esc(cv.v)}" data-in="cvV">
    <div id="cvOut" class="stats">${convOut()}</div></section>
    <section class="panel navy"><h2>학교 사례 보관함 <span class="badge">${T.cases.length}건</span></h2>
    <p class="one">실제 합불 사례는 공통 자료와 섞지 않고 이 화면에만 둬요.</p>
    <div class="grid2">${CASE_COLS.map(c => `<div><label class="f" for="cs_${c}">${c}</label>${c === '성적체계' ? `<select id="cs_${c}"><option>9등급제</option><option>5등급제</option><option>미확인</option></select>` : c === '결과' ? `<select id="cs_${c}"><option>결과 미확인</option><option>최초합격</option><option>충원합격</option><option>불합격</option></select>` : `<input id="cs_${c}" type="text" maxlength="${c === '비식별메모' ? 200 : 40}">`}</div>`).join('')}</div>
    <p class="tiny">이름·학번 등 사람을 알아볼 수 있는 정보는 넣지 마세요. 적은 인원 학과는 재식별 위험이 있어요.</p>
    <div class="row"><button class="btn" data-act="caseAdd">사례 추가</button>
      <label class="btn white" style="position:relative">CSV 가져오기<input type="file" accept=".csv,text/csv" data-in="caseCSV" style="position:absolute;opacity:0;inset:0;width:100%;cursor:pointer" aria-label="사례 CSV 가져오기"></label>
      <button class="btn white" data-act="saveDlg" data-scope="teacher">🔒 암호 파일로 저장/열기</button></div>
    <p class="tiny">CSV는 이 열만 읽어요: ${CASE_COLS.join(', ')}</p>
    <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr>${CASE_COLS.map(c => `<th>${c}</th>`).join('')}<th>5등급 눈금</th><th></th></tr></thead><tbody>
    ${T.cases.map((c, i) => `<tr>${CASE_COLS.map(k => `<td>${esc(c[k])}</td>`).join('')}<td>${/9/.test(c.성적체계) && gradeMean9(c.성적) != null ? '≈' + fmt(gradeMean9(c.성적)) : '-'}</td><td><button class="btn small danger" data-act="caseDel" data-i="${i}">✕</button></td></tr>`).join('') || `<tr><td colspan="${CASE_COLS.length + 2}" class="muted">아직 사례가 없어요.</td></tr>`}
    </tbody></table></div></section>`;
}
function convOut() {
  const { mode, v } = S.teacher.conv, x = Number(v);
  if (v === '' || !isFinite(x)) return '<p class="muted">값을 넣어 주세요.</p>';
  if (mode === 'mean') { const r = gradeMean9(x); return r == null ? '<p class="warn">1~9 사이로 넣어 주세요.</p>' : `<div class="stat apri"><span>5등급 눈금 참고</span><b>약 ${fmt(r)}</b><span class="tiny">평균만으로 낸 값 · 실제 5등급 성적 아님</span></div>`; }
  if (mode === 'single') { const r = gradeBand9(x); return !r ? '<p class="warn">1~9 정수로 넣어 주세요.</p>' : `<div class="stat apri"><span>누적 ${r.lo}~${r.hi}% 구간</span><b>${r.overlaps.join(' 또는 ')}등급</b><span class="tiny">5등급제 구간</span></div>`; }
  const r = percentileFive(x); return r == null ? '<p class="warn">0~100 사이로 넣어 주세요.</p>' : `<div class="stat apri"><span>누적 ${x}%</span><b>${r}등급</b><span class="tiny">5등급제 명목 구간</span></div>`;
}
ACT.cvMode = el => { S.teacher.conv.mode = el.dataset.v; render(); };
IN.cvV = el => { S.teacher.conv.v = el.value; $('#cvOut').innerHTML = convOut(); };
ACT.caseAdd = () => {
  const c = {}; CASE_COLS.forEach(k => (c[k] = ($('#cs_' + k) || {}).value?.trim() || ''));
  if (!c.대학 || !c.학과 || !c.전형) { toast('대학·학과·전형은 꼭 넣어 주세요.'); return; }
  if (S.teacher.cases.length >= 1000) { toast('1,000건까지 보관해요.'); return; }
  S.teacher.cases.push(c); render(); toast('사례를 추가했어요.');
};
ACT.caseDel = el => { S.teacher.cases.splice(+el.dataset.i, 1); render(); };
IN.caseCSV = async el => {
  const f = el.files && el.files[0]; if (!f) return; el.value = '';
  try {
    if (f.size > 512 * 1024) throw new Error('512KB 이하 CSV만 돼요.');
    const R = parseCSV(new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer()));
    const h = R[0] || []; const dep = h.includes('학과') ? '학과' : h.includes('모집단위') ? '모집단위' : '';
    if (!dep || !h.includes('대학') || !h.includes('전형')) throw new Error('대학·학과(모집단위)·전형 열이 필요해요.');
    const rows = R.slice(1).map(r => { const c = {}; CASE_COLS.forEach(k => { const i = h.indexOf(k === '학과' ? dep : k); c[k] = i < 0 ? '' : String(r[i] || '').slice(0, k === '비식별메모' ? 200 : 40); }); return c; }).filter(c => c.대학 && c.학과);
    if (rows.length + S.teacher.cases.length > 1000) throw new Error('합쳐서 1,000건까지예요.');
    S.teacher.cases.push(...rows); render();
    const skipped = h.filter(k => !CASE_COLS.includes(k) && k !== dep);
    toast(rows.length + '건 가져왔어요.' + (skipped.length ? ' 안 읽은 열: ' + skipped.join(',') : ''));
  } catch (e) { toast(e instanceof TypeError ? 'UTF-8 CSV로 저장해 주세요.' : e.message); }
};

/* --- 암호 파일 (PBKDF2-SHA256 250,000 + AES-GCM 256) --- */
const AAD = new TextEncoder().encode('JINHAK-NACHIMBAN|v1|PBKDF2-SHA256-250000|AES-GCM-256');
const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); };
const unb64 = t => { const s = atob(t); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
async function deriveKey(pw, salt) {
  const m = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, m, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function snapshot(scope) {
  if (scope === 'teacher') return { kind: 'teacher', cases: S.teacher.cases };
  const R = S.rec; // 원문(raw)은 넣지 않는다. 가린 글만.
  return { kind: 'student', profile: S.profile, cands: S.cands, rec: { masked: R.masked, hits: R.hits, extra: R.extra, demo: R.demo, grades: R.grades, system: R.system, fit: R.fit, analyzed: R.analyzed }, check: S.check, iv: { answers: S.iv.answers } };
}
ACT.saveDlg = el => {
  const scope = (el && el.dataset.scope) || 'student';
  const ok = !!(window.crypto && crypto.subtle);
  openDialog('암호 파일로 저장 · 열기', `
    <div class="warn">공용 컴퓨터라면 저장하지 마세요. 내려받은 파일은 직접 지워야 해요.</div>
    ${ok ? '' : '<p class="warn">이 브라우저는 암호화를 지원하지 않아요. 저장할 수 없어요.</p>'}
    <p class="one">${scope === 'teacher' ? '학교 사례를' : '가린 학생부·성적표·내 답을'} 암호를 걸어 파일로 내려받아요. 원문은 넣지 않아요.</p>
    <label class="f" for="pw1">암호 (8자 이상)</label><input id="pw1" type="password" autocomplete="new-password">
    <label class="f" for="pw2">한 번 더</label><input id="pw2" type="password" autocomplete="new-password">
    <div class="row" style="margin-top:10px"><button class="btn mint" data-act="encSave" data-scope="${scope}" ${ok ? '' : 'disabled'}>암호 파일 내려받기</button></div>
    <hr style="border:0;border-top:2px dashed var(--line);margin:16px 0">
    <label class="f" for="encFile">저장한 파일 열기</label><input id="encFile" type="file" accept=".json,application/json">
    <label class="f" for="pw3">암호</label><input id="pw3" type="password" autocomplete="current-password">
    <div class="row" style="margin-top:10px"><button class="btn" data-act="encOpen" data-scope="${scope}" ${ok ? '' : 'disabled'}>열기</button></div>
    <p id="encMsg" class="tiny" role="alert"></p>`);
};
ACT.encSave = async el => {
  const p1 = $('#pw1').value, p2 = $('#pw2').value, msg = $('#encMsg');
  if (p1.length < 8) { msg.textContent = '암호는 8자 이상이에요.'; return; }
  if (p1 !== p2) { msg.textContent = '두 암호가 달라요.'; return; }
  el.disabled = true; msg.textContent = '암호를 거는 중…';
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(p1, salt);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, new TextEncoder().encode(JSON.stringify(snapshot(el.dataset.scope)))));
    const env = { format: 'JINHAK-NACHIMBAN-ENC', version: 1, kdf: 'PBKDF2', hash: 'SHA-256', iterations: 250000, cipher: 'AES-GCM', salt: b64(salt), iv: b64(iv), data: b64(ct), createdAt: new Date().toISOString() };
    download('진학나침반-' + (el.dataset.scope === 'teacher' ? '사례' : '내기록') + '-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(env));
    $('#pw1').value = $('#pw2').value = ''; msg.textContent = '내려받았어요. 암호를 잊으면 열 수 없어요.';
  } catch { msg.textContent = '저장하지 못했어요.'; } finally { el.disabled = false; }
};
ACT.encOpen = async el => {
  const f = $('#encFile').files[0], pw = $('#pw3').value, msg = $('#encMsg');
  if (!f || !pw) { msg.textContent = '파일과 암호를 넣어 주세요.'; return; }
  el.disabled = true; msg.textContent = '여는 중…';
  try {
    if (f.size > 40 * 1024 * 1024) throw new Error('파일이 너무 커요.');
    const env = JSON.parse(await f.text());
    if (env.format !== 'JINHAK-NACHIMBAN-ENC' || env.iterations !== 250000) throw new Error('진학 나침반 암호 파일이 아니에요.');
    const key = await deriveKey(pw, unb64(env.salt));
    let plain; try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv), additionalData: AAD }, key, unb64(env.data)); } catch { throw new Error('암호가 틀렸거나 파일이 망가졌어요.'); }
    const o = JSON.parse(new TextDecoder().decode(plain));
    if (o.kind === 'teacher') { if (!Array.isArray(o.cases)) throw new Error('형식이 달라요.'); S.teacher.cases = o.cases.slice(0, 1000).map(c => { const x = {}; CASE_COLS.forEach(k => (x[k] = String(c[k] ?? '').slice(0, 200))); return x; }); }
    else if (o.kind === 'student' && o.rec) {
      const R = newRec(); R.masked = String(o.rec.masked || ''); R.raw = R.masked; R.hits = o.rec.hits || {}; R.extra = String(o.rec.extra || ''); R.demo = !!o.rec.demo; R.confirmed = true;
      if (R.masked) { origReset(); S.rec = R; analyzeRecord(); }
      S.rec.grades = Array.isArray(o.rec.grades) ? o.rec.grades.slice(0, 400) : S.rec.grades; if (o.rec.system) S.rec.system = o.rec.system; S.rec.fit = o.rec.fit || S.rec.fit;
      S.rec.step = S.rec.analyzed ? 3 : 1;
      if (o.check) S.check = Object.assign({ univ: '', answers: {}, shown: {} }, o.check);
      if (Array.isArray(o.cands)) { S.cands = o.cands.slice(0, 6); saveCands(); }
      if (o.iv && Array.isArray(o.iv.answers)) S.iv.answers = o.iv.answers;
    } else throw new Error('형식이 달라요.');
    $('#dlg').close(); render(); toast('열었어요. 지금은 메모리에만 있어요.');
  } catch (e) { msg.textContent = e.message || '열지 못했어요.'; } finally { el.disabled = false; }
};

/* --- 상담 요약 1장 (인쇄) --- */
ACT.printSum = async () => {
  await need(['모집2028', '최저2028', '면접기준']);
  const R = S.rec, p = S.profile, sys = R.system || sysOf(p.curr), w = wavg(R.grades), b = sys === 9 ? band5(R.grades) : null, ev = R.evidence || {};
  const ckAns = Object.entries(S.check.answers).filter(([, v]) => v.trim());
  const P = $('#print');
  P.innerHTML = `<h1>진학 나침반 · 상담 요약 ${R.demo ? '(가상 학생 · 실제 사람 아님)' : ''}</h1>
    <p>${esc(p.grade)} · ${esc(currLabel(p.curr))} · 관심: ${esc(p.interest || '-')} ${p.rural ? '· 농어촌 해당 여부 확인 중' : ''} · ${new Date().toLocaleDateString('ko-KR')}</p>
    <h2>성적</h2><p>학점 가중 평균 (${sys}등급제): <b>${w ? fmt(w.avg) : '-'}</b> ${w ? `(${w.credits}학점)` : ''} ${b ? ` · 5등급 눈금 참고 ${fmt(b.lo)}~${fmt(b.hi)} (공식 환산 아님)` : ''}</p>
    <h2>기록 근거 (항목별 대표 문장)</h2><table><tbody>${Object.entries(COMP_ITEMS).map(([c, list]) => list.map(k => `<tr><td style="width:28%"><b>${esc(c)}</b><br>${esc(k)}</td><td>${(ev[k] || [])[0] ? esc((ev[k][0].sent || '').slice(0, 120)) : '<i>찾은 문장 없음</i>'}</td></tr>`).join('')).join('')}</tbody></table>
    <h2>내 지원 후보</h2>${S.cands.length ? `<table><thead><tr><th>대학</th><th>모집단위</th><th>전형 (2028 잠정)</th><th>인원</th><th>수능최저</th></tr></thead><tbody>${S.cands.map(c => { const ms = minFor(c.univ, { 유형: c.유형, 전형: c.전형, 모집단위: c.unit, 모집단위키: c.key }); return `<tr><td>${esc(c.univ)}</td><td>${esc(c.unit)}</td><td>${esc(c.유형)} · ${esc(c.전형)}</td><td>${esc(c.인원)}</td><td>${ms ? esc(ms.map(m => m.기준 || m.안내).join(' / ')) : '모집요강 확인'}</td></tr>`; }).join('')}</tbody></table>` : '<p>아직 없음</p>'}
    <h2>스스로 점검 (내가 쓴 답)</h2>${ckAns.length ? ckAns.slice(0, 6).map(([id, v]) => `<p><b>${esc(id.split('|')[1])}</b>: ${esc(v.slice(0, 200))}</p>`).join('') : '<p>아직 없음</p>'}
    <h2>면접 연습한 질문</h2>${S.iv.answers.length ? `<ol>${S.iv.answers.map(a => `<li>${esc(a.q)}</li>`).join('')}</ol>` : '<p>아직 없음</p>'}
    <h2>선생님께 묻고 싶은 것</h2><div class="box"></div>
    <p style="font-size:8.5pt;margin-top:8px">입결·전형은 참고 자료예요. 2028 자료는 시행계획 기준(잠정). 합격 예측이 아니에요. 이 종이에는 이름을 적지 않았어요.</p>`;
  window.print();
};

/* --- 다 지우기 --- */
ACT.wipe = () => {
  if (!confirm('이 화면의 학생부·성적·답을 모두 지울까요? (내 정보 설정과 후보는 남아요)')) return;
  stopTimer(); origReset(); S.rec = newRec(); S.check = { univ: '', answers: {}, shown: {} }; S.iv = Object.assign(S.iv, { queue: [], i: 0, phase: '', answers: [], picks: {} });
  S.teacher.cases = []; $('#print').innerHTML = ''; render(); toast('지웠어요.');
};

/* ---- 07-orig.js ---- */
/* ---------- 원본 대조 ----------
   근거 문장을 학생부 PDF 원본 그 쪽에서 형광펜으로 보여 준다.
   PDF는 이 탭 메모리에만 있고(저장·전송 없음), 화면에서는 개인정보 칸을 기본으로 가린다. */
let ORIG = null;
const onlyCh = s => String(s || '').replace(/[\s\u00a0]/g, '');
function origReset() {
  if (ORIG && ORIG.doc) { try { ORIG.doc.destroy(); } catch (e) { /* 무시 */ } }
  ORIG = null;
}
function origKeep(doc, pagesItems, name) {
  origReset();
  ORIG = {
    doc, name,
    pages: pagesItems.map(items => {
      let norm = ''; const map = [], pos = [];
      items.forEach((it, i) => { const str = String(it.str || ''); for (let k = 0; k < str.length; k++) { if (/[\s\u00a0]/.test(str[k])) continue; norm += str[k]; map.push(i); pos.push(k); } });
      return { items, norm, map, pos };
    }),
    view: { page: 1, zoom: 1, mask: true, hit: null }
  };
}
/* 문장 → PDF 쪽·글자 조각 찾기. [이름] 같은 가림 표시는 원본에 없으니 그 앞뒤 조각으로 찾는다 */
function origFind(sent) {
  if (!ORIG) return null;
  const segs = String(sent || '').split(/\[[^\]]{1,8}\]/).map(onlyCh).filter(s => s.length >= 6).sort((a, b) => b.length - a.length);
  const tries = [];
  segs.forEach(s => { tries.push(s); if (s.length > 24) { tries.push(s.slice(0, 18)); tries.push(s.slice(-18)); } });
  for (const key of tries) {
    for (let p = 0; p < ORIG.pages.length; p++) {
      const P = ORIG.pages[p]; const at = P.norm.indexOf(key);
      if (at < 0) continue;
      // 찾은 조각에서 문장 전체 길이만큼 넓힌다(앞 조각이면 뒤로, 뒤 조각이면 앞으로)
      const full = onlyCh(sent).replace(/\[[^\]]{1,8}\]/g, '');
      let from = at, to = at + key.length;
      const head = full.indexOf(key);
      if (head >= 0) { from = Math.max(0, at - head); to = Math.min(P.norm.length, from + full.length); }
      // 글자 조각별로 시작·끝 글자 위치를 모아 문장 부분만 칠한다
      const span = new Map();
      for (let k = from; k < to; k++) { const i = P.map[k], c = P.pos[k]; const s = span.get(i); if (!s) span.set(i, [c, c + 1]); else { s[0] = Math.min(s[0], c); s[1] = Math.max(s[1], c + 1); } }
      return { page: p + 1, items: [...span.keys()], span };
    }
  }
  return null;
}
function origMaskTerms() {
  const raw = S.rec.raw || '';
  const names = typeof findNames === 'function' ? findNames(raw) : [];
  const extras = String(S.rec.extra || '').split(/[,\n]/).map(s => s.trim()).filter(s => s.length >= 2);
  const out = new Set();
  [...names, ...extras].forEach(n => { out.add(n); if (n.length >= 3) out.add(n.slice(1)); });
  return [...out].filter(t => t.length >= 2);
}
async function origDraw() {
  if (!ORIG) return;
  const v = ORIG.view, cv = $('#origCv'), box = $('#origWrap'); if (!cv || !box) return;
  const pg = await ORIG.doc.getPage(v.page);
  const base = pg.getViewport({ scale: 1 });
  const fitW = Math.max(280, (box.clientWidth || 720) - 28);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = pg.getViewport({ scale: (fitW / base.width) * v.zoom * dpr });
  cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
  cv.style.width = Math.floor(vp.width / dpr) + 'px'; box.style.overflowX = v.zoom > 1 ? 'auto' : 'hidden';
  const ctx = cv.getContext('2d');
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  const P = ORIG.pages[v.page - 1];
  const U = PDFJS.m.Util;
  const rectOf = it => { const tr = U.transform(vp.transform, it.transform); const fh = Math.hypot(tr[2], tr[3]) || 10 * vp.scale; return [tr[4], tr[5] - fh, (it.width || 0) * vp.scale, fh * 1.18]; };
  if (v.mask) {
    const terms = origMaskTerms();
    ctx.fillStyle = '#172C49';
    P.items.forEach(it => {
      const s = it.str || ''; if (!s.trim()) return;
      const hit = maskText(s, S.rec.extra).text !== s || terms.some(t => s.includes(t));
      if (hit) { const [x, y, w, h] = rectOf(it); ctx.fillRect(x - 2, y - 2, w + 4, h + 4); }
    });
  }
  let firstY = null;
  if (v.hit && v.hit.page === v.page) {
    ctx.fillStyle = 'rgba(255, 200, 0, .42)';
    const rs = [];
    v.hit.items.forEach(i => {
      const it = P.items[i]; if (!it) return; const [x, y, w, h] = rectOf(it);
      const len = String(it.str || '').length || 1; const sp = v.hit.span && v.hit.span.get(i) || [0, len];
      rs.push([x + w * (sp[0] / len), y, x + w * (sp[1] / len), h]);
    });
    // 같은 줄의 단어 조각은 사이 공백까지 이어 칠한다
    rs.sort((a, b) => (Math.abs(a[1] - b[1]) < 3 ? a[0] - b[0] : a[1] - b[1]));
    const merged = [];
    rs.forEach(r => { const m = merged[merged.length - 1]; if (m && Math.abs(m[1] - r[1]) < 3 && r[0] - m[2] < r[3] * 1.6) { m[2] = Math.max(m[2], r[2]); m[3] = Math.max(m[3], r[3]); } else merged.push(r.slice()); });
    merged.forEach(([x0, y, x1, h]) => { ctx.fillRect(x0 - 1, y, (x1 - x0) + 2, h); if (firstY === null || y < firstY) firstY = y; });
  }
  const pgl = $('#origPg'); if (pgl) pgl.textContent = v.page + ' / ' + ORIG.doc.numPages + '쪽';
  const mb = $('#origMaskBtn'); if (mb) { mb.setAttribute('aria-pressed', String(v.mask)); mb.textContent = v.mask ? '개인정보 가림 켜짐' : '개인정보 가림 꺼짐'; }
  if (firstY !== null) box.scrollTop = Math.max(0, firstY / dpr - 80);
}
function origTextView(sent) {
  const t = S.rec.masked || '';
  const key = String(sent || '');
  let at = t.indexOf(key);
  if (at < 0) { const k2 = key.slice(0, 20); at = k2 ? t.indexOf(k2) : -1; }
  if (at < 0) return `<p class="muted">원문에서 이 문장 위치를 못 찾았어요.</p>`;
  const a = Math.max(0, at - 500), b = Math.min(t.length, at + key.length + 500);
  return `<div class="origtext">${a > 0 ? '…' : ''}${markMasked(t.slice(a, at))}<mark class="orighl" id="origHl">${markMasked(t.slice(at, at + key.length))}</mark>${markMasked(t.slice(at + key.length, b))}${b < t.length ? '…' : ''}</div>`;
}
ACT.origShow = async el => {
  const sent = el.dataset.s || '';
  if (ORIG) {
    const hit = sent ? origFind(sent) : null;
    ORIG.view.hit = hit; ORIG.view.page = hit ? hit.page : (ORIG.view.page || 1); ORIG.view.zoom = 1;
    openDialog('원본에서 보기', `
      <div class="origbar">
        <button class="btn small white" data-act="origPage" data-d="-1" aria-label="이전 쪽">‹</button>
        <b id="origPg">…</b>
        <button class="btn small white" data-act="origPage" data-d="1" aria-label="다음 쪽">›</button>
        <span class="spacer"></span>
        <button class="btn small white" data-act="origZoom" data-d="-1" aria-label="작게">－</button>
        <button class="btn small white" data-act="origZoom" data-d="1" aria-label="크게">＋</button>
        <button class="btn small" id="origMaskBtn" data-act="origMask" aria-pressed="true">개인정보 가림 켜짐</button>
      </div>
      <p class="tiny">${sent ? (hit ? `<b>${hit.page}쪽</b> 노란 칸이 이 문장이에요.` : '원본에서 정확한 위치를 못 찾았어요. 쪽을 넘겨 확인해 주세요.') : esc(ORIG.name || '')} · 이 화면 밖으로 나가지 않아요.</p>
      <div class="origwrap" id="origWrap"><canvas id="origCv" aria-label="학생부 원본 쪽"></canvas></div>
      ${sent ? `<div class="ev" style="margin-top:10px">${esc(sent)}</div>` : ''}`);
    $('#dlg').classList.add('wide');
    try { await origDraw(); } catch (e) { const w = $('#origWrap'); if (w) w.innerHTML = '<p class="muted" style="padding:12px">원본을 그리지 못했어요. ' + esc(e.message || String(e)) + '</p>'; }
  } else {
    openDialog('원문에서 보기', `<p class="tiny">붙여넣은 글에서 찾은 위치예요. PDF로 올리면 원본 쪽에서 바로 보여 줘요.</p>${origTextView(sent)}`);
    $('#dlg').classList.add('wide');
    const h = $('#origHl'); if (h) h.scrollIntoView({ block: 'center' });
  }
};
ACT.origPage = async el => { if (!ORIG) return; const n = ORIG.doc.numPages; ORIG.view.page = Math.min(n, Math.max(1, ORIG.view.page + (+el.dataset.d))); await origDraw(); };
ACT.origZoom = async el => { if (!ORIG) return; ORIG.view.zoom = Math.min(2.5, Math.max(0.6, ORIG.view.zoom + (+el.dataset.d) * 0.25)); await origDraw(); };
ACT.origMask = async () => { if (!ORIG) return; ORIG.view.mask = !ORIG.view.mask; await origDraw(); };

/* ---- 09-main.js ---- */
/* ===== 화면 전환 · 이벤트 · 가상 학생 ===== */
let VIEW = 'home';
const VIEWS = {
  home: [viewHome], record: [viewRecord, () => { if (S.rec.step === 3) { if (S.rec.tab === 'check') fillCheck(); if (S.rec.tab === 'fit') fillFit(); } }],
  major: [viewMajor, fillMajor], compare: [viewCompare, fillCompare], rural: [viewRural, fillRural],
  interview: [viewInterview, fillInterview], teacher: [viewTeacher]
};
function render() {
  const v = VIEWS[VIEW] || VIEWS.home;
  renderTop();
  $('#main').innerHTML = v[0]();
  renderCandbar();
  if (v[1]) Promise.resolve(v[1]()).catch(e => { console.error(e); toast('자료를 여는 중 문제가 생겼어요.'); });
}
function go(to) {
  if (to !== 'interview' || !S.iv.phase) stopTimer();
  if (to === 'major' && VIEW === 'major' && location.hash === '#major') { render(); window.scrollTo(0, 0); return; }
  if (location.hash !== '#' + to) location.hash = to; else { VIEW = to; render(); }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1) || 'home';
  VIEW = VIEWS[h] ? h : 'home';
  if (VIEW !== 'interview') { stopTimer(); }
  render(); $('#main').focus({ preventScroll: true });
});
ACT.go = el => {
  const to = el.dataset.to;
  // 학과 화면 안에서의 '뒤로'
  if (to === 'major' && VIEW === 'major') { if (S.mj.view === 'univ') S.mj.view = 'dept'; else S.mj.view = 'search'; render(); window.scrollTo(0, 0); return; }
  if (to === 'interview' && VIEW === 'interview' && S.iv.phase) { stopTimer(); S.iv.phase = ''; render(); return; }
  if ($('#dlg').open) $('#dlg').close();
  go(to);
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const f = ACT[el.dataset.act]; if (!f) return;
  if (el.tagName === 'A') return;
  e.preventDefault(); f(el, e);
});
const onIn = e => { const el = e.target.closest('[data-in]'); if (!el) return; const f = IN[el.dataset.in]; if (!f) return;
  if (e.type === 'input' && (el.type === 'checkbox' || el.type === 'file' || el.tagName === 'SELECT')) return;
  if (e.type === 'change' && !(el.type === 'checkbox' || el.type === 'file' || el.tagName === 'SELECT' || el.type === 'number')) return;
  f(el, e); };
document.addEventListener('input', onIn);
document.addEventListener('change', onIn);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#dlg').open) $('#dlg').close(); });

/* 가상 학생 (실제 사람 아님) */
const DEMO = `[가상 학생부 · 실제 사람 아님]
학교생활기록부
성명 : 한가온
주민등록번호 : 080315-4000000
주소 : 경상남도 가상군 가상면 연습로 1
가상고등학교 2학년 3반 7번 한가온
연락처 010-0000-0000

7. 교과학습발달상황
[1학년]
학기 교과 과목 학점수 원점수/과목평균(표준편차) 성취도(수강자수) 석차등급
1 국어 국어 4 88/71.2(13.4) A(96) 2
1 수학 수학 4 79/62.5(18.1) B(96) 3
1 영어 영어 4 92/70.3(15.2) A(96) 2
1 사회(역사/도덕포함) 통합사회 3 85/72.0(12.8) B(96) 3
1 과학 통합과학 3 90/68.4(14.9) A(96) 2
1 한국사 한국사 3 81/70.1(13.0) B(96) 4
2 국어 국어 4 84/70.5(12.9) B(96) 3
2 수학 수학 4 83/64.0(17.5) B(96) 3
2 영어 영어 4 90/71.1(14.0) A(96) 2
2 사회(역사/도덕포함) 통합사회 3 88/71.4(12.1) A(96) 2
2 과학 통합과학 3 93/69.0(15.3) A(96) 1
2 과학 과학탐구실험 1 95/90.2(5.1) A(96)
[2학년]
1 국어 문학 3 86/70.2(13.1) A(88) 3
1 수학 수학Ⅰ 4 80/61.8(18.9) B(88) 3
1 영어 영어Ⅰ 3 91/69.5(15.0) A(88) 2
1 과학 생명과학Ⅰ 3 94/67.2(16.1) A(52) 1
1 과학 화학Ⅰ 3 82/63.0(17.2) B(40) 4
1 사회(역사/도덕포함) 생활과 윤리 2 87/72.3(11.0) A(60) 2
2 국어 독서 3 85/69.9(12.7) B(88) 3
2 수학 수학Ⅱ 4 78/60.2(19.3) C(88) 4
2 영어 영어Ⅱ 3 89/68.8(14.6) A(88) 2
2 과학 생명과학Ⅰ 3 95/68.0(15.5) A(52) 1
2 수학 확률과 통계 2 84/66.1(16.0) B(70) 3

8. 과목 세부능력 및 특기사항
[1학년]
통합과학: 생태계 단원에서 '하천 수질과 생물 다양성'을 주제로 모둠 탐구를 설계함. 학교 앞 개울에서 시료를 채취해 용존산소를 측정하고 결과를 그래프로 분석하여 보고서로 정리함. 측정 오차의 원인을 스스로 찾아 다시 실험하는 끈기를 보임.
국어: 독서 토론 수업에서 '아픔이 길이 되려면'을 읽고 지역 의료 격차에 대한 자신의 생각을 근거를 들어 발표함. 친구들의 반론을 경청하고 의견을 조율하여 모둠 결론을 이끌어 냄.
[2학년]
생명과학Ⅰ: 면역 단원 학습 후 백신의 원리에 대해 더 알아보고자 관련 논문을 찾아 읽고 항체 형성 과정을 모형으로 설명함. 농촌 고령층의 예방접종률 자료를 조사하여 접근성 문제를 분석하고 개선 방안을 제안함. 성취도가 우수하며 질문이 깊음.
영어Ⅰ: 'Health care in rural areas'를 주제로 영어 기사를 요약하고 발표함. 어려운 용어를 친구들에게 쉽게 설명해 주는 모습이 돋보임.
화학Ⅰ: 산과 염기 실험에서 지시약을 직접 만들어 중화 반응을 관찰하고, 실험 과정을 보고서로 꼼꼼하게 정리함.

창의적 체험활동상황
[1학년]
자율활동
학급 부회장으로서 학급 회의를 기획하고 친구들의 의견을 모아 교실 환경 개선 활동을 주도하여 이끎. 맡은 바 역할을 끝까지 책임감 있게 수행함.

동아리활동
(생명과학탐구반) 동아리원과 함께 지역 하천 생물 조사 프로젝트에 참여하여 조사 결과를 발표함. 실험 기구 관리를 맡아 성실하게 활동함.

진로활동
간호사 직업 특강에 참여한 후 지역 보건소를 탐방하고 농어촌 간호 인력 부족 문제에 관심을 가지게 됨. 진로 희망을 구체화하는 보고서를 작성함.
[2학년]
동아리활동
(생명과학탐구반) 동아리장으로서 '혈압과 생활습관'을 주제로 설문 조사를 기획하고 자료를 분석하여 교내 보건 캠페인을 진행함. 후배들에게 실험 방법을 가르쳐 주며 협력하는 분위기를 만듦.

진로활동
대학 연계 간호학 체험 프로그램에 참여하여 활력징후 측정을 실습함. 이를 계기로 지역사회 간호에 대한 탐구를 이어가며 관련 도서를 찾아 읽음.

행동특성 및 종합의견
[1학년]
성실하고 책임감이 강하며 어려움을 겪는 친구에게 먼저 다가가 도움을 주는 따뜻한 학생임. 꾸준히 예습과 복습을 하는 습관이 있음.
[2학년]
배려심이 깊고 모둠 활동에서 친구들과 소통하며 협업을 이끄는 학생임. 스스로 계획을 세워 학습하며 성적이 꾸준히 향상됨.`;
ACT.demo = () => {
  origReset(); const R = newRec(); R.raw = DEMO; R.demo = true; const m = maskText(DEMO, ''); R.masked = m.text; R.hits = m.hits; R.step = 2;
  S.rec = R; go('record'); if (VIEW === 'record') render();
  toast('가상 학생이에요. 가려진 곳을 확인해 보세요.');
};

/* 시작 */
(function init() {
  if (!S.profile.set) { const p = S.profile; p.entry = entryFromGrade(p.grade); if (!p.currManual) p.curr = currFromEntry(p.entry); }
  renderFoot();
  const h = location.hash.slice(1); VIEW = VIEWS[h] ? h : 'home';
  if (VIEW === 'interview' && !S.iv.phase) { }
  render();
  if (!window.JN_DATA) toast('자료 파일(data.js)을 못 불러왔어요.');
})();
