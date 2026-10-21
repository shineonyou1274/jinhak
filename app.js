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
/* 화면에 보여 줄 대학 이름: 같은 대학 다른 표기(한양대(ERICA)/한양대에리카, 한국기술교대/한국기술교육대)는 하나로 */
const uniCanon = s => uniNorm(s).replace(/에리카$/, '(ERICA)').replace(/^한국기술교육대/, '한국기술교대');
const dispName = s => String(s || '').replace(/\s*_\s*/g, ' · ');
function uniOptions(names) {
  const m = new Map(); names.filter(Boolean).forEach(n => { const k = uniCanon(n); if (!m.has(k)) m.set(k, dispName(uniNorm(n).replace(/에리카$/, '(ERICA)').replace(/^한국기술교육대/, '한국기술교대'))); });
  return [...m.entries()].map(([k, label]) => ({ k, label })).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}
const pickOpt = (opts, v) => { const t = nsp(v); return opts.find(o => nsp(o.label) === t || o.k === uniCanon(v)) || null; };
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
/* 전형 고르기: 이름이 정확히 같은 행이 있으면 그것만. 없을 때만 비슷한 이름 하나(괄호 속 면접형·서류형은 지우지 않음) */
const tkLoose = s => nsp(s).replace(/[()（）\[\]]/g, '').replace(/전형|학생부|교과|종합|논술|정원내|정원외|[_\-·.]/g, '');
function pickTrack(list, field, name, loose = 'one') {
  const n = nsp(name);
  const ex = list.filter(m => nsp(m[field]) === n);
  if (ex.length) return { rows: ex, approx: '' };
  const x = loose === 'paren' ? tkNorm(name) : tkLoose(name); if (!x || x.length < 2) return { rows: [], approx: '' };
  const norm = loose === 'paren' ? tkNorm : tkLoose;
  const by = new Map();
  list.forEach(m => { const y = norm(m[field]); if (!y) return; const sc = x === y ? 0 : (y.length >= 2 && (y.includes(x) || x.includes(y))) ? 1 + Math.abs(y.length - x.length) : -1; if (sc < 0) return;
    const k = m[field]; if (!by.has(k)) by.set(k, { sc, rows: [] }); by.get(k).rows.push(m); });
  if (!by.size) return { rows: [], approx: '' };
  if (loose === 'all') return { rows: [...by.values()].flatMap(v => v.rows), approx: [...by.keys()].join(', ') };
  const [k, v] = [...by.entries()].sort((a, b) => a[1].sc - b[1].sc || a[0].length - b[0].length)[0];
  return { rows: v.rows, approx: k };
}
/* 모집단위 이름 맞추기: 낱말 단위로 비교해 다른 학과(건축학↔건축공학)를 섞지 않는다 */
const unitToks = s => String(s || '').replace(/<[^>]*>/g, ' ').split(/[\s,·‧ㆍ・\/()（）\[\]{}、:;~+&]+|및/).map(x => x.trim()).filter(x => x.length >= 2 && !/^\d/.test(x));
function tokKeys(t) {
  const k = deptKey(t), out = [k], s = nsp(t).replace(/\(.*?\)/g, '');
  if (/.{2,}학(부|과)$/.test(s)) out.push(s.slice(0, -1)); // 건축공학부 → 건축공학
  if (k.length >= 3 && /학$/.test(k) && !/대학$/.test(k)) out.push(k.slice(0, -1));
  if (/.{2,}대학$/.test(nsp(t))) out.push(nsp(t).replace(/대학$/, '')); // 간호대학 → 간호
  return out;
}
function unitKeys(name, key) {
  const o = new Set(); const full = deptKey(String(name || '').replace(/<[^>]*>/g, ''));
  if (full) o.add(full);
  if (key && !/[<>]/.test(key)) o.add(key);
  // 괄호 속 전공 이름(조형학부(건축학전공))도 키로 쓴다. '인문' 같은 계열 표시는 빼고
  unitToks(name).filter(t => /(학과|학부|전공|과|학)$/.test(t)).forEach(t => tokKeys(t).forEach(k => k.length >= 2 && o.add(k)));
  return o;
}
function unitMention(text, keys, unitName) {
  const un = nsp(String(unitName || '').replace(/\(.*?\)|<[^>]*>/g, ''));
  return unitToks(text).some(t => (un && nsp(t) === un) || tokKeys(t).some(k => keys.has(k)));
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
  let s = 0, w = 0, n = 0;
  rows.forEach(r => { const g = Number(r.등급), c = Number(r.학점); if (g >= 1 && g <= 9 && c > 0) { s += g * c; w += c; n++; } });
  return w ? { avg: s / w, credits: w, n } : null;
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

/* ---------- 로고: 별자리 나침반 ---------- */
let LOGO_N = 0;
function logoSVG(cls = 'logo') {
  const id = 'lg' + (++LOGO_N);
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true">
  <defs><radialGradient id="${id}b" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#2A2F8A"/><stop offset="1" stop-color="#0B0F33"/></radialGradient>
  <linearGradient id="${id}n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8FF6E6"/><stop offset="1" stop-color="#3EE6CF"/></linearGradient>
  <radialGradient id="${id}g"><stop offset="0" stop-color="#FFF6D6"/><stop offset=".45" stop-color="#FFD36E"/><stop offset="1" stop-color="#FFD36E" stop-opacity="0"/></radialGradient></defs>
  <circle cx="32" cy="32" r="30" fill="url(#${id}b)" stroke="rgba(255,255,255,.35)" stroke-width="1"/>
  <circle cx="32" cy="32" r="23" fill="none" stroke="rgba(143,246,230,.45)" stroke-width="1" stroke-dasharray="1.5 3"/>
  <g stroke="rgba(205,190,255,.75)" stroke-width=".9" fill="none"><path d="M32 7 L50 20 L57 32 L46 49 L32 57 L16 47 L7 32 L18 16 Z"/><path d="M18 16 L32 32 L46 49 M50 20 L32 32 L16 47"/></g>
  <g fill="#fff"><circle cx="50" cy="20" r="1.4"/><circle cx="46" cy="49" r="1.3"/><circle cx="16" cy="47" r="1.3"/><circle cx="18" cy="16" r="1.4"/></g>
  <g fill="#FFE3A1"><circle cx="32" cy="7" r="2.2"/><circle cx="57" cy="32" r="1.7"/><circle cx="32" cy="57" r="1.7"/><circle cx="7" cy="32" r="1.7"/></g>
  <path d="M32 12 L36.5 32 L32 30 L27.5 32 Z" fill="url(#${id}n)"/><path d="M32 52 L27.5 32 L32 34 L36.5 32 Z" fill="rgba(255,255,255,.75)"/>
  <circle cx="32" cy="32" r="7" fill="url(#${id}g)"/><circle cx="32" cy="32" r="2.3" fill="#FFF6D6"/></svg>`;
}
/* 선 아이콘 (stroke = currentColor) */
const IC = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  chart: '<path d="M3 20h18"/><path d="M6 16v-5"/><path d="M11 16V6"/><path d="M16 16v-8"/><path d="M20 16v-3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  book: '<path d="M3 5h6a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H3z"/><path d="M21 5h-6a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2.5H21z"/>',
  print: '<path d="M7 9V3h10v6"/><path d="M7 18H4v-8h16v8h-3"/><path d="M7 14h10v7H7z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h6"/>',
  upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/><path d="M22 9v5"/>',
  chat: '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 10h8M8 13h5"/>',
  star: '<path d="M12 3l1.8 5.6L19.5 10l-5.7 1.6L12 17l-1.8-5.4L4.5 10l5.7-1.4z"/><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  check: '<path d="M5 12l5 5 9-10"/>'
};
const ic = (n, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;
const ICON = {
  rec: ic('file', 'ic'),
  major: ic('cap', 'ic'),
  iv: ic('chat', 'ic')
};

/* ---------- 똑똑한 검색: 띄어쓰기 = AND, 초성(ㄱㅊㄷ), 약칭(연대·카이스트·의대·교대) ---------- */
const CHO_L = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
function choOf(s) { let o = ''; for (const ch of String(s || '')) { const c = ch.charCodeAt(0); o += c >= 0xAC00 && c <= 0xD7A3 ? CHO_L[Math.floor((c - 0xAC00) / 588)] : ch; } return o; }
const ALIAS = {
  연대: ['연세대'], 고대: ['고려대'], 성대: ['성균관대'], 성균대: ['성균관대'], 이대: ['이화여'], 숙대: ['숙명여'], 외대: ['한국외국어', '한국외대'], 중대: ['중앙대'], 건대: ['건국대'],
  동대: ['동국대'], 홍대: ['홍익대'], 시립대: ['서울시립대'], 과기대: ['과학기술대'], 서울과기대: ['서울과학기술대'], 경상대: ['경상국립대'], 부경대: ['부경대'], 해양대: ['한국해양대'],
  카이스트: ['kaist', '한국과학기술원'], 포스텍: ['포항공과', 'postech'], 지스트: ['gist', '광주과학기술원'], 디지스트: ['dgist', '대구경북과학기술원'], 유니스트: ['unist', '울산과학기술원'], 켄텍: ['kentech', '한국에너지공과'],
  의대: ['의예', '의학'], 치대: ['치의예', '치의학'], 한의대: ['한의예'], 약대: ['약학'], 수의대: ['수의예'], 교대: ['교육대'], 사대: ['사범', '교육과'], 간호대: ['간호'],
  육사: ['육군사관'], 해사: ['해군사관'], 공사: ['공군사관'], 국간사: ['국군간호사관'], 경찰대: ['경찰대']
};
const ALIAS_RX = { 교대: /교육대학교|초등교육/, 의대: /의예|(^|\s)의학(과|부|전문)|의과대학/, 치대: /치의예|치의학/, 한의대: /한의예|한의학/, 수의대: /수의예|수의학/ };
function smartTerms(q) {
  // 약칭이면 원래 낱말은 빼고 풀어 쓴 말만 찾는다('의대'가 '동의대'에 걸리지 않게)
  return String(q || '').trim().split(/\s+/).filter(Boolean).map(t => { const low = t.toLowerCase(); return { t: low, cho: /^[ㄱ-ㅎ]{2,}$/.test(t), rx: ALIAS_RX[t] || null, alts: ALIAS[t] ? ALIAS[t].map(x => x.toLowerCase()) : [low] }; });
}
function smartHit(terms, hay) {
  if (!terms || !terms.length) return true;
  const h = String(hay || '').toLowerCase(); let hc = null;
  return terms.every(x => { if (x.rx) return x.rx.test(h); if (x.cho) { hc = hc ?? choOf(h).replace(/\s/g, ''); return hc.includes(x.t); } return x.alts.some(a => h.includes(a)); });
}
/* ---- 02-record.js ---- */
/* ===== 학생부 읽기: 가리기 → 영역 나누기 → 성적 → 근거 (규칙 기반, AI 없음) ===== */

/* --- 개인정보 가리기 --- */
const TAIL = '(?=[\\s,.)\\]·]|은|는|이|가|을|를|과|와|의|도|만|께|랑|에|$)';
const MASK_LABELS = ['이름', '성명', '주민번호', '출력정보', '전화번호', '이메일', '학번', '학적', '학교', '주소', '날짜', '가림'];
function findNames(t) {
  const out = new Set(); let m;
  // '성명:' 뒤 이름은 그대로, '이름' 뒤는 콜론이 있을 때만(본문의 '이름 짓기' 같은 말 제외)
  // 빈 성명 칸('성명 :' 다음 줄 '주소 :')이 다음 줄 라벨을 이름으로 잡지 않게, 줄을 넘길 때는 그 줄이 이름만일 때만
  const re = /(?:성[ \t]*명|학생명)[ \t]*[:：]?[ \t]*(?:([가-힣]{2,4})(?![가-힣])|\n[ \t]*([가-힣]{2,4})[ \t]*(?=\n|$))|이[ \t]*름[ \t]*[:：][ \t]*([가-힣]{2,4})(?![가-힣])/g;
  const notName = /^(학번|학년|성별|주소|생년|번호|주민|학적|학교|담임|사진|인적|특기|구분|반|없음)|(기|하기|보기|하다|함|을|를|의|사항)$/;
  while ((m = re.exec(t))) { const n = m[1] || m[2] || m[3]; if (n && !notName.test(n)) out.add(n); }
  return [...out];
}
function maskText(text, extra) {
  let t = String(text || ''); const hits = {};
  const rep = (re, label) => { t = t.replace(re, () => { hits[label] = (hits[label] || 0) + 1; return '[' + label + ']'; }); };
  const extras = String(extra || '').split(/[,\n]/).map(s => s.trim()).filter(s => s.length >= 2).sort((a, b) => b.length - a.length);
  extras.forEach(w => rep(new RegExp(rxEsc(w), 'g'), '가림'));
  findNames(t).sort((a, b) => b.length - a.length).forEach(n => {
    // 이름 전체: 앞뒤 낱말 경계(뒤에는 조사만). '한결'이 '한결같이'를 가리지 않게
    rep(new RegExp('(?<![가-힣])' + rxEsc(n) + TAIL, 'g'), '이름');
    // 3글자 이름의 뒤 두 글자(부르는 이름): 단독 낱말이거나 '하늘이는'처럼 사람 부르는 꼴일 때만. '하늘을 바라보며'는 두기
    if (n.length >= 3) rep(new RegExp('(?<![가-힣])' + rxEsc(n.slice(1)) + '(?=이(?:가|는|를|의|도|와|랑|에게|한테)|[\\s,.)\\]·]|$)', 'g'), '이름');
  });
  rep(/\d{6}\s*[-–]\s*[1-4][\d*]{6}/g, '주민번호');
  rep(/\d{1,3}\.\d{1,3}\.[\d*]{1,3}\.[\d*]{1,3}(?:\s*\/\s*[가-힣]{2,4})?/g, '출력정보');
  rep(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, '전화번호');
  rep(/\b0\d{1,2}[-)]\s?\d{3,4}-\d{4}\b/g, '전화번호');
  rep(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '이메일');
  rep(/(?:학\s*번|학적\s*번호)\s*[:：]?\s*\d{4,10}/g, '학번');
  rep(/(?:성[ \t]*명|학생명)[ \t]*[:：]?[ \t]*(?!주[ \t]*소|학[ \t]*적)[가-힣]{2,4}(?![가-힣])/g, '성명');
  rep(/\d\s*학년\s*\d{1,2}\s*반\s*\d{1,2}\s*번(?:\s*[가-힣]{2,4}(?![가-힣]))?/g, '학적');
  rep(/반\s*\d{1,2}\s*번호\s*\d{1,3}/g, '학적');
  rep(/[가-힣]{2,10}(?:여자고등학교|고등학교|여자중학교|중학교|초등학교|여고)/g, '학교');
  // '주소 :' 라벨(줄 맨 앞, 콜론 필수)일 때만 그 줄 내용을 가린다. 본문의 '이메일 주소'는 두기
  rep(/(?<=^|\n)[ \t]*주[ \t]*소[ \t]*[:：][ \t]*[^\n]*\S/g, '주소');
  // 나이스 2022 양식: '주소 :' 다음 줄부터 주소가 1~3줄 이어진다('학적사항' 전까지)
  t = t.replace(/((?:^|\n)[ \t]*주[ \t]*소[ \t]*[:：][ \t]*(?:\[주소\])?[ \t]*)((?:\n(?![ \t]*(?:학적|특기|학년|성명|성별|\d\.))[^\n]*){1,3})/g, (m0, h, rows) => h + rows.replace(/\n[^\n]*/g, ln => /[가-힣]+(?:도|시|군|구|읍|면|동|로|길|리)(?![가-힣])|\d+\s*(?:-\s*\d+)?\s*(?:번지|동|호)|아파트/.test(ln) ? (hits['주소'] = (hits['주소'] || 0) + 1, '\n[주소]') : ln));
  rep(/(?:19|20)\d{2}\s*[년.]\s*\d{1,2}\s*[월.]\s*\d{1,2}\s*일?/g, '날짜');
  rep(/(?:^|\n)[ \t]*\d{1,2}[ \t]+\d{1,2}[ \t]+\d{1,3}[ \t]+[가-힣]{2,4}[ \t]*(?=\n|$)/g, '학적');
  // 1쪽 학적 표: '반 번호 담임성명' 머리 바로 아래 '1 3 29'처럼 담임 이름 없는 줄도 가린다
  t = t.replace(/(반[ \t]*번[ \t]*호[ \t]*담임[^\n]*)((?:\n[ \t]*[1-3][ \t]+\d{1,2}[ \t]+\d{1,3}(?:[ \t]+[가-힣]{2,4})?[ \t]*(?=\n|$))+)/g, (m0, h, rows) => h + rows.replace(/\n[^\n]*/g, () => { hits['학적'] = (hits['학적'] || 0) + 1; return '\n[학적]'; }));
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
/* 쪽 넘김 때 다시 찍히는 창체 표 머리('학년 / 창의적 체험활동상황 / 영역 시간 특기사항 / 1 진로활동 35')를 본문에서 떼어 낸다.
   같은 학년·영역이 이어지면 그 줄도 버리고, 새 영역이면 '학년' 줄과 '영역 시간' 줄로 나눠 둔다. */
const RE_CC_AREA = /^((?:자율|동아리|진로|봉사)[·・]?(?:자치)?\s*활동)\s+(\d{1,4})$/;
function dropRepeatHeads(src) {
  const out = []; let seen = false, g = null, area = null;
  for (let i = 0; i < src.length; i++) {
    const a = String(src[i]).trim();
    if (a === '학년' && /^창의적\s*체험\s*활동\s*상황$/.test(String(src[i + 1] || '').trim()) && /^영역\s*시간\s*특기\s*사항$/.test(String(src[i + 2] || '').trim())) {
      if (!seen) { seen = true; out.push(src[i], src[i + 1], src[i + 2]); i += 2; continue; }
      i += 2;
      const nx = String(src[i + 1] || '').trim(), m = nx.match(/^([1-3])\s+(.+)$/), am = m && m[2].match(RE_CC_AREA);
      if (am) { i++; const ng = Number(m[1]), na = nsp(am[1]); if (!(ng === g && na === area)) { out.push(String(ng), am[1] + ' ' + am[2]); g = ng; area = na; } }
      continue;
    }
    if (seen) { if (/^[1-3]$/.test(a)) g = Number(a); const am = a.match(RE_CC_AREA); if (am) area = nsp(am[1]); }
    out.push(src[i]);
  }
  return out;
}
function normalizeLines(text) {
  const src = dropRepeatHeads(String(text || '').split(/\r?\n/)), out = []; let buf = [];
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
        if (carried && head) { gy = carried; sj = head; }
        else if (carried) {
          // 과목 이름까지 줄이 나뉜 경우('예술 / 음악 감상과 / 비평 / 2 92/93.9 …'): 앞 줄은 교과, 나머지는 과목
          const g0 = GYOGWA.find(g => nsp(pre[0]) === nsp(g)) || GYOGWA.find(g => carried.indexOf(nsp(g)) === 0);
          if (g0 && nsp(pre[0]) === nsp(g0)) { gy = g0; sj = pre.slice(1).join(''); }
          else if (g0) { gy = g0; sj = carried.slice(nsp(g0).length); }
          else { gy = ''; sj = pre.join(''); }
        } else { const pr = splitGyogwa(head); gy = pr[0]; sj = pr[1] || pr[0]; }
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
      // 원점수 없는 과목(체육·예술 등): '체육 체육 2 A', '1 체육 운동과 건강 2 A'
      const nm = ln.match(/^(?:([1-2])\s+)?([^\d\/()（）.:：]{2,30}?)\s+(\d{1,2})\s+([A-E])$/);
      if (nm && (nm[1] || term !== null)) {
        const t3 = nm[1] ? Number(nm[1]) : term; let gy, sj; const carried = pre.join('').replace(/\s/g, '');
        if (carried) { gy = carried; sj = nm[2].trim(); } else { const pr = splitGyogwa(nm[2].trim()); gy = pr[0]; sj = pr[1] || pr[0]; }
        if (nm[1]) term = t3;
        pre = []; if (sj) out.push({ 학년: seg.학년, 학기: t3, 교과: gy, 과목: sj, 학점: Number(nm[3]), 등급: null, 성취도: nm[4] });
        continue;
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
  // '열성적'·'기록 향상'·'성취감' 같은 오탐을 막으려고 낱말 대신 수업 성취 맥락을 본다
  '학업성취도': [/(?<![가-힣])성적(?:이 |을 |이|을)?(?:향상|우수|상승|크게 오르|꾸준히 오르)/, /성취도(?:가|를|에서)? ?(?:높|향상|우수|최고|보여)/, /학업 ?성취/, /우수한 성취(?!감)/, /(?:성적|점수|성취도|학업 성취|이해도|문제 해결력|어휘력|독해력|계산력)(?:이|가)? ?(?:크게 |크게|꾸준히 |눈에 띄게 )?향상/, /(?<![가-힣])등급(?:이|을)? ?(?:올|향상|상승)/, /상위권(?:의)? ?(?:성적|성취)/, /만점/],
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
// 짧은 낱말은 낱말 안쪽에서 걸리지 않게 앞 글자를 본다('열성적'의 '성적', '일상위'의 '상위')
const LEFT_BOUND = new Set(['상위', '팀', '공동', '대표', '부장', '실장', '회장', '반장', '조장', '성실', '규칙', '약속', '희망', '전공', '직업', '장래', '발표', '함께', '소통']);
const KW_RX = new Map();
function kwRx(w) {
  if (w instanceof RegExp) return w;
  if (!KW_RX.has(w)) KW_RX.set(w, new RegExp((LEFT_BOUND.has(w) ? '(?<![가-힣])' : '') + rxEsc(w)));
  return KW_RX.get(w);
}
const NOT_ACADEMIC = /^(체육|운동|스포츠|음악|미술|연극|예술)/;
function buildEvidence(items) {
  const ev = {}; Object.keys(TAG_RULES).forEach(k => (ev[k] = []));
  items.forEach((it, idx) => {
    sentences(it.내용).forEach(sent => {
      for (const [k, kws] of Object.entries(TAG_RULES)) {
        // 학업성취도는 교과 세특에서만(체육 '기록 향상', 행특 '열성적' 제외)
        if (k === '학업성취도' && (it.영역 !== '세특' || NOT_ACADEMIC.test(nsp(it.과목 || '')))) continue;
        const found = [...new Set(kws.map(w => { const m = sent.match(kwRx(w)); return m ? m[0] : null; }).filter(Boolean))];
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
  // 세특 뒤에 붙어 온 표 머리글·쪽 머리글('<체육·예술', '학기 교과 과목', '이수학점 합계')을 잘라 내고, 빈 기록은 뺀다
  const JUNK = /<\s*(체육|교양)|학기\s*교과\s*과목|이수\s*학점\s*합계/;
  const PGHEAD = /\[학교\]\s*\/\s*\[날짜\]\s*[\d:]*\s*\/\s*\[출력정보\]\s*|\/?\s*\d*\s*\[학교\]\s*\[날짜\]\s*\d*\s*\[학적\]\s*(?:성명\s*\[이름\])?/g;
  for (let i = items.length - 1; i >= 0; i--) { const it = items[i]; it.내용 = String(it.내용).replace(PGHEAD, ' ').replace(/[ \t]{2,}/g, ' '); const m = it.내용.search(JUNK); if (m >= 0) it.내용 = it.내용.slice(0, m).trim(); if (it.내용.replace(/\s|해당\s*사항\s*없음/g, '').length < 20) items.splice(i, 1); }
  R.items = items; R.chain = null; R.incomplete = null;
  let g = parseGrades(R.areas['교과성적'] || '');
  const g2 = parseGrades(text); if (g2.length > g.length) g = g2;
  // 줄이 나뉜 과목 이름('음악 감상과비평')은 세특 머리의 과목 이름('음악 감상과 비평')으로 맞춘다
  const itemSubj = new Map(); items.forEach(i => { if (i.과목) itemSubj.set(nsp(i.과목), i.과목); });
  R.grades = g.map(r => ({ 학년: r.학년 || '', 학기: r.학기 || '', 교과: r.교과 || '', 과목: itemSubj.get(nsp(r.과목)) || r.과목 || '', 학점: r.학점 ?? '', 등급: r.등급 ?? '', 성취도: r.성취도 || '' }));
  const maxG = Math.max(0, ...R.grades.map(r => Number(r.등급) || 0));
  const seen = new Set([...R.grades.map(r => nsp(r.과목)), ...items.map(i => nsp(i.과목))]);
  const n15 = ONLY_2015.filter(s => seen.has(s)).length, n22 = ONLY_2022.filter(s => seen.has(s)).length;
  const guess = maxG >= 6 ? 9 : n15 >= n22 + 2 ? 9 : n22 >= n15 + 2 ? 5 : null;
  R.system = guess || sysOf(S.profile.curr);
  R.sysAuto = !!guess && guess !== sysOf(S.profile.curr);
  R.sysWhy = maxG >= 6 ? '성적에 6등급 이상이 있어요' : guess === 9 ? '2015 개정 과목 이름이 보여요' : '2022 개정 과목 이름이 보여요';
  R.evidence = buildEvidence(items);
  addMajorEvidence(R);
  R.analyzed = true;
}
/* 진로역량 '전공(계열) 관련 교과' 항목: 희망 분야 낱말이 나오는 세특 문장을 근거로 */
function majorWords(R) {
  const out = new Set();
  // 원문 줄 단위에서 '희망분야' 뒤 짧은 구간만 읽는다(문단 전체를 잡지 않게)
  const re = /희망\s*분야\s*[:：]?[ \t]*([^\n]{1,30})/g; let mm;
  while ((mm = re.exec(R.masked || ''))) mm[1].split(/[,·/\s]+|및/).slice(0, 6).forEach(w => { w = w.replace(/(계열|분야|학과|학부|전공)$/, '').trim(); if (w.length >= 2 && w.length <= 8 && /^[가-힣A-Za-z]+$/.test(w)) out.add(w); });
  String(S.profile.interest || '').split(/[,·/\s]+/).forEach(w => { w = w.trim(); if (w.length >= 2) out.add(w); });
  // '건축학'→'건축'처럼 '학'만 떼고, '기계공학'→'기계'는 만들지 않는다('기계와 대화' 같은 오탐 방지)
  [...out].forEach(w => { if (/공학$/.test(w)) return; const s = w.replace(/학$/, ''); if (s.length >= 2) out.add(s); });
  return [...out].filter(w => !/^(희망|없음|미정|학년|학기|영역|시간|봉사|활동|특기사항|일자|기간|장소|내용)$/.test(w));
}
function addMajorEvidence(R) {
  const mw = majorWords(R); R.majorWords = mw; if (!mw.length) return;
  const effort = R.evidence['전공(계열) 관련 교과 이수 노력'], ach = R.evidence['전공(계열) 관련 교과 성취도'];
  const cut = R.system === 5 ? 2 : 3;
  const good = new Set(R.grades.filter(g => /^A/.test(g.성취도 || '') || (Number(g.등급) && Number(g.등급) <= cut)).map(g => nsp(g.과목)));
  R.items.forEach((it, idx) => {
    if (it.영역 !== '세특') return;
    sentences(it.내용).forEach(sent => {
      const found = mw.filter(w => sent.includes(w)); if (!found.length) return;
      const e = { idx, sent, kws: found, 영역: it.영역, 학년: it.학년, 과목: it.과목 };
      if (effort.length < 40 && !effort.some(x => x.sent === sent)) effort.push(e);
      if (good.has(nsp(it.과목)) && ach.length < 40 && !ach.some(x => x.sent === sent)) ach.push(e);
    });
  });
}
function takenSets() {
  const taken = new Set(), gy = new Set();
  S.rec.grades.forEach(r => { if (r.과목) taken.add(subjNorm(r.과목)); if (r.교과) gy.add(subjNorm(String(r.교과).replace(/\(.*$/, ''))); });
  S.rec.items.forEach(it => { if (it.과목) taken.add(subjNorm(it.과목)); });
  return { taken, gy };
}

/* ---- 02b-chain.js ---- */
/* ===== 탐구 흐름: 학년을 이어 온 주제·끊긴 주제·새 주제, 계획으로 끝난 문장 (예전 Analyzer.gs 이식) ===== */
// 불용어는 예전 앱이 실제 학생부 여러 건에서 걸러 낸 목록 그대로다
const CH_STOP = new Set('자치활동 자율활동 동아리활동 진로활동 봉사활동 봉사시간 특기사항 세부능력 교과우수상 수상경력 수강자 학교장 담임 학적 인적 창의적체험 체험활동 봄예술제 체육대회 축제 정화 정돈 청소 교내 교외 행사 대회 캠프 특강 농구 축구 배구 야구 줄넘기 달리기 경기 종목 이어진다 구성 구조 연결 방식 전달 유지 조정 완성 기존 주변 판단 관리 인상 기능 현대 모든 정확하게 긍정적인 어려움 변화 상황 중요 필요 사용 적용 타인 단위 분위기 기준 방향 정도 수준 부분 측면 요소 조건 있음 없음 하였음 되었음 보임 통해 대해 위해 관련 활동 수업 시간 내용 모습 과정 결과 돋보였으며 인상적임 우수함 뛰어남 성실함 발표함 참여함 작성함 조사함 실시함 진행함 보여줌 드러냄 나타냄 임함 노력함 기울임 보완함 향상됨 성장함 자신 학생 친구 선생님 학교 학급 이후 특히 또한 다양한 여러 매우 가장 함께 직접 스스로 그리고 하지만 때문 경우 이때 이를 이러한 그러한 서로 먼저 계속 다시 아주 1학년 2학년 3학년 1학기 2학기 학년 학기 탐구 보고서 프로젝트 실험 조사 분석 발표 토론 독서 논문 자료 과제 활동지 수행평가 동아리 자율 진로 봉사 멘토링 캠페인 공모전 이해 생각 의견 질문 문제 방법 학습 설명 실제 관심 개념 주제 진행 수립 참여 확인 제시 제안 계획 역할 능력 태도 자세 경험 사례 목표 정보 지식 기술 분야 중심 통한 바탕 기반 전체 이상 이하 최고 최대 어떻게 무엇 왜곡 기본 배운 배움 익힌 알게 되는 하는 되는지 하는지 통하여 역량 과목 교과 학업 성취 평가 기록 과정에서 활동에서 수행 태도로 사용자 이용자 사람 우리 사회 문화 세계 현재 과거 미래 오늘 요즘 추천 강화 제작 확대 증가 감소 영향 문제점 필요성 중요성 읽고 단순 미치 맡아 급우 마다 대한 위한 따른 관한 날짜 번호 성명 학년도 쪽수 반번호 다양 있게 준비 도움 정리 작성 평소 반복 위치 활용 표현 발휘 관찰 사실 학생임 있다 없다 아니라 따라 되었다고 이라 다른 어떤 있도록 가지고 의미 방안 선택 강조 실천 소개 혜택 파악 특징 이유 발생 기여 제출 향상 일상 대처 가능성 노력 연습 발전 원리 소감 내용을 과정을 활동을 생각을 자신의 스스로의 이어지는 관계 있으며 있었음 있어 있고 돋보임 돋보이 나아 않고 생겨 생김 느낌 찾아 찾은 새로운 깨닫게 깨달음 해결 흥미 호기심 탐색 연구 심화 확장 연계 의지 열정 책임 배려 소통 협력 협업 리더 나눔 성실 규칙 준수 공감 조원 교사 모둠 동급생 선배 후배 인물 등장인물 설정 이용 아이디어 주장 작품 이야기 배경 기간 도서 영상 포스터 단원 기회 고려 도출 계산 사고 인식 관점 해석 사건 인간 생활 개인 자기 자신감 전반 기타 OOO 밝힘 고찰 비교 받음 탁월 핵심 어려운 마음 집중 ooo 이름 학교 날짜 학적 주소 가림 출력정보 학점 해당 사항 비고 이수학점 합계 이수여부 교양교 성취도 원점수 과목평균 수강자수 석차등급 등급 체육 운동 감상 미술 음악 예술 건강 비평 아닌 서술 성장 궁금 처음 실력 능력주 형태 꾸준히 알아보고자 형성 기획 개선 측정'.split(/\s+/));
const CH_SUFFIX = /(하는지|되는지|하면서|하였음|하기로|이라고|으로써|로부터|에게서|에서의|하는|되는|하며|하고|하여|해서|하기|하지|되어|된|될|라고|으로|에서|에게|부터|까지|처럼|보다|만큼|께서|으로서|로서|들|을|를|이|가|은|는|의|에|와|과|로|도|만|한|할|함|했|해|됨)$/;
function chKeywords(text, n) {
  const freq = {};
  String(text).replace(/\[[^\]]*\]/g, ' ').replace(/[^가-힣A-Za-z0-9\s]/g, ' ').split(/\s+/).forEach(t0 => {
    let t = t0.replace(CH_SUFFIX, '').replace(CH_SUFFIX, '').replace(/(하|되|시키|스러)$/, '');
    if (t.length < 2 || t.length > 12) return;
    if (CH_STOP.has(t) || CH_STOP.has(t0)) return;
    if (/(있|없|같|많|적|크|작|높|낮)$/.test(t) || /^[0-9]+$/.test(t)) return;
    freq[t] = (freq[t] || 0) + 1;
  });
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n || 20);
}
function analyzeChain(items) {
  const kw = {};
  [1, 2, 3].forEach(g => { kw[g] = Object.fromEntries(chKeywords(items.filter(it => it.학년 === g).map(it => it.내용).join(' '), 60)); });
  const 지속 = [], 단절 = [], 신규 = [];
  Object.keys(kw[1]).forEach(w => { if (kw[2][w] || kw[3][w]) 지속.push(w); else if (kw[1][w] >= 2) 단절.push(w); });
  Object.keys(kw[2]).forEach(w => { if (!kw[1][w]) { if (kw[3][w]) 지속.push(w); else 신규.push(w); } });
  Object.keys(kw[3]).forEach(w => { if (!kw[1][w] && !kw[2][w]) 신규.push(w); });
  const f = w => kw[3][w] || kw[2][w] || kw[1][w] || 0;
  const top = (ws, k) => [...new Set(ws)].sort((a, b) => f(b) - f(a)).slice(0, k);
  // 이어진 낱말이 나온 기록 짝: 학년 차가 큰 짝 먼저, 낱말마다 두 쌍, 같은 기록은 두 번까지
  const 연결 = [], 쓴쌍 = {}, 쓴 = {};
  top(지속, 10).forEach(w => {
    const found = items.map((it, i) => ({ it, i })).filter(x => x.it.학년 && x.it.내용.includes(w));
    const 짝 = [];
    for (let a = 0; a < found.length; a++) for (let b = a + 1; b < found.length; b++) {
      let p = found[a], q = found[b]; if (p.it.학년 === q.it.학년) continue; if (p.it.학년 > q.it.학년) [p, q] = [q, p];
      짝.push({ 앞: p, 뒤: q, 차: q.it.학년 - p.it.학년 });
    }
    짝.sort((x, y) => y.차 - x.차);
    let n = 0;
    for (const p of 짝) {
      if (연결.length >= 12 || n >= 2) break;
      const key = p.앞.i + '>' + p.뒤.i; if (쓴쌍[key] || (쓴[p.앞.i] || 0) >= 2 || (쓴[p.뒤.i] || 0) >= 2) continue;
      쓴쌍[key] = 1; 쓴[p.앞.i] = (쓴[p.앞.i] || 0) + 1; 쓴[p.뒤.i] = (쓴[p.뒤.i] || 0) + 1;
      연결.push({ 키워드: w, 앞: p.앞.it, 뒤: p.뒤.it }); n++;
    }
  });
  return { 지속: top(지속, 12), 단절: top(단절, 8), 신규: top(신규, 12), 연결 };
}
const CH_PLAN = /(계획함|계획을세움|계획하였음|하기로함|하기로하였음|해보기로함|해보기로하였음|해보고자함|해보고자하였음|탐구하고자함|탐구하고자하였음|알아보기로함|알아보기로하였음|조사해보기로|시도하려|후속탐구로남김)[.。]?$/;
const CH_RESULT = /(결과|결론|확인함|확인하였|검증|도출|완성|산출|밝혀|밝힘|나타남|입증|성공|실패|측정|얻었|알게됨|알아냄|정리함|정리하여|증명|분석함|분석하여|고안|제작|설계|구현|규명|해결|개선|비교함|비교하여|적용함|적용하여|발표함|깨달|찾아냄|이끌어냄|만들어냄|끄집어)/;
// 세특 하나는 활동 여러 개를 묶은 덩어리라 낱말 유무로 미완결을 가리지 않는다. 문장 하나가 계획으로 끊긴 경우만 센다
function findIncomplete(items) {
  const out = [], seen = {};
  items.forEach((it, idx) => {
    const ss = String(it.내용).split(/(?<=[.。])\s+/);
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i].trim(); if (s.length < 15) continue;
      if (CH_PLAN.test(s.replace(/\s/g, '')) && !CH_RESULT.test(ss.slice(i + 1).join(' ').replace(/\s/g, '')) && !seen[idx]) { seen[idx] = 1; out.push({ it, 문장: s }); }
    }
  });
  return out;
}
function chainHTML() {
  const R = S.rec; if (!R.chain) { R.chain = analyzeChain(R.items || []); R.incomplete = findIncomplete(R.items || []); }
  const C = R.chain, grades = new Set((R.items || []).map(i => i.학년).filter(Boolean));
  const chips = (ws, cls) => ws.length ? `<div class="hitchips">${ws.map(w => `<span class="${cls}">${esc(w)}</span>`).join('')}</div>` : '<p class="tiny">없음</p>';
  const where = it => [it.학년 ? it.학년 + '학년' : '', AREA_NAME[it.영역] || it.영역, it.과목].filter(Boolean).join(' · ');
  const sentOf = (it, w) => { const s = sentences(it.내용).find(x => x.includes(w)) || ''; return s; };
  const pairs = C.연결.map((x, i) => { const a = sentOf(x.앞, x.키워드), b = sentOf(x.뒤, x.키워드);
    return `<div class="ev"><span class="where"><b>'${esc(x.키워드)}'</b> ${esc(where(x.앞))} → ${esc(where(x.뒤))}</span>
      <p style="margin:4px 0">${hlSent(a, [x.키워드])}${a ? ` <button class="origbtn" data-act="origShow" data-s="${esc(a)}">${ic('eye')}원본</button>` : ''}</p>
      <p style="margin:4px 0">→ ${hlSent(b, [x.키워드])}${b ? ` <button class="origbtn" data-act="origShow" data-s="${esc(b)}">${ic('eye')}원본</button>` : ''}</p></div>`; }).join('');
  const inc = (R.incomplete || []).map(o => `<div class="ev"><span class="where">${esc(where(o.it))}<button class="origbtn" data-act="origShow" data-s="${esc(o.문장)}">${ic('eye')}원본</button></span>${esc(o.문장)}<p class="tiny" style="margin:4px 0 0">계획으로 끝나고 결과 문장이 없어요. 이어서 해 볼 탐구 후보예요.</p></div>`).join('');
  return `<section class="panel vio"><h2>${ic('list')} 탐구 흐름</h2><p class="one">학년을 넘어 이어진 주제와 새로 나온 주제예요. 낱말로 센 거라 참고로 보세요.</p>
    ${grades.size < 2 ? '<div class="note">한 학년 기록만 있어서 이어짐은 아직 볼 수 없어요.</div>' : ''}
    <div class="grid2"><div><h3>학년을 이어 온 주제</h3>${chips(C.지속, 'on')}</div><div><h3>새로 나온 주제</h3>${chips(C.신규, '')}</div></div>
    ${C.단절.length ? `<h3>1학년에만 있고 끊긴 주제</h3>${chips(C.단절, '')}` : ''}
    ${pairs ? `<details class="fold" data-fold="chpairs"${fo('chpairs', true)}><summary><span class="sumt"><b>이어진 기록 짝</b><span class="pv">${C.연결.length}쌍 · 면접에서 "어떻게 이어졌나" 질문이 나오기 좋은 곳</span></span></summary><div class="fb">${pairs}</div></details>` : ''}
    <details class="fold" data-fold="chinc"${fo('chinc')}><summary><span class="sumt"><b>이어갈 탐구</b><span class="pv">${(R.incomplete || []).length}곳 · 계획으로 끝난 문장</span></span><span class="cnt ${(R.incomplete || []).length ? '' : 'zero'}">${(R.incomplete || []).length}</span></summary><div class="fb">${inc || '<p class="muted" style="margin:0">계획으로만 끝난 문장은 없어요.</p>'}</div></details>
  </section>`;
}
/* ---- 03-home-record.js ---- */
/* ===== 상단·홈·내 정보·학생부 화면 ===== */
const ACT = {}, IN = {};
/* 접기 상태: data-fold 키별로 기억해서 다시 그려도 열린 채로 */
const FOLD = {};
const fo = (key, def = false) => ((key in FOLD) ? FOLD[key] : def) ? ' open' : '';
document.addEventListener('toggle', e => { const d = e.target; if (d && d.dataset && d.dataset.fold) FOLD[d.dataset.fold] = d.open; }, true);
function setTopH() { const t = $('#top'); if (t) document.documentElement.style.setProperty('--toph', t.offsetHeight + 'px'); }
window.addEventListener('resize', setTopH);

function renderTop() {
  const p = S.profile;
  const cur = VIEW === 'compare' || VIEW === 'rural' ? 'major' : VIEW;
  const nb = (to, color, icn, label) => `<button class="navb ${color} ${cur === to ? 'on' : ''}" data-act="nav" data-to="${to}" ${cur === to ? 'aria-current="page"' : ''}>${ic(icn)}${label}</button>`;
  $('#top').innerHTML = `<button class="brand" data-act="go" data-to="home" aria-label="진학 나침반 처음으로">${logoSVG()}<b>진학 나침반</b></button>
  <nav class="nav" aria-label="주요 화면">${nb('record', 'mint', 'file', '학생부')}${nb('major', 'apri', 'cap', '학과·전형')}${nb('interview', 'vio', 'chat', '면접')}</nav>
  <div class="chips">
    <button class="chip" data-act="profile" aria-label="내 정보 바꾸기">${ic('user')} ${esc(p.grade)} <small>${esc(currLabel(p.curr))}</small></button>
    ${p.rural ? '<button class="chip on" data-act="profile">농어촌</button>' : ''}
    ${p.interest ? `<button class="chip ghost" data-act="profile">${esc(p.interest)}</button>` : ''}
  </div>`;
  setTopH();
}
ACT.nav = el => {
  const to = el.dataset.to;
  if ($('#dlg').open) $('#dlg').close();
  if (VIEW === to) {
    if (to === 'major') S.mj.view = 'search';
    if (to === 'interview' && S.iv.phase) { stopTimer(); S.iv.phase = ''; }
    render(); window.scrollTo(0, 0); return;
  }
  go(to);
};
function renderFoot() {
  $('#foot').innerHTML = `<p>무료·비영리 · 학생부는 서버로 보내지 않고, 저장·AI 학습도 하지 않아요 · <a href="${MOE_URL}" target="_blank" rel="noopener noreferrer">교육부 안내(학생부 열람·상담)</a></p>
  <p><button class="tlink" data-act="go" data-to="teacher">선생님용 도구</button> · <button class="tlink" data-act="wipe">이 화면 다 지우기</button></p>`;
}
function vhead(color, title, sub, back = 'home') {
  return `<div class="vhead ${color}"><button class="back" data-act="go" data-to="${back}" aria-label="뒤로">${ic('back')}</button><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div></div>`;
}

/* ---------- 홈 ---------- */
function viewHome() {
  const n = (window.JN_META || {}).counts || {};
  return `<section class="hero">
    <span class="eyebrow">${ic('star')} 내 꿈을 비추는 별자리</span>
    <h1>진학 나침반</h1>
    <p>내 학생부로, 내 길을 스스로 찾아요.</p>
    <div class="hero-act">${S.rec.analyzed ? `<button class="btn small mint" data-act="go" data-to="record">내 학생부 결과 이어 보기</button>` : `<button class="btn small demo" data-act="demo">${ic('play')} 가상 학생으로 둘러보기</button>`}</div>
    <div class="tags"><span>${ic('shield')}학생부는 이 기기 안에서만</span><span>학과 ${(n['학과사전'] || 0).toLocaleString()}개</span><span>기출 질문 ${(n['기출면접'] || 0).toLocaleString()}개</span></div>
    ${logoSVG('big-logo')}
  </section>
  <div class="cards">
    <button class="bigcard c-mint" data-act="go" data-to="record"><span class="num">1</span><h2>내 학생부 살펴보기</h2><p>성적·기록 근거·권장과목</p>${ICON.rec}</button>
    <button class="bigcard c-apri" data-act="go" data-to="major"><span class="num">2</span><h2>학과·전형 찾기</h2><p>학과·대학·입결 한 번에</p>${ICON.major}</button>
    <button class="bigcard c-vio" data-act="go" data-to="interview"><span class="num">3</span><h2>면접 연습</h2><p>기출 질문으로 연습</p>${ICON.iv}</button>
  </div>
  <div class="demo-row">
    ${S.profile.rural ? `<button class="btn white" data-act="go" data-to="rural">농어촌 전형 체크</button>` : ''}
    ${S.cands.length ? `<button class="btn white" data-act="go" data-to="compare">내 후보 ${S.cands.length}개 비교</button>` : ''}
  </div>`;
}

/* ---------- 내 정보 ---------- */
function openDialog(title, body) {
  const d = $('#dlg'); d.classList.remove('wide');
  d.innerHTML = `<div class="dh"><h2 id="dlgTitle">${title}</h2><button data-act="dlgClose" aria-label="닫기">${ic('close')}</button></div><div class="db">${body}</div>`;
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
    <label class="f" id="lc">교육과정 <span class="tiny">입학연도로 자동</span></label>
    <div class="seg" role="group" aria-labelledby="lc">
      <button data-act="pCurr" data-v="2022" aria-pressed="${p.curr === '2022'}">2022 개정 · 5등급</button>
      <button data-act="pCurr" data-v="2015" aria-pressed="${p.curr === '2015'}">2015 개정 · 9등급</button></div>
    <label class="toggle" style="margin-top:12px"><input type="checkbox" data-in="pRural" ${p.rural ? 'checked' : ''}><span class="sw"></span>농어촌 학교·지역에 살아요</label>
    <label class="f" for="pInt">관심 분야</label>
    <input id="pInt" type="text" maxlength="40" placeholder="예: 간호, 컴퓨터, 교육" value="${esc(p.interest)}" data-in="pInt">
    ${S.rec.analyzed && S.rec.system && S.rec.system !== sysOf(p.curr) ? `<p class="note">학생부는 ${S.rec.system === 9 ? '2015 개정(9등급)' : '2022 개정(5등급)'}으로 보여요.</p>` : ''}
    <p class="tiny">내 정보와 지원 후보 목록만 이 기기에 저장돼요. 학생부는 저장하지 않아요.</p>
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
  // 3단계(결과)에서는 단계 바를 한 줄 진행 표시로 줄인다
  // 가리기는 자동. 단계는 '올리기 → 결과' 두 개만 보여 주고, 가린 내용 확인은 결과 화면의 선택 링크로
  const mini = R.step >= 2 ? `<nav class="steps mini" aria-label="단계"><button data-act="recStep" data-n="1">1 올리기</button><span aria-hidden="true">›</span><button class="${R.step === 3 ? 'on' : ''}" data-act="recStep" data-n="3" ${R.step === 3 ? 'aria-current="step"' : ''}>2 결과</button><span class="spacer"></span><button data-act="recStep" data-n="2" class="${R.step === 2 ? 'on' : ''}">${ic('eye')}가린 내용 보기</button></nav>` : '';
  return vhead('mint', '내 학생부 살펴보기', R.demo ? '<span class="badge sun">가상 학생 · 실제 사람 아님</span>' : '원문은 이 기기 밖으로 나가지 않아요.') +
    (mini || `<div class="steps">${st(1, '올리기')}${st(3, '결과 보기')}</div>`) + body;
}
function recStep1() {
  return `<section class="panel mint">
    <h2>학생부 넣기</h2>
    <p class="one">PDF는 이 브라우저 안에서만 읽어요.</p>
    <label class="drop" tabindex="-1"><input type="file" accept="application/pdf,.pdf" data-in="pdf" aria-label="학생부 PDF 고르기"><strong>${ic('upload')} PDF 고르기</strong><span class="muted">나이스·정부24에서 받은 학생부 PDF</span></label>
    <details class="fold" data-fold="pdfhow"${fo('pdfhow')}><summary><span class="sumt"><b>학생부 PDF 받는 법 (1분)</b></span></summary><div class="fb"><ol class="how">
      <li>정부24·나이스에서 학교생활기록부를 받거나, 학교에 PDF로 받을 수 있는지 물어봐요.</li>
      <li>인쇄 화면이 나오면 프린터 대신 'PDF로 저장'을 골라요.</li>
      <li>저장한 PDF를 위 'PDF 고르기'로 올려요. 사진으로 찍은 PDF는 글자를 못 읽어요.</li></ol></div></details>
    <div id="pdfStatus" class="muted" aria-live="polite" style="margin-top:8px">${S.rec.pdfName ? esc(S.rec.pdfName) + ' 읽음' : ''}</div>
    <div class="or">또는</div>
    <label class="f" for="rawText">글자 붙여넣기</label>
    <textarea id="rawText" data-in="raw" placeholder="학생부 내용을 복사해서 붙여넣어 주세요.">${esc(S.rec.raw)}</textarea>
    <div class="row" style="margin-top:12px"><button class="btn demo" data-act="demo">가상 학생으로 둘러보기</button><span class="spacer"></span><button class="btn mint" data-act="toMask">결과 보기 ${ic('next')}</button></div>
  </section>`;
}
function recStep2() {
  const R = S.rec, hits = Object.entries(R.hits);
  return `<section class="panel sun">
    <h2>가린 내용 보기 <span class="badge">선택</span></h2>
    <p class="one">인쇄·복사·저장할 때만 쓰여요. 빠진 이름이 있으면 적어 주세요.</p>
    <div class="hitchips">${hits.length ? hits.map(([k, v]) => `<span>${esc(k)} ${v}</span>`).join('') : '<span>자동으로 가린 곳 없음</span>'}</div>
    <div class="masked" tabindex="0" aria-label="가려진 학생부 미리보기">${markMasked(R.masked.slice(0, 20000))}${R.masked.length > 20000 ? '\n…(뒤는 생략해서 보여요)' : ''}</div>
    <label class="f" for="maskExtra">더 가릴 말 <span class="tiny">(친구·선생님 이름 등, 쉼표로)</span></label>
    <div class="row"><input id="maskExtra" type="text" value="${esc(R.extra)}" data-in="maskExtra" style="flex:1;min-width:200px"><button class="btn white" data-act="remask">다시 가리기</button></div>
    <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn mint" data-act="analyze" id="btnAnalyze">결과로 돌아가기 ${ic('next')}</button></div>
  </section>`;
}
function recStep3() {
  const R = S.rec, tab = R.tab;
  const t = (k, icn, label) => `<button class="tab mint ${tab === k ? 'on' : ''}" data-act="recTab" data-k="${k}" aria-pressed="${tab === k}">${ic(icn)}${label}</button>`;
  let inner = '';
  if (tab === 'grade') inner = recGrade(); else if (tab === 'ev') inner = recEvidence(); else if (tab === 'check') inner = '<div id="checkBox">불러오는 중…</div>'; else if (tab === 'ipg') inner = '<div id="ipgBox">불러오는 중…</div>'; else inner = '<div id="fitBox">불러오는 중…</div><div id="pathBox"></div>';
  return `<div class="tabs stick" role="group" aria-label="결과 보기" style="--n:5">${t('grade', 'chart', '성적')}${t('ipg', 'compass', '입결 비교')}${t('ev', 'search', '기록 근거')}${t('check', 'pen', '스스로 점검')}${t('fit', 'book', '과목·학과')}</div>${inner}
  <section class="panel navy"><div class="row">
    <button class="btn" data-act="printSum">${ic('print')} 상담 요약 1장</button>
    <button class="btn white" data-act="saveDlg">${ic('lock')} 암호 파일로 저장</button>
    <button class="btn vio" data-act="aiPrompt">${ic('star')} AI 분석 프롬프트 복사</button>
    <span class="spacer"></span><button class="btn danger" data-act="wipe">${ic('trash')} 다 지우기</button></div>
    <p class="tiny" style="margin:8px 0 0">지금은 이 탭의 메모리에만 있어요. 탭을 닫으면 사라져요.</p></section>`;
}

/* 성적: 요약 카드 + SVG 그래프 4개 (라이브러리 없음) */
const GROUPS = ['국어', '수학', '영어', '사회', '과학', '기타'];
const GCOL = { 국어: '#FF8FB8', 수학: '#62D8FF', 영어: '#FFD36E', 사회: '#FFB07A', 과학: '#3EE6CF', 기타: '#A98CFF' };
const ACOL = { A: '#3EE6CF', B: '#A98CFF', C: '#FFD36E', D: '#FF8A5C', E: '#FF7BA9' };
function groupOf(r) {
  const g = String(r.교과 || ''), s = String(r.과목 || '');
  if (g) {
    // '기술・가정/제2외국어/한문/교양'에 '국어' 글자가 들어 있어 먼저 걸러 낸다
    const h = nsp(g);
    if (/제2외국어|한문|교양|정보|기술|가정|체육|예술|음악|미술/.test(h)) return '기타';
    if (/^국어/.test(h)) return '국어'; if (/^수학/.test(h)) return '수학'; if (/^영어/.test(h)) return '영어';
    if (/^(사회|역사|한국사|도덕)/.test(h)) return '사회'; if (/^과학/.test(h)) return '과학';
    return '기타';
  }
  if (/한문|제2외국어|정보|교양/.test(s)) return '기타';
  if (/국어|문학|독서|화법|작문|언어와\s*매체|문법/.test(s)) return '국어';
  if (/수학|미적분|확률|기하|대수/.test(s)) return '수학';
  if (/영어/.test(s)) return '영어';
  if (/사회|역사|한국사|윤리|지리|정치|경제|법과|세계사|동아시아/.test(s)) return '사회';
  if (/과학|물리|화학|생명|지구/.test(s)) return '과학';
  return '기타';
}
const termName = k => { const [a, b] = k.split('-'); return `${a}학년 ${b}학기`; };
function gradeModel() {
  const R = S.rec, sys = R.system || sysOf(S.profile.curr), rows = R.grades;
  const all = wavg(rows), band = sys === 9 ? band5(rows) : null;
  const tmap = {};
  rows.forEach(r => { const a = String(r.학년 || '').trim(), s = String(r.학기 || '').trim(); if (!a || !s) return; const k = a + '-' + s; (tmap[k] = tmap[k] || []).push(r); });
  const terms = Object.keys(tmap).sort().map(k => ({ k, w: wavg(tmap[k]) })).filter(t => t.w);
  const groups = GROUPS.map(g => { const rs = rows.filter(r => groupOf(r) === g); return { g, w: wavg(rs), n: rs.length }; }).filter(x => x.w);
  const graded = rows.filter(r => { const g = Number(r.등급), c = Number(r.학점); return g >= 1 && g <= 9 && c > 0; }).length;
  const valid = rows.map(r => Math.round(Number(r.등급))).filter(g => g >= 1 && g <= 9);
  const nmax = Math.max(sys, ...valid, 1) > 5 ? 9 : 5;
  const dist = Array.from({ length: nmax }, (_, i) => valid.filter(g => g === i + 1).length);
  const ach = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  rows.forEach(r => { const m = String(r.성취도 || '').trim().toUpperCase().match(/^[A-E]/); if (m) ach[m[0]]++; });
  const pool = groups.filter(x => x.g !== '기타');
  const best = (pool.length ? pool : groups).slice().sort((a, b) => a.w.avg - b.w.avg)[0] || null;
  return { sys, all, band, terms, groups, dist, nmax, ach, best, latest: terms[terms.length - 1] || null, n: rows.length, graded };
}
const CW = () => (window.innerWidth < 600 ? 340 : 520);
const tipAttr = (t, label) => `data-act="ctip" data-tip="${esc(t)}" tabindex="0" role="img" aria-label="${esc(label || t)}"`;
function chartTrend(M) {
  const T = M.terms, sys = M.sys, W = CW(), H = W < 400 ? 230 : 250, L = 40, Rr = 18, Tp = 30, B = 36;
  if (!T.length) return '<p class="muted">학기 정보가 있는 과목이 없어요.</p>';
  const ih = H - Tp - B, iw = W - L - Rr;
  // y축을 내 점수 범위에 맞춘다(1~9 고정이면 2.28~2.67 변화가 평평하게 보임)
  const top = Math.max(sys, ...T.map(t => Math.ceil(t.w.avg)));
  const vs = T.map(t => t.w.avg);
  let ylo = Math.max(1, Math.floor(Math.min(...vs)) - 1), yhi = Math.min(top, Math.ceil(Math.max(...vs)) + 1);
  while (yhi - ylo < 2) { if (ylo > 1) ylo--; else if (yhi < top) yhi++; else break; }
  const y = g => Tp + (g - ylo) / (yhi - ylo) * ih;
  const x = i => T.length === 1 ? L + iw / 2 : L + 20 + i * (iw - 40) / (T.length - 1);
  const step = yhi - ylo <= 4 ? 0.5 : 1, ticks = [];
  for (let v = ylo; v <= yhi + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10);
  const d = T.length > 1 ? T[T.length - 1].w.avg - T[0].w.avg : 0;
  const delta = T.length > 1 ? (Math.abs(d) < 0.005 ? `<text class="axl" x="${W - Rr}" y="${Tp - 14}" text-anchor="end">첫 학기와 같아요</text>`
    : `<text class="dl ${d < 0 ? 'up' : 'down'}" x="${W - Rr}" y="${Tp - 12}" text-anchor="end" aria-label="첫 학기보다 ${fmt(Math.abs(d))}등급 ${d < 0 ? '낮아짐(좋은 쪽)' : '높아짐'}">첫 학기보다 ${d < 0 ? '▲' : '▼'}${fmt(Math.abs(d))}</text>`) : '';
  const pts = T.map((t, i) => [x(i), y(t.w.avg)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${pts[pts.length - 1][0].toFixed(1)} ${Tp + ih} L${pts[0][0].toFixed(1)} ${Tp + ih} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="학기별 평균 등급 추이, 위로 갈수록 좋은 등급">
    <defs><linearGradient id="trL" x1="0" x2="1"><stop offset="0" stop-color="#3EE6CF"/><stop offset="1" stop-color="#A98CFF"/></linearGradient>
    <linearGradient id="trA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3EE6CF" stop-opacity=".35"/><stop offset="1" stop-color="#A98CFF" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(v => `<line class="ax${v % 1 ? ' half' : ''}" x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}"/>${v % 1 ? '' : `<text class="axl" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`}`).join('')}
    <text class="axl" x="${L - 8}" y="${Tp - 14}" text-anchor="end">등급</text>${delta}
    ${T.length > 1 ? `<path d="${area}" fill="url(#trA)"/><path d="${line}" fill="none" stroke="url(#trL)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${T.map((t, i) => { const [px, py] = pts[i]; const tip = `${termName(t.k)} 평균 ${fmt(t.w.avg)}등급 (${t.w.credits}학점)`;
      return `<g><circle cx="${px}" cy="${py}" r="14" fill="transparent" ${tipAttr(tip)}><title>${esc(tip)}</title></circle><circle cx="${px}" cy="${py}" r="6" fill="#0B1035" stroke="#8FF6E6" stroke-width="3" pointer-events="none"/>
      <text class="vl" x="${px}" y="${py - 13}" text-anchor="middle" pointer-events="none">${fmt(t.w.avg)}</text>
      <text class="axl" x="${px}" y="${H - 12}" text-anchor="middle">${esc(t.k)}</text></g>`; }).join('')}
  </svg>`;
}
function chartGroups(M) {
  const G = M.groups, sys = M.sys;
  if (!G.length) return '<p class="muted">등급 있는 과목이 없어요.</p>';
  const W = CW(), rowH = 36, L = 50, Rr = 60, H = G.length * rowH + 8, iw = W - L - Rr;
  const top = Math.max(sys, ...G.map(g => Math.ceil(g.w.avg)));
  return `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="교과군별 평균 등급 막대, 길수록 좋은 등급">
    ${G.map((g, i) => { const y0 = 4 + i * rowH, len = Math.max(6, (top + 1 - g.w.avg) / top * iw); const tip = `${g.g} 평균 ${fmt(g.w.avg)}등급 · 등급 과목 ${g.w.n}개 ${g.w.credits}학점 · 전체 ${g.n}과목`;
      return `<text x="${L - 10}" y="${y0 + 22}" text-anchor="end" style="font-size:14px;font-weight:800">${g.g}</text>
      <rect x="${L}" y="${y0 + 6}" width="${iw}" height="22" rx="11" fill="rgba(255,255,255,.07)"/>
      <rect x="${L}" y="${y0 + 6}" width="${len.toFixed(1)}" height="22" rx="11" fill="${GCOL[g.g]}" ${tipAttr(tip)}><title>${esc(tip)}</title></rect>
      <text class="vl" x="${(L + len + 8).toFixed(1)}" y="${y0 + 22}">${fmt(g.w.avg)}</text>`; }).join('')}
  </svg>`;
}
function chartDist(M) {
  const D = M.dist, total = D.reduce((a, b) => a + b, 0);
  if (!total) return '<p class="muted">등급 있는 과목이 없어요.</p>';
  const W = CW(), H = 220, L = 6, Rr = 14, Tp = 26, B = 34, ih = H - Tp - B, n = D.length, slot = (W - L - Rr) / n, bw = Math.min(40, slot * .62), mx = Math.max(...D);
  const col = i => { const t = n === 1 ? 0 : i / (n - 1); const a = [62, 230, 207], b = [255, 123, 169]; return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',')})`; };
  return `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="등급별 과목 수">
    <line class="ax" x1="${L}" x2="${W - Rr}" y1="${Tp + ih}" y2="${Tp + ih}"/>
    ${D.map((c, i) => { const h = mx ? c / mx * ih : 0, cx = L + slot * i + slot / 2; const tip = `${i + 1}등급 ${c}과목`;
      return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(Tp + ih - Math.max(h, c ? 3 : 0)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, c ? 3 : 0).toFixed(1)}" rx="6" fill="${col(i)}" ${tipAttr(tip)}><title>${tip}</title></rect>
      ${c ? `<text class="vl" x="${cx}" y="${(Tp + ih - h - 7).toFixed(1)}" text-anchor="middle">${c}</text>` : ''}
      <text class="axl" x="${cx}" y="${H - 12}" text-anchor="middle">${i + 1}${W < 400 ? '' : '등급'}</text>`; }).join('')}
  </svg>`;
}
function chartAch(M) {
  const A = M.ach, keys = Object.keys(A), total = keys.reduce((s, k) => s + A[k], 0);
  if (!total) return '<p class="muted">성취도(A~E)가 적힌 과목이 없어요.</p>';
  const r = 54, C = 2 * Math.PI * r; let off = 0;
  const nk = keys.filter(k => A[k]).length;
  const segs = keys.filter(k => A[k]).map(k => { const len = A[k] / total * C; const tip = `성취도 ${k} ${A[k]}과목 (${Math.round(A[k] / total * 100)}%)`;
    const vis = nk > 1 && len > 4 ? len - 2.5 : len; // 조각 사이 틈
    const s = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${ACOL[k]}" stroke-width="24" stroke-dasharray="${vis.toFixed(2)} ${(C - vis).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 80 80)" ${tipAttr(tip)}><title>${tip}</title></circle>`;
    off += len; return s; }).join('');
  return `<div class="donutwrap"><svg viewBox="0 0 160 160" role="group" aria-label="성취도 분포"><circle cx="80" cy="80" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="24"/>${segs}
    <text x="80" y="78" text-anchor="middle" style="font-size:26px;font-weight:800;fill:#fff">${total}</text><text x="80" y="98" text-anchor="middle" class="axl">과목</text></svg>
    <div class="dleg">${keys.map(k => `<span${A[k] ? '' : ' class="zero"'}><i style="background:${ACOL[k]}"></i><b>${k}</b> ${A[k]}과목 <span class="tiny">${Math.round(A[k] / total * 100)}%</span></span>`).join('')}</div></div>`;
}
function gradeVizHTML() {
  const M = gradeModel(), R = S.rec;
  if (!M.n) return '';
  const ck = R.chart || 'trend';
  const C = [['trend', '학기별 평균 추이', '위로 갈수록 좋은 등급', chartTrend], ['group', '교과군별 평균', '길수록 좋은 등급', chartGroups], ['dist', '등급 분포', '과목 수', chartDist], ['ach', '성취도 분포', 'A~E', chartAch]];
  return `<div class="stats">
    <div class="stat mint"><span>전체 평균</span><b>${M.all ? fmt(M.all.avg) : '-'}<small> 등급</small></b><span class="tiny">${M.all ? `등급 과목 ${M.graded} · 전체 ${M.n} · ${M.all.credits}학점 가중` : '등급 있는 과목이 없어요'}</span></div>
    <div class="stat vio"><span>최근 학기${M.latest ? ' ' + esc(M.latest.k) : ''}</span><b>${M.latest ? fmt(M.latest.w.avg) : '-'}<small> 등급</small></b><span class="tiny">${M.terms.length > 1 ? `첫 학기 ${fmt(M.terms[0].w.avg)} → 지금` : '학기가 하나예요'}</span></div>
    <div class="stat sun"><span>가장 좋은 교과군</span><b>${M.best ? esc(M.best.g) : '-'}</b><span class="tiny">${M.best ? `평균 ${fmt(M.best.w.avg)}등급` : ''}</span></div>
    ${M.band ? `<div class="stat apri"><span>5등급 참고</span><b>${fmt(M.band.lo)}~${fmt(M.band.hi)}</b><span class="tiny">공식 환산 아님</span></div>` : ''}
  </div>
  <div class="ctabs" role="group" aria-label="그래프 고르기">${C.map(([k, t]) => `<button class="tab mint ${ck === k ? 'on' : ''}" data-act="cTab" data-k="${k}" aria-pressed="${ck === k}">${t.replace('학기별 ', '').replace(' 평균', '')}</button>`).join('')}</div>
  <div class="charts">${C.map(([k, t, sub, fn]) => `<div class="chart ${ck === k ? 'on' : ''}" data-c="${k}"><h3>${t} <span class="tiny">${sub}</span></h3>${fn(M)}<p class="ctip" aria-live="polite"></p></div>`).join('')}</div>`;
}
ACT.ctip = el => { const c = el.closest('.chart'); const t = c && c.querySelector('.ctip'); if (t) t.textContent = el.getAttribute('data-tip'); };
document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('.chart [data-tip]'); if (el) ACT.ctip(el); });
document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('.chart [data-tip]'); if (el) ACT.ctip(el); });
ACT.cTab = el => { S.rec.chart = el.dataset.k; $$('.ctabs .tab').forEach(b => { const on = b.dataset.k === el.dataset.k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); $$('.charts .chart').forEach(c => c.classList.toggle('on', c.dataset.c === el.dataset.k)); };
function recGrade() {
  const R = S.rec, sys = R.system || sysOf(S.profile.curr);
  const rows = R.grades.map((r, i) => `<tr>
    <td><input aria-label="${i + 1}행 학년" data-in="g" data-i="${i}" data-k="학년" value="${esc(r.학년)}" size="2"></td>
    <td><input aria-label="${i + 1}행 학기" data-in="g" data-i="${i}" data-k="학기" value="${esc(r.학기)}" size="2"></td>
    <td><input aria-label="${i + 1}행 과목" data-in="g" data-i="${i}" data-k="과목" value="${esc(r.과목)}" size="12"></td>
    <td><input aria-label="${i + 1}행 학점" data-in="g" data-i="${i}" data-k="학점" value="${esc(r.학점)}" size="2" inputmode="numeric"></td>
    <td><input aria-label="${i + 1}행 등급" data-in="g" data-i="${i}" data-k="등급" value="${esc(r.등급)}" size="2" inputmode="numeric"></td>
    <td><input aria-label="${i + 1}행 성취도" data-in="g" data-i="${i}" data-k="성취도" value="${esc(r.성취도)}" size="2"></td>
    <td><button class="btn danger small" data-act="gDel" data-i="${i}" aria-label="${i + 1}행 지우기">${ic('close')}</button></td></tr>`).join('');
  return `<section class="panel mint"><div class="row"><h2 style="margin:0">${ic('chart')} 내 성적 한눈에</h2><span class="spacer"></span>
    <div class="seg" style="min-width:220px" role="group" aria-label="등급제">
      <button data-act="gSys" data-v="9" aria-pressed="${sys === 9}">9등급제</button><button data-act="gSys" data-v="5" aria-pressed="${sys === 5}">5등급제</button></div></div>
    ${R.sysAuto ? `<div class="note">${esc(R.sysWhy)}. 그래서 ${sys}등급제로 계산했어요. <button class="btn small white" data-act="profile">내 정보 확인</button></div>` : ''}
    <div id="gviz">${gradeVizHTML()}</div>
    ${R.grades.length ? '' : '<div class="note">성적표를 자동으로 못 읽었어요. 아래에서 직접 넣을 수 있어요.</div>'}
    <details class="fold mint" data-fold="gtable"${fo('gtable', !R.grades.length)}><summary><span class="sumt"><b>${ic('pen')} 성적표 확인·고치기</b><span class="pv">${R.grades.length}과목 · 고치면 그래프가 바로 바뀌어요</span></span></summary><div class="fb">
    <div class="tbl-wrap"><table><thead><tr><th>학년</th><th>학기</th><th>과목</th><th>학점</th><th>등급</th><th>성취도</th><th><span class="tiny">지우기</span></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="row" style="margin-top:10px"><button class="btn white small" data-act="gAdd">${ic('plus')} 과목 추가</button><span class="tiny">진로선택처럼 등급 없는 과목은 평균에서 빠져요.</span></div></div></details>
  </section>`;
}
IN.g = el => { const r = S.rec.grades[+el.dataset.i]; if (!r) return; r[el.dataset.k] = el.value.trim(); const v = $('#gviz'); if (v) v.innerHTML = gradeVizHTML(); };
ACT.gDel = el => { S.rec.grades.splice(+el.dataset.i, 1); FOLD.gtable = true; render(); };
ACT.gAdd = () => { S.rec.grades.push({ 학년: '', 학기: '', 교과: '', 과목: '', 학점: '', 등급: '', 성취도: '' }); FOLD.gtable = true; render(); setTimeout(() => { const ins = $$('input[data-k=과목]'); ins.length && ins[ins.length - 1].focus(); }, 0); };
ACT.gSys = el => { S.rec.system = +el.dataset.v; S.rec.sysAuto = false; render(); };

/* 기록 근거: 역량 3개 탭 → 세부항목 접힌 카드 */
function recEvidence() {
  const R = S.rec, ev = R.evidence || {};
  const comps = Object.entries(COMP_ITEMS), COL = ['mint', 'apri', 'vio'];
  const tab = comps.some(c => c[0] === R.evTab) ? R.evTab : comps[0][0];
  const ci = comps.findIndex(c => c[0] === tab);
  const total = list => list.reduce((s, k) => s + (ev[k] || []).length, 0);
  const areaCount = ['세특', '자율', '동아리', '진로', '봉사', '행특'].map(a => { const n = R.items.filter(i => i.영역 === a).length; return n ? `${AREA_NAME[a].replace('활동', '')} ${n}` : ''; }).filter(Boolean).join(' · ');
  const flow = R.evTab === '흐름';
  const tabs = comps.map(([c, list], i) => `<button class="tab ${COL[i]} ${c === tab && !flow ? 'on' : ''}" data-act="evTab" data-k="${esc(c)}" aria-pressed="${c === tab && !flow}">${esc(c.replace('역량', ''))} <span class="n">${total(list)}</span></button>`).join('') + `<button class="tab vio ${flow ? 'on' : ''}" data-act="evTab" data-k="흐름" aria-pressed="${flow}">탐구 흐름</button>`;
  const cards = comps[ci][1].map(k => {
    const arr = ev[k] || [], key = 'ev|' + k;
    // 학업성취도는 문장보다 성적표가 먼저다
    let gl = '';
    if (k === '학업성취도') { const all = wavg(R.grades); const terms = [...new Set(R.grades.map(g => g.학년 + '-' + g.학기))].sort().map(t => [t, wavg(R.grades.filter(g => g.학년 + '-' + g.학기 === t))]).filter(x => x[1]);
      gl = all ? `<div class="note" style="margin:0 0 8px">성적표: 평균 <b>${fmt(all.avg)}등급</b>${terms.length > 1 ? ` · 학기별 ${terms.map(x => fmt(x[1].avg)).join(' → ')}` : ''} · 성취도 A ${R.grades.filter(g => /^A/.test(g.성취도 || '')).length}과목 <button class="btn small white" data-act="recTab" data-k="grade">성적 탭</button></div>` : ''; }
    const body = arr.length ? arr.slice(0, 5).map(evHTML).join('') + (arr.length > 5 ? `<details><summary>문장 더 보기 (${Math.min(arr.length, 15) - 5})</summary>${arr.slice(5, 15).map(evHTML).join('')}</details>` : '')
      : '<p class="muted" style="margin:0">이 항목 문장은 못 찾았어요. 표현이 달라서일 수 있어요.</p>';
    return `<details class="fold" data-fold="${esc(key)}"${fo(key)}><summary><span class="sumt"><b>${esc(k)}</b><span class="pv">${arr.length ? esc(arr[0].sent) : k === '학업성취도' && gl ? '성적표로 확인' : '찾은 문장 없음'}</span></span><span class="cnt ${arr.length ? '' : 'zero'}">${arr.length}문장</span></summary><div class="fb">${gl}${body}</div></details>`;
  }).join('');
  return `<section class="panel mint"><h2>${ic('search')} 기록 근거</h2><p class="one">평가 항목별로 내 학생부 문장을 모았어요. 점수는 매기지 않아요.</p>
    <div class="row" style="margin-bottom:6px">${areaCount ? `<span class="statline">찾은 기록: ${esc(areaCount)}</span>` : '<span class="badge rose">영역을 못 나눴어요</span>'}<span class="spacer"></span>${ORIG ? `<button class="btn small white" data-act="origShow" data-s="">${ic('eye')} 원본 PDF 펼치기</button>` : ''}</div>
    <div class="tabs seg2" role="group" aria-label="역량 고르기" style="margin-top:10px">${tabs}</div>
    ${flow ? '</section>' + chainHTML() + '<section hidden>' : `<div class="comp c${ci + 1}">${cards}</div>`}
    ${(R.majorWords || []).length && ci === 1 ? `<p class="tiny">전공(계열) 항목은 희망 분야 낱말 <b>${esc(R.majorWords.join(', '))}</b>이 나오는 세특 문장으로 찾았어요. 성취도 항목은 그중 성취도 A·상위 등급 과목만이에요.</p>` : ''}</section>`;
}
ACT.evTab = el => { S.rec.evTab = el.dataset.k; render(); };
function evHTML(e) {
  const where = [e.학년 ? e.학년 + '학년' : '', AREA_NAME[e.영역] || e.영역, e.과목].filter(Boolean).join(' · ');
  return `<div class="ev"><span class="where">${esc(where)}<button class="origbtn" data-act="origShow" data-s="${esc(e.sent)}">${ic('eye')}${ORIG ? '원본 PDF에서 보기' : '원문에서 보기'}</button></span>${hlSent(e.sent, e.kws)}</div>`;
}

/* 스스로 점검: 학생이 먼저 쓰고, 그다음 내 기록 근거를 본다 */
async function fillCheck() {
  const box = $('#checkBox'); if (!box) return;
  const cp = await ds('체크포인트');
  const opts = uniOptions(cp.map(r => r.대학));
  if (!S.check.univ) { const c = S.cands.find(c => opts.some(o => sameUni(o.label, c.univ))); if (c) S.check.univ = opts.find(o => sameUni(o.label, c.univ)).label; }
  const u = S.check.univ, uo = u ? pickOpt(opts, u) : null;
  const rows = uo ? cp.filter(r => uniCanon(r.대학) === uo.k) : [];
  const groups = {}; rows.forEach(r => { const k = r.세부항목; (groups[k] = groups[k] || []).push(r); });
  let cards = '';
  Object.entries(COMP_ITEMS).forEach(([comp, list], ci) => {
    let part = '', nq = 0;
    list.forEach(item => {
      const qs = (groups[item] || []).slice(0, 2);
      qs.forEach((r, qi) => {
        const id = u + '|' + item + '|' + qi, ans = S.check.answers[id] || '', shown = S.check.shown[id];
        const ev = (S.rec.evidence || {})[item] || [];
        nq++;
        part += `<div class="qcard"><div class="row"><span class="badge">${esc(item)}</span></div>
          <p class="q">${esc(r.체크포인트)}</p>
          <label class="f" for="ck${esc(id)}" style="margin-top:4px">내 생각 먼저</label>
          <textarea id="ck${esc(id)}" data-in="ckAns" data-id="${esc(id)}" placeholder="내 활동으로 짧게 답해 보세요.">${esc(ans)}</textarea>
          <div class="row" style="margin-top:8px"><button class="btn small vio" data-act="ckShow" data-id="${esc(id)}" ${ans.trim().length >= 10 ? '' : 'disabled'}>${ic('eye')} 내 기록 근거 보기</button><span class="tiny left" data-left>${ckLeft(ans)}</span></div>
          ${shown ? `<div style="margin-top:8px">${ev.length ? ev.slice(0, 3).map(evHTML).join('') : '<p class="muted">이 항목 문장은 못 찾았어요.</p>'}</div>` : ''}</div>`;
      });
    });
    if (nq) cards += `<details class="fold vio" data-fold="ck|${esc(comp)}"${fo('ck|' + comp, ci === 0)}><summary><span class="sumt"><b>${esc(comp)}</b><span class="pv">${list.map(esc).join(' · ')}</span></span><span class="cnt">${nq}문항</span></summary><div class="fb">${part}</div></details>`;
  });
  box.innerHTML = `<section class="panel vio"><h2>${ic('pen')} 스스로 점검</h2><p class="one">대학이 밝힌 체크포인트예요. 답을 먼저 써야 근거가 열려요.</p>
    <label class="f" for="ckUniv">대학 찾기 <span class="tiny">${opts.length}곳</span></label>
    <input id="ckUniv" type="search" list="ckUList" data-in="ckUniv" value="${esc(uo ? uo.label : '')}" placeholder="대학 이름 입력 (예: 부산대)" autocomplete="off"><datalist id="ckUList">${opts.map(o => `<option value="${esc(o.label)}">`).join('')}</datalist>
    ${uo ? (cards || '<p class="muted">이 대학 체크포인트가 없어요.</p>') : '<div class="empty"><strong>대학을 고르면 질문이 나와요</strong></div>'}</section>`;
}
function ckLeft(a) { const n = 10 - String(a || '').trim().length; return n > 0 ? `${n}자 더 쓰면 열려요` : '열렸어요'; }
IN.ckUniv = el => { const v = el.value.trim(); if (v && !(cpOpts() || []).some(o => nsp(o.label) === nsp(v))) return; S.check.univ = v; fillCheck(); };
const cpOpts = () => DS['체크포인트'] ? uniOptions(DS['체크포인트'].map(r => r.대학)) : null;
IN.ckAns = el => { S.check.answers[el.dataset.id] = el.value; const row = el.nextElementSibling, b = row && row.querySelector('[data-act=ckShow]'); if (b) b.disabled = el.value.trim().length < 10; const l = row && row.querySelector('[data-left]'); if (l) l.textContent = ckLeft(el.value); };
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
  const F = S.rec.fit, opts = uniOptions(units.map(u => u.univ));
  const uo = F.univ ? pickOpt(opts, F.univ) : null;
  const unitList = uo ? units.filter(u => uniCanon(u.univ) === uo.k).filter((u, i, a) => a.findIndex(x => x.unit === u.unit) === i) : [];
  let target = null, source = '';
  if (uo && F.unit) { target = unitList.find(u => u.unit === F.unit); source = uo.label + ' 발표 자료'; }
  else if (F.dept) { const d = dict.find(x => x.학과명 === F.dept); if (d) { target = { core: [], rec: [...splitSubjects(d.일반선택), ...splitSubjects(d.진로선택), ...splitSubjects(d.융합선택)], note: '' }; source = '학과사전(학과 일반 기준)'; } }
  const { taken, gy } = takenSets();
  const later = S.profile.grade === '고1' || S.profile.grade === '고2';
  const chip = s => { const st = subjStatus(s, taken, gy); if (!st) return ''; const lab = st === 'ok' ? '들었어요' : st === 'chk' ? '확인 필요' : '아직 안 보여요'; return `<span class="sub ${st}" title="${lab}">${esc(s)} <span class="tiny">· ${lab}</span></span>`; };
  let res = '';
  if (target) {
    res = `<h3>${esc(source)}</h3>
      <div class="legend" aria-label="색 뜻"><span class="ok">들었어요</span><span class="no">아직 안 보여요</span><span class="chk" title="이름이 비슷하거나 교육과정이 달라요">확인 필요</span></div>
      ${target.core.length ? `<p><b>핵심 권장</b></p><div class="subs">${target.core.map(chip).join('')}</div>` : ''}
      ${target.rec.length ? `<p><b>권장</b></p><div class="subs">${target.rec.map(chip).join('')}</div>` : ''}
      ${!target.core.length && !target.rec.length ? `<p class="note">${esc(target.note || '과목 이름을 따로 밝히지 않았어요.')}</p>` : ''}
      <details class="fold" data-fold="fitnote"${fo('fitnote')}><summary><span class="sumt"><b>알아두면 좋아요</b><span class="pv">개설 안 된 과목·교육과정 차이</span></span></summary><div class="fb">
      <p class="note">학교에 개설되지 않은 과목일 수 있어요. 공동교육과정·온라인학교도 확인해 보세요.${later ? ' 앞으로 들을 수 있는 과목도 있어요.' : ''}</p>
      ${S.rec.system === 9 || S.profile.curr === '2015' ? '<p class="tiny">자료 대부분이 2022 개정 과목 이름이라, 2015 개정 과목은 \'확인 필요\'로 보일 수 있어요.</p>' : ''}</div></details>`;
  }
  box.innerHTML = `<section class="panel mint"><h2>${ic('book')} 권장과목 비교</h2><p class="one">희망 대학·모집단위를 고르면 내 이수 과목과 나란히 보여요.</p>
    <div class="grid2"><div><label class="f" for="fitU">대학 <span class="tiny">${opts.length}곳</span></label><input id="fitU" type="search" list="fitUList" data-in="fitU" value="${esc(uo ? uo.label : '')}" placeholder="대학 이름 입력" autocomplete="off"><datalist id="fitUList">${opts.map(o => `<option value="${esc(o.label)}">`).join('')}</datalist></div>
    <div><label class="f" for="fitN">모집단위</label><select id="fitN" data-in="fitN" ${uo ? '' : 'disabled'}><option value="">${uo ? `모집단위 (${unitList.length})` : '대학을 먼저 찾아 주세요'}</option>${unitList.map(x => `<option value="${esc(x.unit)}" ${x.unit === F.unit ? 'selected' : ''}>${esc(dispName(x.unit))}</option>`).join('')}</select></div></div>
    <label class="f" for="fitD">또는 학과 일반 기준 <span class="tiny">학과사전 ${dict.length}개</span></label>
    <input id="fitD" type="search" list="fitDList" data-in="fitD" value="${esc(F.dept || '')}" placeholder="학과 이름 입력 (예: 간호학과)" autocomplete="off"><datalist id="fitDList">${[...new Set(dict.map(d => d.학과명))].map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    ${res || '<div class="empty"><strong>대학·모집단위나 학과를 골라 주세요</strong></div>'}</section>`;
}
// 검색칸은 목록의 이름과 정확히 같아질 때(또는 비웠을 때)만 반영한다
IN.fitU = el => { const v = el.value.trim(); if (v && !$$('#fitUList option').some(o => nsp(o.value) === nsp(v))) return; S.rec.fit = { univ: v, unit: '', dept: '' }; fillFit(); };
IN.fitN = el => { S.rec.fit.unit = el.value; S.rec.fit.dept = ''; fillFit(); };
IN.fitD = el => { const v = el.value.trim(); if (v && !$$('#fitDList option').some(o => o.value === v)) return; S.rec.fit = { univ: '', unit: '', dept: v }; fillFit(); };

/* 단계 이동 */
ACT.recStep = el => { S.rec.step = +el.dataset.n; render(); };
ACT.recTab = el => { S.rec.tab = el.dataset.k; render(); };
IN.raw = el => { S.rec.raw = el.value; S.rec.demo = false; };
/* 올리면 바로 결과로: 가리기는 자동 적용(학생부는 기기 안에서만 처리), 확인은 선택 */
function runRecord(msg) {
  const R = S.rec; const m = maskText(R.raw, R.extra); R.masked = m.text; R.hits = m.hits; R.confirmed = true;
  analyzeRecord(); R.step = 3; R.tab = R.tab || 'grade'; render(); toast(msg || '다 읽었어요.');
}
ACT.toMask = () => {
  const R = S.rec; const t = ($('#rawText') || {}).value ?? R.raw;
  if (t.replace(/\s/g, '').length < 30) { toast('학생부 내용을 먼저 넣어 주세요.'); return; }
  R.raw = t; R.tab = 'grade'; runRecord();
};
IN.maskExtra = el => { S.rec.extra = el.value; };
ACT.remask = () => { const R = S.rec; const m = maskText(R.raw, R.extra); R.masked = m.text; R.hits = m.hits; R.confirmed = true; analyzeRecord(); render(); toast('다시 가렸어요.'); };
IN.maskOk = () => {};
ACT.analyze = () => { const R = S.rec; if (!R.analyzed) analyzeRecord(); R.confirmed = true; R.step = 3; R.tab = R.tab || 'grade'; render(); };

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
    S.rec.tab = 'grade'; runRecord(`${r.pages}쪽을 다 읽었어요.`);
  } catch (e) {
    st.innerHTML = '<span class="badge rose">못 읽었어요</span> ' + esc(e && e.message ? e.message : String(e)) + ' 글자를 붙여넣어도 돼요.';
  }
};

/* AI 분석 프롬프트: 앱은 AI를 부르지 않는다. 가린 글만 담아 학생이 직접 붙여 넣게 한다 */
ACT.aiPrompt = async () => {
  const R = S.rec; if (!R.analyzed) return;
  await need(['루브릭', '체크포인트']);
  const uni = (S.cands[0] && uniBase(S.cands[0].univ)) || '';
  const rub = DS['루브릭'].map(r => `- ${r.역량} > ${r.세부항목}: ${r.표준정의}`).join('\n');
  const cps = uni ? DS['체크포인트'].filter(r => sameUni(r.대학, uni)).slice(0, 14).map(r => `- [${r.세부항목}] ${r.체크포인트}`).join('\n') : '';
  const w = wavg(R.grades); const C = R.chain || analyzeChain(R.items || []), inc = R.incomplete || findIncomplete(R.items || []);
  const ev = Object.entries(R.evidence || {}).map(([k, v]) => `${k} ${v.length}문장`).join(', ');
  const p = `너는 고등학교 진로진학 상담을 돕는 조력자야. 아래 학생부(개인정보는 [이름]처럼 가려져 있음)를 읽고 학생 스스로 생각하게 돕는 피드백을 줘.

규칙
1. 학생부에 실제로 있는 문장만 근거로 써. 근거마다 원문 문장을 짧게 따옴표로 인용해.
2. 없는 활동·수상·성적을 지어내지 마. 모르면 "기록에서 확인 안 됨"이라고 써.
3. 점수, 등급, 합격 가능성은 말하지 마.
4. 정답을 먼저 주지 말고, 학생이 스스로 답해 볼 질문을 항목마다 1~2개 줘.

할 일
1. 아래 평가 항목별로 강점 1~2개와 근거 문장
2. 기록이 더 있으면 좋을 점 (부정적 단정 없이 "이렇게 이어 가면 좋겠다"로)
3. 학년을 이어 온 주제가 실제로 깊어졌는지, 다음 학기에 이어 볼 탐구 2개
4. 면접에서 나올 만한 질문 5개

평가 항목 (학생부종합 공통 기준)
${rub}
${cps ? `\n${uni} 체크포인트 (일부)\n${cps}\n` : ''}
앱이 미리 센 것 (참고)
- 교육과정 ${R.system === 5 ? '2022 개정(5등급제)' : '2015 개정(9등급제)'}${w ? `, 등급 과목 학점 가중 평균 ${fmt(w.avg)}` : ''}
- 희망 분야 낱말: ${(typeof ipgWords === 'function' ? ipgWords() : (R.majorWords || [])).join(', ') || '없음'}${S.cands.length ? `\n- 담은 후보: ${S.cands.map(c => uniBase(c.univ) + ' ' + c.unit + '(' + c.전형 + ')').join(', ')}` : ''}
- 항목별 찾은 문장 수: ${ev}
- 학년을 이어 온 주제: ${C.지속.join(', ') || '없음'} / 새 주제: ${C.신규.slice(0, 8).join(', ') || '없음'}
- 계획으로 끝난 문장: ${inc.length}곳

학생부 (가린 글)
"""
${String(R.masked || '').slice(0, 60000)}
"""`;
  copyText(p);
};
/* ---- 04-major.js ---- */
/* ===== ② 학과·전형 찾기 ===== */
const MJ_DATA = ['학과사전', '모집2028', '최저2028', '면접기준', '전형결과', '공식입결', '2028출처', '수시2028C', '어디가입결'];
let MOJIP_IDX = null;
function mojipIndex() {
  if (MOJIP_IDX) return MOJIP_IDX;
  const byKey = new Map(), byName = new Map();
  DS['모집2028'].forEach(r => { if (!byKey.has(r.모집단위키)) byKey.set(r.모집단위키, []); byKey.get(r.모집단위키).push(r);
    // 모집단위키가 이상한 행(조형학부(건축학전공<5년>)→'조형', '건축공학과<4년>')도 모집단위 이름으로 찾게
    rowKeys(r).forEach(k => { if (k === r.모집단위키) return; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(r); }); });
  return (MOJIP_IDX = { byKey, byName });
}
const isRural = s => /농어촌|농어업/.test(s || '');
const myGrade = () => { const w = S.rec.analyzed ? wavg(S.rec.grades) : null; return w ? { avg: w.avg, sys: S.rec.system || sysOf(S.profile.curr) } : null; };

function viewMajor() {
  const M = S.mj;
  if (M.view === 'univ' && M.univ) return vhead('apri', esc(M.univ), esc(M.deptName || ''), 'major') + '<div id="mjBox">불러오는 중…</div>';
  if (M.view === 'dept' && M.dept) return vhead('apri', esc(M.deptName), '학과 → 대학 고르기', 'major') + '<div id="mjBox">불러오는 중…</div>';
  return vhead('apri', '학과·전형 찾기', '궁금한 학과를 찾아보세요.') + `<section class="panel apri">
    <label class="f" for="mjQ">학과 이름이나 관심 낱말</label>
    <input id="mjQ" type="search" data-in="mjQ" value="${esc(M.q)}" placeholder="예: 간호 / 연대 경영 / 의대 부산 / ㄱㅊㄷ 간호" autocomplete="off">
    <div id="mjChips" class="row" style="margin-top:10px"></div>
    <div class="row jump" style="margin-top:12px"><button class="btn vio" data-act="go" data-to="jeongsi">${ic('chart')} 정시 탐색</button><button class="btn sun" data-act="go" data-to="xuni">${ic('star')} 과학기술원·특수대학</button></div></section><div id="mjBox"></div>`;
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
  const items = [
    ...hits.map(h => { const k = deptKey(h.d.학과명), n = cnt(k); return `<button class="li" data-act="mjDept" data-name="${esc(h.d.학과명)}"><div><div class="t">${esc(h.d.학과명)}</div><div class="s">${esc(h.d.계열)} · ${esc((h.d['관련 직업'] || '').split(',').slice(0, 3).join(', '))}</div></div><div class="r">${n ? `<span class="badge apri">2028 모집 ${n}개 대학</span>` : '<span class="badge">모집 자료 이름 다름</span>'}</div></button>`; }),
    ...extraKeys.map(k => `<button class="li" data-act="mjKey" data-key="${esc(k)}"><div><div class="t">${esc((idx.byKey.get(k)[0] || {}).모집단위 || k)}</div><div class="s">모집단위 이름으로 찾음</div></div><div class="r"><span class="badge apri">${cnt(k)}개 대학</span></div></button>`)];
  const lim = S.mj.more ? items.length : 12;
  // 대학·모집단위 바로 찾기: "연대 경영", "의대 부산", "ㄱㅊㄷ 간호" (띄어쓰기 AND·초성·약칭)
  const terms = smartTerms(S.mj.q), smart = terms.length >= 2 || terms.some(t => t.cho || t.rx || ALIAS[t.t]);
  let uHTML = '';
  if (smart && DS['수시2028C']) {
    if (!cafeIdx.hay) cafeIdx.hay = DS['수시2028C'].map(x => [x.대학명, x.단과대학, x.모집단위, x.전형명, x.광역 || x.지역, x.지역].join(' '));
    const g = new Map();
    DS['수시2028C'].forEach((x, i) => { if (!smartHit(terms, cafeIdx.hay[i])) return; const k = uniBase(x.대학명) + '|' + x.모집단위; if (!g.has(k)) g.set(k, { u: uniBase(x.대학명), n: x.모집단위, tr: new Set(), c: 0 }); const o = g.get(k); o.tr.add(x._유형 || x.전형유형); o.c += +x.모집인원 || 0; });
    const arr = [...g.values()].slice(0, 30);
    uHTML = arr.length ? `<section class="panel apri"><h2>${ic('compass')} 대학·모집단위 바로 찾기 <span class="badge apri">${g.size}</span></h2><p class="tiny">띄어쓰기는 모두 포함, 초성(ㄱㅊㄷ)과 약칭(연대·의대·교대)도 돼요.</p><div class="list two">${arr.map(o => `<button class="li" data-act="ipgOpen" data-tab="plan" data-u="${esc(o.u)}" data-n="${esc(o.n)}"><div><div class="t">${esc(o.u)} ${esc(o.n.length > 40 ? o.n.slice(0, 40) + '…' : o.n)}</div><div class="s">${esc([...o.tr].filter(Boolean).join(' · '))} · ${o.c}명</div></div></button>`).join('')}</div>${g.size > 30 ? `<p class="tiny">위 30개만 보여요. 낱말을 더 넣어 좁혀 보세요.</p>` : ''}</section>` : '';
  }
  box.innerHTML = uHTML + `<section class="panel apri"><h2>${ic('search')} 찾은 학과 <span class="badge apri">${items.length}</span></h2><div class="list two">
    ${items.slice(0, lim).join('')}
    ${!items.length ? '<div class="empty"><strong>못 찾았어요</strong>더 짧은 낱말로 찾아보세요.</div>' : ''}</div>
    ${items.length > lim ? `<div class="more"><button class="btn white" data-act="mjMore">${ic('plus')} 더 보기 (${items.length - lim})</button></div>` : ''}</section>`;
}
IN.mjQ = el => { S.mj.q = el.value; S.mj.more = false; mjResults(); };
ACT.mjSet = el => { S.mj.q = el.dataset.q; S.mj.more = false; const i = $('#mjQ'); if (i) i.value = S.mj.q; mjResults(); };
ACT.mjMore = () => { S.mj.more = true; mjResults(); };
ACT.mjUMore = () => { S.mj.umore = true; fillDept(); };
ACT.mjDept = el => { const n = el.dataset.name; Object.assign(S.mj, { dept: n, deptName: n, keys: [deptKey(n)], view: 'dept', univ: null, uq: '', umore: false }); go('major'); };
ACT.mjKey = el => { const k = el.dataset.key; const r = (mojipIndex().byKey.get(k) || [])[0]; Object.assign(S.mj, { dept: '#' + k, deptName: r ? r.모집단위 : k, keys: [k], view: 'dept', univ: null, uq: '', umore: false }); go('major'); };

function unitRows() {
  const idx = mojipIndex(); let rows = [];
  S.mj.keys.forEach(k => rows.push(...(idx.byKey.get(k) || [])));
  const seen = new Set(rows);
  S.mj.keys.forEach(k => (idx.byName.get(k) || []).forEach(r => { if (!seen.has(r)) { seen.add(r); rows.push(r); } }));
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
  const ov = d ? String(d['학과 개요'] || '') : '', ov1 = (ov.split(/(?<=[.。])\s/)[0] || ov).slice(0, 80);
  const sub = (k, t, html) => `<details class="fold" data-fold="dp|${esc(M.dept)}|${k}"${fo('dp|' + M.dept + '|' + k)}><summary><span class="sumt"><b>${t}</b></span></summary><div class="fb">${html}</div></details>`;
  // 학과 소개는 접기 하나로 묶고, 대학 목록을 먼저 보여 준다
  const intro = d ? `<details class="fold apri" data-fold="dp|${esc(M.dept)}"${fo('dp|' + M.dept)}><summary><span class="sumt"><b>${esc(d.학과명)} 알아보기 <span class="badge apri">${esc(d.계열)}</span></b><span class="pv">${esc(ov1)}${ov1.length < ov.length ? '…' : ''}</span></span></summary><div class="fb">
      <p style="margin-top:0">${esc(ov.slice(0, 220))}${ov.length > 220 ? '…' : ''}</p>
      ${sub('fit', '이런 학생에게 맞아요', `<p style="margin:0">${esc(d['적성과 흥미'] || '자료 없음')}</p>`)}
      ${sub('job', '관련 직업', `<div class="subs">${(d['관련 직업'] || '').split(',').map(s => s.trim()).filter(Boolean).map(s => `<span class="sub plain">${esc(s)}</span>`).join('') || '<span class="muted">자료 없음</span>'}</div>`)}
      ${sub('subj', '고교에서 들으면 좋은 과목', subj || '<p class="muted">자료 없음</p>')}
      ${sub('act', '고교 활동 예시', `<p style="margin:0">${esc(d['고교 활동'] || '자료 없음')}</p>`)}
      <div class="row"><button class="btn small white" data-act="fitFromDept" data-name="${esc(d.학과명)}">내 학생부와 과목 비교</button></div></div></details>` : '';
  box.innerHTML = `
    <section class="panel sun">${intro}<h2>이 학과를 뽑는 대학 ${univs.length}곳 <span class="badge sun">2028 시행계획 기준(잠정)</span></h2>
      <div class="row"><input type="search" aria-label="대학 이름으로 거르기" placeholder="대학 이름으로 거르기" value="${esc(M.uq)}" data-in="mjUq" style="flex:1;min-width:180px">
      <label class="toggle"><input type="checkbox" data-in="mjBu" ${M.bu ? 'checked' : ''}><span class="sw"></span>부울경만</label>
      <label class="toggle"><input type="checkbox" data-in="mjRural" ${S.profile.rural ? 'checked' : ''}><span class="sw"></span>농어촌 강조</label></div>
      <div class="list two" style="margin-top:10px">${univs.slice(0, M.umore || uq ? 200 : 12).map(x => `<button class="li" data-act="mjUniv" data-u="${esc(x.u)}"><div><div class="t">${esc(x.u)}</div><div class="s">${esc([...new Set(x.rs.map(r => r.모집단위))].slice(0, 3).join(', '))} · 전형 ${x.rs.length}개 · ${x.n}명</div></div>
        <div class="r">${x.buk ? '<span class="badge mint">부울경</span>' : ''}${x.rural ? `<span class="badge ${S.profile.rural ? 'sun' : ''}">농어촌 전형</span>` : ''}</div></button>`).join('') || '<div class="empty"><strong>모집 자료에서 못 찾았어요</strong>학과 이름이 대학마다 달라요. 검색에서 낱말을 바꿔 보세요.</div>'}</div>
      ${!M.umore && !uq && univs.length > 12 ? `<div class="more"><button class="btn white" data-act="mjUMore">${ic('plus')} 대학 더 보기 (${Math.min(univs.length, 200) - 12})</button></div>` : ''}</section>`;
}
IN.mjUq = el => { S.mj.uq = el.value; clearTimeout(IN._uqT); IN._uqT = setTimeout(() => { fillDept(); const i = $('[data-in=mjUq]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); };
IN.mjBu = el => { S.mj.bu = el.checked; fillDept(); };
IN.mjRural = el => { S.profile.rural = el.checked; saveProfile(); renderTop(); S.mj.view === 'univ' ? fillUniv() : fillDept(); };
ACT.mjUniv = el => { S.mj.univ = el.dataset.u; S.mj.view = 'univ'; S.mj.utab = 'plan'; go('major'); };
ACT.mjUTab = el => { S.mj.utab = el.dataset.k; fillUniv(); };
ACT.fitFromDept = el => { S.rec.fit = { univ: '', unit: '', dept: el.dataset.name }; if (S.rec.analyzed) { S.rec.step = 3; S.rec.tab = 'fit'; } go('record'); };

/* 수능최저·면접 찾기 */
/* 대상 문구에서 'X 제외', 'X 외 모든 모집단위' 같은 제외 목록 구간을 찾는다(괄호 깊이 고려). '그 외'·'표 외'는 제외가 아니다 */
function exclSpans(t) {
  const spans = [], re = /제외|예외|이외|(?<=\s)외(?=[\s)\],]|$)/g; let m;
  while ((m = re.exec(t))) {
    if (m[0] === '외' && /(?:^|\s)(?:그|표)\s*$/.test(t.slice(0, m.index))) continue;
    let i = m.index - 1, depth = 0;
    for (; i >= 0; i--) { const c = t[i]; if (c === ')' || c === ']') depth++; else if (c === '(' || c === '[') { if (!depth) break; depth--; } else if (!depth && (c === '-' || c === ':' || c === ';')) break; }
    spans.push([i + 1, m.index]);
  }
  return spans;
}
const GEN_RE = /그\s*외|일반\s*(?:모집단위|학과)|전체|전\s*모집단위|모든\s*(?:모집단위|학과)|전\s*학과|나머지|공통|표\s*외/;
/* 'in' 이 모집단위를 짚음 / 'out' 제외 목록에 있음 / 'general' 나머지 전체 / 'none' 언급 없음 */
function targetState(target, row, keys) {
  const t = String(target || '');
  if (!t.trim()) return 'general';
  const sp = exclSpans(t); let outside = '', last = 0;
  sp.forEach(([a, b]) => { outside += t.slice(last, a) + ' , '; last = b; }); outside += t.slice(last);
  const excl = sp.map(([a, b]) => t.slice(a, b)).join(' , ');
  if (unitMention(outside, keys, row.모집단위)) return 'in';
  if (excl && unitMention(excl, keys, row.모집단위)) return 'out';
  let top = outside, prev; do { prev = top; top = top.replace(/\([^()]*\)|\[[^\[\]]*\]/g, ' '); } while (top !== prev);
  return GEN_RE.test(top) ? 'general' : 'none';
}
const rowKeys = row => unitKeys(row.모집단위, row.모집단위키);
function minFor(univ, row) {
  const all = DS['최저2028'].filter(m => sameUni(m.대학, univ) && m.유형 === row.유형);
  const pk = pickTrack(all, '전형', row.전형);
  const cands = pk.rows; if (!cands.length) return null;
  const keys = rowKeys(row), st = cands.map(m => targetState(m.대상, row, keys));
  let res;
  const spec = cands.filter((m, i) => st[i] === 'in');
  if (spec.length) res = spec.slice(0, 3);
  else { const gen = cands.filter((m, i) => st[i] === 'general');
    if (gen.length) res = gen.slice(0, 2);
    // 행이 하나뿐이어도 대상이 다른 학과를 콕 짚었으면(건축공학부…) 붙이지 않는다
    else if (cands.length === 1 && st[0] !== 'out' && !unitToks(cands[0].대상).some(t => /(학과|학부|전공|과)$/.test(t))) res = cands.slice();
    else res = [{ 대상: '', 기준: '', 안내: '이 모집단위 기준을 자료에서 못 찾았어요' }]; }
  if (pk.approx) res.approx = pk.approx;
  return res;
}
function ivFor(univ, row) {
  const typeOk = m => !m.유형 || (m.유형 === '학종' ? row.유형 === '종합' : m.유형 === '교과' ? row.유형 === '교과' : true);
  const keys = rowKeys(row);
  const unitOk = m => { const t = String(m.해당모집단위 || ''); if (!t.trim() || /전\s*모집단위|전체/.test(t)) return true; const s = targetState(t, row, keys); return s === 'in' || s === 'general'; };
  const base = DS['면접기준'].filter(m => sameUni(m.대학, univ) && typeOk(m));
  const pk = pickTrack(base, '전형', row.전형, 'paren');
  const r = pk.rows.filter(unitOk);
  return r.length ? r : (/면접/.test(row.전형) ? [{ 면접방식: '' }] : null);
}
const NONE_RE = /^(?:수능)?(?:최저학력기준|최저학력|최저기준|최저)?없음$/;
const isNoMin = m => m.최저적용 === '미적용' || NONE_RE.test(nsp(m.기준));
function minText(ms) {
  if (!ms) return '<span class="tiny">모집요강 확인</span>';
  const ap = ms.approx ? `<span class="badge">이름이 비슷한 전형 기준</span> <span class="tiny">${esc(ms.approx)}</span><br>` : '';
  if (ms[0].안내) return ap + '<span class="tiny">' + esc(ms[0].안내) + ' · 모집요강 확인</span>';
  return ap + ms.map(m => `${m.대상 && ms.length > 1 ? `<span class="tiny">${esc(m.대상)}</span><br>` : ''}${isNoMin(m) ? '<span class="badge mint">없음</span>' : esc(m.기준 || '-')}${m.반영영역 && !isNoMin(m) ? `<br><span class="tiny">${esc(m.반영영역)}</span>` : ''}`).join('<hr class="dash">');
}
function minPlain(ms) { if (!ms) return '모집요강 확인'; return (ms.approx ? '(이름이 비슷한 전형 기준: ' + ms.approx + ') ' : '') + ms.map(m => m.안내 || (isNoMin(m) ? '없음' : m.기준)).join(' / '); }

/* 입결: 공식입결(원 자료) 먼저, 그다음 전형결과 3개년. 원 자료 표기 그대로 + 기준 문구 */
function officialFor(univ, keys) {
  const ks = new Set(keys.filter(Boolean));
  return DS['공식입결'].filter(r => sameUni(r.대학, univ) && (ks.has(deptKey(r.모집단위)) || [...(r.__uk || (r.__uk = unitKeys(r.모집단위)))].some(k => ks.has(k))));
}
const UNI_NOTE = {
  '영남대': '영남대 안내: 대학별 산출방법이 달라 다른 대학과 비교할 수 없어요. 영남대 지원 참고용이에요.',
  '경남대': '경남대 기준은 최종합격자(충원 포함) 상위 90%예요. 등록자 기준과 달라요.'
};
function ref5(v) { const g = gradeMean9(v); return g == null ? '' : ` <span class="tiny">(5등급 눈금≈${fmt(g)})</span>`; }
function officialHTML(rows, my, u) {
  if (!rows.length) return '';
  const g = new Map();
  rows.forEach(r => { const k = [r.학년도, r.모집시기, r.전형유형, r.전형명, r.모집단위].join('|'); if (!g.has(k)) g.set(k, []); g.get(k).push(r); });
  const five = my && my.sys === 5;
  // 같은 전형(유형+이름)끼리 접기로 묶는다
  const tracks = new Map();
  [...g.values()].forEach(rs => {
    const a = rs[0];
    const vals = rs.map(r => { const v = String(r.성적값 || '').trim(); const num = v !== '' && isFinite(Number(v)); const sys9 = /9/.test(r.성적체계 || '9');
      return `<li>${r.성적기준 || v !== '' ? `<span class="tiny">${esc(r.성적기준 || '기준 미표기')}</span> ` : ''}<b>${v === '' ? '<span class="badge">미공개</span>' : esc(v)}</b>${num && five && sys9 ? ref5(Number(v)) : ''}</li>`; }).join('');
    const est = /부경대/.test(uniBase(a.대학)) ? ' <span class="badge">유형 추정</span>' : '';
    const src = /^https?:\/\//.test(a.출처URL) ? `<a href="${esc(a.출처URL)}" target="_blank" rel="noopener noreferrer">출처${a.출처페이지 ? (/^\d/.test(a.출처페이지) ? ' p.' : ' · ') + esc(a.출처페이지) : ''}</a>` : esc(a.출처유형 || '');
    const tr = `<tr><td><b>${esc(a.학년도)}</b><br><span class="tiny">${esc(a.모집시기)}</span></td><td>${esc(a.전형유형)}${est}<br><b>${esc(a.전형명)}</b><br><span class="tiny">${esc(a.모집단위)}</span></td>
      <td class="n">${esc(a.모집인원 || '-')}</td><td class="n">${esc(a.경쟁률 || '-')}</td><td class="n">${a.충원합격 !== '' ? esc(a.충원합격) : '-'}</td>
      <td><ul style="margin:0;padding-left:16px">${vals}</ul><span class="tiny">${esc(a.성적체계)} · ${esc(a.교육과정)} 교육과정</span></td><td>${src}<br><span class="tiny">${esc(a.출처유형)}</span></td></tr>`;
    const tk = (a.전형유형 || '') + '|' + (a.전형명 || '');
    if (!tracks.has(tk)) tracks.set(tk, { a, trs: [], years: new Set() });
    const t = tracks.get(tk); t.trs.push(tr); t.years.add(a.학년도);
  });
  const notes = [...new Set(rows.map(r => UNI_NOTE[Object.keys(UNI_NOTE).find(k => uniBase(r.대학).startsWith(k))]).filter(Boolean))];
  const head = `<thead><tr><th>학년도</th><th>전형</th><th class="n">인원</th><th class="n">경쟁률</th><th class="n">충원 표기<br><span class="tiny">대학별 의미 다름</span></th><th>성적 (기준 그대로)</th><th>출처</th></tr></thead>`;
  const allAdiga = rows.every(r => /어디가/.test(r.출처유형 || ''));
  return `<h3>${allAdiga ? '대입정보포털 어디가 입결 <span class="badge mint">출처: 한국대학교육협의회</span>' : '대학 공식 발표 입결 <span class="badge mint">원 자료</span>'}</h3>${notes.map(n => `<p class="note">${esc(n)}</p>`).join('')}
    ${[...tracks.entries()].map(([tk, t], i) => { const key = 'ip|' + u + '|' + tk; return `<details class="fold apri" data-fold="${esc(key)}"${fo(key, i === 0)}><summary><span class="sumt"><b>${esc(t.a.전형명 || '전형')} <span class="badge">${esc(t.a.전형유형 || '-')}</span></b><span class="pv">${[...t.years].sort().reverse().map(esc).join(' · ')}학년도 · ${t.trs.length}건</span></span></summary><div class="fb">
      <div class="tbl-wrap"><table>${head}<tbody>${t.trs.join('')}</tbody></table></div></div></details>`; }).join('')}`;
}
function sheetResults(univ, keys) { return DS['전형결과'].filter(r => sameUni(r.대학, univ) && keys.includes(r.키)); }
function sheetHTML(rows, my, u) {
  if (!rows.length) return '';
  const five = my && my.sys === 5;
  const cell = v => v ? `${esc(v)}${five && isFinite(Number(v)) ? ref5(Number(v)) : ''}` : '-';
  const crit = [...new Set(rows.map(r => [r.기준1, r.기준2].filter(Boolean).join(' / ')))].filter(Boolean).join(' · ');
  const folds = rows.map((r, i) => {
    const body = ['26', '25', '24'].map(y => (r[y + '경쟁'] || r[y + '성적1'] || r[y + '성적2']) ? `<tr><td>20${y}</td><td class="n">${esc(r[y + '모집'] || '-')}</td><td class="n">${esc(r[y + '경쟁'] || '-')}</td><td class="n">${cell(r[y + '성적1'])}</td><td class="n">${cell(r[y + '성적2'])}</td></tr>` : '').join('');
    const key = 'sh|' + u + '|' + r.전형 + '|' + r.모집단위;
    return `<details class="fold" data-fold="${esc(key)}"${fo(key)}><summary><span class="sumt"><b>${esc(r.전형)}</b><span class="pv">${esc(r.대학)} · ${esc(r.모집단위)}</span></span></summary><div class="fb">
      ${body ? `<div class="tbl-wrap"><table><thead><tr><th>학년도</th><th class="n">모집</th><th class="n">경쟁률</th><th class="n">성적1</th><th class="n">성적2</th></tr></thead><tbody>${body}</tbody></table></div>` : `<p class="tiny">지난 결과 없음 (2027 모집 ${esc(r['27모집'] || '-')}명)</p>`}</div></details>`;
  }).join('');
  return `<h3>최근 3년 입결 <span class="badge">지식베이스 정리본</span></h3>
    <p class="tiny">성적1·2 기준: <b>${esc(crit || '표기 없음')}</b> · 9등급(2015 개정) 값</p>${folds}`;
}
function myBox(my) {
  if (!my) return `<p class="note">내 학생부를 넣으면 내 평균을 옆에 참고로 보여 줘요. <button class="btn small white" data-act="go" data-to="record">학생부 넣기</button></p>`;
  return `<div class="stats" style="max-width:340px"><div class="stat vio"><span>내 평균 (${my.sys}등급제)</span><b>${fmt(my.avg)}</b><span class="tiny">참고로 나란히 볼 뿐이에요</span></div></div>
    ${my.sys === 5 ? '<div class="warn">입결은 9등급제(2015 개정)예요. 괄호 속 5등급 눈금 값은 참고용이에요.</div>' : ''}`;
}
function fillUniv() {
  const box = $('#mjBox'); if (!box) return;
  const M = S.mj, u = M.univ, rows = unitRows().filter(r => r.대학 === u);
  const src = DS['2028출처'].find(r => sameUni(r.대학, u));
  const my = myGrade();
  const off = officialFor(u, M.keys), offA = adigaFor(u, M.keys), sh = sheetResults(u, M.keys);
  const ivRows = rows.map(r => ({ r, iv: ivFor(u, r) })).filter(x => x.iv);
  const tab = ['plan', 'result', 'iv'].includes(M.utab) ? M.utab : 'plan';
  const t = (k, icn, label, n) => `<button class="tab apri ${tab === k ? 'on' : ''}" data-act="mjUTab" data-k="${k}" aria-pressed="${tab === k}">${ic(icn)}${label}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`;
  let body = '';
  if (tab === 'plan') {
    const trs = rows.map(r => {
      const ms = minFor(u, r), iv = ivFor(u, r), ru = isRural(r.전형);
      const inC = S.cands.some(c => c.univ === u && c.전형 === r.전형 && c.unit === r.모집단위);
      return `<tr class="${ru && S.profile.rural ? 'hl' : ''}${iv ? '' : ' noiv'}"><td data-label="유형"><div><span class="badge ${r.유형 === '교과' ? 'mint' : r.유형 === '종합' ? 'vio' : r.유형 === '논술' ? 'apri' : 'sun'}">${esc(r.유형)}</span></div></td>
        <td data-label="전형"><div><b>${esc(r.전형)}</b>${ru ? ' <span class="badge sun">농어촌</span>' : ''}<br><span class="tiny">${esc(r.모집단위)}</span>${(() => { const x = cafeRow(u, r); const h = x ? howText(x) : ''; const rc = x && /교과/.test(x._유형 || x.전형유형 || '') ? refCalc(refRule(x.반영교과)) : null; return (h ? `<br><span class="how">${esc(h)}</span>` : '') + (rc ? `<br><span class="tiny myref">이 대학 기준 내 평균 <b>${fmt(rc.avg)}</b> (${esc(rc.label)})</span>` : ''); })()}</div></td><td class="n" data-label="인원"><div>${esc(r.인원)}</div></td>
        <td data-label="수능최저"><div>${(() => { const x = cafeRow(u, r); const b = x && x.수능최저학력기준 ? csatBadge(x.수능최저학력기준) : ''; return b ? b.trim() + '<br>' : ''; })()}${ms ? minText(ms) : (() => { const x = cafeRow(u, r); const t = x && String(x.수능최저학력기준 || '').trim(); return t ? (/^(없음|-|미적용)$/.test(t) ? '<span class="badge mint">없음</span>' : `<span class="tiny">${esc(t.length > 120 ? t.slice(0, 120) + '…' : t)}</span>`) : minText(ms); })()}</div></td><td class="ivc" data-label="면접"><div>${iv ? `<span class="badge vio" title="${esc(iv[0].면접방식 || '')}">면접</span>` : '<span class="tiny">—</span>'}</div></td>
        <td class="cdc" data-label="후보"><button class="cand ${inC ? 'on' : ''}" data-act="candAdd" data-u="${esc(u)}" data-t="${esc(r.전형)}" data-n="${esc(r.모집단위)}" data-y="${esc(r.유형)}" data-c="${esc(r.인원)}" data-k="${esc(r.모집단위키)}" aria-pressed="${inC}" aria-label="${esc(r.전형)} ${inC ? '후보에서 빼기' : '후보에 담기'}">${inC ? ic('check') + '담음' : ic('plus') + '담기'}</button></td></tr>`;
    }).join('');
    body = `<section class="panel apri"><h2>2028 전형 <span class="badge sun">시행계획 기준(잠정)</span></h2>
      <details class="fold" data-fold="mockU"${fo('mockU', !Object.values(S.profile.mock || {}).some(x => x))}><summary><span class="sumt"><b>${ic('check')} 수능최저 바로 점검</b><span class="pv">${Object.values(S.profile.mock || {}).some(x => x) ? '모의고사 등급 입력됨 · 표에 충족 여부가 나와요' : '모의고사 등급을 넣으면 표에 충족 여부가 나와요'}</span></span></summary><div class="fb">${mockHTML()}</div></details>
      ${src ? `<p class="tiny">출처: ${esc(src.출처)} ${src.상태 && src.상태 !== 'ok' ? '· ' + esc(src.상태) : ''}</p>` : ''}
      <div class="tbl-wrap"><table class="rt"><thead><tr><th>유형</th><th>전형</th><th class="n">인원</th><th>수능최저</th><th>면접</th><th>후보</th></tr></thead><tbody>${trs}</tbody></table></div>
      <p class="tiny">수능최저·면접은 전형 이름이 같은 자료를 붙였어요. 이름이 다르면 '이름이 비슷한 전형 기준'으로 표시해요. 꼭 모집요강으로 확인해 주세요.</p>
      <div class="row"><label class="toggle"><input type="checkbox" data-in="mjRural" ${S.profile.rural ? 'checked' : ''}><span class="sw"></span>농어촌 강조</label><button class="btn small white" data-act="go" data-to="rural">농어촌 체크</button></div></section>`;
  } else if (tab === 'result') {
    body = `<section class="panel vio"><h2>입결 참고</h2>${myBox(my)}
      ${!off.length && /영남대/.test(uniBase(u)) ? '<p class="note">영남대 입결은 대학 안내에 따라 공식 게시물에서 확인해 주세요. <a href="https://enter.yu.ac.kr/10000023?mode=view&bbs_seq=1223&categorycode=8" target="_blank" rel="noopener noreferrer">2026 수시 입학자 성적(영남대 입학처)</a></p>' : ''}${officialHTML(off, my, u)}${officialHTML(offA, my, u + '#a')}${sheetHTML(sh, my, u)}${schoolCasesHTML(u, M.keys)}
      ${!off.length && !offA.length && !sh.length ? '<div class="empty"><strong>이 대학·학과 입결 자료가 없어요</strong>대학 입학처 자료를 확인해 주세요.</div>' : ''}
      <p class="note">어디가 <b>전형정보</b>에서 이 학과를 펼치면 2026 결과(50%·70% 등급)를 볼 수 있어요. <a href="https://www.adiga.kr/ucp/prc/uni/admssUnivView.do?menuId=PCPRCINF2000" target="_blank" rel="noopener noreferrer">어디가 전형정보 열기</a> <span class="tiny">출처: 한국대학교육협의회</span></p>
      <p class="tiny">합격 가능성을 알려 주는 게 아니에요. 대학마다 반영 과목·방식이 달라요.</p></section>`;
  } else {
    const seen = new Set();
    const cards = ivRows.map(({ r, iv }) => { const c = iv[0]; const k = r.전형 + '|' + (c.면접방식 || ''); if (seen.has(k)) return ''; seen.add(k);
      return `<div class="item"><h4>${esc(r.전형)} <span class="badge">${esc(r.유형)}</span></h4>
        ${c.면접방식 ? `<p style="margin:2px 0"><b>방식</b> ${esc(c.면접방식)}</p>` : '<p class="tiny" style="margin:2px 0">면접 방식은 모집요강에서 확인해 주세요.</p>'}${c.면접시간 ? `<p style="margin:2px 0"><b>시간</b> ${esc(c.면접시간)}${c.면접유형 ? ' · ' + esc(c.면접유형) : ''}</p>` : ''}
        ${c.면접일 ? `<p style="margin:2px 0"><b>면접일</b> ${esc(c.면접일)}</p>` : ''}${c.준비팁 ? `<p class="tiny" style="margin:4px 0 0">${esc(c.준비팁)}</p>` : ''}${c.출처 ? `<p class="tiny" style="margin:2px 0 0">출처: ${esc(c.출처)}</p>` : ''}</div>`; }).join('');
    body = `<section class="panel vio"><h2>${ic('chat')} 면접 있는 전형</h2>
      ${cards || '<p class="muted">이 학과 전형에서 면접 정보를 찾지 못했어요.</p>'}
      <p class="tiny">2028 면접은 바뀔 수 있어요. 모집요강으로 확인해 주세요.</p>
      <div class="row"><button class="btn vio" data-act="ivFrom" data-u="${esc(u)}" data-d="${esc(M.deptName || '')}">이 대학 면접 연습 ${ic('next')}</button></div></section>`;
  }
  const nCard = new Set(off.concat(offA).map(r => (r.출처유형 || '') + (r.전형유형 || '') + '|' + (r.전형명 || ''))).size + sh.length;
  box.innerHTML = `<div class="tabs stick" role="group" aria-label="대학 상세" style="--n:3">${t('plan', 'list', '2028 전형', rows.length)}${t('result', 'chart', '입결', nCard || null)}${t('iv', 'chat', '면접', ivRows.length)}</div>${body}`;
}

/* 후보 */
ACT.candAdd = el => {
  const d = el.dataset, at = S.cands.findIndex(c => c.univ === d.u && c.전형 === d.t && c.unit === d.n);
  if (at >= 0) { S.cands.splice(at, 1); saveCands(); toast('후보에서 뺐어요 (' + S.cands.length + '/6)'); fillUniv(); renderCandbar(); return; }
  if (S.cands.length >= 6) { toast('후보는 6개까지예요. 비교 화면에서 빼고 담아 주세요.'); return; }
  // 학과 검색에 쓴 키도 함께 둔다(모집단위키가 '조형'처럼 넓어도 입결은 그 학과만)
  S.cands.push({ univ: d.u, 전형: d.t, unit: d.n, 유형: d.y, 인원: d.c, key: d.k, keys: (S.mj.keys || []).slice(0, 4) });
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
    const ks = (c.keys && c.keys.length ? c.keys : [c.key]);
    const off = officialFor(c.univ, ks); const sh = sheetResults(c.univ, ks);
    const tyOk = r => !r.전형유형 || (c.유형 === '교과' ? /교과/.test(r.전형유형) : c.유형 === '종합' ? /종합/.test(r.전형유형) : true);
    // 같은 전형 값만 넣는다. 이름이 같은 전형이 없으면 비슷한 이름 하나만, 그것도 없으면 비워 두고 이름만 알려 준다
    const offT = off.filter(tyOk), pk = pickTrack(offT, '전형명', c.전형), shP = pickTrack(sh, '전형', c.전형);
    let ip = '';
    const o = pk.rows.slice().sort((a, b) => String(b.학년도).localeCompare(String(a.학년도))).slice(0, 3);
    const apx = n => n ? `<div><span class="badge">이름이 비슷한 전형</span> <span class="tiny">${esc(n)}</span></div>` : '';
    if (o.length) ip = apx(pk.approx) + o.map(r => `<div class="tiny">${esc(r.학년도)} ${esc(r.전형명)} · ${esc(r.성적기준 || '')} <b>${r.성적값 === '' ? '미공개' : esc(r.성적값)}</b>${my && my.sys === 5 && r.성적값 !== '' ? ref5(Number(r.성적값)) : ''}</div>`).join('');
    else { const s = shP.rows[0]; if (s && (s['26성적1'] || s['26성적2'])) ip = apx(shP.approx) + `<div class="tiny">2026 ${esc(s.전형)} · ${esc(s.기준1)} <b>${esc(s['26성적1'] || '-')}</b> · ${esc(s.기준2)} <b>${esc(s['26성적2'] || '-')}</b></div>`; }
    if (!ip) { const names = [...new Set([...offT.map(r => r.학년도 + ' ' + r.전형명), ...sh.map(r => r.전형)])].slice(0, 3);
      if (names.length) ip = `<span class="tiny">같은 이름 전형 입결이 없어요. 전형 이름이 달라요(${esc(names.join(', '))}). 대학 상세 입결 탭에서 확인해 주세요.</span>`; }
    return `<article class="cmpcard"><h3>${esc(c.univ)}</h3><p class="tiny" style="margin:0">${esc(c.unit)}</p>
      <dl><dt>유형</dt><dd>${esc(c.유형)}</dd><dt>전형</dt><dd>${esc(c.전형)}${isRural(c.전형) ? ' <span class="badge sun">농어촌</span>' : ''}</dd><dt>2028 인원</dt><dd>${esc(c.인원)}명 <span class="tiny">(잠정)</span></dd>
      <dt>수능최저</dt><dd>${minText(ms)}</dd><dt>면접</dt><dd>${iv ? '있음' : '<span class="tiny">정보 없음</span>'}</dd><dt>입결</dt><dd>${ip || '<span class="tiny">자료 없음</span>'}</dd></dl>
      <button class="btn small danger" data-act="candDel" data-i="${i}">${ic('close')} 빼기</button></article>`;
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
    <div style="margin-top:12px">${list.map((t, i) => `<label class="confirm plain"><input type="checkbox" data-in="ruChk" data-i="${R.type}-${i}" ${R.checks[R.type + '-' + i] ? 'checked' : ''}>${esc(t)}</label>`).join('')}</div>
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


/* ---------- 학생부 결과: 내 평균과 입결 나란히 (희망 학과 기준) ---------- */
// 합격 가능성을 말하지 않는다. 같은 기준 값과 내 평균의 숫자 차이만 보여 준다.
function ipgWords() {
  const R = S.rec;
  if (R.ipgQ != null) return R.ipgQ.split(/[,\s]+/).map(w => w.trim()).filter(w => w.length >= 2);
  const w = [...(R.majorWords || []), ...String(S.profile.interest || '').split(/[,·/\s]+/)].map(x => String(x).trim()).filter(x => x.length >= 2);
  if (!w.length) {
    // 희망분야 칸이 비면 진로활동·세특에 가장 자주 나오는 학과 낱말 2개
    const t = [R.areas && R.areas['진로'], R.areas && R.areas['세특']].filter(Boolean).join(' ');
    const cnt = IPG_GUESS.map(g => [g[0], g[1].reduce((s, x) => s + (t.split(x).length - 1), 0)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
    cnt.slice(0, 2).forEach(x => w.push(x[0]));
  }
  return [...new Set(w)].slice(0, 6);
}
const IPG_GUESS = [['간호', ['간호']], ['의예', ['의사', '의학']], ['약학', ['약사', '약학']], ['교육', ['교사', '교육']], ['컴퓨터', ['컴퓨터', '프로그래밍', '개발자']], ['소프트웨어', ['소프트웨어']], ['기계', ['기계']], ['전자', ['전자', '반도체']], ['건축', ['건축']], ['경영', ['경영', '마케팅']], ['경제', ['경제']], ['심리', ['심리', '상담']], ['사회복지', ['복지']], ['화학', ['화학']], ['생명', ['생명', '생물']], ['물리', ['물리']], ['수학', ['수학']], ['영어', ['영어']], ['법학', ['법조', '변호사', '법학']], ['행정', ['행정', '공무원']], ['미디어', ['미디어', '언론', '방송']], ['디자인', ['디자인']], ['체육', ['체육', '스포츠']], ['유아', ['유아']], ['물리치료', ['물리치료']], ['항공', ['항공', '로켓', '우주']], ['신소재', ['신소재', '소재']], ['환경', ['환경']], ['식품', ['식품', '영양']], ['농업', ['농업', '농학']]];
function ipgPick(rows) {
  // 같은 전형에서 비교 기준 하나만: 70% > 50% > 평균 순
  const pri = r => /70/.test(r.성적기준) ? 0 : /50/.test(r.성적기준) ? 1 : /평균/.test(r.성적기준) ? 2 : 3;
  return rows.filter(r => isFinite(Number(r.성적값)) && String(r.성적값).trim() !== '').sort((a, b) => pri(a) - pri(b))[0];
}
async function fillIpg() {
  const box = $('#ipgBox'); if (!box) return;
  await need(['공식입결', '전형결과', '수시2028C', '어디가입결']);
  const my = myGrade(), words = ipgWords();
  const hasW = s => { const t = nsp(s); return words.some(w => t.includes(nsp(w))); };
  const out = [];
  if (my && words.length) {
    // 1) 대학 발표·어디가 입결
    const g = new Map();
    DS['공식입결'].forEach(r => { if (!hasW(r.모집단위)) return; const k = [r.대학, r.학년도, r.전형명, r.모집단위].join('|'); if (!g.has(k)) g.set(k, []); g.get(k).push(r); });
    g.forEach(rs => { const p = ipgPick(rs); if (p) out.push({ u: uniBase(p.대학), unit: p.모집단위, tr: p.전형명 || p.전형유형, y: p.학년도, v: Number(p.성적값), crit: p.성적기준 || '기준 미표기', src: /어디가/.test(p.출처유형) ? '어디가' : '대학 발표', rural: /농어촌/.test(p.전형명) }); });
    // 1-2) 어디가 전국 입결: 대학·전형·학과별 가장 최근 해, 70% 우선
    const ag = new Map();
    (DS['어디가입결'] || []).forEach(r => { if (!hasW(r.학과) || +r.연도 < 2025) return; const v = +r.등급70 > 0 ? +r.등급70 : +r.등급50 > 0 ? +r.등급50 : 0; if (!v) return; const k = r.대학 + '|' + r.전형 + '|' + r.학과; const o = ag.get(k); if (!o || +r.연도 > +o.y) ag.set(k, { u: uniBase(r.대학), unit: r.학과, tr: r.전형, y: r.연도, v, crit: (+r.등급70 > 0 ? '최종등록자 70%' : '최종등록자 50%') + ' (등급)', src: '어디가', rural: /농어촌/.test(r.전형) }); });
    const offKeys = new Set(out.map(o => o.u + '|' + deptKey(o.unit) + '|' + o.y));
    ag.forEach(o => { if (!offKeys.has(o.u + '|' + deptKey(o.unit) + '|' + o.y)) out.push(o); });
    // 2) 지식베이스 3개년 정리본(가장 최근 값)
    const seen = new Set(out.map(o => o.u + '|' + deptKey(o.unit)));
    DS['전형결과'].forEach(r => {
      if (!hasW(r.모집단위)) return;
      const y = ['26', '25', '24'].find(y => isFinite(Number(r[y + '성적1'])) && String(r[y + '성적1']).trim() !== ''); if (!y) return;
      if (seen.has(uniBase(r.대학) + '|' + deptKey(r.모집단위))) return;
      out.push({ u: uniBase(r.대학), unit: r.모집단위, tr: r.전형, y: '20' + y, v: Number(r[y + '성적1']), crit: r.기준1 || '기준 미표기', src: '정리본', rural: /농어촌/.test(r.전형) });
    });
  }
  const five = my && my.sys === 5;
  const cmp = o => five ? gradeMean9(o.v) : o.v;
  const O = my ? gradeOutlook() : null;
  const near = out.map(o => ({ ...o, c: cmp(o) })).filter(o => o.c != null && Math.abs(o.c - my.avg) <= 0.8)
    .sort((a, b) => (S.profile.rural ? (b.rural - a.rural) : 0) || Math.abs(a.c - my.avg) - Math.abs(b.c - my.avg));
  const lim = S.rec.ipgMore ? 60 : 12;
  const trs = near.slice(0, lim).map(o => { const d = o.c - my.avg;
    return `<tr><td><b>${esc(o.u)}</b><br><span class="tiny">${esc(o.unit)}</span></td><td>${esc(o.tr)}${o.rural ? ' <span class="badge sun">농어촌</span>' : ''}<br><span class="tiny">${esc(o.y)}학년도</span></td>
      <td class="n"><b>${fmt(o.v)}</b>${five ? `<br><span class="tiny">5등급 눈금≈${fmt(o.c)}</span>` : ''}<br><span class="tiny">${esc(o.crit)}</span></td>
      <td class="n">${Math.abs(d) < 0.005 ? '0.00' : (d > 0 ? '+' : '−') + fmt(Math.abs(d))}${O && O.rem ? `<br><span class="tiny">${needShort(o.c, O)}</span>` : ''}</td><td><span class="badge">${esc(o.src)}</span><br><button class="btn small white" data-act="ipgOpen" data-u="${esc(o.u)}" data-n="${esc(o.unit)}">자세히</button></td></tr>`; }).join('');
  // 3) 우리 학교 선배 사례(선생님이 이 기기에 불러온 경우만)
  const cases = (S.teacher.cases || []).filter(c => words.length && hasW(c.학과));
  const csNear = my ? cases.filter(c => { const v = Number(c.성적); if (!isFinite(v) || !c.성적) return false; const cv = five && /9/.test(c.성적체계 || '9') ? gradeMean9(v) : v; return cv != null && Math.abs(cv - my.avg) <= 0.8; }) : [];
  const caseHTML = S.teacher.cases && S.teacher.cases.length ? `<h3>우리 학교 선배 사례 <span class="badge vio">이 기기에만 있음</span></h3>
    ${csNear.length ? `<div class="tbl-wrap"><table><thead><tr><th>대학·학과</th><th>전형</th><th class="n">내신</th><th>결과</th></tr></thead><tbody>${csNear.slice(0, 30).map(c => `<tr><td><b>${esc(c.대학)}</b><br><span class="tiny">${esc(c.학과)}</span></td><td>${esc(c.전형)}<br><span class="tiny">${esc(c.학년도)}</span></td><td class="n">${esc(c.성적)}</td><td>${esc(c.결과)}${c.비식별메모 ? `<br><span class="tiny">${esc(c.비식별메모)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="tiny">이 학과 낱말로 내 평균 근처(±0.8) 선배 사례가 없어요.</p>'}` : '';
  // 0) 내가 담은 후보: 후보마다 같은 전형 입결 한 줄
  const candRows = my ? (S.cands || []).map(cd => {
    const keys = [...new Set([...unitKeys(cd.unit, cd.key), ...(cd.keys || [])])];
    const off = officialFor(cd.univ, keys), sh = sheetResults(cd.univ, keys);
    const offT = off.filter(r => sameTrack(r.전형명 || '', cd.전형)), shT = sh.filter(r => sameTrack(r.전형, cd.전형));
    let pick = null;
    const po = ipgPick(offT.length ? offT : []);
    if (po) pick = { v: Number(po.성적값), crit: po.성적기준, y: po.학년도, src: /어디가/.test(po.출처유형) ? '어디가' : '대학 발표', same: true };
    else { const r = shT[0]; const y = r && ['26', '25', '24'].find(y => String(r[y + '성적1'] || '').trim() !== '' && isFinite(Number(r[y + '성적1']))); if (y) pick = { v: Number(r[y + '성적1']), crit: r.기준1, y: '20' + y, src: '정리본', same: true }; }
    if (!pick) { const p2 = ipgPick(off); if (p2) pick = { v: Number(p2.성적값), crit: p2.성적기준, y: p2.학년도, src: (/어디가/.test(p2.출처유형) ? '어디가' : '대학 발표'), same: false, tr: p2.전형명 }; }
    return { cd, pick };
  }) : [];
  const candHTML = candRows.length ? `<h3>내가 담은 후보 ${candRows.length}곳</h3><div class="tbl-wrap"><table><thead><tr><th>후보</th><th class="n">입결 (기준)</th><th class="n">내 평균과 차이</th>${O && O.rem ? '<th>남은 학기에 필요한 평균</th>' : ''}</tr></thead><tbody>${candRows.map(({ cd, pick }) => { const cv = pick ? (five ? gradeMean9(pick.v) : pick.v) : null; const d = cv != null ? cv - my.avg : null;
    return `<tr><td><b>${esc(uniBase(cd.univ))}</b> ${esc(cd.unit)}<br><span class="tiny">${esc(cd.전형)}</span></td><td class="n">${pick ? `<b>${fmt(pick.v)}</b>${five ? `<br><span class="tiny">5등급 눈금≈${fmt(cv)}</span>` : ''}<br><span class="tiny">${esc(pick.crit || '')} · ${esc(pick.y)} · ${esc(pick.src)}${pick.same ? '' : ' · 다른 전형(' + esc(pick.tr || '') + ')'}</span>` : '<span class="badge">입결 없음</span>'}</td><td class="n">${d == null ? '-' : `<b>${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))}</b>`}</td>${O && O.rem ? `<td>${cv == null ? '-' : needHTML(cv, O)}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>` : (my ? '<p class="tiny">학과·전형 화면에서 후보를 담으면 여기서 내 평균과 나란히 볼 수 있어요.</p>' : '');  box.innerHTML = `<section class="panel vio"><h2>${ic('compass')} 내 평균과 입결 나란히</h2>
    ${my ? `<p class="one">내 평균 <b>${fmt(my.avg)}</b> (${my.sys}등급제) 근처(±0.8) 입결만 모았어요.</p>` : '<div class="note">성적표가 있어야 비교할 수 있어요. 성적 탭에서 확인해 주세요.</div>'}
    <label class="f" for="ipgQ">학과 낱말 <span class="tiny">(희망분야에서 자동, 쉼표로 고칠 수 있어요)</span></label>
    <div class="row"><input id="ipgQ" type="text" value="${esc(words.join(', '))}" style="flex:1;min-width:200px" placeholder="예: 간호, 기계, 교육"><button class="btn vio" data-act="ipgGo">다시 찾기</button></div>
    ${five ? '<div class="warn">입결은 9등급제(2015 개정) 값이에요. 5등급 눈금 값으로 바꿔 나란히 놓았어요. 공식 환산이 아니에요.</div>' : ''}${calcCardHTML(S.cands || [])}${O ? goalHTML(O, candRows, near) : ''}${candHTML}<h3>희망 학과 근처 입결</h3>
    ${my && words.length ? (trs ? `<div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>대학·모집단위</th><th>전형</th><th class="n">입결 (기준)</th><th class="n">내 평균과 차이</th><th>출처</th></tr></thead><tbody>${trs}</tbody></table></div>
      ${near.length > lim ? `<button class="btn white small" data-act="ipgMore" style="margin-top:8px">더 보기 (${near.length - lim})</button>` : ''}` : '<div class="empty"><strong>근처 입결을 못 찾았어요</strong>학과 낱말을 바꿔 보세요.</div>') : ''}
    <p class="tiny" style="margin-top:8px">차이 −는 입결 숫자가 내 평균보다 작다는 뜻이에요(더 높은 등급). 기준(50%·70%·평균)과 전형마다 반영 방식이 달라서 참고로만 보세요.</p>
    ${caseHTML}</section>`;
}
/* ---------- 목표까지: 남은 학기에 평균 몇 등급을 받아야 최종 평균이 목표에 닿는지 ----------
   수시는 3학년 1학기까지 5학기. 남은 학기 학점은 지금까지 학기당 평균 학점으로 잡는다(대학별 반영 교과·비율은 못 반영). */
function gradeOutlook() {
  const G = (S.rec.grades || []).filter(r => Number(r.등급) >= 1 && Number(r.학점) > 0);
  const terms = [...new Set(G.map(r => r.학년 + '-' + r.학기))].filter(t => /^[1-3]-[12]$/.test(t)).sort();
  const w = wavg(G); if (!w || !terms.length) return null;
  const done = terms.filter(t => t <= '3-1').length, rem = Math.max(0, 5 - done);
  const per = terms.map(t => [t, wavg(G.filter(r => r.학년 + '-' + r.학기 === t))]).filter(x => x[1]);
  const best = per.reduce((a, b) => (!a || b[1].avg < a[1].avg ? b : a), null);
  const Cd = w.credits, Sd = w.avg * Cd, Cr = (Cd / terms.length) * rem;
  const sys = S.rec.system || sysOf(S.profile.curr);
  const fin = x => Cr ? (Sd + x * Cr) / (Cd + Cr) : w.avg;
  return { avg: w.avg, Cd, Sd, Cr, rem, done, terms, best, sys, all1: fin(1), withBest: best ? fin(best[1].avg) : w.avg, keep: w.avg };
}
const needOf = (target, O) => O.Cr ? (target * (O.Cd + O.Cr) - O.Sd) / O.Cr : null;
function needShort(target, O) {
  const n = needOf(target, O); if (n == null) return '';
  if (n >= O.avg) return '지금 평균 유지로 닿음';
  if (n < 1) return '남은 학기 모두 1등급이어도 안 닿음';
  return `남은 ${O.rem}학기 평균 ${fmt(n)} 필요`;
}
function needHTML(target, O) {
  const n = needOf(target, O); if (n == null) return '-';
  const lvl = n >= O.avg ? ['mint', '지금처럼'] : n < 1 ? ['rose', '성적만으로는 어려움'] : O.best && n >= O.best[1].avg ? ['vio', '내 최고 학기 수준'] : ['sun', '큰 도약'];
  return `${n < 1 ? '1등급 밖' : `<b>${fmt(n)}</b>`} <span class="badge ${lvl[0]}">${lvl[1]}</span>`;
}
function goalHTML(O, candRows, near) {
  if (!O.rem) return `<div class="note">수시에 들어가는 5학기(3학년 1학기까지) 성적이 다 나왔어요. 이제 내신 평균은 바뀌지 않아요.</div>`;
  const picks = [...candRows.filter(c => c.pick).map(c => [uniBase(c.cd.univ) + ' ' + c.cd.unit, O.sys === 5 ? gradeMean9(c.pick.v) : c.pick.v]), ...near.slice(0, 3).map(o => [o.u + ' ' + o.unit, o.c])].filter(x => x[1] != null).slice(0, 6);
  const T = S.rec.goalT != null && S.rec.goalT !== '' ? Number(S.rec.goalT) : (picks[0] ? Number(fmt(picks[0][1])) : null);
  const n = T != null && isFinite(T) ? needOf(T, O) : null;
  const gap = n != null ? O.avg - n : null;
  const msg = n == null ? '목표 평균을 넣거나 아래 후보 입결을 눌러 보세요.'
    : n >= O.avg ? `지금 평균(${fmt(O.avg)})만 유지해도 최종 ${fmt(T)}에 닿아요.`
    : n < 1 ? `남은 ${O.rem}학기를 모두 1등급 받아도 최종 평균은 ${fmt(O.all1)}까지예요. 내신 숫자만으로는 ${fmt(T)}에 못 닿아요. 학생부종합의 기록이나 다른 전형을 같이 보세요.`
    : `남은 ${O.rem}학기에 평균 <b>${fmt(n)}등급</b>을 받으면 최종 ${fmt(T)}이 돼요. 지금보다 학기마다 <b>${fmt(gap)}등급</b> 더 올려야 해요.${O.best ? (n >= O.best[1].avg ? ` 내 최고 학기(${O.best[0]}, ${fmt(O.best[1].avg)}) 수준이면 돼요.` : ` 아직 받아 본 적 없는 성적이에요(최고 학기 ${O.best[0]} ${fmt(O.best[1].avg)}).`) : ''}`;

  return `<div class="goal"><h3>${ic('star')} 목표까지 얼마나</h3>
    <div class="stats"><div class="stat mint"><span>지금 평균 (${O.done}학기)</span><b>${fmt(O.avg)}</b><span class="tiny">수시 반영 5학기 중 ${O.rem}학기 남음</span></div>
      <div class="stat vio"><span>최고 학기만큼 받으면</span><b>${fmt(O.withBest)}</b><span class="tiny">${O.best ? esc(O.best[0]) + ' ' + fmt(O.best[1].avg) + ' 유지' : ''}</span></div>
      <div class="stat sun"><span>남은 학기 모두 1등급이면</span><b>${fmt(O.all1)}</b><span class="tiny">내신으로 갈 수 있는 끝</span></div></div>
    <div class="row" style="margin-top:10px"><label class="f" for="goalT" style="margin:0">목표 최종 평균 (${O.sys}등급제)</label><input id="goalT" type="number" step="0.01" min="1" max="${O.sys}" inputmode="decimal" value="${T != null ? esc(String(T)) : ''}" style="width:110px" data-in="goalT"></div>
    ${picks.length ? `<div class="hitchips" style="margin-top:6px">${picks.map(([l, v]) => `<button class="chip" data-act="goalPick" data-v="${fmt(v)}">${esc(l)} ${fmt(v)}</button>`).join('')}</div>` : ''}
    <p class="one" id="goalMsg" style="margin-top:8px">${msg}</p>
    <p class="tiny">지금까지 학기당 평균 학점으로 남은 학기를 잡은 계산이에요. 대학마다 반영 과목·학년 비율이 달라 실제 환산 점수와 다를 수 있어요.</p></div>`;
}
IN.goalT = el => { S.rec.goalT = el.value; const O = gradeOutlook(); const box = $('#goalMsg'); if (!O || !box) return; clearTimeout(IN.goalT._t); IN.goalT._t = setTimeout(() => fillIpg().then(() => { const i = $('#goalT'); if (i) { i.focus(); const v = i.value; i.value = ''; i.value = v; } }), 500); };
ACT.goalPick = el => { S.rec.goalT = el.dataset.v; fillIpg(); };
ACT.ipgGo = () => { const i = $('#ipgQ'); S.rec.ipgQ = i ? i.value : ''; S.rec.ipgMore = false; fillIpg(); };
ACT.ipgMore = () => { S.rec.ipgMore = true; fillIpg(); };
ACT.ipgOpen = el => { const n = el.dataset.n; let u = el.dataset.u; const real = (DS['모집2028'] || []).find(r => sameUni(r.대학, u) && (nsp(r.모집단위) === nsp(n) || deptKey(r.모집단위) === deptKey(n))) || (DS['모집2028'] || []).find(r => sameUni(r.대학, u)); if (real) u = real.대학; Object.assign(S.mj, { dept: n, deptName: n, keys: [...unitKeys(n)], view: 'univ', univ: u, utab: el.dataset.tab || 'result', uq: '', umore: false }); go('major'); };

function schoolCasesHTML(u, keys) {
  const cs = (S.teacher.cases || []).filter(c => sameUni(c.대학, u) && (keys || []).some(k => k && nsp(c.학과).includes(k)));
  if (!cs.length) return '';
  return `<h3>우리 학교 선배 사례 <span class="badge vio">이 기기에만 있음</span></h3><div class="tbl-wrap"><table><thead><tr><th>학과</th><th>전형</th><th class="n">내신</th><th>결과</th></tr></thead><tbody>${cs.slice(0, 40).map(c => `<tr><td>${esc(c.학과)}</td><td>${esc(c.전형)}<br><span class="tiny">${esc(c.학년도)}</span></td><td class="n">${esc(c.성적 || '-')}</td><td>${esc(c.결과)}${c.비식별메모 ? `<br><span class="tiny">${esc(c.비식별메모)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
/* ---------- 카페 정리본(2028 시행계획): 모집단위별 전형방법·최저 ---------- */
let CAFE_IDX = null;
function cafeIdx() {
  if (CAFE_IDX) return CAFE_IDX;
  const m = new Map(); (DS['수시2028C'] || []).forEach(x => { const k = uniBase(x.대학명); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
  return (CAFE_IDX = m);
}
function cafeRow(u, r) {
  if (!DS['수시2028C']) return null;
  const list = cafeIdx().get(uniBase(u)) || []; const un = nsp(r.모집단위), dk = deptKey(r.모집단위);
  const c = list.filter(x => nsp(x.모집단위) === un || deptKey(x.모집단위) === dk); if (!c.length) return null;
  // '학생부교과(지역인재전형)' ↔ '지역인재전형'처럼 바깥 유형 이름을 벗겨 비교하고, 유형(교과/종합)이 같은 것만 이름 포함으로 맞춘다
  const tkey = s => nsp(String(s || '').replace(/^(학생부\s*(?:교과|종합)|실기\/?실적|논술)\s*\((.+?)\)(?:_.*)?$/, '$2')).replace(/\(.*?\)/g, '').replace(/전형$/, '');
  const ty = String(r.유형 || ''), sameTy = x => !ty || String(x._유형 || x.전형유형 || '').includes(ty);
  const k = tkey(r.전형);
  return c.find(x => tkey(x.전형명) === k) || c.find(x => sameTy(x) && k.length >= 3 && (tkey(x.전형명).includes(k) || k.includes(tkey(x.전형명)) && tkey(x.전형명).length >= 3)) || null;
}
function howText(x) {
  const part = st => [['학생부교과', '학생부'], ['서류', '서류'], ['면접', '면접'], ['논술', '논술'], ['실기', '실기']].map(([c, l]) => { const v = x[st + '_' + c + '(%)']; return v && +v > 0 ? `${l} ${v}%` : ''; }).filter(Boolean);
  const s1 = part('1단계');
  if (x.선발방식 === '단계별' || +x['2단계_1단계성적(%)'] > 0) {
    const s2 = [+x['2단계_1단계성적(%)'] > 0 ? `1단계 ${x['2단계_1단계성적(%)']}%` : '', ...part('2단계')].filter(Boolean);
    const rate = String(x['1단계_선발비율'] || '').match(/\((\d+(?:\.\d+)?배수)\)/);
    return `1단계 ${s1.join('+') || x['1단계_전형방법'] || ''}${rate ? ' (' + rate[1] + ')' : ''} → 2단계 ${s2.join('+') || x['2단계_전형방법'] || ''}`;
  }
  return s1.join(' + ') || x['1단계_전형방법'] || '';
}
/* ---------- 어디가 전국 입결(2023~2026) → 입결 표 형식으로 펼치기 ---------- */
const ADIGA_SRC = 'https://www.adiga.kr/ucp/prc/uni/admssUnivView.do?menuId=PCPRCINF2000';
function adigaFor(univ, keys) {
  const D = DS['어디가입결']; if (!D) return [];
  const ks = new Set((keys || []).filter(Boolean));
  const rows = D.filter(r => sameUni(r.대학, univ) && (ks.has(deptKey(r.학과)) || [...(r.__uk || (r.__uk = unitKeys(r.학과)))].some(k => ks.has(k)))).sort((a, b) => b.연도 - a.연도);
  const out = [];
  rows.forEach(r => {
    const base = { 대학: r.대학, 학년도: r.연도, 모집시기: '수시', 전형유형: r.유형 === '교과' ? '학생부교과' : r.유형 === '종합' ? '학생부종합' : r.유형, 전형명: r.전형, 모집단위: r.학과,
      모집인원: r.모집인원 && r.모집인원 !== '0' ? r.모집인원 : '', 경쟁률: +r.경쟁률 > 0 ? r.경쟁률 : '', 충원합격: r.충원 !== '' ? r.충원 : '', 성적체계: '9등급', 교육과정: '2015',
      출처유형: '대입정보포털 어디가', 출처URL: ADIGA_SRC, 출처페이지: '정리: 남악고 김현석' };
    const vals = [['최종등록자 50% (등급)', r.등급50], ['최종등록자 70% (등급)', r.등급70]];
    if (+r.만점 > 0) vals.push([`환산 50% (만점 ${r.만점})`, r.변환50], [`환산 70% (만점 ${r.만점})`, r.변환70]);
    const any = vals.some(([, v]) => +v > 0);
    (any ? vals.filter(([, v]) => +v > 0) : [['', '']]).forEach(([k, v]) => out.push({ ...base, 성적기준: k, 성적값: v }));
  });
  return out;
}
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
    <div class="row" style="margin-top:10px"><button class="btn vio" data-act="ivLoad">질문 보기</button>${(() => { const seen = new Set(); return S.cands.filter(c => { const k = c.univ + '|' + c.unit; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6).map(c => `<button class="btn small white" data-act="ivFrom" data-u="${esc(c.univ)}" data-d="${esc(c.unit)}">${esc(c.univ)}${S.cands.some(x => x.univ === c.univ && x.unit !== c.unit) ? ' · ' + esc(c.unit) : ''}</button>`).join(''); })()}</div>
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
ACT.ivLoad = () => { S.iv.picks = {}; S.iv.qtab = ''; S.iv.qmore = {}; ivRender(); };
ACT.ivFrom = el => { S.iv.univ = el.dataset.u; S.iv.dept = el.dataset.d || ''; S.iv.picks = {}; S.iv.qtab = ''; S.iv.qmore = {}; S.iv.phase = ''; go('interview'); };

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
  // 표 머리글('2 진로활동 33 희망분야 …')을 떼고, 평가 문장보다 활동 문장을 고른다
  const clean = t => String(t || '').replace(/^\s*\d?\s*(자율|동아리|진로)활동\s*\d+\s*/, '').replace(/희망\s*분야\s*[가-힣A-Za-z]+(?:\s*(?:계열|분야))?(?:\s*[,·]\s*[가-힣A-Za-z]+(?:\s*(?:계열|분야))?)*\s*/, '');
  const ACT_RE = /(탐구|읽고|읽음|제작|설계|발표|조사|분석|실험|작성|참여|맡아|구성|기획|주제로|연주|토론|해결)/, EVAL_RE = /(학생임|돋보임|우수함|기대됨|인상적임|집중력이 높음)\.?\s*$/;
  const exc = it => { const ss = sentences(clean(it.내용)); const s = ss.find(x => ACT_RE.test(x) && !EVAL_RE.test(x)) || ss.find(x => !EVAL_RE.test(x)) || ss[0] || clean(it.내용); return s.length > 60 ? s.slice(0, 58) + '…' : s; };
  const jong = w => { const t = String(w || '').replace(/[\s'"’”)\]….]+$/, ''); const ch = t.slice(-1); const c = ch.charCodeAt(0) - 0xAC00; if (c >= 0 && c <= 11171) return c % 28; if (/[013678]/.test(ch)) return 1; if (/[A-Za-z]/.test(ch)) return /[lmnr]/i.test(ch) ? 1 : 0; return 0; };
  const PAIR = { '이': ['이', '가'], '가': ['이', '가'], '을': ['을', '를'], '를': ['을', '를'], '은': ['은', '는'], '는': ['은', '는'], '과': ['과', '와'], '와': ['과', '와'] };
  const josaFix = (tpl, vals) => tpl.replace(/\{(키워드|전공|대학|과목|발췌)\}(['’"”]?)(이|가|을|를|은|는|과|와)(?![가-힣])/g, (m, k, q, p) => '{' + k + '}' + q + PAIR[p][jong(vals[k]) ? 0 : 1]);
  const fill = (tpl, it, kw) => josaFix(tpl, { 키워드: kw || '', 전공: major, 대학: univ, 과목: it && it.과목 || '', 발췌: it ? exc(it) : '' }).replace(/\{학년\}/g, it && it.학년 ? it.학년 + '학년' : '').replace(/\{과목\}/g, it && it.과목 ? it.과목 : '')
    .replace(/\{발췌\}/g, it ? exc(it) : '').replace(/\{키워드\}/g, kw || '').replace(/\{전공\}/g, major).replace(/\{대학\}/g, univ).replace(/\s{2,}/g, ' ').trim();
  const pick = (area, n) => items.filter(i => i.영역 === area).sort((a, b) => b.내용.length - a.내용.length).slice(0, n);
  const use = (type, area) => T.filter(t => t.유형 === type && t.적용영역 === area);
  const add = (q, why, tag) => { if (q && !/\{/.test(q) && !out.some(o => o.q === q)) out.push({ q, why, tag }); };
  pick('세특', 3).forEach((it, i) => {
    const kws = keywords(clean(it.내용));
    const a = use('생기부확인', '세특')[0]; if (a) add(fill(a.템플릿, it), a.출제의도, '세특');
    if (kws[0]) { const b = use(['개념설명', '전공연계', '심화'][i % 3], '세특')[0]; if (b) add(fill(b.템플릿, it, kws[0]), b.출제의도, '세특'); }
  });
  ['자율', '동아리', '진로'].forEach(area => { const it = pick(area, 1)[0]; if (!it) return; const a = use('생기부확인', area)[0]; if (a) add(fill(a.템플릿, it), a.출제의도, AREA_NAME[area]);
    const kw = keywords(clean(it.내용))[0]; const b = T.find(t => t.적용영역 === area && t.유형 !== '생기부확인'); if (b && (kw || !/\{키워드\}/.test(b.템플릿))) add(fill(b.템플릿, it, kw), b.출제의도, AREA_NAME[area]); });
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
  const has = v => v && !/^[-–·\s]*$/.test(String(v));
  const critCard = c => `<div class="item"><h4>${esc(c.전형)} <span class="badge">${esc(c.유형)}</span></h4>
      ${has(c.면접방식) ? `<p style="margin:2px 0"><b>방식</b> ${esc(c.면접방식)}</p>` : ''}${has(c.면접시간) || has(c.면접유형) ? `<p style="margin:2px 0"><b>시간</b> ${[c.면접시간, c.면접유형].filter(has).map(esc).join(' · ')}</p>` : ''}
      ${c.선발방법 ? `<p style="margin:2px 0"><b>선발</b> ${esc(c.선발방법)}</p>` : ''}${c.면접일 ? `<p style="margin:2px 0"><b>면접일</b> ${esc(c.면접일)}</p>` : ''}
      ${(elemBy[c.전형] || []).length ? `<div class="subs">${elemBy[c.전형].map(e => `<span class="sub plain" title="${esc(e.설명)}">${esc(e.요소)} ${e.비율 ? esc(e.비율) + '%' : ''}</span>`).join('')}</div>` : ''}
      <p class="tiny" style="margin:4px 0 0">출처: ${esc(c.출처 || '-')}</p></div>`;
  // 학과를 넣었으면 그 학과를 뽑는 전형만 앞에, 나머지는 접어 둔다
  const d0 = S.iv.dept, dRows = d0 && u ? DS['모집2028'].filter(r => sameUni(r.대학, u) && (r.모집단위 === d0 || r.모집단위키 === deptKey(d0))) : [];
  const dKeys = d0 ? unitKeys(d0) : null;
  const forDept = c => { if (!d0) return true; const t = String(c.해당모집단위 || ''); if (t.trim() && !/전\s*모집단위|전체/.test(t) && !unitMention(t, dKeys, d0)) return false; return !dRows.length || dRows.some(r => sameTrack(c.전형, r.전형)); };
  const main = crit.filter(forDept), rest = crit.filter(c => !forDept(c));
  const sum1 = c => [c.전형, has(c.면접방식) ? String(c.면접방식).slice(0, 30) : '', has(c.면접일) ? c.면접일 : ''].filter(Boolean).join(' · ');
  const info = u ? `<section class="panel vio"><details class="fold vio" data-fold="ivi|${esc(u)}"${fo('ivi|' + u)} style="margin:0"><summary><span class="sumt"><b>${ic('chat')} ${esc(u)} 면접은 이래요</b><span class="pv">${main[0] ? esc(sum1(main[0])) : crit.length ? esc(sum1(crit[0])) : '면접 방식 자료 없음'}</span></span>${crit.length ? `<span class="cnt">${crit.length}</span>` : ''}</summary><div class="fb">
    ${main.length ? main.slice(0, 3).map(critCard).join('') : crit.length ? '<p class="tiny">이 학과를 짚은 면접 자료는 없어요.</p>' : '<p class="muted">면접 방식 자료가 없어요.</p>'}
    ${[...main.slice(3), ...rest].length ? `<details class="fold" data-fold="ivc|${esc(u)}"${fo('ivc|' + u)}><summary><span class="sumt"><b>다른 전형 ${main.slice(3).length + rest.length}개</b><span class="pv">${[...main.slice(3), ...rest].map(c => esc(c.전형)).join(' · ')}</span></span></summary><div class="fb">${[...main.slice(3), ...rest].map(critCard).join('')}</div></details>` : ''}
    ${qs.length ? `<details class="fold" data-fold="ivq|${esc(u)}"${fo('ivq|' + u)}><summary><span class="sumt"><b>전형별 면접 진행</b></span><span class="cnt">${qs.length}</span></summary><div class="fb">${qs.map(q => `<div class="item"><h4>${esc(q.전형명)} <span class="badge">${esc(q.유형)}</span></h4>${[q.시간, q.반영비율].filter(has).length ? `<p style="margin:2px 0" class="tiny">${[q.시간, q.반영비율].filter(has).map(esc).join(' · ')}</p>` : ''}${has(q.평가요소) ? `<p style="margin:2px 0">${esc(q.평가요소)}</p>` : ''}${has(q['질문/진행방식']) ? `<p class="tiny" style="margin:2px 0">${esc(q['질문/진행방식'])}</p>` : ''}</div>`).join('')}</div></details>` : ''}
    ${guide.length ? `<details class="fold" data-fold="ivg|${esc(u)}"${fo('ivg|' + u)}><summary><span class="sumt"><b>대학 안내</b></span><span class="cnt">${guide.length}</span></summary><div class="fb">${guide.map(g => `<p><span class="badge">${esc(g.항목)}</span> ${esc(g.내용)}</p>`).join('')}</div></details>` : ''}
    <p class="tiny" style="margin-bottom:0">2028 면접은 바뀔 수 있어요. 모집요강으로 확인해 주세요.</p></div></details></section>` : '';
  const Q = ivQuestions();
  const qRow = (r, label) => { const id = 'g' + hash(r.대학 + r.학과 + r.질문); return qItem(id, r.질문, `${label ? esc(label) + ' · ' : ''}${esc(r.연도)} · ${esc(r.출처)}${r.꼬리질문 ? ' · 꼬리: ' + esc(r.꼬리질문.slice(0, 60)) : ''}`); };
  const G3 = [['mine', '이 대학·이 학과', Q.mine, r => r.학과], ['uni', '이 대학 다른 학과', Q.uniOther, r => r.학과], ['same', '같은 학과·다른 대학', Q.same, r => r.대학 || '자료집']];
  let qt = S.iv.qtab; const cur0 = G3.find(g => g[0] === qt);
  if (!cur0 || !cur0[2].length) { const f = G3.find(g => g[2].length); qt = f ? f[0] : 'mine'; }
  const cur = G3.find(g => g[0] === qt), more = (S.iv.qmore || {})[qt], lim = more ? cur[2].length : 5;
  const qtabs = G3.map(([k, label, arr]) => `<button class="tab vio ${k === qt ? 'on' : ''}" data-act="ivQTab" data-k="${k}" aria-pressed="${k === qt}" ${arr.length ? '' : 'disabled'}>${label} <span class="n">${arr.length}</span></button>`).join('');
  const list = cur[2].slice(0, lim).map(r => qRow(r, cur[3](r))).join('');
  box.innerHTML = recQBlock() + info + `<section class="panel vio"><h2>${ic('list')} 기출 질문</h2><p class="one">연습할 질문을 고르세요. 모범답안은 없어요.</p>
    ${Q.mine.length || Q.uniOther.length || Q.same.length ? `<div class="tabs" role="group" aria-label="기출 묶음">${qtabs}</div>${list}
    ${cur[2].length > lim ? `<div class="more"><button class="btn white" data-act="ivQMore" data-k="${qt}">${ic('plus')} 더 보기 (${cur[2].length - lim})</button></div>` : ''}` : '<p class="muted">기출을 못 찾았어요. 학과 이름을 바꿔 보세요.</p>'}</section>
    <div class="row end stickbar"><button class="btn sun" data-act="ivStart">${ic('play')}<span>고른 질문으로 연습 (<span id="pickN">${Object.keys(S.iv.picks).length}</span>)</span></button></div>`;
}
ACT.ivQTab = el => { S.iv.qtab = el.dataset.k; ivRender(); };
ACT.ivQMore = el => { S.iv.qmore = Object.assign({}, S.iv.qmore, { [el.dataset.k]: true }); ivRender(); };
function qItem(id, q, meta) {
  const on = !!S.iv.picks[id];
  return `<label class="confirm qpick ${on ? 'on' : ''}">
    <input type="checkbox" data-in="ivPick" data-id="${esc(id)}" data-q="${esc(q)}" ${on ? 'checked' : ''}><span><b>${esc(q)}</b><br><span class="tiny">${meta}</span></span></label>`;
}
function recQBlock() {
  const rq = recQuestions();
  if (!S.rec.analyzed) return `<section class="panel mint"><h2>내 학생부로 만든 질문</h2><p class="muted">학생부를 넣으면 내 기록으로 질문을 만들어요.</p><button class="btn mint small" data-act="go" data-to="record">학생부 넣기</button> <button class="btn sun small" data-act="demo">가상 학생으로 보기</button></section>`;
  return `<section class="panel mint"><details class="fold mint" data-fold="recq"${fo('recq', true)} style="margin:0"><summary><span class="sumt"><b>${ic('star')} 내 학생부로 만든 질문</b><span class="pv">${rq[0] ? esc(rq[0].q) : '만든 질문이 없어요'}</span></span><span class="cnt">${rq.length}</span></summary><div class="fb">${rq.slice(0, 5).map(x => qItem('r' + hash(x.q), x.q, `${esc(x.tag)} · ${esc(x.why)}`)).join('')}
    ${rq.length > 5 ? `<details class="fold" data-fold="recq2"${fo('recq2')}><summary><span class="sumt"><b>질문 더 보기</b></span><span class="cnt">${rq.length - 5}</span></summary><div class="fb">${rq.slice(5).map(x => qItem('r' + hash(x.q), x.q, `${esc(x.tag)} · ${esc(x.why)}`)).join('')}</div></details>` : ''}</div></details></section>`;
}
IN.ivPick = el => {
  if (el.checked) S.iv.picks[el.dataset.id] = el.dataset.q; else delete S.iv.picks[el.dataset.id];
  const lab = el.closest('label'); lab.classList.toggle('on', el.checked);
  const n = $('#pickN'); if (n) n.textContent = Object.keys(S.iv.picks).length;
};
ACT.ivStart = () => {
  let q = Object.values(S.iv.picks);
  if (!q.length) q = $$('[data-in=ivPick]').slice(0, 5).map(i => i.dataset.q);
  if (!q.length) { toast('질문을 먼저 골라 주세요.'); return; }
  Object.assign(S.iv, { queue: q, i: 0, phase: 'think', answers: q.map(x => ({ q: x, a: '', checks: [false, false, false] })) });
  render(); startTimer(); window.scrollTo(0, 0);
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
    <circle id="ringA" cx="75" cy="75" r="62" fill="none" stroke="#FFD36E" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="0" transform="rotate(-90 75 75)"/><text id="ringT" x="75" y="86" text-anchor="middle">${I.phase === 'think' ? I.think : 90}초</text></svg>`;
  const ph = { think: 0, answer: 1, check: 2 }[I.phase] ?? 0;
  const prog = `<div class="pstep"><span class="qn">질문 ${I.i + 1}/${I.queue.length}</span><ol aria-label="연습 단계">${['① 생각', '② 답', '③ 점검'].map((t, k) => `<li class="${k === ph ? 'on' : k < ph ? 'done' : ''}"${k === ph ? ' aria-current="step"' : ''}>${t}</li>`).join('')}</ol></div>`;
  let body = '';
  if (I.phase === 'think') body = `<p class="qbig">${esc(cur.q)}</p>${ring}
    <div class="seg" style="max-width:420px;margin:8px auto" role="group" aria-label="생각 시간">${[15, 30, 60].map(s => `<button data-act="ivThink" data-v="${s}" aria-pressed="${I.think === s}">${s}초</button>`).join('')}</div>
    <div class="row" style="justify-content:center"><button class="btn sun" data-act="ivNextPhase">답하기 ${ic('next')}</button></div>`;
  else if (I.phase === 'answer') body = `<p class="qbig">${esc(cur.q)}</p>
    <div class="seg" style="max-width:420px;margin:0 auto 10px" role="group" aria-label="답하는 방법"><button data-act="ivMode" data-v="write" aria-pressed="${I.mode === 'write'}">글로 쓰기</button><button data-act="ivMode" data-v="speak" aria-pressed="${I.mode === 'speak'}">말로 하기</button></div>
    ${ring}${I.mode === 'write' ? `<label class="anslab" for="ivA">내 답</label><textarea id="ivA" data-in="ivA" placeholder="결론부터, 내 경험으로.">${esc(cur.a)}</textarea>` : '<p>소리 내어 답해 보세요. 90초 안에!</p>'}
    <div class="row" style="justify-content:center;margin-top:10px"><button class="btn sun" data-act="ivNextPhase">셀프 체크 ${ic('next')}</button></div>`;
  else body = `<p class="qbig" style="font-size:1.1rem">${esc(cur.q)}</p>
    ${cur.a && cur.a.trim() ? `<details class="myans" open><summary>내가 쓴 답</summary><p>${esc(cur.a)}</p></details>` : `<p class="tiny" style="margin:0 0 6px">${I.mode === 'speak' ? '말로 답했어요. 떠올려 보고 체크해 보세요.' : '쓴 답이 없어요.'}</p>`}
    <div class="checks">${['결론을 먼저 말했나요?', '내 경험이 근거로 들어갔나요?', '배운 점·달라진 점을 말했나요?'].map((t, k) => `<label><input type="checkbox" data-in="ivChk" data-k="${k}" ${cur.checks[k] ? 'checked' : ''}>${t}</label>`).join('')}</div>
    <div class="row" style="justify-content:center"><button class="btn white" data-act="ivRetry">다시 답하기</button><button class="btn sun" data-act="ivNextQ">${I.i + 1 < I.queue.length ? '다음 질문 ' + ic('next') : '마치기'}</button></div>`;
  return `<section class="practice" data-phase="${esc(I.phase)}">${prog}${body}</section><div class="row end" style="margin-top:12px"><button class="btn white" data-act="ivQuit">그만하기</button></div>`;
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
    <div class="cvrow"><div><label class="f" for="cvV">값</label><input id="cvV" type="number" step="0.01" value="${esc(cv.v)}" data-in="cvV" placeholder="${cv.mode === 'pct' ? '예: 34' : cv.mode === 'single' ? '예: 4' : '예: 2.53'}"></div>
    <div id="cvOut" class="cvout">${convOut()}</div></div>
    <p class="tiny" style="margin:8px 0 0">입결 화면의 '5등급 눈금≈'는 이 평균 환산(한 점)이고, 성적 화면의 '5등급 참고'는 과목별 환산을 모은 범위예요.</p></section>
    <section class="panel navy"><h2>학교 사례 보관함 <span class="badge">${T.cases.length}건</span></h2>
    <p class="one">실제 합불 사례는 공통 자료와 섞지 않고 이 화면에만 둬요.</p>
    <div class="row"><label class="btn white" style="position:relative">CSV 가져오기<input type="file" accept=".csv,text/csv" data-in="caseCSV" style="position:absolute;opacity:0;inset:0;width:100%;cursor:pointer" aria-label="사례 CSV 가져오기"></label>
      <button class="btn white" data-act="saveDlg" data-scope="teacher">${ic('lock')} 암호 파일로 저장/열기</button></div>
    <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr>${CASE_COLS.map(c => `<th>${c}</th>`).join('')}<th>5등급 눈금</th><th></th></tr></thead><tbody>
    ${T.cases.map((c, i) => `<tr>${CASE_COLS.map(k => `<td>${esc(c[k])}</td>`).join('')}<td>${/9/.test(c.성적체계) && gradeMean9(c.성적) != null ? '≈' + fmt(gradeMean9(c.성적)) : '-'}</td><td><button class="btn small danger" data-act="caseDel" data-i="${i}" aria-label="사례 지우기">${ic('close')}</button></td></tr>`).join('') || `<tr><td colspan="${CASE_COLS.length + 2}" class="muted">아직 사례가 없어요.</td></tr>`}
    </tbody></table></div>
    <details class="fold" data-fold="caseform"${fo('caseform')}><summary><span class="sumt"><b>${ic('plus')} 사례 직접 추가</b><span class="pv">대학·학과·전형·성적·결과</span></span></summary><div class="fb">
    <div class="grid2">${CASE_COLS.map(c => `<div><label class="f" for="cs_${c}">${c}</label>${c === '성적체계' ? `<select id="cs_${c}"><option>9등급제</option><option>5등급제</option><option>미확인</option></select>` : c === '결과' ? `<select id="cs_${c}"><option>결과 미확인</option><option>최초합격</option><option>충원합격</option><option>불합격</option></select>` : `<input id="cs_${c}" type="text" maxlength="${c === '비식별메모' ? 200 : 40}" placeholder="${esc(CASE_PH[c] || '')}">`}</div>`).join('')}</div>
    <p class="tiny">이름·학번 등 사람을 알아볼 수 있는 정보는 넣지 마세요. 적은 인원 학과는 재식별 위험이 있어요.</p>
    <div class="row"><button class="btn" data-act="caseAdd">사례 추가</button></div>
    <p class="tiny">CSV는 이 열만 읽어요: ${CASE_COLS.join(', ')}</p></div></details></section>`;
}
const CASE_PH = { 대학: '예: 경남대', 학과: '예: 간호학과', 전형: '예: 학생부교과', 학년도: '예: 2026', 교육과정: '예: 2015 개정', 성적: '예: 2.53', 비식별메모: '예: 면접 준비 기간 짧았음' };
function convOut() {
  const { mode, v } = S.teacher.conv, x = Number(v);
  if (v === '' || !isFinite(x)) return '<p class="muted" style="margin:0">값을 넣으면 바로 보여 줘요.</p>';
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
    <hr>
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
      // 형식 검사: 망가진 파일이어도 인쇄·화면이 멈추지 않게 문자열만 받는다
      const strMap = v => { const o2 = {}; if (v && typeof v === 'object' && !Array.isArray(v)) Object.entries(v).slice(0, 400).forEach(([k, x]) => { if (typeof x === 'string') o2[k] = x.slice(0, 4000); }); return o2; };
      if (o.check && typeof o.check === 'object') S.check = { univ: typeof o.check.univ === 'string' ? o.check.univ : '', answers: strMap(o.check.answers), shown: Object.fromEntries(Object.keys(strMap(o.check.answers)).map(k => [k, !!(o.check.shown || {})[k]])) };
      if (Array.isArray(o.cands)) { S.cands = o.cands.filter(c => c && typeof c.univ === 'string' && typeof c.전형 === 'string').slice(0, 6); saveCands(); }
      if (o.iv && Array.isArray(o.iv.answers)) S.iv.answers = o.iv.answers.filter(a => a && typeof a.q === 'string').slice(0, 50).map(a => ({ q: a.q.slice(0, 500), a: typeof a.a === 'string' ? a.a.slice(0, 4000) : '', checks: [0, 1, 2].map(k => !!(Array.isArray(a.checks) && a.checks[k])) }));
      S.rec.grades = S.rec.grades.filter(g => g && typeof g === 'object').map(g => { const x = {}; ['학년', '학기', '교과', '과목', '학점', '등급', '성취도'].forEach(k => (x[k] = g[k] == null ? '' : String(g[k]).slice(0, 60))); return x; });
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
    ${(() => { const O = typeof gradeOutlook === 'function' ? gradeOutlook() : null; if (!O || !O.rem) return ''; return `<p>남은 ${O.rem}학기: 최고 학기(${esc(O.best ? O.best[0] : '-')})만큼 받으면 최종 <b>${fmt(O.withBest)}</b> · 모두 1등급이면 ${fmt(O.all1)}${S.rec.goalT ? ` · 목표 ${esc(S.rec.goalT)} → ` + esc(needShort(Number(S.rec.goalT), O)) : ''}</p>`; })()}
    <h2>기록 근거 (항목별 대표 문장)</h2><table><tbody>${Object.entries(COMP_ITEMS).map(([c, list]) => list.map(k => `<tr><td style="width:30%"><b>${esc(c.replace('역량', ''))}</b> · ${esc(k)}</td><td>${(ev[k] || [])[0] ? esc((ev[k][0].sent || '').slice(0, 95)) + ((ev[k][0].sent || '').length > 95 ? '…' : '') : '<i>찾은 문장 없음</i>'}</td></tr>`).join('')).join('')}</tbody></table>
    <h2>내 지원 후보</h2>${S.cands.length ? `<table><thead><tr><th>대학</th><th>모집단위</th><th>전형 (2028 잠정)</th><th>인원</th><th>수능최저</th></tr></thead><tbody>${S.cands.map(c => { const ms = minFor(c.univ, { 유형: c.유형, 전형: c.전형, 모집단위: c.unit, 모집단위키: c.key }); return `<tr><td>${esc(c.univ)}</td><td>${esc(c.unit)}</td><td>${esc(c.유형)} · ${esc(c.전형)}</td><td>${esc(c.인원)}</td><td>${esc(minPlain(ms))}</td></tr>`; }).join('')}</tbody></table>` : '<p>아직 없음</p>'}
    <h2>스스로 점검 (내가 쓴 답)</h2>${ckAns.length ? ckAns.slice(0, 6).map(([id, v]) => `<p><b>${esc(id.split('|')[1])}</b>: ${esc(v.slice(0, 200))}</p>`).join('') : '<p>아직 없음</p>'}
    <h2>면접 연습한 질문</h2>${S.iv.answers.length ? `<ol>${S.iv.answers.map(a => `<li>${esc(a.q)}</li>`).join('')}</ol>` : '<p>아직 없음</p>'}
    <h2>선생님께 묻고 싶은 것</h2><div class="box"></div>
    <p style="font-size:8.5pt;margin-top:8px">입결·전형은 참고 자료예요. 2028 자료는 시행계획 기준(잠정). 합격 예측이 아니에요. 이 종이에는 이름을 적지 않았어요.</p>`;
  window.print();
};

/* --- 다 지우기 --- */
ACT.wipe = () => {
  if (!confirm('이 화면의 학생부·성적·답을 모두 지울까요? (내 정보 설정과 후보는 남아요)')) return;
  stopTimer();
  // 원본 보기 대화상자(그린 쪽 캔버스·근거 문장)도 비운다
  const dlg = $('#dlg'); if (dlg) { $$('canvas', dlg).forEach(cv => { try { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); } catch (e) { } cv.width = 0; cv.height = 0; }); if (dlg.open) dlg.close(); dlg.classList.remove('wide'); dlg.innerHTML = ''; }
  origReset(); S.rec = newRec(); S.check = { univ: '', answers: {}, shown: {} }; S.iv = Object.assign(S.iv, { queue: [], i: 0, phase: '', answers: [], picks: {} });
  S.teacher.cases = []; $('#print').innerHTML = ''; $$('input[type=file]').forEach(i => { i.value = ''; });
  Object.keys(FOLD).forEach(k => delete FOLD[k]);
  render(); toast('지웠어요.');
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
  const sd = document.getElementById('origSide'); if (sd) { sd.hidden = true; sd.innerHTML = ''; } document.body.classList.remove('withorig');
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
      // 쪽 경계에서 잘린 문장: 앞쪽에서 같은 글자가 이어지는 만큼만 칠하고, 나머지는 다음 쪽 위쪽에서 찾는다
      let next = null;
      if (head === 0) {
        let k = 0; while (k < full.length && P.norm[from + k] === full[k]) k++;
        const Q = ORIG.pages[p + 1];
        if (k >= 6 && k < full.length && Q) {
          const rest = full.slice(k), probe = rest.slice(0, Math.min(12, rest.length)), j = Q.norm.indexOf(probe);
          if (j >= 0 && j < 600) { let n = 0; while (n < rest.length && Q.norm[j + n] === rest[n]) n++; to = from + k; next = { page: p + 2, ...spanOf(Q, j, j + n) }; }
        }
      }
      return { page: p + 1, ...spanOf(P, from, to), next };
    }
  }
  return null;
}
// 글자 조각별로 시작·끝 글자 위치를 모아 문장 부분만 칠한다
function spanOf(P, from, to) {
  const span = new Map();
  for (let k = from; k < to; k++) { const i = P.map[k], c = P.pos[k]; if (i == null) continue; const s = span.get(i); if (!s) span.set(i, [c, c + 1]); else { s[0] = Math.min(s[0], c); s[1] = Math.max(s[1], c + 1); } }
  return { items: [...span.keys()], span };
}
/* 1쪽 학적 표의 '학년 반 번호' 줄(담임 이름 없어도)을 찾아 그 줄 조각을 가린다 */
function origClassRows(P) {
  const lines = new Map();
  P.items.forEach((it, i) => { if (!it.transform || !String(it.str || '').trim()) return; const y = Math.round(it.transform[5] / 3); if (!lines.has(y)) lines.set(y, []); lines.get(y).push(i); });
  const ys = [...lines.keys()].sort((a, b) => b - a), out = new Set(); let on = false;
  for (const y of ys) {
    const idx = lines.get(y).sort((a, b) => P.items[a].transform[4] - P.items[b].transform[4]);
    const s = idx.map(i => P.items[i].str).join(' ').replace(/\s+/g, ' ').trim();
    if (/반\s*번\s*호\s*담임/.test(s)) { on = true; continue; }
    if (on && /^[1-3] \d{1,2} \d{1,3}(?: [가-힣]{2,4})?$/.test(s)) { idx.forEach(i => out.add(i)); continue; }
    if (on && s) on = false;
  }
  return out;
}
function origMaskTerms() {
  const raw = S.rec.raw || '';
  const names = typeof findNames === 'function' ? findNames(raw) : [];
  const extras = String(S.rec.extra || '').split(/[,\n]/).map(s => s.trim()).filter(s => s.length >= 2);
  const out = new Set();
  [...names, ...extras].forEach(n => { out.add(n); if (n.length >= 3) out.add(n.slice(1)); });
  // 1쪽 학적 표 담임 이름('1 1 32 이재익')
  for (const m of raw.matchAll(/(?:^|\n)[ \t]*[1-3][ \t]+(?:\d{1,2}[ \t]+){1,2}\d{1,3}[ \t]+([가-힣]{2,4})[ \t]*(?=\n|$)/g)) out.add(m[1]);
  return [...out].filter(t => t.length >= 2);
}
/* '주소 :' 다음에 이어지는 주소 줄(1~3줄). 1쪽 조각이 이 줄 안에 들어 있으면 가린다 */
function origAddrLines() {
  const raw = S.rec.raw || '', m = raw.match(/주[ \t]*소[ \t]*[:：][^\n]*((?:\n(?![ \t]*(?:학적|특기|학년|성명|성별|\d\.))[^\n]*){0,3})/);
  if (!m) return [];
  const first = (raw.match(/주[ \t]*소[ \t]*[:：]([^\n]*)/) || [])[1] || '';
  return [first, ...m[1].split('\n')].map(s => s.trim()).filter(s => s.length >= 6 && /[가-힣]+(?:도|시|군|구|읍|면|동|로|길|리)(?![가-힣])|\d+\s*(?:동|호)/.test(s));
}
/* 사진 같은 그림 자리: 그리기 명령에서 그림이 놓인 네모를 계산한다 */
async function origImageRects(pg, vp) {
  const U = PDFJS.m.Util, OPS = PDFJS.m.OPS, ol = await pg.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0]; const st = [], out = [];
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i], a = ol.argsArray[i];
    if (fn === OPS.save) st.push(ctm.slice());
    else if (fn === OPS.restore) ctm = st.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = U.transform(ctm, a);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat || fn === OPS.paintJpegXObject) {
      const m = U.transform(vp.transform, ctm);
      const xs = [m[4], m[4] + m[0], m[4] + m[2], m[4] + m[0] + m[2]], ys = [m[5], m[5] + m[1], m[5] + m[3], m[5] + m[1] + m[3]];
      out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]);
    }
  }
  return out;
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
    const terms = origMaskTerms(), cls = origClassRows(P), addr = v.page === 1 ? origAddrLines() : [];
    ctx.fillStyle = '#172C49';
    try { (await origImageRects(pg, vp)).forEach(([x, y, w, h]) => { if (w > 8 && h > 8) ctx.fillRect(x, y, w, h); }); } catch (e) { /* 그림 자리 못 찾으면 넘어감 */ }
    P.items.forEach((it, ii) => {
      const s = it.str || ''; if (!s.trim()) return;
      const t2 = s.trim();
      const hit = cls.has(ii) || maskText(s, S.rec.extra).text !== s || terms.some(t => s.includes(t)) || (t2.length >= 2 && addr.some(l => l.includes(t2)) && !/^(주소|:)$/.test(t2));
      if (hit) { const [x, y, w, h] = rectOf(it); ctx.fillRect(x - 2, y - 2, w + 4, h + 4); }
    });
  }
  let firstY = null;
  const H = v.hit && (v.hit.page === v.page ? v.hit : v.hit.next && v.hit.next.page === v.page ? v.hit.next : null);
  if (H) {
    ctx.fillStyle = 'rgba(255, 200, 0, .42)';
    const rs = [];
    H.items.forEach(i => {
      const it = P.items[i]; if (!it) return; const [x, y, w, h] = rectOf(it);
      const len = String(it.str || '').length || 1; const sp = H.span && H.span.get(i) || [0, len];
      rs.push([x + w * (sp[0] / len), y, x + w * (sp[1] / len), h]);
    });
    // 같은 줄의 단어 조각은 사이 공백까지 이어 칠한다
    rs.sort((a, b) => (Math.abs(a[1] - b[1]) < 3 ? a[0] - b[0] : a[1] - b[1]));
    const merged = [];
    rs.forEach(r => { const m = merged[merged.length - 1]; if (m && Math.abs(m[1] - r[1]) < 3 && r[0] - m[2] < r[3] * 1.6) { m[2] = Math.max(m[2], r[2]); m[3] = Math.max(m[3], r[3]); } else merged.push(r.slice()); });
    merged.forEach(([x0, y, x1, h]) => { ctx.fillRect(x0 - 1, y, (x1 - x0) + 2, h); if (firstY === null || y < firstY) firstY = y; });
  }
  const pgl = $('#origPg'); if (pgl) pgl.textContent = v.page + ' / ' + ORIG.doc.numPages + '쪽';
  const nt = $('#origNote'); if (nt && v.hit) { const pages = [v.hit.page, v.hit.next && v.hit.next.page].filter(Boolean); nt.innerHTML = pages.includes(v.page) ? `<b>${v.page}쪽</b> 노란 칸이 이 문장이에요.${v.hit.next ? ` 문장이 ${v.hit.next.page}쪽으로 이어져요.` : ''}` : `이 문장은 <b>${pages.join('~')}쪽</b>에 있어요. 지금은 ${v.page}쪽이에요.`; }
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
    const sideOK = window.matchMedia('(min-width: 1100px)').matches;
    const html = `
      <div class="origbar">
        <button class="btn small white" data-act="origPage" data-d="-1" aria-label="이전 쪽">${ic('back')}</button>
        <b id="origPg">…</b>
        <button class="btn small white" data-act="origPage" data-d="1" aria-label="다음 쪽">${ic('next')}</button>
        <span class="spacer"></span>
        <button class="btn small white" data-act="origZoom" data-d="-1" aria-label="작게">${ic('minus')}</button>
        <button class="btn small white" data-act="origZoom" data-d="1" aria-label="크게">${ic('plus')}</button>
        <button class="btn small" id="origMaskBtn" data-act="origMask" aria-pressed="true">개인정보 가림 켜짐</button>
      </div>
      <p class="tiny"><span id="origNote">${sent ? (hit ? `<b>${hit.page}쪽</b> 노란 칸이 이 문장이에요.` : '원본에서 정확한 위치를 못 찾았어요. 쪽을 넘겨 확인해 주세요.') : esc(ORIG.name || '')}</span> · 이 화면 밖으로 나가지 않아요.</p>
      <div class="origwrap" id="origWrap"><canvas id="origCv" aria-label="학생부 원본 쪽"></canvas></div>
      ${sent ? `<div class="ev" style="margin-top:10px">${esc(sent)}</div>` : ''}`;
    if (sideOK) origSideOpen(html); else { openDialog('원본에서 보기', html); $('#dlg').classList.add('wide'); }
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

/* 넓은 화면: 원본을 오른쪽에 붙박이로 띄워 두고 기록 근거를 보면서 넘긴다(예전 앱 방식) */
function origSideOpen(html) {
  let sd = document.getElementById('origSide');
  if (!sd) { sd = document.createElement('aside'); sd.id = 'origSide'; sd.className = 'origside'; sd.setAttribute('aria-label', '학생부 원본'); document.body.appendChild(sd); }
  sd.innerHTML = `<div class="origsidehd"><b>${ic('file')} 원본 PDF</b><span class="spacer"></span><button class="btn small white" data-act="origSideClose" aria-label="원본 닫기">${ic('close')} 닫기</button></div><div class="origsidebd">${html}</div>`;
  sd.hidden = false; document.body.classList.add('withorig');
  const d = $('#dlg'); if (d && d.open) { d.classList.remove('wide'); d.close(); }
}
ACT.origSideClose = () => { const sd = document.getElementById('origSide'); if (sd) { sd.hidden = true; sd.innerHTML = ''; } document.body.classList.remove('withorig'); };
/* ---- 09-main.js ---- */
/* ===== 화면 전환 · 이벤트 · 가상 학생 ===== */
let VIEW = 'home';
const VIEWS = {
  home: [viewHome], record: [viewRecord, () => { if (S.rec.step === 3) { if (S.rec.tab === 'check') fillCheck(); if (S.rec.tab === 'fit') { fillFit(); if (typeof fillPath === 'function') fillPath(); } if (S.rec.tab === 'ipg') fillIpg(); } }],
  major: [viewMajor, fillMajor], compare: [viewCompare, fillCompare], rural: [viewRural, fillRural],
  interview: [viewInterview, fillInterview], teacher: [viewTeacher],
  jeongsi: [viewJeongsi, fillJeongsi],
  xuni: [viewXuni, fillXuni]
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
  origReset(); const R = newRec(); R.raw = DEMO; R.demo = true; R.tab = 'grade';
  S.rec = R; go('record'); runRecord('가상 학생이에요. 실제 사람이 아니에요.');
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

/* ---- 10-path.js ---- */
/* ===== 학과 추천 (예전 GAS Path.gs findFits / explorePath / pathAdvice 이식) =====
   들은 과목이 대학 권장과목과 얼마나 겹치는지만 센다. AI·네트워크 호출 없음.
   예전 코드에서 지킨 약속:
   - 지망에 가산점을 얹지 않는다. 지망은 따로 세워 같은 자로 잰 숫자를 보여 준다.
   - 화면의 겹침 %는 성적·학과 이름을 섞지 않은 값이다(순서에만 성적 강약·희망 낱말이 들어간다).
   - 적성·흥미·합격 가능성은 이 숫자에 없다.
   - 대학 기준과 학과사전(커리어넷) 기준은 목록 길이가 달라 한 표에서 줄 세우지 않는다. */

/* 이름 줄이기: 같은 학과를 한 줄로 묶을 때 (예전 normKey_) */
function pathKey(s) {
  let k = nsp(String(s || '').replace(/<[^>]*>/g, '')).replace(/\(.*?\)|\[.*?\]/g, '').replace(/[·\/]/g, '');
  for (let i = 0; i < 2; i++) { const k2 = k.replace(/(학과군|학부|학과|전공|계열|과정|과|부)$/, ''); if (k2 === k || k2.length < 2) break; k = k2; }
  return k || nsp(s);
}
const pathGy = s => { const t = nsp(s).replace(/\(.*$/, ''); return /^기술/.test(t) ? '기술가정정보' : t; };
const PATH_GYO = new Set(['국어', '수학', '영어', '사회', '과학', '한국사', '정보', '체육', '예술', '기술가정정보']);

/* 색인: 데이터는 바뀌지 않으므로 한 번만 만든다 */
let PATH_IX = null;
async function pathIndex() {
  if (PATH_IX) return PATH_IX;
  await need(['학과별권장과목', '권장과목', '학과사전', '과목안내']);
  const known = new Set(), tokGy = {}, show = {};
  DS['과목안내'].forEach(r => { const k = subjNorm(r.과목명); if (!k) return; known.add(k); tokGy[k] = pathGy(r.교과); show[k] = String(r.과목명).trim(); });
  ONLY_2015.forEach(n => known.add(subjNorm(n)));
  EQUIV.forEach(g => g.forEach(n => known.add(subjNorm(n))));
  const keep = list => { const out = [], seen = new Set(); list.forEach(t => { const k = subjNorm(t); if (!k || seen.has(k)) return; if (!known.has(k) && !(k in GYOGWA_WORDS)) return; seen.add(k); out.push(show[k] || t); }); return out; };
  const build = units => { const df = {}; units.forEach(u => { new Set([...u.core, ...u.rec].map(subjNorm)).forEach(k => (df[k] = (df[k] || 0) + 1)); }); return { units, df, N: units.length }; };
  // 대학 기준: 학과별권장과목 + 권장과목(겹치면 앞의 것)
  const uni = [], seenU = new Set();
  [DS['학과별권장과목'], DS['권장과목']].forEach(rows => rows.forEach(r => {
    const id = uniBase(r.대학) + '|' + nsp(r.모집단위); if (seenU.has(id)) return;
    const core = keep(splitSubjects(r.핵심권장과목)), rec = keep(splitSubjects(r.권장과목)).filter(t => !core.includes(t));
    if (!core.length && !rec.length) return; seenU.add(id);
    uni.push({ univ: r.대학, unit: r.모집단위, key: pathKey(r.모집단위), core, rec });
  }));
  // 학과사전(커리어넷): 진로선택 = 핵심, 일반·융합선택 = 권장. 교양○○학부는 계열 묶음이라 뺀다
  const net = [], word = {};
  DS['학과사전'].forEach(r => {
    const nm = String(r.학과명 || '').trim(); if (!nm) return;
    String(r.낱말 || '').split(/\s+/).forEach(w => { if (!w) return; (word[w] = word[w] || []); if (word[w].length < 10) word[w].push(nm); });
    if (/^교양/.test(nm)) return;
    const core = keep(splitSubjects(r.진로선택)), rec = keep([...splitSubjects(r.일반선택), ...splitSubjects(r.융합선택)]).filter(t => !core.includes(t));
    if (!core.length && !rec.length) return;
    net.push({ name: nm, field: r.계열 || '', key: pathKey(nm), core, rec });
  });
  PATH_IX = { uni: build(uni), net: build(net), known, tokGy, word };
  return PATH_IX;
}

/* 기록에 적힌 희망 분야 (학년별) — 예전 희망분야_ */
const PATH_HOPE_STOP = /^(희망|없음|미정|학년|학기|영역|시간|봉사|활동|특기사항|일자|기간|장소|내용|진로|진로활동|해당|사항)$/;
function pathHope() {
  const by = {};
  (S.rec.items || []).filter(it => it.영역 === '진로').forEach(it => {
    const m = String(it.내용 || '').match(/희망\s*분야\s*[:：]?\s*([^\n]{1,40})/); if (!m) return;
    const g = Number(it.학년) || 0, out = (by[g] = by[g] || []);
    const toks = m[1].trim().split(/\s+/);
    for (let i = 0; i < toks.length && i < 6; i++) {
      const raw = toks[i], more = /[,·\/]$/.test(raw);
      raw.split(/[,·\/]/).forEach(x => { x = x.replace(/[.'"()]/g, '').replace(/(계열|분야|쪽)$/, '').trim(); if (x.length >= 2 && x.length <= 10 && /^[가-힣A-Za-z]+$/.test(x) && !PATH_HOPE_STOP.test(x) && !out.includes(x)) out.push(x); });
      if (!more && !/^(계열|분야)$/.test(toks[i + 1] || '')) break;
    }
  });
  const rows = Object.keys(by).map(Number).sort().map(g => ({ g, f: by[g] })).filter(r => r.f.length);
  let all = [...new Set(rows.flatMap(r => r.f))];
  if (!all.length) all = (S.rec.majorWords || []).filter(w => !PATH_HOPE_STOP.test(w));
  // 희망분야 줄이 없으면 진로활동·세특에 자주 나온 학과 낱말로 짐작한다(입결 비교 탭과 같은 규칙)
  let guessed = false;
  if (!all.length && typeof ipgWords === 'function') { const R = S.rec, keep = R.ipgQ; R.ipgQ = null; all = ipgWords().filter(w => !PATH_HOPE_STOP.test(w)); R.ipgQ = keep; guessed = all.length > 0; }
  let flow = '';
  if (rows.length >= 2) {
    const a = rows[0].f, b = rows[rows.length - 1].f;
    const ov = a.filter(x => b.some(y => y.includes(x) || x.includes(y)));
    flow = !ov.length ? '바뀜' : (ov.length === a.length && a.length === b.length ? '그대로' : '넓어짐');
  }
  return { rows, all, flow, guessed };
}

/* 한 기준(핵심·권장 목록)과 들은 과목 맞대기 — 예전 재기/겹치기 */
function pathMeasure(core, rec, ix, ctx) {
  const one = list => {
    let pt = 0, full = 0, pure = 0, pureFull = 0; const hit = [], chk = [], miss = [], strong = new Set();
    list.forEach(t => {
      const k = subjNorm(t), st = subjStatus(t, ctx.taken, ctx.gy); if (!st) return;
      const gy = PATH_IX.tokGy[k] || (k in GYOGWA_WORDS ? pathGy(k) : ''); const mul = ctx.mul[gy] ?? 1;
      let w = Math.max(0.15, Math.log(ix.N / (ix.df[k] || 1)));
      if (!PATH_IX.known.has(k)) w *= 0.15; // '수학, 과학'처럼 교과 이름만 적은 기준은 가려 낼 힘이 없다
      pureFull += w;
      if (st !== 'no') { full += w; pt += w * mul; pure += w; (st === 'ok' ? hit : chk).push(t); if (mul > 1) strong.add(gy); }
      else { full += w * (mul < 1 ? 2 : 1); miss.push(t); } // 성적이 어려웠던 교과에서 빠진 과목은 순서에서만 더 무겁게
    });
    return { pt, full, r: full ? Math.min(1, pt / full) : null, pr: pureFull ? pure / pureFull : null, hit, chk, miss, strong };
  };
  const H = one(core), R = one(rec), total = H.full + R.full;
  if (total < 2.5) return null; // 국어·영어만 적은 곳처럼 정보가 없는 기준은 버린다
  const mix = (a, b) => a == null ? b : b == null ? a : 0.75 * a + 0.25 * b;
  return {
    score: mix(H.r, R.r) * (total / (total + 6)),
    ov: Math.round(mix(H.pr, R.pr) * 100), // 화면 숫자: 성적을 얹지 않은 겹침
    hc: H.hit.length + H.chk.length, ht: H.hit.length + H.chk.length + H.miss.length,
    rc: R.hit.length + R.chk.length, rt: R.hit.length + R.chk.length + R.miss.length,
    hit: [...H.hit, ...R.hit], chk: [...H.chk, ...R.chk], miss: [...H.miss, ...R.miss], coreMiss: H.miss,
    strong: [...new Set([...H.strong, ...R.strong])]
  };
}

function pathCompute() {
  const P = S.rec.path, ix = PATH_IX;
  const { taken, gy } = takenSets();
  // 성적 강약: 9등급 강 ≤3·약 ≥6, 5등급 강 ≤2·약 ≥4 (예전 문턱 그대로)
  const sys = S.rec.system || sysOf(S.profile.curr), lo = sys === 5 ? 2 : 3, hi = sys === 5 ? 4 : 6;
  const agg = {};
  (S.rec.grades || []).forEach(r => { const g = Number(r.등급), c = Number(r.학점) || 1; if (!(g >= 1 && g <= 9) || !r.교과) return; const k = pathGy(r.교과); (agg[k] = agg[k] || { s: 0, w: 0 }); agg[k].s += g * c; agg[k].w += c; });
  const mul = {}, strong = [], weak = [];
  Object.entries(agg).forEach(([k, v]) => { const a = v.s / v.w; if (a <= lo) { mul[k] = 1.25; strong.push([k, a]); } else if (a >= hi) { mul[k] = 0.75; weak.push([k, a]); } });
  const ctx = { taken, gy, mul };
  const hope = pathHope();
  const interest = String(S.profile.interest || '').split(/[,·\/\s]+/).map(s => s.trim()).filter(s => s.length >= 2);
  const wishWords = [...new Set([...hope.all, ...interest])];
  // 학과사전 낱말 맞대기: 낱말이 걸리는 학과가 적을수록 무겁게
  const dict = {}, dictWhy = {};
  wishWords.forEach(w => { const list = ix.word[w]; if (!list) return; const wt = 1 / Math.sqrt(list.length); list.forEach(nm => { const k = pathKey(nm); dict[k] = (dict[k] || 0) + wt; (dictWhy[k] = dictWhy[k] || []); if (!dictWhy[k].includes(w)) dictWhy[k].push(w); }); });
  const bonus = name => {
    const bare = String(name).replace(/(학과군|학부|학과|전공|계열|과정)$/, '');
    const hw = wishWords.filter(w => name.includes(w) || (bare.length >= 2 && w.includes(bare)));
    const k = pathKey(name), d = dict[k] || 0;
    return { add: 0.25 * Math.min(2, hw.length) + Math.min(0.3, 0.1 * d), hw, dw: dictWhy[k] || [] };
  };
  // 대학 기준 → 같은 이름 묶기
  const rows = [];
  ix.uni.units.forEach(u => { if (P.buk && !isBUK(u.univ)) return; const c = pathMeasure(u.core, u.rec, ix.uni, ctx); if (!c) return; const b = bonus(u.unit); rows.push({ ...u, ...c, b, s: c.score + b.add }); });
  rows.sort((a, b) => b.s - a.s || b.ht - a.ht);
  const groups = new Map();
  rows.forEach(x => { if (!groups.has(x.key)) groups.set(x.key, { ...x, unis: [], n: 0 }); const g = groups.get(x.key); g.n++; if (g.unis.length < 6 && !g.unis.includes(uniBase(x.univ))) g.unis.push(uniBase(x.univ)); });
  const cands = [...groups.values()];
  // 지망: 점수에 얹지 않고 따로 세운다
  let wish = null;
  if (P.unit) {
    const wk = pathKey(P.unit);
    const exact = P.univ ? rows.find(x => x.key === wk && sameUni(x.univ, P.univ)) : null, sim = rows.find(x => x.key === wk);
    const use = exact || sim, rank = cands.findIndex(g => g.key === wk) + 1;
    const hw = hope.all.filter(w => P.unit.includes(w) || w.includes(P.unit.replace(/(학과군|학부|학과|전공|계열|과정)$/, '')));
    wish = { use, same: !!exact, rank, total: cands.length, canCompare: hope.all.length > 0, off: hope.all.length > 0 && !hw.length, overlapWords: hw };
  }
  // 어느 쪽으로 가도 쓰이는 과목: 위 후보 10곳의 기준에 거듭 나오는 과목(교과 이름만 적은 것은 뺀다)
  const common = [];
  const top10 = cands.slice(0, 10);
  if (top10.length >= 3) {
    const cnt = {};
    top10.forEach(g => new Set([...g.hit, ...g.chk, ...g.miss].map(t => subjNorm(t))).forEach(k => { if (ix.known.has(k)) cnt[k] = (cnt[k] || 0) + 1; }));
    const th = Math.max(2, Math.ceil(top10.length * 0.4));
    const nameOf = k => { for (const g of top10) { const t = [...g.hit, ...g.chk, ...g.miss].find(x => subjNorm(x) === k); if (t) return t; } return k; };
    Object.entries(cnt).filter(([, n]) => n >= th).forEach(([k, n]) => { const t = nameOf(k); common.push({ t, n, st: subjStatus(t, taken, gy) }); });
    common.sort((a, b) => b.n - a.n || (a.st === 'no' ? 0 : 1) - (b.st === 'no' ? 0 : 1));
  }
  // 학과사전 기준(대학이 과목을 안 밝힌 학과): 따로 모으고, 과목 목록이 같은 학과는 한 줄로
  const seenKey = new Set(cands.map(g => g.key)), fp = new Map(), net = [];
  if (!P.buk) ix.net.units.forEach(u => { if (seenKey.has(u.key)) return; const c = pathMeasure(u.core, u.rec, ix.net, ctx); if (!c) return; const b = bonus(u.name); net.push({ ...u, ...c, b, s: c.score + b.add }); });
  net.sort((a, b) => b.s - a.s);
  const netG = [];
  net.forEach(x => { const f = x.core.join('|') + '#' + x.rec.join('|'); const g = fp.get(f); if (g) { if (g.same.length < 4) g.same.push(x.name); return; } x.same = []; fp.set(f, x); netG.push(x); });
  // 교육과정: 2015 이름이면 겹침이 낮게 나올 수 있다
  const sel = [...taken].filter(k => !/^(국어|수학|영어|한국사|통합사회|통합과학|과학탐구실험)$/.test(k) && !/^공통/.test(k) && !/^(통합|과학탐구실험|한국사)[12]$/.test(k));
  const old = sel.filter(k => ONLY_2015.map(subjNorm).includes(k)).length;
  const curr = sel.length < 6 ? 'few' : (old / sel.length >= 0.3 ? '2015' : '2022');
  const best = Math.max(0, ...cands.slice(0, 3).map(g => g.ov));
  return { cands, wish, common, net: netG, hope, strong, weak, sys, lo, hi, curr, sel: sel.length, best, wishWords };
}

/* ---------- 화면 ---------- */
const PATH_STATE = { '정함': '지망 학과를 맨 위에 따로 세우고, 권장과목에서 빠진 과목을 보여 줘요.', '미정': '아직 좁히지 않아도 돼요. 어느 쪽으로 가도 쓰이는 과목을 먼저 보세요.', '바뀜': '진로가 바뀌어도 지금까지의 기록은 그대로 쓸 수 있어요. 기록의 희망과 지금 지망이 어떻게 다른지 먼저 보세요.' };
const pathChip = (t, st) => `<span class="sub ${st || 'no'}">${esc(t)}</span>`;
function pathReason(g) {
  const r = [];
  if (g.b.hw.length) r.push(`희망 '${g.b.hw.slice(0, 2).join(', ')}'`);
  const got = [...g.hit, ...g.chk].slice(0, 3);
  if (got.length) r.push(`${got.join('·')} 들음`);
  if (g.strong.length) r.push(`성적 좋은 ${g.strong.slice(0, 2).join('·')}`);
  if (!g.b.hw.length && g.b.dw.length) r.push(`학과사전 낱말 '${g.b.dw.slice(0, 2).join(', ')}'`);
  if (g.coreMiss.length) r.push(`아직 안 보임: ${g.coreMiss.slice(0, 2).join('·')}`);
  return r.join(' · ') || '권장과목 겹침으로만 잡았어요';
}
function pathRow(g) {
  return `<tr><td><b>${esc(dispName(g.unit))}</b><br><span class="tiny">${esc(g.unis.join(', '))}${g.n > g.unis.length ? ` 외 ${g.n - g.unis.length}곳` : ''}</span></td>
    <td class="n"><b>${g.ov}%</b></td><td class="n">${g.ht ? `${g.hc}/${g.ht}` : '-'}</td>
    <td><span class="tiny">${esc(pathReason(g))}</span></td>
    <td><button class="btn small white" data-act="mjDept" data-name="${esc(g.unit)}">학과 보기</button></td></tr>`;
}
async function fillPath() {
  const box = $('#pathBox'); if (!box) return;
  S.rec.path = S.rec.path || { state: '', unit: (S.rec.fit && S.rec.fit.unit) || '', univ: (S.rec.fit && S.rec.fit.univ) || '', buk: false };
  const P = S.rec.path;
  await pathIndex();
  if (!$('#pathBox')) return;
  const C = pathCompute();
  const later = S.profile.grade === '고1' || S.profile.grade === '고2';
  const st = P.state || (P.unit ? '정함' : '미정');
  const seg = (v, t) => `<button data-act="pathState" data-v="${v}" aria-pressed="${st === v}">${t}</button>`;
  const units = [...new Set(PATH_IX.uni.units.map(u => dispName(u.unit)))].sort((a, b) => a.localeCompare(b, 'ko'));
  const unis = uniOptions(PATH_IX.uni.units.map(u => u.univ));

  // 기록의 희망 분야 흐름
  const H = C.hope;
  const hopeHTML = H.rows.length ? `<p class="statline">기록의 희망 분야: ${H.rows.map(r => `${r.g ? r.g + '학년 ' : ''}<b>${esc(r.f.join(', '))}</b>`).join(' → ')}</p>
    ${H.flow === '바뀜' ? '<p class="note">처음과 마지막 희망 분야가 달라요. 바뀐 이유와 그 사이에 무엇을 이어 왔는지 면접에서 물을 수 있어요.</p>' : H.flow === '넓어짐' ? '<p class="note">희망 분야가 이어지면서 넓어졌어요. 어느 쪽이 중심인지 정리해 두세요.</p>' : H.flow === '그대로' ? '<p class="note">학년마다 희망 분야가 같아요. 학년별로 이어진 활동을 설명하기 좋아요.</p>' : ''}`
    : (H.all.length ? `<p class="statline">${H.guessed ? '기록에서 짐작한 희망 낱말' : '희망 낱말'}: <b>${esc(H.all.join(', '))}</b>${H.guessed ? ' <span class="tiny">(희망분야 칸이 없어 진로활동 낱말로 짐작)</span>' : ''}</p>` : '<p class="tiny">진로활동에서 희망 분야를 못 찾았어요. 아래 지망 학과를 적으면 그것으로 봐요.</p>');

  // (1) 지망
  let wishHTML = '';
  const W = C.wish;
  if (W) {
    if (!W.use) wishHTML = `<div class="note"><b>지망 ${esc(P.unit)}</b>: 이 이름으로 과목을 밝힌 대학 자료가 없어요. 권장과목 탭에서 학과사전 기준으로 볼 수 있어요.</div>`;
    else {
      const u = W.use;
      wishHTML = `<h3>지망 · ${esc(W.same ? uniBase(u.univ) + ' ' : '')}${esc(dispName(u.unit))}${W.same ? '' : ' <span class="badge">같은 이름 학과 기준</span>'}</h3>
        ${W.same ? '' : `<p class="tiny">${esc(uniBase(u.univ))} 자료로 맞대어 봤어요.</p>`}
        <div class="stats"><div class="stat vio"><span>과목 겹침</span><b>${u.ov}%</b></div>
          <div class="stat mint"><span>핵심 권장</span><b>${u.ht ? `${u.hc}<small> / ${u.ht}</small>` : '—'}</b></div>
          <div class="stat apri"><span>권장</span><b>${u.rt ? `${u.rc}<small> / ${u.rt}</small>` : '—'}</b></div>
          ${W.rank ? `<div class="stat sun"><span>후보 ${W.total}곳 중</span><b>${W.rank}<small>번째</small></b></div>` : ''}</div>
        <div class="legend"><span class="ok">들었어요</span><span class="chk">이름이 비슷한 과목</span><span class="no">아직 안 보여요</span></div>
        <div class="subs">${u.hit.map(t => pathChip(t, 'ok')).join('')}${u.chk.map(t => pathChip(t, 'chk')).join('')}${u.miss.map(t => pathChip(t, 'no')).join('')}</div>
        ${u.coreMiss.length ? `<p class="one">핵심 권장 중 아직 안 보이는 과목: <b>${esc(u.coreMiss.join(', '))}</b>${later ? ' · 남은 학기에 들을 수 있는지 편성표를 확인해요.' : ''}</p>` : '<p class="one">핵심 권장과목은 다 보여요.</p>'}
        <p class="tiny">순서에 지망 가산점은 없어요. 지금 들은 과목이 얼마나 겹치는지일 뿐, 적성이나 합격 가능성이 아니에요.</p>`;
    }
    // (3) 기록 희망과 지망
    if (!W.canCompare) wishHTML += `<p class="tiny">진로활동에 희망 분야가 없어 지망과 같은 쪽인지는 말할 수 없어요.</p>`;
    else if (W.off) wishHTML += `<div class="warn"><b>기록과 지망이 달라요.</b> 기록의 희망은 <b>${esc(H.all.slice(0, 4).join(', '))}</b>, 지망은 <b>${esc(P.unit)}</b>이에요. 진로가 바뀐 건지, 기록이 아직 못 따라온 건지 먼저 이야기해 보세요.</div>`;
    else wishHTML += `<p class="note">기록의 희망과 지망이 이어져요. 겹치는 낱말: <b>${esc(W.overlapWords.join(', '))}</b></p>`;
  }

  // (2) 후보
  const top = C.cands.slice(0, 12), more = C.cands.slice(12, 24);
  const trust = C.best >= 70 ? '겹침이 뚜렷해요. 그래도 적성과 흥미는 이 숫자에 없어요.' : C.best >= 50 ? '겹침이 중간쯤이에요. 위아래 몇 개는 순서가 쉽게 바뀔 수 있어요.' : `가장 높은 겹침이 ${C.best}%예요. 아직 들은 선택과목이 적어 가려내기 어려워요. 과목을 더 들은 뒤 다시 보세요.`;
  const head = '<thead><tr><th>학과 (대학)</th><th class="n">겹침</th><th class="n">핵심</th><th>이유</th><th></th></tr></thead>';
  const candHTML = top.length ? `<h3>들은 과목으로 본 학과 ${C.cands.length}곳 중 위 ${top.length}곳</h3>
    <p class="tiny">${esc(trust)}</p>
    <div class="tbl-wrap"><table>${head}<tbody>${top.map(pathRow).join('')}</tbody></table></div>
    ${more.length ? `<details class="fold" data-fold="pathMore"${fo('pathMore')}><summary><span class="sumt"><b>더 보기</b><span class="pv">${more.length}곳</span></span></summary><div class="fb"><div class="tbl-wrap"><table>${head}<tbody>${more.map(pathRow).join('')}</tbody></table></div></div></details>` : ''}`
    : '<div class="empty"><strong>맞대어 볼 과목을 못 찾았어요</strong>성적 탭에서 과목이 제대로 읽혔는지 확인해 주세요.</div>';

  // 학과사전 기준
  const netHTML = C.net.length ? `<details class="fold" data-fold="pathNet"${fo('pathNet')}><summary><span class="sumt"><b>대학이 과목을 안 밝힌 학과</b><span class="pv">학과사전(커리어넷) 기준 · ${C.net.length}곳</span></span></summary><div class="fb">
    <p class="tiny">학과 일반 기준이라 위 표와 같은 자가 아니에요. 그래서 따로 줄 세웠어요.${C.curr === '2015' ? ' 학과사전은 2022 개정 과목 이름이라 2015 과목은 낮게 나올 수 있어요.' : ''}</p>
    <div class="tbl-wrap"><table><thead><tr><th>학과</th><th class="n">겹침</th><th>이유</th><th></th></tr></thead><tbody>${C.net.slice(0, 12).map(g => `<tr><td><b>${esc(g.name)}</b><br><span class="tiny">${esc(g.field)}${g.same.length ? ' · 같은 과목: ' + esc(g.same.join(', ')) : ''}</span></td><td class="n"><b>${g.ov}%</b></td><td><span class="tiny">${esc(pathReason(g))}</span></td><td><button class="btn small white" data-act="mjDept" data-name="${esc(g.name)}">학과 보기</button></td></tr>`).join('')}</tbody></table></div></div></details>` : '';

  // (4) 어느 쪽에도 쓰이는 과목
  const commonHTML = C.common.length && (st !== '정함' || !P.unit) ? `<h3>어느 쪽으로 가도 쓰이는 과목</h3>
    <p class="tiny">위 후보 ${Math.min(10, C.cands.length)}곳의 권장과목에 거듭 나오는 과목이에요. 숫자는 몇 곳에 나왔는지예요.</p>
    <div class="subs">${C.common.slice(0, 10).map(c => `<span class="sub ${c.st || 'no'}">${esc(c.t)} <span class="tiny">· ${c.n}곳${c.st === 'ok' ? ' · 들었어요' : ''}</span></span>`).join('')}</div>` : '';

  // 할 일 (예전 pathAdvice)
  const todo = [];
  if (S.profile.grade === '고1') todo.push(['과목은 아직 고를 수 있어요', '2학년·3학년 과목 선택이 남았어요. 지금 안 들은 과목은 아직 고르는 중이에요.']);
  else if (S.profile.grade === '고2') todo.push(['3학년 과목 선택이 남았어요', W && W.use && W.use.coreMiss.length ? `${W.use.coreMiss.join(', ')}이 학교에 열리는지 편성표로 확인해요.` : '권장과목이 학교에 열리는지 편성표로 확인해요.']);
  else todo.push(['과목은 이미 정해졌어요', '못 들은 과목이 있다면, 개설되지 않은 사정과 무엇으로 대신 채웠는지 말할 수 있게 준비해요.']);
  const empty = Object.entries(S.rec.evidence || {}).filter(([, v]) => !v.length).map(([k]) => k);
  if (empty.length) todo.push(['기록 근거를 못 찾은 평가 항목', `${empty.join(', ')} · ${later ? '남은 학기에 채울 수 있는 자리예요. 없는 역량이 아니라 안 적힌 기록이에요.' : '면접에서 말로 설명할 자리예요.'}`]);
  const todoHTML = `<details class="fold" data-fold="pathTodo"${fo('pathTodo', true)}><summary><span class="sumt"><b>지금 할 일</b><span class="pv">${esc(todo[0][0])}</span></span><span class="cnt">${todo.length}</span></summary><div class="fb">
    ${todo.map(([t, d]) => `<p style="margin:0 0 8px"><b>${esc(t)}</b><br><span class="tiny">${esc(d)}</span></p>`).join('')}</div></details>`;

  // 성적 강약·교육과정 안내
  const gText = C.strong.length || C.weak.length ? `<p class="tiny">순서에 반영한 성적: ${C.strong.length ? `잘한 교과 ${C.strong.map(([k, a]) => `${esc(k)} ${fmt(a)}`).join(', ')}` : ''}${C.strong.length && C.weak.length ? ' · ' : ''}${C.weak.length ? `어려웠던 교과 ${C.weak.map(([k, a]) => `${esc(k)} ${fmt(a)}`).join(', ')}` : ''} <span class="tiny">(${C.sys}등급제: ${C.lo}등급 이내 / ${C.hi}등급 이상 기준)</span></p>` : '';
  const currText = C.curr === '2015' ? '<div class="warn">2015 개정 과목 이름이 많아요. 권장과목 자료는 2022 개정 이름이 섞여 있어, 비슷한 과목은 노란색(이름이 비슷한 과목)으로 보여요. 숫자보다 빠진 과목 칸을 보세요.</div>'
    : C.curr === 'few' ? `<div class="note">읽은 선택과목이 ${C.sel}개뿐이라 겹침을 믿기 어려워요. 성적 탭에서 과목이 다 읽혔는지 확인해요.</div>` : '';

  box.innerHTML = `<section class="panel vio"><h2>${ic('compass')} 학과 추천</h2>
    <p class="one">들은 과목과 대학 권장과목이 얼마나 겹치는지 봤어요.</p>
    <div class="seg" role="group" aria-label="진로 상태" style="max-width:420px">${seg('정함', '정했어요')}${seg('미정', '아직이에요')}${seg('바뀜', '바뀌었어요')}</div>
    <p class="tiny">${esc(PATH_STATE[st])}</p>
    <div class="grid2"><div><label class="f" for="pathUnit">지망 학과 <span class="tiny">(선택)</span></label><input id="pathUnit" type="search" list="pathUnitList" data-in="pathUnit" value="${esc(P.unit)}" placeholder="예: 간호학과" autocomplete="off"><datalist id="pathUnitList">${units.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
    <div><label class="f" for="pathUniv">지망 대학 <span class="tiny">(선택)</span></label><input id="pathUniv" type="search" list="pathUnivList" data-in="pathUniv" value="${esc(P.univ)}" placeholder="예: 부산대" autocomplete="off"><datalist id="pathUnivList">${unis.map(o => `<option value="${esc(o.label)}">`).join('')}</datalist></div></div>
    <div class="row" style="margin-top:8px"><label class="confirm"><input type="checkbox" data-in="pathBuk" ${P.buk ? 'checked' : ''}>부울경 대학만</label><span class="spacer"></span><button class="btn vio" data-act="pathGo">다시 보기</button></div>
    ${hopeHTML}${currText}${wishHTML}${candHTML}${netHTML}${commonHTML}${gText}${todoHTML}
    <p class="tiny" style="margin-top:8px">겹침 %는 권장과목을 실제로 들었는지만 센 값이에요. 줄 세우는 순서에는 성적과 희망 낱말이 들어가요. 적성·흥미·합격 가능성은 어디에도 없어요. 후보를 좁히는 데 쓰고, 고르는 일은 학생과 선생님이 해요.</p></section>`;
}
IN.pathUnit = el => { (S.rec.path = S.rec.path || {}).unit = el.value.trim(); };
IN.pathUniv = el => { (S.rec.path = S.rec.path || {}).univ = el.value.trim(); };
IN.pathBuk = el => { (S.rec.path = S.rec.path || {}).buk = el.checked; fillPath(); };
ACT.pathState = el => { (S.rec.path = S.rec.path || {}).state = el.dataset.v; fillPath(); };
ACT.pathGo = () => { const P = (S.rec.path = S.rec.path || {}); const u = $('#pathUnit'), v = $('#pathUniv'); if (u) P.unit = u.value.trim(); if (v) P.univ = v.value.trim(); if (P.unit && !P.state) P.state = '정함'; fillPath(); };

/* ---- 11-jeongsi.js ---- */
/* ===== 정시 탐색 (2028 시행계획 · 우리 진학자료 카페 정리본) =====
   CSS 추가 필요:
   .jsbar{display:flex;height:10px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.08);margin-top:4px;max-width:360px}
   .jsbar i{display:block;height:100%}
   .jslegend{display:flex;gap:8px;flex-wrap:wrap;font-size:.8rem;color:var(--sub);margin-top:3px}
   .jslegend b{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:3px;vertical-align:middle}
   .jsfac h4{margin:10px 0 4px;font-size:.85rem;color:var(--sub)}
   .jsfac .chip{min-height:34px;padding:4px 11px;font-size:.85rem}
   .jsfac .chip small{margin-left:4px;font-weight:600;color:var(--sub)}
   .jsuni{margin:14px 0 6px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
   .jsrow>summary{display:grid;grid-template-columns:auto 1fr auto;gap:4px 12px;align-items:start}
   .jsrow .jsm{grid-column:2/4;font-size:.86rem;color:var(--sub)}
   .jsgt td,.jsgt th{padding:2px 6px;font-size:.8rem;text-align:center}
   @media (max-width:640px){.jsrow>summary{grid-template-columns:auto 1fr}.jsrow .jscnt{grid-column:2}}
*/
S.js = S.js || { q: '', sel: {}, more: false, open: null, uniMore: {} };
const JS_GROUPS = [
  { k: 'region', label: '지역', col: '광역', vals: ['서울', '경기·인천', '충청', '강원', '호남·제주', '영남'] },
  { k: 'gun', label: '모집군', col: '_군', vals: ['가', '나', '다', '군외', '기타'], name: { 가: '가군', 나: '나군', 다: '다군', 군외: '군외', 기타: '기타·미정' } },
  { k: 'type', label: '전형 유형', col: '_유형', vals: ['수능위주', '실기위주'] },
  { k: 'who', label: '지원 대상', col: '_대상', vals: ['일반', '지역인재', '기회균형', '농어촌', '특성화·재직자', '장애인 등', '재외·외국인', '특기자·실기'] },
  { k: 'line', label: '계열', col: '_계열', vals: ['인문', '자연', '예체능', '통합'] },
  { k: 'rec', label: '학생부 반영', col: '_학생부', vals: ['있음', '없음'] },
  { k: 'iv', label: '면접', col: '_면접', vals: ['있음', '없음'] }
];
const JS_PART = [['국', '수능_국어(%)', '국어', 'var(--rose)'], ['수', '수능_수학(%)', '수학', 'var(--mint)'], ['영', '수능_영어(%)', '영어', 'var(--sun)'], ['탐', '수능_탐구(%)', '탐구', 'var(--vio)'], ['사', '수능_통합사회(%)', '통합사회', 'var(--apri)'], ['과', '수능_통합과학(%)', '통합과학', '#6FC3FF']];
let JS_HAY = null;
const jsVals = (r, col) => String(r[col] || '').split('|').map(s => s.trim()).filter(Boolean);
function jsPrep() {
  const rows = DS['정시2028'] || [];
  if (JS_HAY && JS_HAY.length === rows.length) return rows;
  JS_HAY = rows.map(r => [r.대학명, r.단과대학, r.모집단위, r.전형명, r.모집군].filter(Boolean).join(' ').toLowerCase());
  JS_HAY.tags = rows.map(r => Object.fromEntries(JS_GROUPS.map(g => [g.k, jsVals(r, g.col)])));
  return rows;
}
/* 국·수·영·탐 비율 + 우수영역 선택(가중치 합) */
function jsParts(r) {
  let out = JS_PART.map(([n, c, name, color]) => ({ n, name, color, v: Number(r[c]) || 0 })).filter(x => x.v > 0);
  // 2028 수능: 탐구 % = 통합사회 % + 통합과학 % (원자료 2,263행 모두 일치). 나눠 적힌 행은 탐구를 막대에서 빼 겹치지 않게
  const tamV = out.some(x => x.n === '사' || x.n === '과') ? (out.find(x => x.n === '탐') || {}).v : null;
  if (tamV != null) out = out.filter(x => x.n !== '탐');
  const w = String(r['선택반영_가중치(우수순)'] || '').split(',').map(Number).filter(x => x > 0);
  const sel = w.reduce((a, b) => a + b, 0);
  if (sel) out.push({ n: '선', name: '선택(' + (r['선택반영_대상영역'] || '') + ')', color: 'var(--sub)', v: sel });
  return { out, w, area: r['선택반영_대상영역'] || '', tamV };
}
function jsBars(r, legend) {
  const { out, w, area, tamV } = jsParts(r); if (!out.length) return '';
  const tot = out.reduce((s, x) => s + x.v, 0) || 100;
  const sk = out.filter(x => x.n === '사' || x.n === '과').map(x => x.n + ' ' + x.v).join('·');
  const txt = out.filter(x => x.n !== '선' && !(tamV != null && (x.n === '사' || x.n === '과'))).map(x => x.n + ' ' + x.v).concat(tamV != null ? ['탐 ' + tamV + '(' + sk + ')'] : []).join(' · ') + (w.length ? (out.length > 1 ? ' · ' : '') + '선택(' + esc(area) + ') ' + w.join('/') : '');
  return `<div class="jsbar" role="img" aria-label="${esc(out.map(x => x.name + ' ' + x.v + '%').join(', '))}">${out.map(x => `<i style="width:${(x.v / tot * 100).toFixed(1)}%;background:${x.color}"></i>`).join('')}</div>
    ${legend ? `<div class="jslegend">${out.map(x => `<span><b style="background:${x.color}"></b>${esc(x.name)} ${x.v}%</span>`).join('')}</div>` : `<div class="tiny">${txt}</div>`}`;
}
function jsMethod(r) {
  const m = r['1단계_전형방법'] || [['수능', r['1단계_수능(%)']], ['학생부', r['1단계_학생부(%)']], ['실기', r['1단계_실기(%)']], ['면접', r['1단계_면접(%)']]].filter(x => Number(x[1]) > 0).map(x => x[0] + ' ' + x[1] + '%').join(' + ');
  return m || '';
}
// 검색어로 거른 줄 번호는 검색어가 바뀔 때만 다시 센다(조건 칩 건수 계산마다 반복하지 않게)
let JS_QC = { q: null, idx: null };
function jsSearch() {
  const rows = jsPrep();
  if (JS_QC.q === S.js.q && JS_QC.n === rows.length) return JS_QC.idx;
  const terms = smartTerms(S.js.q), idx = [];
  for (let i = 0; i < rows.length; i++) if (!terms.length || smartHit(terms, JS_HAY[i])) idx.push(i);
  JS_QC = { q: S.js.q, n: rows.length, idx };
  return idx;
}
function jsPass(skip) {
  const out = [];
  for (const i of jsSearch()) {
    const tg = JS_HAY.tags[i]; let ok = true;
    for (const g of JS_GROUPS) { if (g.k === skip) continue; const s = S.js.sel[g.k]; if (s && s.length && !s.some(v => tg[g.k].includes(v))) { ok = false; break; } }
    if (ok) out.push(i);
  }
  return out;
}
function jsFacHTML() {
  return JS_GROUPS.map(g => {
    const pass = jsPass(g.k), cnt = {};
    pass.forEach(i => JS_HAY.tags[i][g.k].forEach(v => (cnt[v] = (cnt[v] || 0) + 1)));
    const sel = S.js.sel[g.k] || [];
    const chips = g.vals.filter(v => cnt[v] || sel.includes(v)).map(v => `<button class="chip ${sel.includes(v) ? 'on' : ''}" data-act="jsChip" data-g="${g.k}" data-v="${esc(v)}" aria-pressed="${sel.includes(v)}">${esc((g.name || {})[v] || v)}<small>${(cnt[v] || 0).toLocaleString()}</small></button>`).join('');
    return chips ? `<h4>${esc(g.label)}</h4><div class="chips" style="margin:0;justify-content:flex-start">${chips}</div>` : '';
  }).join('');
}
function jsRowHTML(i) {
  const r = DS['정시2028'][i], tg = JS_HAY.tags[i];
  const gun = tg.gun.length ? tg.gun.map(g => g === '군외' || g === '기타' ? g : g + '군').join('·') : (r.모집군 || '-');
  const flags = [S.profile.rural && tg.who.includes('농어촌') ? '<span class="badge sun">농어촌</span>' : '', r.선발방식 === '단계별' ? '<span class="badge">단계별</span>' : '', tg.iv.includes('있음') ? '<span class="badge vio">면접</span>' : '', tg.type.includes('실기위주') ? '<span class="badge apri">실기</span>' : '', String(r.정원구분 || '').includes('외') ? '<span class="badge">정원외</span>' : ''].filter(Boolean).join(' ');
  const key = 'js|' + i, open = S.js.open === i;
  return `<details class="fold jsrow" data-fold="${key}"${open ? ' open' : ''}><summary data-act="jsOpen" data-i="${i}">
    <span class="badge mint">${esc(gun)}</span>
    <span><b>${esc(r.모집단위 || '-')}</b> ${flags}<br><span class="tiny">${[r.전형명, r.단과대학, r.계열].filter(Boolean).map(esc).join(' · ')}</span></span>
    <span class="n jscnt"><b>${r.모집인원 ? esc(r.모집인원) : ''}</b><span class="tiny">${r.모집인원 ? '명' : '약간명'}</span></span>
    <span class="jsm">${esc(jsMethod(r))}${jsBars(r, false)}</span></summary><div class="fb" id="jsD${i}">${open ? jsDetailHTML(i) : ''}</div></details>`;
}
function jsGradeTable(r, k) {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(g => r[k + '_' + g + '등급']);
  if (!v.some(x => x !== '' && x != null)) return '';
  return `<div class="tbl-wrap"><table class="jsgt"><thead><tr><th>${k}</th>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(g => `<th>${g}</th>`).join('')}</tr></thead><tbody><tr><td class="tiny">등급별</td>${v.map(x => `<td>${esc(x || '-')}</td>`).join('')}</tr></tbody></table></div>`;
}
function jsDetailHTML(i) {
  const r = DS['정시2028'][i];
  const kv = list => { const t = list.filter(x => x[1] != null && String(x[1]).trim() !== ''); return t.length ? `<div class="tbl-wrap"><table><tbody>${t.map(([k, v]) => `<tr><th style="width:26%">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>` : ''; };
  const { w, area } = jsParts(r);
  const st2 = r.선발방식 === '단계별';
  let h = jsBars(r, true);
  h += kv([
    ['전형방법', st2 ? `1단계 ${r['1단계_선발비율'] || ''} ${r['1단계_전형방법'] || ''} → 2단계 ${r['2단계_전형방법'] || [['1단계', r['2단계_1단계성적(%)']], ['수능', r['2단계_수능(%)']], ['학생부', r['2단계_학생부(%)']], ['실기', r['2단계_실기(%)']], ['면접', r['2단계_면접(%)']]].filter(x => Number(x[1]) > 0).map(x => x[0] + ' ' + x[1] + '%').join(' + ')}` : jsMethod(r)],
    ['수능 활용지표', r['수능_활용지표']], ['수능 반영방식', r['수능_반영방식']],
    ['선택반영', w.length ? `${area} (우수순 ${w.join('·')}%)` : ''],
    ['탐구', [r['탐구_반영과목수'] ? r['탐구_반영과목수'] + '과목' : '', r['탐구_산출방법']].filter(Boolean).join(' · ')],
    ['가산점', r['가산_대상'] ? `${r['가산_대상']} ${r['가산_비율(%)'] ? r['가산_비율(%)'] + '%' : ''}` : ''],
    ['영어', r['영어_반영방식']], ['한국사', r['한국사_반영방식']], ['수능 비고', r['수능_비고']]
  ]);
  const et = jsGradeTable(r, '영어'), ht = jsGradeTable(r, '한국사');
  if (et || ht) h += `<p class="tiny" style="margin:8px 0 2px">등급별 환산 점수</p>${et}${ht}`;
  h += kv([['학생부 반영교과', r['반영교과']], ['출결', r['출결반영']], ['지원자격', r['지원자격']], ['수능최저', r['수능최저학력기준'] && r['수능최저학력기준'] !== '없음' ? r['수능최저학력기준'] : ''], ['비고', r['비고']], ['소재지', [r.지역, r.광역].filter(Boolean).join(' · ')]]);
  return h;
}
function jsResHTML() {
  const pass = jsPass(null), g = new Map();
  pass.forEach(i => { const u = DS['정시2028'][i].대학명; if (!g.has(u)) g.set(u, []); g.get(u).push(i); });
  const unis = [...g.entries()];
  const people = pass.reduce((s, i) => s + (Number(DS['정시2028'][i].모집인원) || 0), 0);
  const lim = S.js.more ? unis.length : 12;
  const head = `<p class="statline"><b>${unis.length.toLocaleString()}</b>개 대학 · <b>${pass.length.toLocaleString()}</b>개 모집단위 · ${people.toLocaleString()}명</p>`;
  if (!pass.length) return head + '<div class="empty"><strong>맞는 모집단위가 없어요</strong>검색어를 줄이거나 조건을 풀어 보세요.</div>';
  const body = unis.slice(0, lim).map(([u, idx]) => {
    const n = S.js.uniMore[u] ? idx.length : 15;
    const reg = DS['정시2028'][idx[0]].지역;
    return `<div class="jsuni"><h3 style="margin:0">${esc(u)}</h3><span class="tiny">${esc(reg || '')} · ${idx.length}개 모집단위</span></div>
      ${idx.slice(0, n).map(jsRowHTML).join('')}
      ${idx.length > n ? `<button class="btn white small" data-act="jsUni" data-u="${esc(u)}">이 대학 더 보기 (${idx.length - n})</button>` : ''}`;
  }).join('');
  return head + body + (unis.length > lim ? `<button class="btn white" data-act="jsMore" style="margin-top:12px">대학 더 보기 (${unis.length - lim})</button>` : '');
}
function viewJeongsi() {
  return vhead('apri', '정시 탐색', '2028 시행계획 기준(잠정)', 'major') + '<div id="jsBox">불러오는 중…</div>';
}
function jsDraw() {
  const f = $('#jsFac'), r = $('#jsRes'), c = $('#jsFacN');
  if (f) f.innerHTML = jsFacHTML();
  if (c) { const n = JS_GROUPS.reduce((s, g) => s + ((S.js.sel[g.k] || []).length), 0); c.textContent = n ? n + '개 선택' : ''; }
  if (r) r.innerHTML = jsResHTML();
}
async function fillJeongsi() {
  const box = $('#jsBox'); if (!box) return;
  await need(['정시2028']); jsPrep();
  if (!(DS['정시2028'] || []).length) { box.innerHTML = '<div class="empty"><strong>정시 자료가 없어요</strong></div>'; return; }
  box.innerHTML = `<section class="panel apri">
    <label class="f" for="jsQ">대학·모집단위·전형 검색</label>
    <input id="jsQ" type="search" data-in="jsQ" value="${esc(S.js.q)}" placeholder="예: 부산 의대 / ㄱㅊㄷ 간호 / 카이스트" style="width:100%" autocomplete="off">
    <p class="tiny" style="margin:4px 0 0">띄어쓰기는 '그리고'. 초성·약칭(연대·교대·의대)도 돼요.</p>
    <details class="fold jsfac" data-fold="jsfac"${fo('jsfac', false)}><summary><span class="sumt"><b>조건 좁히기</b><span class="pv" id="jsFacN"></span></span></summary><div class="fb"><div id="jsFac"></div>
      <button class="btn white small" data-act="jsReset" style="margin-top:10px">조건 모두 풀기</button></div></details>
  </section>
  <section class="panel"><div id="jsRes"></div>
    <p class="tiny" style="margin-top:12px">2028학년도 시행계획(2026.4 공표본) 정리. 지원 전 대학 모집요강을 꼭 확인하세요.</p></section>`;
  jsDraw();
}
IN.jsQ = el => { S.js.q = el.value; S.js.more = false; S.js.open = null; clearTimeout(IN.jsQ._t); IN.jsQ._t = setTimeout(jsDraw, 250); };
ACT.jsChip = el => {
  const g = el.dataset.g, v = el.dataset.v, s = (S.js.sel[g] = S.js.sel[g] || []);
  const at = s.indexOf(v); if (at >= 0) s.splice(at, 1); else s.push(v);
  S.js.more = false; S.js.open = null; jsDraw();
};
ACT.jsReset = () => { S.js.sel = {}; S.js.more = false; S.js.open = null; jsDraw(); };
ACT.jsMore = () => { S.js.more = true; const r = $('#jsRes'); if (r) r.innerHTML = jsResHTML(); };
ACT.jsUni = el => { S.js.uniMore[el.dataset.u] = true; const r = $('#jsRes'); if (r) r.innerHTML = jsResHTML(); };
// 줄을 누르면 그 자리에서 상세를 펼친다(상세는 열 때만 만든다)
ACT.jsOpen = el => {
  const i = +el.dataset.i, d = el.closest('details'); if (!d) return;
  const willOpen = !d.open; d.open = willOpen; S.js.open = willOpen ? i : null;
  if (willOpen) { const b = document.getElementById('jsD' + i); if (b && !b.innerHTML) b.innerHTML = jsDetailHTML(i); }
};

/* ---- 12-xuni.js ---- */
/* ===== 과학기술원·특수대학 코너 (자료: 우리 진학자료 카페 2028 시행계획 정리본) =====
   CSS 추가 필요:
.xu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin:10px 0 16px}
.xu-card{border:1px solid var(--line);border-radius:18px;padding:14px;background:rgba(255,255,255,.04);display:flex;flex-direction:column;gap:8px}
.xu-hd{display:flex;align-items:center;gap:10px}
.xu-mark{flex:none;min-width:58px;height:44px;padding:0 8px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:900;font-size:.82rem;letter-spacing:-.2px}
.xu-hd h3{margin:0;font-size:1rem;line-height:1.3}
.xu-big{font-size:1.6rem;font-weight:900;line-height:1.1}
.xu-big small{font-size:.8rem;font-weight:600;color:var(--sub);margin-left:4px}
.xu-list{list-style:none;margin:0;padding:0;font-size:.88rem}
.xu-list li{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px dashed var(--line)}
.xu-list li span:last-child{flex:none;font-variant-numeric:tabular-nums}
.xu-card .fold{margin-top:4px}
@media (max-width:640px){.xu-grid{grid-template-columns:1fr}}
*/
const XU_SCI = [
  { n: '한국과학기술원(KAIST)', short: 'KAIST', c: '#1b4f9c', loc: '대전', free: true },
  { n: '포항공과대학교', short: 'POSTECH', c: '#b0263b', loc: '경북 포항', free: false },
  { n: '광주과학기술원(GIST)', short: 'GIST', c: '#6d2c91', loc: '광주', free: true },
  { n: '대구경북과학기술원(DGIST)', short: 'DGIST', c: '#0f7d8c', loc: '대구', free: true },
  { n: '울산과학기술원(UNIST)', short: 'UNIST', c: '#1d7f4e', loc: '울산', free: true },
  { n: '한국에너지공과대학교(KENTECH)', short: 'KENTECH', c: '#c76a12', loc: '전남 나주', free: true }
];
const XU_SP = [
  { n: '육군사관학교', short: '육사', c: '#3f5a2c' }, { n: '해군사관학교', short: '해사', c: '#1d3a6b' }, { n: '공군사관학교', short: '공사', c: '#2f6ca8' },
  { n: '국군간호사관학교', short: '국간사', c: '#7a3b5c' }, { n: '경찰대학', short: '경찰대', c: '#24324a' }
];
const xuState = () => (S.xu = S.xu || { open: {} });

function viewXuni() {
  return vhead('apri', '과학기술원·특수대학', '수시 6회 제한 밖 학교 모음', 'major') + '<div id="xuBox">불러오는 중…</div>';
}
const xuNum = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return isFinite(n) ? n : 0; };
const xuShortType = t => String(t || '').replace('학생부', '').replace('위주', '') || '-';
function xuSummary(name) {
  const s = DS['수시2028C'].filter(r => r.대학명 === name), j = DS['정시2028'].filter(r => r.대학명 === name);
  const by = new Map();
  s.forEach(r => { const k = r.전형명 || '-'; if (!by.has(k)) by.set(k, { n: 0, type: r.전형유형 }); by.get(k).n += xuNum(r.모집인원); });
  const total = s.reduce((a, r) => a + xuNum(r.모집인원), 0), jt = j.reduce((a, r) => a + xuNum(r.모집인원), 0);
  return { s, j, by, total, jt, loc: (s[0] || j[0] || {}).지역 || '' };
}
/* 1단계·2단계 퍼센트 열을 묶어 한 줄로 */
function xuMethod(r) {
  const part = (st, keys) => keys.map(([c, l]) => { const v = String(r[st + '_' + c] || '').trim(); return v && v !== '0' && v !== '-' ? `${l} ${v.replace(/%$/, '')}%` : ''; }).filter(Boolean);
  const k1 = [['학생부교과(%)', '교과'], ['서류(%)', '서류'], ['면접(%)', '면접'], ['논술(%)', '논술'], ['실기(%)', '실기']];
  const a = part('1단계', k1); const e1 = String(r['1단계_기타'] || '').trim(); if (e1 && e1 !== '-') a.push(e1);
  const b = part('2단계', [['1단계성적(%)', '1단계'], ...k1]); const e2 = String(r['2단계_기타'] || '').trim(); if (e2 && e2 !== '-') b.push(e2);
  const sel = String(r['1단계_선발비율'] || '').trim();
  if (b.length) return `1단계 ${a.join(' + ') || String(r['1단계_전형방법'] || '-')}${sel ? ` (${sel})` : ''} → 2단계 ${b.join(' + ')}`;
  return a.join(' + ') || String(r['1단계_전형방법'] || r['2단계_전형방법'] || '-');
}
function xuMin(r) {
  const m = String(r.수능최저학력기준 || '').trim();
  if (!m || /^(없음|-|미적용)$/.test(m) || r._최저 === '없음') return '<span class="badge mint">없음</span>';
  return `<span class="tiny">${esc(m.length > 60 ? m.slice(0, 60) + '…' : m)}</span>`;
}
const xuHasIv = r => r._면접 === '있음' || /면접/.test([r['1단계_면접(%)'], r['2단계_면접(%)'], r['1단계_전형방법'], r['2단계_전형방법']].join(' ').replace(/^[\s0-]*$/, ''));
function xuCard(u, isSci) {
  const m = xuSummary(u.n);
  const rule = isSci ? (u.free ? '<span class="badge mint">수시 6회 지원 제한 미적용</span>' : '<span class="badge sun">수시 6회 지원 횟수에 포함</span>') : '<span class="badge mint">수시 6회·정시 군 제한 미적용</span>';
  const hd = `<div class="xu-hd"><div class="xu-mark" style="background:${u.c}">${esc(u.short)}</div><div style="min-width:0"><h3>${esc(u.n)}</h3><span class="tiny">${esc(u.loc || m.loc)}</span></div></div>`;
  if (!m.s.length && !m.j.length) return `<div class="xu-card">${hd}<div class="note">데이터 없음 · 학교 누리집에서 확인해 주세요.</div></div>`;
  const list = [...m.by.entries()].map(([t, v]) => `<li><span>${esc(t)} <span class="tiny">${esc(xuShortType(v.type))}</span></span><span>${v.n ? fmt(v.n, 0) + '명' : '–'}</span></li>`).join('');
  const key = 'xu|' + u.n, open = !!xuState().open[u.n];
  const rows = open ? m.s.map(r => `<tr><td><b>${esc(r.모집단위 || '-')}</b>${r.단과대학 ? `<br><span class="tiny">${esc(r.단과대학)}</span>` : ''}</td><td>${esc(r.전형명)}<br><span class="tiny">${esc(xuShortType(r.전형유형))}${r.정원구분 ? ' · ' + esc(r.정원구분) : ''}</span></td><td class="n">${esc(r.모집인원 || '-')}</td><td><span class="tiny">${esc(xuMethod(r))}</span></td><td>${xuMin(r)}</td><td>${xuHasIv(r) ? '<span class="badge vio">면접</span>' : '<span class="tiny">—</span>'}</td></tr>`).join('') : '';
  return `<div class="xu-card">${hd}
    <div class="xu-big">${fmt(m.total, 0)}<small>명 · 수시 ${m.s.length}개 모집단위</small></div>${rule}
    <ul class="xu-list">${list}${m.j.length ? `<li><span>정시</span><span>${fmt(m.jt, 0)}명</span></li>` : ''}</ul>
    ${m.s.length ? `<details class="fold" data-fold="${esc(key)}"${open ? ' open' : ''}><summary data-act="xuOpen" data-u="${esc(u.n)}"><span class="sumt"><b>모집단위 보기</b><span class="pv">${m.s.length}행 · 전형방법·수능최저·면접</span></span></summary><div class="fb">
      ${open ? `<div class="tbl-wrap"><table><thead><tr><th>모집단위</th><th>전형</th><th class="n">인원</th><th>전형방법</th><th>수능최저</th><th>면접</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}</div></details>` : ''}
  </div>`;
}
async function fillXuni() {
  const box = $('#xuBox'); if (!box) return;
  await need(['수시2028C', '정시2028']);
  box.innerHTML = `<section class="panel apri"><h2>${ic('star')} 6회 제한 밖 학교</h2>
    <p class="one">KAIST·GIST·DGIST·UNIST·KENTECH는 개별 법률로 세워진 학교라 수시 6회 지원 횟수에 들어가지 않아요.</p>
    <p class="one">POSTECH(포항공과대)은 일반 사립대라 6회 안에 포함돼요. 사관학교·경찰대도 6회 제한과 정시 군 제한 밖이에요.</p>
    <p class="tiny">인원은 2028 시행계획 수시 모집인원 합계예요(약간명·이월 제외). 지원 횟수 규정은 해당 연도 모집요강과 대교협 안내로 다시 확인하세요.</p></section>
    <h2 style="margin:14px 0 4px">과학기술원·이공계 특성화대학 <span class="tiny">6곳</span></h2>
    <div class="xu-grid">${XU_SCI.map(u => xuCard(u, true)).join('')}</div>
    <h2 style="margin:14px 0 4px">특수목적대학 <span class="tiny">사관학교·경찰대학</span></h2>
    <div class="xu-grid">${XU_SP.map(u => xuCard(u, false)).join('')}</div>`;
}
ACT.xuOpen = (el, e) => {
  const u = el.dataset.u, st = xuState(); st.open[u] = !st.open[u];
  if (e) e.preventDefault();
  const y = window.scrollY; fillXuni().then(() => window.scrollTo(0, y));
};

/* ---- 13-calc.js ---- */
/* ===== 대학별 반영 교과 평균 · 수능최저 충족 점검 =====
   근거: 카페 정리본(2028 시행계획)의 '반영교과'·'수능최저학력기준' 문장.
   - 반영 교과 평균: 그 대학이 보는 교과만 골라 학점 가중 평균(상위 N과목이면 N개). 대학 환산점수 전체가 아니라 '이 대학 기준 내 평균'.
   - 등급 점수: 문장에 5단계 점수표(예: 100·90·80·70·0)가 있고 5등급제 학생이면 등급 점수 평균을 참고로 보여 준다(성취도·기본점수 제외).
   - 수능최저: '탐구 1과목 중 2개 영역 등급 합 7 이내' 같은 흔한 형식만 자동 판정, 못 읽으면 '직접 확인'. */

const REF_GROUPS = [['국어', /국어/], ['수학', /수학/], ['영어', /영어/], ['사회', /사회/], ['과학', /과학/], ['한국사', /한국사/], ['기술·가정/정보', /기술|정보/], ['제2외국어/한문', /제2외국어|한문/]];
function refRule(text) {
  const t = String(text || '').replace(/(\d),(\d{3})/g, '$1$2');
  if (!t || /종합평가|정성평가\(서류|서류 종합/.test(t) && !/석차|등급/.test(t)) return null;
  const head = t.split(/\s\/\s/)[0];
  let groups = REF_GROUPS.filter(([, re]) => re.test(head)).map(([g]) => g);
  if (/수학\s*미반영/.test(t)) groups = groups.filter(g => g !== '수학');
  if (/과학\s*미반영/.test(t)) groups = groups.filter(g => g !== '과학');
  if (/사회\s*미반영/.test(t)) groups = groups.filter(g => g !== '사회');
  if (!groups.length) return null;
  // '진로선택 상위 3과목' 같은 가산 항목은 빼고 본 반영의 상위 N과목만 잡는다
  const top = [...head.matchAll(/(?:상위|우수)\s*(\d{1,2})\s*(?:개\s*)?과목/g)].find(m => !/(진로|융합|성취도|가산)[^,]{0,8}$/.test(head.slice(0, m.index))) || head.match(/(?:^|[^\d])(\d{1,2})\s*과목\s*[:：]/);
  const per = head.match(/(?:교과별|각)[^,]{0,15}?(\d)\s*과목씩/) || head.match(/교과별\s*상위\s*(\d)\s*과목/);
  const total = head.match(/총\s*(\d{1,2})\s*과목/);
  const socOrSci = /사회[^,]{0,24}?(또는|\/)\s*과학/.test(head);
  const unweighted = /(?:이수\s*)?(?:학점|단위수?)\s*미반영/.test(t);
  // 5단계 점수표: 100·90·80·70·0 / 200·160·120·80·0 / 50/40/30/10/0
  let pts = null; const pm = t.match(/(\d{1,4}(?:\.\d+)?)\s*[·\/,]\s*(\d{1,4}(?:\.\d+)?)\s*[·\/,]\s*(\d{1,4}(?:\.\d+)?)\s*[·\/,]\s*(\d{1,4}(?:\.\d+)?)\s*[·\/,]\s*(\d{1,4}(?:\.\d+)?)(?!\s*[·\/,]\s*\d)/);
  if (pm) { const a = pm.slice(1, 6).map(Number); if (a[0] > a[4] && a.every((v, i) => i === 0 || v <= a[i - 1])) pts = a; }
  const ratio = t.match(/등급\s*(\d{2})%\s*\+\s*성취도\s*(\d{2})%/);
  return { groups, top: top ? +top[1] : null, per: per ? +per[1] : null, total: total ? +total[1] : null, socOrSci, unweighted, pts, ratio: ratio ? [+ratio[1], +ratio[2]] : null, text: t };
}
function gradeGroup(r) {
  const s = (r.교과 || '') + ' ' + (r.과목 || '');
  if (/^한국사/.test(r.과목 || '') || /^한국사/.test(r.교과 || '')) return '한국사';
  if (/국어/.test(r.교과 || '')) return '국어';
  if (/수학/.test(r.교과 || '')) return '수학';
  if (/영어/.test(r.교과 || '')) return '영어';
  if (/사회/.test(r.교과 || '')) return '사회';
  if (/과학/.test(r.교과 || '') && !/탐구실험/.test(r.과목 || '')) return '과학';
  if (/기술|정보/.test(s)) return '기술·가정/정보';
  if (/외국어|한문/.test(s)) return '제2외국어/한문';
  return '';
}
function refCalc(rule) {
  if (!rule || !S.rec.analyzed) return null;
  const sys = S.rec.system || sysOf(S.profile.curr);
  const rows = (S.rec.grades || []).filter(r => {
    const g = Number(r.등급), c = Number(r.학점); if (!(g >= 1 && g <= 9 && c > 0)) return false;
    if (`${r.학년}-${r.학기}` > '3-1') return false;
    const gg = gradeGroup(r); if (!gg) return false;
    if (gg === '한국사') return rule.groups.includes('한국사') || rule.groups.includes('사회');
    return rule.groups.includes(gg);
  });
  if (!rows.length) return null;
  let use = rows;
  if (rule.per) { const gk = r => { const g = gradeGroup(r) === '한국사' ? '사회' : gradeGroup(r); return rule.socOrSci && (g === '사회' || g === '과학') ? '사회/과학' : g; }; const by = {}; rows.forEach(r => { (by[gk(r)] = by[gk(r)] || []).push(r); }); use = Object.values(by).flatMap(a => a.sort((x, y) => x.등급 - y.등급).slice(0, rule.per)); if (rule.total) use = use.sort((x, y) => x.등급 - y.등급).slice(0, rule.total); }
  else if (rule.top) use = rows.slice().sort((x, y) => x.등급 - y.등급).slice(0, rule.top);
  let s = 0, w = 0, ps = 0;
  use.forEach(r => { const c = rule.unweighted ? 1 : Number(r.학점); s += Number(r.등급) * c; w += c; if (rule.pts && sys === 5) ps += (rule.pts[Number(r.등급) - 1] ?? 0) * c; });
  const label = rule.groups.map(g => g.replace(/·.*|\/.*/, '')).join('·') + (rule.per ? ` 교과별 상위 ${rule.per}과목` + (rule.total ? ` (총 ${rule.total})` : '') : rule.top ? ` 상위 ${rule.top}과목` : '');
  return { avg: s / w, n: use.length, label, pts: rule.pts && sys === 5 ? ps / w : null, ptsMax: rule.pts ? rule.pts[0] : null, sys };
}

/* --- 수능최저 --- */
function csatRule(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  if (!t.trim()) return null;
  if (/^(없음|미적용|-)/.test(t.trim()) || /(최저학력기준|자격기준)[^,.]{0,6}(없음|미적용|적용하지 않음)/.test(t) && !/등급\s*(합|이내)/.test(t)) return { none: true, note: /에만 적용|제외/.test(t) ? t : '' };
  const r = { k: null, sum: null, each: null, must: [], tam: 'best', sciOnly: false, socOnly: false, hist: null, text: t };
  let m;
  if ((m = t.match(/(\d)\s*개\s*영역\s*(?:의\s*)?(?:등급\s*)?(?:의\s*)?합(?:산)?\s*(?:이\s*)?(\d{1,2})\s*(?:등급\s*)?이내/))) { r.k = +m[1]; r.sum = +m[2]; }
  else if ((m = t.match(/(\d)\s*개\s*영역\s*(?:각\s*)?(?:등급\s*)?(\d)\s*(?:등급\s*)?이내/))) { r.k = +m[1]; r.each = +m[2]; }
  else if ((m = t.match(/(?:등급\s*)?합(?:산)?\s*(?:이\s*)?(\d{1,2})\s*(?:등급\s*)?이내/))) { r.sum = +m[1]; const k = t.match(/(\d)\s*개\s*(?:영역|과목)/); if (k) r.k = +k[1]; }
  if ((m = t.match(/각\s*(\d)\s*등급\s*이내/)) && !r.sum) { r.each = +m[1]; const k = t.match(/(\d)\s*개\s*영역/); if (k) r.k = +k[1]; }
  if (/수학\s*(?:포함|필수|의무)|수학\s*\(필수\)|\+\s*수학/.test(t)) r.must.push('수');
  if (/영어\s*(?:포함|필수)/.test(t)) r.must.push('영');
  const t2 = t.replace(/(사회탐구|통합사회)\s*미반영/g, '').replace(/\([^)]*수능\s*탐구[^)]*\)|\(사회탐구·과학탐구=[^)]*\)|※\s*탐구\s*:\s*통합사회·통합과학[^,)]*/g, '');
  if (/과학탐구|과탐|통합과학/.test(t2) && !/사회탐구|사탐|통합사회|사회\s*[\/·,]\s*과학|사회·과학|사회\/과학/.test(t2)) r.sciOnly = true;
  if ((m = t.match(/영어\s*(\d)\s*등급\s*이내/))) r.eng = +m[1];
  r.special = /반영\s*시|상향|등급으로\s*반영|또는|평균/.test(t) && !/2\s*과목\s*평균/.test(t);
  if (/2\s*과목\s*평균|평균\s*반영/.test(t) && !/상위\s*1/.test(t)) r.tam = 'avg';
  if ((m = t.match(/한국사\s*(\d)\s*등급\s*이내/))) r.hist = +m[1];
  if (!r.k && (r.sum || r.each)) { if (/상위\s*(\d)/.test(t)) r.k = +t.match(/상위\s*(\d)/)[1]; }
  if (!r.k || (!r.sum && !r.each)) return { unknown: true, text: t };
  return r;
}
function csatCheck(rule, mk) {
  if (!rule) return null;
  if (rule.none) return { ok: true, none: true };
  if (rule.unknown) return { unknown: true };
  const v = k => { const x = Number(mk[k]); return x >= 1 && x <= 9 ? x : null; };
  const sa = v('사'), sc = v('과');
  const tam = rule.sciOnly ? sc : rule.tam === 'avg' ? (sa && sc ? Math.floor((sa + sc) / 2) : null) : (sa || sc ? Math.min(sa || 9, sc || 9) : null);
  const pool = [['국', v('국')], ['수', v('수')], ['영', v('영')], ['탐', tam]];
  if (pool.some(([n, x]) => x == null && (rule.must.includes(n)))) return { need: true };
  const have = pool.filter(([, x]) => x != null);
  if (have.length < rule.k) return { need: true };
  const must = have.filter(([n]) => rule.must.includes(n)), rest = have.filter(([n]) => !rule.must.includes(n)).sort((a, b) => a[1] - b[1]);
  const pick = [...must, ...rest].slice(0, Math.max(rule.k, must.length));
  const sum = pick.reduce((s, [, x]) => s + x, 0);
  let ok = rule.sum ? sum <= rule.sum : pick.every(([, x]) => x <= rule.each);
  let histOk = true; if (rule.hist) { const h = v('한'); histOk = h != null && h <= rule.hist; ok = ok && histOk; }
  if (rule.eng) { const e = v('영'); if (e == null || e > rule.eng) { ok = false; histOk = histOk && true; } }
  return { ok, sum, pick: pick.map(([n, x]) => n + x).join('+'), gap: rule.sum ? sum - rule.sum : null, histOk, rule };
}
function csatBadge(text) {
  const mk = S.profile.mock || {}; if (!Object.values(mk).some(x => x)) return '';
  const res = csatCheck(csatRule(text), mk); if (!res) return '';
  if (res.none) return '';
  if (res.unknown) return ' <span class="badge">직접 확인</span>';
  if (res.need) return ' <span class="badge">등급 더 넣기</span>';
  return res.ok ? ` <span class="badge mint" title="${esc(res.pick)}">충족 ${esc(res.pick)}${res.rule.special ? ' · 원문 확인' : ''}</span>` : ` <span class="badge rose" title="${esc(res.pick)}">${res.gap > 0 ? `합 ${res.sum} · ${res.gap}등급 모자람` : res.histOk ? '미충족' : '한국사 미충족'}</span>`;
}
const MOCK_KEYS = [['국', '국어'], ['수', '수학'], ['영', '영어'], ['사', '통합사회'], ['과', '통합과학'], ['한', '한국사']];
function mockHTML() {
  const mk = S.profile.mock || {};
  return `<div class="mock"><b>내 모의고사 등급</b> <span class="tiny">(9등급 · 넣으면 수능최저를 바로 점검해요)</span>
    <div class="mockrow">${MOCK_KEYS.map(([k, l]) => `<label><span>${l}</span><input type="number" min="1" max="9" inputmode="numeric" data-in="mock" data-k="${k}" value="${esc(mk[k] || '')}" aria-label="${l} 등급"></label>`).join('')}</div>
    <p class="tiny" style="margin:4px 0 0">2015 교육과정 학생은 탐구 2과목 등급을 사회·과학 칸에 넣어 주세요. 이 기기에만 저장돼요.</p></div>`;
}
IN.mock = el => {
  S.profile.mock = S.profile.mock || {}; const v = el.value.trim(); S.profile.mock[el.dataset.k] = /^[1-9]$/.test(v) ? v : ''; saveProfile();
  clearTimeout(IN.mock._t); IN.mock._t = setTimeout(() => { const k = el.dataset.k; const re = () => { const i = document.querySelector(`[data-in="mock"][data-k="${k}"]`); if (i) { i.focus(); const x = i.value; i.value = ''; i.value = x; } };
    if (VIEW === 'record' && S.rec.tab === 'ipg') fillIpg().then(re); else if (VIEW === 'major' && S.mj.view === 'univ') { fillUniv(); re(); } }, 600);
};

/* 후보별: 그 대학 반영 평균 + 등급 점수 + 수능최저 */
function calcCardHTML(cands) {
  const my = myGrade();
  if (!cands.length) return `<div class="calc"><h3>${ic('chart')} 대학마다 다른 내 평균</h3>${mockHTML()}<p class="tiny">학과·전형 화면에서 후보를 담으면, 대학마다 보는 교과로 다시 계산한 내 평균과 수능최저 충족 여부를 여기서 보여 줘요.</p></div>`;
  const rows = cands.map(cd => {
    const x = cafeRow(cd.univ, { 모집단위: cd.unit, 전형: cd.전형 });
    const rule = x ? refRule(x.반영교과) : null, rc = refCalc(rule);
    const minTxt = x ? x.수능최저학력기준 : '';
    const isGyo = x ? /교과/.test(x._유형 || x.전형유형 || '') : /교과/.test(cd.유형 || '');
    return { cd, x, rule, rc, minTxt, isGyo };
  });
  return `<div class="calc"><h3>${ic('chart')} 대학마다 다른 내 평균</h3>
    <p class="one">대학이 보는 교과만 골라 다시 계산했어요. 전체 평균 <b>${my ? fmt(my.avg) : '-'}</b></p>
    ${mockHTML()}
    <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>후보</th><th>반영 교과</th><th class="n">이 대학 기준 내 평균</th><th>수능최저</th></tr></thead><tbody>
    ${rows.map(({ cd, x, rc, minTxt, isGyo }) => {
      const d = rc && my ? rc.avg - my.avg : null;
      return `<tr><td><b>${esc(uniBase(cd.univ))}</b> ${esc(cd.unit)}<br><span class="tiny">${esc(cd.전형)}</span></td>
        <td>${rc ? `<span class="tiny">${esc(rc.label)} · ${rc.n}과목</span>` : x ? `<span class="tiny">${isGyo ? '반영 교과를 못 읽었어요' : '종합평가(서류)'}</span>` : '<span class="tiny">자료 없음</span>'}${x ? `<details class="mini"><summary class="tiny">원문</summary><span class="tiny">${esc(x.반영교과)}</span></details>` : ''}</td>
        <td class="n">${rc ? `<b>${fmt(rc.avg)}</b>${d != null && Math.abs(d) >= 0.01 ? `<br><span class="tiny">전체보다 ${d < 0 ? '▲' + fmt(-d) + ' 좋음' : '▼' + fmt(d)}</span>` : ''}${rc.pts != null ? `<br><span class="tiny">등급 점수 ${fmt(rc.pts, 1)} / ${rc.ptsMax}</span>` : ''}` : '-'}</td>
        <td>${minTxt ? `<span class="tiny">${esc(minTxt.length > 70 ? minTxt.slice(0, 70) + '…' : minTxt)}</span>${csatBadge(minTxt)}` : '<span class="tiny">-</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="tiny">반영 평균은 대학 환산점수 전체가 아니에요. 성취도·기본점수·출결은 빠져 있어요. 등급 점수는 5등급제 학생에게만, 원문에 점수표가 있을 때 보여요.</p></div>`;
}
