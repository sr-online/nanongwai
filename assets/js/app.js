/* ============ READ-WRITE RADAR — app ============ */
(function () {
  'use strict';
  const R = window.RWR;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Number(n) || 0).toLocaleString('th-TH');
  const pct = (a, b, d = 1) => (b ? (a * 100 / b) : 0).toFixed(d);
  const HAS_CHART = typeof window.Chart !== 'undefined';

  /* ---------------- state & storage ---------------- */
  // แหล่งข้อมูลหลัก = คะแนนรายบุคคล (S.roster) + รายชื่อนักเรียนบกพร่อง (S.students)
  // จำนวนนักเรียน/ระดับผลการประเมินรายชั้น (S.grades) คำนวณจากข้อมูลทั้งสองเสมอ
  const KEY = 'rwr-data-v2';
  const OLD_KEY = 'rwr-data-v1';
  const PHOTO_KEY = 'rwr-photos-v1';
  const GR = {}; R.GRADES.forEach((g) => (GR[g.id] = g));
  function emptyGrades() {
    const g = {};
    R.GRADES.forEach((gr) => {
      const ind = {};
      gr.ind.forEach((k) => (ind[k] = { vg: 0, g: 0, f: 0, p: 0 }));
      g[gr.id] = { total: 0, impaired: 0, ind };
    });
    return g;
  }
  const hasScore = (v) => v !== null && v !== undefined && v !== '' && !isNaN(+v);
  function deriveGrades(roster, students) {
    const g = emptyGrades();
    roster.forEach((s) => {
      const d = g[s.grade]; if (!d) return;
      d.total++;
      Object.keys(d.ind).forEach((k) => { const v = (s.scores || {})[k]; if (hasScore(v)) d.ind[k][levelOf(+v).key]++; });
    });
    students.forEach((s) => { if (g[s.grade]) g[s.grade].impaired++; });
    return g;
  }
  // สถานะรายบุคคล: pass = ผ่านเกณฑ์ทุกตัวชี้วัด, fail = มีตัวชี้วัดต่ำกว่าเกณฑ์ (ซ่อมเสริม), inc = ยังกรอกคะแนนไม่ครบ
  function stuStatus(s) {
    const gr = GR[s.grade]; if (!gr) return 'inc';
    let miss = false, fail = false;
    gr.ind.forEach((k) => { const v = (s.scores || {})[k]; if (!hasScore(v)) miss = true; else if (+v < R.PASS_MIN) fail = true; });
    return fail ? 'fail' : miss ? 'inc' : 'pass';
  }
  function cleanRoster(list) {
    return (Array.isArray(list) ? list : []).filter((s) => s && GR[s.grade] && typeof s.name === 'string').map((s) => {
      const scores = {};
      GR[s.grade].ind.forEach((k) => { const v = (s.scores || {})[k]; if (hasScore(v)) scores[k] = Math.max(0, Math.min(100, Math.round(+v))); });
      return { name: s.name.trim(), grade: s.grade, scores };
    });
  }
  function cleanStudents(list) {
    return (Array.isArray(list) ? list : []).filter((s) => s && GR[s.grade] && typeof s.name === 'string' && !/^ด\.[ชญ]\. ตัวอย่าง /.test(s.name)); // กรองรายชื่อสาธิตจากเทมเพลตรุ่นเดิมออก
  }
  function defaults() {
    const s = R.initialData();
    return {
      settings: { school: 'โรงเรียนบ้านนาหนองหวาย', area: 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษานครพนม เขต 2', year: 2569 },
      roster: s.roster, students: s.students,
      committee: R.COMMITTEE.map(() => ''), steps: {}
    };
  }
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function load(src) {
    let d = src || readJSON(KEY), legacy = false;
    if (!d) { d = readJSON(OLD_KEY); legacy = !!d; }
    const out = defaults();
    if (d) {
      out.settings = Object.assign({}, out.settings, d.settings || {});
      // ย้ายค่าเดิมจากเทมเพลต (โรงเรียนคลังสื่อฯ) ไปเป็นค่าโรงเรียนปัจจุบัน
      if (/คลังสื่อ/.test(out.settings.school || '')) out.settings.school = defaults().settings.school;
      if (!out.settings.area || out.settings.area === 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษา เขต 2') out.settings.area = defaults().settings.area;
      if (Array.isArray(d.committee)) out.committee = R.COMMITTEE.map((_, i) => d.committee[i] || '');
      if (d.steps && typeof d.steps === 'object') out.steps = d.steps;
      // ข้อมูลรุ่นเก่า (v1) เก็บเพียงจำนวนรวมรายชั้น ไม่มีคะแนนรายบุคคล → ใช้รายชื่อและคะแนนของโรงเรียน
      if (!legacy && Array.isArray(d.roster)) out.roster = cleanRoster(d.roster);
      if (Array.isArray(d.students)) out.students = cleanStudents(d.students);
    }
    out.grades = deriveGrades(out.roster, out.students);
    return out;
  }
  let S = load();
  let photos = [];
  try { photos = JSON.parse(localStorage.getItem(PHOTO_KEY) || '[]'); } catch (e) { photos = []; }

  function sync() { S.grades = deriveGrades(S.roster, S.students); }
  function save() {
    sync();
    const { grades, ...data } = S;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { toast('บันทึกไม่สำเร็จ: เบราว์เซอร์ไม่อนุญาตพื้นที่จัดเก็บ'); }
  }
  function savePhotos() {
    try { localStorage.setItem(PHOTO_KEY, JSON.stringify(photos)); return true; }
    catch (e) { toast('พื้นที่จัดเก็บเต็ม — ลบภาพบางส่วนหรือใช้ภาพขนาดเล็กลง'); return false; }
  }

  /* ---------------- compute ---------------- */
  function gradeStat(gr) {
    const d = S.grades[gr.id];
    const lv = { vg: 0, g: 0, f: 0, p: 0 };
    let read = { good: 0, n: 0 }, write = { good: 0, n: 0 };
    const per = {};
    gr.ind.forEach((k) => {
      const v = d.ind[k];
      const n = v.vg + v.g + v.f + v.p;
      per[k] = { ...v, n, good: v.vg + v.g, qi: n ? (v.vg * 4 + v.g * 3 + v.f * 2 + v.p) / n : 0 };
      R.LEVELS.forEach((L) => (lv[L.key] += v[L.key]));
      const side = R.SKILLS[k].side === 'r' ? read : write;
      side.good += v.vg + v.g; side.n += n;
    });
    const n = lv.vg + lv.g + lv.f + lv.p;
    const cnt = gr.ind.length;
    const avg = {}; R.LEVELS.forEach((L) => (avg[L.key] = cnt ? Math.round(lv[L.key] / cnt) : 0));
    const kids = S.roster.filter((s) => s.grade === gr.id);
    const st = { pass: [], fail: [], inc: [] };
    kids.forEach((s) => st[stuStatus(s)].push(s));
    return {
      gr, total: d.total, impaired: d.impaired, normal: Math.max(0, d.total - d.impaired),
      lv, n, avg, per, read, write, kids, pass: st.pass, fail: st.fail, inc: st.inc,
      good: lv.vg + lv.g,
      qi: n ? (lv.vg * 4 + lv.g * 3 + lv.f * 2 + lv.p) / n : 0
    };
  }
  function overall() {
    const stats = R.GRADES.map(gradeStat);
    const o = { stats, total: 0, impaired: 0, normal: 0, lv: { vg: 0, g: 0, f: 0, p: 0 }, avg: { vg: 0, g: 0, f: 0, p: 0 }, n: 0, active: 0, pass: 0, fail: 0, inc: 0 };
    stats.forEach((s) => {
      o.total += s.total; o.impaired += s.impaired; o.normal += s.normal; o.n += s.n;
      o.pass += s.pass.length; o.fail += s.fail.length; o.inc += s.inc.length;
      if (s.total || s.n) o.active++;
      R.LEVELS.forEach((L) => { o.lv[L.key] += s.lv[L.key]; o.avg[L.key] += s.avg[L.key]; });
    });
    o.good = o.lv.vg + o.lv.g;
    o.qi = o.n ? (o.lv.vg * 4 + o.lv.g * 3 + o.lv.f * 2 + o.lv.p) / o.n : 0;
    return o;
  }
  function levelOf(p) { return R.LEVELS.find((L) => p >= L.min) || R.LEVELS[3]; }

  /* ---------------- helpers: UI ---------------- */
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }
  const tip = $('#tip');
  function showTip(html, e) {
    tip.innerHTML = html; tip.classList.add('show'); moveTip(e);
  }
  function moveTip(e) {
    const x = e.clientX + 14, y = e.clientY + 14;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(x, innerWidth - w - 8) + 'px';
    tip.style.top = (y + h > innerHeight ? e.clientY - h - 10 : y) + 'px';
  }
  function hideTip() { tip.classList.remove('show'); }
  function bindTips(root) {
    $$('[data-tip]', root).forEach((el) => {
      el.addEventListener('mouseenter', (e) => showTip(el.getAttribute('data-tip'), e));
      el.addEventListener('mousemove', moveTip);
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('click', (e) => showTip(el.getAttribute('data-tip'), e));
    });
  }
  function countUp(el, to, suffix = '', dec = 0) {
    const from = 0, dur = 900, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      const v = from + (to - from) * e;
      el.textContent = (dec ? v.toFixed(dec) : fmt(Math.round(v))) + suffix;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  function lvColor(L) { return css(L.color); }

  /* ---------------- bindings (school / kpi) ---------------- */
  function applyBindings() {
    $$('[data-bind="school"]').forEach((e) => (e.textContent = S.settings.school || 'โรงเรียน'));
    $$('[data-bind="area"]').forEach((e) => (e.textContent = S.settings.area || ''));
    $$('[data-bind="year"]').forEach((e) => (e.textContent = S.settings.year || 2569));
  }
  function applyKpis(animate) {
    const o = overall();
    const vals = {
      total: [o.total, ''], normal: [o.normal, ''], impaired: [o.impaired, ''],
      goodPct: [+pct(o.good, o.n), '%', 1], normalPct: [+pct(o.normal, o.total), '%', 1], impairedPct: [+pct(o.impaired, o.total), '%', 1],
      pass: [o.pass, ''], fail: [o.fail, ''], passPct: [+pct(o.pass, o.total), '%', 1], failPct: [+pct(o.fail, o.total), '%', 1],
      grades: [R.GRADES.length, '']
    };
    Object.keys(vals).forEach((k) => $$(`[data-kpi="${k}"]`).forEach((el) => {
      const [v, s, d] = vals[k];
      if (animate) countUp(el, v, s, d || 0); else el.textContent = (d ? v.toFixed(d) : fmt(v)) + s;
    }));
    $$('[data-kpi="gradesFoot"]').forEach((e) => (e.textContent = `${R.GRADES[0].short} – ${R.GRADES[R.GRADES.length - 1].short} · มีข้อมูล ${o.active} จาก ${R.GRADES.length} ระดับชั้น`));
    $$('[data-kpi="failFoot"]').forEach((e) => (e.textContent = o.inc ? `ยังกรอกคะแนนไม่ครบ ${fmt(o.inc)} คน` : 'มีตัวชี้วัดต่ำกว่าระดับดี'));
    $$('[data-kpi="qualityFoot"]').forEach((e) => (e.textContent = `ดัชนีคุณภาพเฉลี่ย ${o.qi.toFixed(2)} / 4.00`));
  }

  /* ======================================================
     PAGE 1 — models
     ====================================================== */
  function renderCycle() {
    const el = $('#cycleModel'); if (el.dataset.done) return; el.dataset.done = 1;
    const nodes = [
      { t: 'คัดกรอง', s: 'Screening', c: ['#4f46e5', '#7c3aed'], tip: 'ทดสอบการอ่าน–เขียนด้วยเครื่องมือมาตรฐานของ สพฐ.' },
      { t: 'วิเคราะห์', s: 'Analyze', c: ['#0ea5e9', '#10b981'], tip: 'วิเคราะห์ผลรายบุคคล หาสาเหตุ จัดกลุ่มนักเรียน' },
      { t: 'พัฒนา', s: 'Develop', c: ['#f59e0b', '#ef4444'], tip: 'จัดนวัตกรรมและกิจกรรมพัฒนาอ่านคล่อง เขียนคล่อง' },
      { t: 'ติดตาม', s: 'Monitor', c: ['#db2777', '#f97316'], tip: 'ประเมินพัฒนาการทุกเดือนและรายงานผู้บริหาร' }
    ];
    const cx = 200, cy = 200, r = 128;
    let defs = '', body = '';
    nodes.forEach((n, i) => {
      defs += `<linearGradient id="cg${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${n.c[0]}"/><stop offset="1" stop-color="${n.c[1]}"/></linearGradient>`;
      const a = -Math.PI / 2 + i * Math.PI / 2;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      body += `<g data-tip="<b>${n.t}</b><br>${n.tip}" style="cursor:pointer">
        <circle cx="${x}" cy="${y}" r="52" fill="url(#cg${i})"><animate attributeName="r" values="52;55;52" dur="3s" begin="${i * .75}s" repeatCount="indefinite"/></circle>
        <text x="${x}" y="${y - 2}" text-anchor="middle" fill="#fff" font-size="17" font-weight="700">${n.t}</text>
        <text x="${x}" y="${y + 17}" text-anchor="middle" fill="#fff" font-size="11" opacity=".85">${n.s}</text></g>`;
    });
    el.innerHTML = `<svg viewBox="0 0 400 400" role="img" aria-label="วงจรพัฒนาการอ่านเขียน">
      <defs>${defs}<marker id="cyArr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--muted)"/></marker></defs>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line-2)" stroke-width="2" stroke-dasharray="6 8">
        <animateTransform attributeName="transform" type="rotate" from="0 200 200" to="360 200 200" dur="40s" repeatCount="indefinite"/></circle>
      ${[0, 1, 2, 3].map((i) => { const a = -Math.PI / 2 + i * Math.PI / 2 + Math.PI / 4; const x1 = cx + r * Math.cos(a - .2), y1 = cy + r * Math.sin(a - .2), x2 = cx + r * Math.cos(a + .2), y2 = cy + r * Math.sin(a + .2); return `<path d="M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}" fill="none" stroke="var(--muted)" stroke-width="2.5" marker-end="url(#cyArr)"/>`; }).join('')}
      <circle cx="${cx}" cy="${cy}" r="46" fill="var(--surface)" stroke="var(--line)" stroke-width="2"/>
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="var(--ink)" font-size="15" font-weight="700">ผู้เรียน</text>
      <text x="${cx}" y="${cy + 15}" text-anchor="middle" fill="var(--muted)" font-size="11">เป็นศูนย์กลาง</text>
      ${body}</svg>`;
    bindTips(el);
  }

  function renderDefModel() {
    const el = $('#defModel'); if (el.dataset.done) return; el.dataset.done = 1;
    const W = 900;
    const box = (x, y, w, h, fill, title, sub, id, light) => `
      <g class="dm-node" data-id="${id}" style="cursor:pointer" data-tip="${esc('<b>' + title + '</b><br>' + ((R.DEFS.find((d) => d.id === id) || {}).text || sub))}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${fill}" ${light ? 'stroke="var(--line-2)" stroke-width="1.5"' : ''}/>
        <text x="${x + w / 2}" y="${y + h / 2 - (sub ? 4 : -5)}" text-anchor="middle" font-size="16" font-weight="700" fill="${light ? 'var(--ink)' : '#fff'}">${title}</text>
        ${sub ? `<text x="${x + w / 2}" y="${y + h / 2 + 16}" text-anchor="middle" font-size="12" fill="${light ? 'var(--muted)' : 'rgba(255,255,255,.85)'}">${sub}</text>` : ''}
      </g>`;
    const link = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}" fill="none" stroke="var(--line-2)" stroke-width="2.5"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} 330" role="img" aria-label="โมเดลนิยามศัพท์">
      <defs>
        <linearGradient id="dmA" x1="0" x2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#db2777"/></linearGradient>
        <linearGradient id="dmR" x1="0" x2="1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient>
        <linearGradient id="dmW" x1="0" x2="1"><stop offset="0" stop-color="#059669"/><stop offset="1" stop-color="#10b981"/></linearGradient>
      </defs>
      ${link(450, 72, 225, 132)}${link(450, 72, 675, 132)}
      ${link(225, 200, 115, 250)}${link(225, 200, 335, 250)}${link(675, 200, 565, 250)}${link(675, 200, 785, 250)}
      ${box(270, 12, 360, 60, 'url(#dmA)', 'ความสามารถในการอ่านและการเขียน', 'Literacy Screening ป.1 – ป.6', 'read', false).replace('data-id="read"', 'data-id="root"')}
      ${box(115, 132, 220, 68, 'url(#dmR)', '3.1 การอ่าน', 'Reading', 'read')}
      ${box(565, 132, 220, 68, 'url(#dmW)', '3.2 การเขียน', 'Writing', 'write')}
      ${box(20, 250, 190, 62, 'var(--surface-2)', 'อ่านออกเสียง', 'Oral Reading', 'oral', true)}
      ${box(240, 250, 190, 62, 'var(--surface-2)', 'อ่านรู้เรื่อง', 'Comprehension', 'comp', true)}
      ${box(470, 250, 190, 62, 'var(--surface-2)', 'เขียนคำ', 'Dictation', 'word', true)}
      ${box(690, 250, 190, 62, 'var(--surface-2)', 'เขียนเรื่อง', 'Creative Writing', 'story', true)}
    </svg>`;
    bindTips(el);
    $('#defDetail').innerHTML = R.DEFS.filter((d) => d.parent).map((d, i) => `
      <div class="callout"><span class="ic ${['c1', 'c3', 'c6', 'c2'][i]}"><svg><use href="#${d.parent === 'read' ? 'i-book' : 'i-pen'}"/></svg></span>
      <p><b>${d.title}</b><br>${d.text}</p></div>`).join('');
  }

  /* ======================================================
     PAGE 2 — method
     ====================================================== */
  function renderPDCA() {
    const el = $('#pdcaModel');
    const cols = ['P', 'D', 'C', 'A'];
    const colors = { P: ['#4f46e5', '#7c3aed'], D: ['#db2777', '#f97316'], C: ['#0ea5e9', '#10b981'], A: ['#f59e0b', '#ef4444'] };
    const W = 1000, colW = 220, gap = (W - colW * 4) / 3;
    let maxN = Math.max(...cols.map((c) => R.STEPS.filter((s) => s.phase === c).length));
    const H = 110 + maxN * 64 + 10;
    let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="โมเดลกระบวนการ PDCA"><defs>`;
    cols.forEach((c) => (out += `<linearGradient id="pd${c}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[c][0]}"/><stop offset="1" stop-color="${colors[c][1]}"/></linearGradient>`));
    out += `<marker id="pdArr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--muted)"/></marker></defs>`;
    cols.forEach((c, i) => {
      const x = i * (colW + gap);
      const ph = R.PHASES[c];
      out += `<rect x="${x}" y="0" width="${colW}" height="${H}" rx="20" fill="var(--surface-2)" stroke="var(--line)"/>`;
      out += `<rect x="${x}" y="0" width="${colW}" height="84" rx="20" fill="url(#pd${c})"/><rect x="${x}" y="60" width="${colW}" height="24" fill="url(#pd${c})"/>`;
      out += `<text x="${x + colW / 2}" y="38" text-anchor="middle" fill="#fff" font-size="24" font-weight="800">${ph.name}</text>`;
      out += `<text x="${x + colW / 2}" y="64" text-anchor="middle" fill="#fff" font-size="13" opacity=".92">${ph.th}</text>`;
      if (i < 3) out += `<path d="M${x + colW + 4} 42 L${x + colW + gap - 6} 42" stroke="var(--muted)" stroke-width="2.5" marker-end="url(#pdArr)"/>`;
      R.STEPS.filter((s) => s.phase === c).forEach((s, j) => {
        const y = 100 + j * 64;
        const done = S.steps[s.no];
        const title = s.title.length > 22 ? s.title.slice(0, 21) + '…' : s.title;
        out += `<g data-tip="${esc('<b>' + s.no + ' ' + s.title + '</b>')}" style="cursor:pointer" data-goto="${s.no}">
          <rect x="${x + 12}" y="${y}" width="${colW - 24}" height="52" rx="12" fill="var(--surface)" stroke="${done ? css('--ok') : 'var(--line-2)'}" stroke-width="${done ? 2 : 1}"/>
          <rect x="${x + 22}" y="${y + 12}" width="40" height="28" rx="8" fill="url(#pd${c})"/>
          <text x="${x + 42}" y="${y + 31}" text-anchor="middle" fill="#fff" font-size="13" font-weight="700">${s.no}</text>
          <text x="${x + 70}" y="${y + 31}" fill="var(--ink)" font-size="12">${esc(title)}</text>
          ${done ? `<circle cx="${x + colW - 26}" cy="${y + 10}" r="8" fill="${css('--ok')}"/><path d="M${x + colW - 30} ${y + 10} l3 3 l5 -6" stroke="#fff" stroke-width="2" fill="none"/>` : ''}
        </g>`;
      });
    });
    el.innerHTML = out + '</svg>';
    bindTips(el);
    $$('[data-goto]', el).forEach((g) => g.addEventListener('click', () => {
      const st = $(`.step[data-no="${g.dataset.goto}"]`);
      if (st) { st.classList.add('open'); st.querySelector('.detail').hidden = false; st.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }));
  }

  function renderSteps() {
    const list = $('#stepList');
    list.innerHTML = R.STEPS.map((s) => {
      const ph = R.PHASES[s.phase];
      return `<div class="step ${S.steps[s.no] ? 'done' : ''}" data-no="${s.no}">
        <div class="no ${ph.cls}">${s.no}</div>
        <div><h4>${s.title}</h4><div class="meta">${ph.name} · ${ph.th} · ${s.d[0]}–${s.d[1]} ก.ค.</div></div>
        <svg class="chev" width="20" height="20"><use href="#i-chev"/></svg>
        <div class="detail" hidden><ul>${s.detail.map((x) => `<li>${x}</li>`).join('')}</ul>
          <label class="check-done"><input type="checkbox" ${S.steps[s.no] ? 'checked' : ''}> ดำเนินการเสร็จแล้ว</label></div>
      </div>`;
    }).join('');
    $$('.step', list).forEach((st) => {
      st.addEventListener('click', (e) => {
        if (e.target.closest('.check-done')) return;
        st.classList.toggle('open'); st.querySelector('.detail').hidden = !st.classList.contains('open');
      });
      st.querySelector('input').addEventListener('change', (e) => {
        S.steps[st.dataset.no] = e.target.checked; save();
        st.classList.toggle('done', e.target.checked);
        renderStepGauge(); renderPDCA();
      });
    });
    renderStepGauge();
  }
  function ringSVG(value, max, label, sub, color) {
    const r = 70, C = 2 * Math.PI * r, k = max ? value / max : 0;
    return `<svg viewBox="0 0 180 180" role="img" aria-label="${label}">
      <defs><linearGradient id="rg${label.length}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#db2777"/></linearGradient></defs>
      <circle cx="90" cy="90" r="${r}" fill="none" stroke="var(--bg-2)" stroke-width="16"/>
      <circle cx="90" cy="90" r="${r}" fill="none" stroke="${color || `url(#rg${label.length})`}" stroke-width="16" stroke-linecap="round"
        stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - k)}" transform="rotate(-90 90 90)" style="transition:stroke-dashoffset .8s"/>
      <text x="90" y="88" text-anchor="middle" font-size="32" font-weight="700" fill="var(--ink)">${label}</text>
      <text x="90" y="112" text-anchor="middle" font-size="10.5" fill="var(--muted)">${sub}</text></svg>`;
  }
  function renderStepGauge() {
    const done = R.STEPS.filter((s) => S.steps[s.no]).length;
    $('#stepGauge').innerHTML = ringSVG(done, 9, Math.round(done / 9 * 100) + '%', `เสร็จ ${done} จาก 9 ขั้นตอน`) +
      `<div style="display:grid;gap:6px;width:100%;margin-top:10px">${Object.keys(R.PHASES).map((p) => {
        const all = R.STEPS.filter((s) => s.phase === p), d = all.filter((s) => S.steps[s.no]).length;
        return `<div style="display:flex;align-items:center;gap:8px;font-size:13px"><span class="${R.PHASES[p].cls}" style="width:10px;height:10px;border-radius:3px"></span><span style="flex:1">${R.PHASES[p].name} · ${R.PHASES[p].th}</span><b style="font-variant-numeric:tabular-nums">${d}/${all.length}</b></div>`;
      }).join('')}</div>`;
    $('#stepProgress').textContent = `เสร็จแล้ว ${done}/9`;
  }

  function renderBand() {
    $('#band').innerHTML = R.LEVELS.slice().reverse().map((L) =>
      `<div style="flex:${L.max - L.min + 1};background:${lvColor(L)}">${L.name}<small>${L.range}</small></div>`).join('');
    calcLevel();
  }
  function calcLevel() {
    const sc = parseFloat($('#cScore').value), full = parseFloat($('#cFull').value);
    const res = $('#cResult'), mk = $('#marker');
    if (!(full > 0) || isNaN(sc) || sc < 0 || sc > full) { res.innerHTML = 'กรอกคะแนนให้ถูกต้อง (0 – คะแนนเต็ม)'; mk.hidden = true; return; }
    const p = sc / full * 100; const L = levelOf(Math.floor(p));
    res.innerHTML = `<span class="sw" style="background:${lvColor(L)}"></span> ร้อยละ ${p.toFixed(2)} → ระดับ “${L.name}”`;
    mk.hidden = false; mk.style.left = p + '%';
  }

  function renderMatrix() {
    const cols = R.SKILL_ORDER;
    let h = `<thead><tr><th class="l">ระดับชั้น</th>${cols.map((k) => `<th>${R.SKILLS[k].name}</th>`).join('')}<th>รวม</th></tr></thead><tbody>`;
    R.GRADES.forEach((g) => {
      h += `<tr><td class="l"><b>${g.short}</b> <span style="color:var(--muted);font-size:12.5px">${g.full}</span></td>${cols.map((k) => `<td>${g.ind.includes(k) ? '<span class="yes" title="ประเมิน"></span>' : '<span class="no-dot"></span>'}</td>`).join('')}<td class="num"><b>${g.ind.length}</b></td></tr>`;
    });
    $('#matrix').innerHTML = h + '</tbody>';
  }

  function renderGantt() {
    const ph = { P: '#6d5dfc', D: '#e8508a', C: '#14a6b8', A: '#f08a24' };
    let h = '<div></div><div class="days">' + [1, 5, 10, 15, 20, 25, 31].map((d) => `<span>${d}</span>`).join('') + '</div>';
    R.STEPS.forEach((s) => {
      const l = (s.d[0] - 1) / 31 * 100, w = (s.d[1] - s.d[0] + 1) / 31 * 100;
      h += `<div class="lbl"><b>${s.no}</b> ${s.title}</div><div class="track"><div class="bar" style="left:${l}%;width:${w}%;background:${ph[s.phase]}" data-tip="${esc(`<b>${s.no} ${s.title}</b><br>${s.d[0]} – ${s.d[1]} กรกฎาคม ${S.settings.year}<br>(${s.d[1] - s.d[0] + 1} วัน · ${R.PHASES[s.phase].name})`)}"></div></div>`;
    });
    $('#gantt').innerHTML = h + `<div></div><div style="font-size:12px;color:var(--muted)">* แผนปฏิทินโดยประมาณ ภายในช่วง 1 – 31 กรกฎาคม ${S.settings.year}</div>`;
    bindTips($('#gantt'));
  }

  /* ======================================================
     PAGE 3 — results
     ====================================================== */
  const charts = {};
  function kill(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }
  function chartDefaults() {
    if (!HAS_CHART) return;
    Chart.defaults.font.family = 'Prompt, "Noto Sans Thai", Tahoma, sans-serif';
    Chart.defaults.font.size = 12.5;
    Chart.defaults.color = css('--ink-2');
    Chart.defaults.borderColor = css('--grid');
    Chart.defaults.plugins.legend.display = false;
    const tt = Chart.defaults.plugins.tooltip;
    tt.backgroundColor = css('--surface'); tt.titleColor = css('--ink'); tt.bodyColor = css('--ink-2');
    tt.borderColor = css('--line'); tt.borderWidth = 1; tt.padding = 10; tt.cornerRadius = 10;
    tt.boxPadding = 4; tt.usePointStyle = true;
    tt.titleFont = { weight: '600' };
  }
  function noChart(id) {
    const c = document.getElementById(id); if (!c) return;
    c.parentElement.innerHTML = '<div class="empty">ไม่สามารถโหลดไลบรารีกราฟได้ (ต้องเชื่อมต่ออินเทอร์เน็ต) — ดูข้อมูลได้จากตารางด้านล่าง</div>';
  }
  function legendLevels(sel) {
    $$(sel).forEach((el) => (el.innerHTML = R.LEVELS.map((L) => `<span><i style="background:${lvColor(L)}"></i>${L.name} <small style="color:var(--muted)">(${L.range.replace('ร้อยละ ', '')})</small></span>`).join('')));
  }
  let stackMode = 'pct', tableMode = 'count', drillGrade = 'p1';

  function renderNotice() {
    const o = overall();
    let h = '';
    const ic = '<svg width="20" height="20"><use href="#i-alert"/></svg>';
    if (!o.total) h = `<div class="notice">${ic}<span><b>ยังไม่มีข้อมูล</b> — กดปุ่ม “กรอก / แก้ไขข้อมูลผลคัดกรอง” เพื่อเพิ่มรายชื่อและคะแนนนักเรียน</span></div>`;
    else {
      const bad = [];
      o.stats.forEach((s) => { if (s.inc.length) bad.push(`${s.gr.short} ${s.inc.length} คน`); });
      const over = o.stats.filter((s) => s.impaired > s.total).map((s) => s.gr.short);
      if (bad.length) h += `<div class="notice">${ic}<span><b>ยังกรอกคะแนนไม่ครบทุกตัวชี้วัด:</b> ${bad.join(', ')} — ผลสรุปจะนับเฉพาะตัวชี้วัดที่มีคะแนน</span></div>`;
      if (over.length) h += `<div class="notice">${ic}<span><b>จำนวนนักเรียนบกพร่องมากกว่าจำนวนนักเรียนในชั้น:</b> ${over.join(', ')} — ตรวจสอบรายชื่อในภาคผนวก ข</span></div>`;
    }
    $('#dataNotice').innerHTML = h; $('#dataNotice').hidden = !h;
  }

  function renderResults(animate) {
    chartDefaults();
    renderNotice();
    applyKpis(animate);
    legendLevels('#lgLevels, #lgLevels2, #lgLevels3');
    const o = overall();
    const labels = R.GRADES.map((g) => g.short);
    const gap = css('--surface');

    // donut
    if (!HAS_CHART) { ['chDonut', 'chStack', 'chPop', 'chRW', 'chDrill'].forEach(noChart); }
    else {
      kill('donut');
      charts.donut = new Chart($('#chDonut'), {
        type: 'doughnut',
        data: { labels: R.LEVELS.map((L) => L.name), datasets: [{ data: R.LEVELS.map((L) => o.lv[L.key]), backgroundColor: R.LEVELS.map(lvColor), borderColor: gap, borderWidth: 2, hoverOffset: 8, borderRadius: 4 }] },
        options: {
          maintainAspectRatio: false, cutout: '64%',
          plugins: { tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt(c.raw)} (${pct(c.raw, o.n)}%)` } } }
        },
        plugins: [{ id: 'center', afterDraw(ch) {
          const { ctx, chartArea: a } = ch; const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
          ctx.save(); ctx.textAlign = 'center';
          ctx.fillStyle = css('--ink'); ctx.font = '700 26px Prompt, sans-serif'; ctx.fillText(pct(o.good, o.n) + '%', x, y + 4);
          ctx.fillStyle = css('--muted'); ctx.font = '12px Prompt, sans-serif'; ctx.fillText('ดี – ดีมาก', x, y + 24); ctx.restore();
        } }]
      });

      // stacked by grade
      kill('stack');
      const stats = o.stats;
      charts.stack = new Chart($('#chStack'), {
        type: 'bar',
        data: { labels, datasets: R.LEVELS.map((L) => ({
          label: L.name, backgroundColor: lvColor(L), borderColor: gap, borderWidth: { right: 2 }, borderSkipped: false, borderRadius: 3,
          data: stats.map((s) => stackMode === 'pct' ? +pct(s.lv[L.key], s.n) : s.lv[L.key]), raw: stats.map((s) => s.lv[L.key]), barPercentage: .78
        })) },
        options: {
          indexAxis: 'y', maintainAspectRatio: false,
          scales: {
            x: { stacked: true, max: stackMode === 'pct' ? 100 : undefined, grid: { color: css('--grid') }, ticks: { callback: (v) => stackMode === 'pct' ? v + '%' : v } },
            y: { stacked: true, grid: { display: false } }
          },
          interaction: { mode: 'index', axis: 'y', intersect: false },
          plugins: { tooltip: { callbacks: {
            title: (c) => R.GRADES[c[0].dataIndex].full,
            label: (c) => ` ${c.dataset.label}: ${fmt(c.dataset.raw[c.dataIndex])} ครั้ง (${pct(c.dataset.raw[c.dataIndex], stats[c.dataIndex].n)}%)`
          } } }
        }
      });

      // population
      kill('pop');
      charts.pop = new Chart($('#chPop'), {
        type: 'bar',
        data: { labels, datasets: [
          { label: 'ผ่านเกณฑ์', data: stats.map((s) => s.pass.length), backgroundColor: css('--s-normal'), borderRadius: 4, borderColor: gap, borderWidth: { top: 2 }, borderSkipped: false, maxBarThickness: 34 },
          { label: 'ซ่อมเสริม', data: stats.map((s) => s.fail.length), backgroundColor: css('--s-impaired'), borderRadius: 4, borderColor: gap, borderWidth: { top: 2 }, borderSkipped: false, maxBarThickness: 34 },
          ...(o.inc ? [{ label: 'กรอกไม่ครบ', data: stats.map((s) => s.inc.length), backgroundColor: css('--muted'), borderRadius: 4, borderColor: gap, borderWidth: { top: 2 }, borderSkipped: false, maxBarThickness: 34 }] : [])
        ] },
        options: {
          maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: css('--grid') }, ticks: { precision: 0 } } },
          plugins: { tooltip: { callbacks: { title: (c) => R.GRADES[c[0].dataIndex].full, footer: (c) => `รวม ${fmt(stats[c[0].dataIndex].total)} คน` } } }
        }
      });

      // read vs write
      kill('rw');
      charts.rw = new Chart($('#chRW'), {
        type: 'bar',
        data: { labels, datasets: [
          { label: 'ด้านการอ่าน', data: stats.map((s) => +pct(s.read.good, s.read.n)), backgroundColor: css('--s-read'), borderRadius: 4, maxBarThickness: 22, categoryPercentage: .7, barPercentage: .9 },
          { label: 'ด้านการเขียน', data: stats.map((s) => +pct(s.write.good, s.write.n)), backgroundColor: css('--s-write'), borderRadius: 4, maxBarThickness: 22, categoryPercentage: .7, barPercentage: .9 }
        ] },
        options: {
          maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true, max: 100, grid: { color: css('--grid') }, ticks: { callback: (v) => v + '%' } } },
          plugins: { tooltip: { callbacks: { title: (c) => R.GRADES[c[0].dataIndex].full, label: (c) => ` ${c.dataset.label}: ${c.raw}%` } } }
        }
      });
    }

    renderHeat(o);
    renderDrill();
    renderTable();
    renderRoster();
    renderSummary(o);
    renderSolutions();
  }

  function seqColor(p) {
    // sequential blue ramp (light -> dark)
    const ramp = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
    const i = Math.min(ramp.length - 1, Math.round(p / 100 * (ramp.length - 1)));
    return { bg: ramp[i], fg: i >= 6 ? '#fff' : '#0b0b0b' };
  }
  function renderHeat(o) {
    const cols = R.SKILL_ORDER;
    const el = $('#heat');
    el.style.gridTemplateColumns = `64px repeat(${cols.length}, minmax(70px,1fr))`;
    let h = '<div></div>' + cols.map((k) => `<div class="h">${R.SKILLS[k].name}</div>`).join('');
    o.stats.forEach((s) => {
      h += `<div class="r">${s.gr.short}</div>`;
      cols.forEach((k) => {
        const v = s.per[k];
        if (!v) { h += '<div class="cell na">–</div>'; return; }
        if (!v.n) { h += '<div class="cell na">ไม่มีข้อมูล</div>'; return; }
        const p = v.good / v.n * 100, c = seqColor(p);
        h += `<div class="cell" style="background:${c.bg};color:${c.fg}" data-tip="${esc(`<b>${s.gr.full}</b><br>${R.IND_LABEL[k]}<br>ดีมาก ${v.vg} · ดี ${v.g} · พอใช้ ${v.f} · ปรับปรุง ${v.p}<br>ดี–ดีมาก <b>${p.toFixed(1)}%</b> · ดัชนี ${v.qi.toFixed(2)}`)}">${p.toFixed(0)}%</div>`;
      });
    });
    el.innerHTML = h; bindTips(el);
  }

  function gaugeSVG(v) {
    // semicircle 1..4
    const k = Math.max(0, Math.min(1, (v - 1) / 3));
    const r = 100, cx = 130, cy = 130;
    const arc = (a0, a1) => { const p = (a) => [cx + r * Math.cos(Math.PI + a * Math.PI), cy + r * Math.sin(Math.PI + a * Math.PI)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}`; };
    const segs = R.LEVELS.slice().reverse().map((L, i) => `<path d="${arc(i / 4 + .006, (i + 1) / 4 - .006)}" stroke="${lvColor(L)}" stroke-width="22" fill="none"/>`).join('');
    const ang = Math.PI + k * Math.PI;
    const nx = cx + (r - 30) * Math.cos(ang), ny = cy + (r - 30) * Math.sin(ang);
    const L = v ? (v >= 3.25 ? R.LEVELS[0] : v >= 2.5 ? R.LEVELS[1] : v >= 1.75 ? R.LEVELS[2] : R.LEVELS[3]) : null;
    return `<svg viewBox="0 0 260 170" role="img" aria-label="ดัชนีคุณภาพ">
      ${segs}
      <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="var(--ink)" stroke-width="4" stroke-linecap="round" style="transition:.6s"/>
      <circle cx="${cx}" cy="${cy}" r="9" fill="var(--ink)"/>
      <text x="${cx}" y="${cy + 34}" text-anchor="middle" font-size="26" font-weight="700" fill="var(--ink)">${v ? v.toFixed(2) : '–'}</text>
      <text x="22" y="${cy + 18}" font-size="11" fill="var(--muted)">1.00</text><text x="238" y="${cy + 18}" text-anchor="end" font-size="11" fill="var(--muted)">4.00</text>
    </svg><div style="text-align:center;font-size:13.5px;color:var(--ink-2)">ดัชนีคุณภาพ (Quality Index)<br>${L ? `อยู่ในระดับ <b style="color:var(--ink)">${L.name}</b>` : 'ยังไม่มีข้อมูล'}</div>`;
  }

  function renderDrill() {
    const seg = $('#segGrade');
    seg.innerHTML = R.GRADES.map((g) => `<button data-v="${g.id}" class="${g.id === drillGrade ? 'on' : ''}">${g.short}</button>`).join('');
    $$('button', seg).forEach((b) => b.addEventListener('click', () => { drillGrade = b.dataset.v; renderDrill(); }));
    const gr = R.GRADES.find((g) => g.id === drillGrade), s = gradeStat(gr);
    $('#gauge').innerHTML = gaugeSVG(s.qi) + `<div style="display:flex;gap:16px;margin-top:10px;font-size:13px;color:var(--ink-2)"><span>ทั้งหมด <b>${fmt(s.total)}</b></span><span>ผ่านเกณฑ์ <b>${fmt(s.pass.length)}</b></span><span>ซ่อมเสริม <b>${fmt(s.fail.length)}</b></span><span>บกพร่อง <b>${fmt(s.impaired)}</b></span></div>`;
    if (!HAS_CHART || !$('#chDrill')) return;
    kill('drill');
    charts.drill = new Chart($('#chDrill'), {
      type: 'bar',
      data: { labels: gr.ind.map((k) => R.IND_LABEL[k]), datasets: R.LEVELS.map((L) => ({
        label: L.name, backgroundColor: lvColor(L), borderColor: css('--surface'), borderWidth: { right: 2 }, borderSkipped: false, borderRadius: 3, barPercentage: .7,
        data: gr.ind.map((k) => +pct(s.per[k][L.key], s.per[k].n)), raw: gr.ind.map((k) => s.per[k][L.key])
      })) },
      options: {
        indexAxis: 'y', maintainAspectRatio: false,
        interaction: { mode: 'index', axis: 'y', intersect: false },
        scales: { x: { stacked: true, max: 100, grid: { color: css('--grid') }, ticks: { callback: (v) => v + '%' } }, y: { stacked: true, grid: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.dataset.raw[c.dataIndex])} คน (${c.raw}%)` } } }
      }
    });
  }

  function renderTable() {
    const isPct = tableMode === 'pct';
    let h = `<thead><tr><th rowspan="2">ชั้น</th><th colspan="3">จำนวนนักเรียน${isPct ? ' (ร้อยละ)' : ' (คน)'}</th><th rowspan="2" class="l">ตัวชี้วัดในการคัดกรอง</th><th colspan="4">ระดับผลการประเมิน${isPct ? ' (ร้อยละ)' : ' (คน)'}</th><th rowspan="2">หมายเหตุ</th></tr>
      <tr><th>ทั้งหมด</th><th>บกพร่อง</th><th>ปกติ</th>${R.LEVELS.map((L) => `<th><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${lvColor(L)};margin-right:5px"></span>${L.name}</th>`).join('')}</tr></thead><tbody>`;
    const o = overall();
    o.stats.forEach((s) => {
      s.gr.ind.forEach((k, i) => {
        const v = s.per[k];
        h += `<tr class="${i === 0 ? 'grp' : ''}">`;
        if (i === 0) {
          const span = s.gr.ind.length;
          h += `<td rowspan="${span}"><b>${s.gr.short}</b></td>
            <td rowspan="${span}" class="num">${isPct ? (s.total ? '100' : '–') : fmt(s.total)}</td>
            <td rowspan="${span}" class="num">${isPct ? pct(s.impaired, s.total, 2) : fmt(s.impaired)}</td>
            <td rowspan="${span}" class="num">${isPct ? pct(s.normal, s.total, 2) : fmt(s.normal)}</td>`;
        }
        h += `<td class="l">${R.IND_LABEL[k]}</td>${R.LEVELS.map((L) => `<td class="num">${isPct ? (v.n ? pct(v[L.key], v.n, 2) : '–') : fmt(v[L.key])}</td>`).join('')}`;
        if (i === 0) {
          const note = !s.total ? '<span class="chk empty">ไม่มีนักเรียน</span>'
            : `<span class="chk ok">ผ่าน ${s.pass.length}</span> <span class="chk bad">ซ่อมเสริม ${s.fail.length}</span>${s.inc.length ? ` <span class="chk empty">กรอกไม่ครบ ${s.inc.length}</span>` : ''}`;
          h += `<td rowspan="${s.gr.ind.length}" style="white-space:nowrap">${note}</td>`;
        }
        h += '</tr>';
      });
    });
    h += `</tbody><tfoot><tr><td>รวม</td><td class="num">${isPct ? '100' : fmt(o.total)}</td><td class="num">${isPct ? pct(o.impaired, o.total, 2) : fmt(o.impaired)}</td><td class="num">${isPct ? pct(o.normal, o.total, 2) : fmt(o.normal)}</td><td class="l">ทุกตัวชี้วัด</td>${R.LEVELS.map((L) => `<td class="num">${isPct ? pct(o.lv[L.key], o.n, 2) : fmt(o.lv[L.key])}</td>`).join('')}<td style="white-space:nowrap">ผ่าน ${fmt(o.pass)} · ซ่อมเสริม ${fmt(o.fail)}</td></tr></tfoot>`;
    $('#resTable').innerHTML = h;
  }

  /* ---------- ผลรายบุคคล (ผ่านเกณฑ์ / ซ่อมเสริม) ---------- */
  let rosterMode = 'all';
  const weakInd = (s) => (GR[s.grade] ? GR[s.grade].ind.filter((k) => hasScore((s.scores || {})[k]) && +s.scores[k] < R.PASS_MIN) : []);
  const statusChip = (st) => st === 'pass' ? '<span class="chk ok">ผ่านเกณฑ์</span>' : st === 'fail' ? '<span class="chk bad">ซ่อมเสริม</span>' : '<span class="chk empty">กรอกไม่ครบ</span>';
  function scoreCell(sc) {
    if (!hasScore(sc)) return '<td class="num" style="color:var(--muted)">–</td>';
    const L = levelOf(+sc);
    return `<td class="num" title="${L.name}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${lvColor(L)};margin-right:6px"></span>${sc}</td>`;
  }
  function renderRoster() {
    const box = $('#rosterSec'); if (!box) return;
    const list = S.roster;
    box.hidden = !list.length; if (!list.length) return;
    const cols = R.SKILL_ORDER;
    const fg = $('#rosFilter').value, q = ($('#rosSearch').value || '').trim();
    const o = overall();
    const rows = list.filter((s) => (!fg || s.grade === fg) && (!q || s.name.includes(q)) && (rosterMode === 'all' || stuStatus(s) === rosterMode));
    $('#rosStat').innerHTML = `<span class="pill">ทั้งหมด <b>${fmt(o.total)}</b> คน</span>
      <span class="chk ok">ผ่านเกณฑ์ ${fmt(o.pass)} คน (${pct(o.pass, o.total)}%)</span>
      <span class="chk bad">ไม่ผ่านเกณฑ์ / ซ่อมเสริม ${fmt(o.fail)} คน (${pct(o.fail, o.total)}%)</span>
      ${o.inc ? `<span class="chk empty">กรอกคะแนนไม่ครบ ${fmt(o.inc)} คน</span>` : ''}`;
    $('#rosTable').innerHTML = `<thead><tr><th>ที่</th><th class="l">ชื่อ – สกุล</th><th>ชั้น</th>${cols.map((k) => `<th>${R.IND_LABEL[k]}</th>`).join('')}<th>ผลการคัดกรอง</th><th class="l">ตัวชี้วัดที่ต้องพัฒนา</th></tr></thead><tbody>` +
      (rows.length ? rows.map((s, i) => `<tr><td class="num">${i + 1}</td><td class="l" style="white-space:nowrap">${esc(s.name)}</td><td>${GR[s.grade].short}</td>${cols.map((k) => GR[s.grade].ind.includes(k) ? scoreCell((s.scores || {})[k]) : '<td class="num" style="color:var(--muted)">–</td>').join('')}
        <td>${statusChip(stuStatus(s))}</td><td class="l" style="font-size:13px">${weakInd(s).map((k) => R.IND_LABEL[k]).join(', ') || '–'}</td></tr>`).join('')
        : `<tr><td colspan="${cols.length + 5}" class="empty">ไม่พบรายชื่อตามเงื่อนไข</td></tr>`) + '</tbody>';
  }

  /* ---------- บทสรุปผลการคัดกรอง (เรียบเรียงจากข้อมูลจริง) ---------- */
  const joinTh = (a) => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(' ') + ' และ' + a[a.length - 1];
  function summaryParas(o) {
    const g0 = R.GRADES[0], gN = R.GRADES[R.GRADES.length - 1];
    if (!o.total) return ['ยังไม่มีข้อมูลผลการคัดกรอง — กดปุ่ม “กรอก / แก้ไขข้อมูลผลคัดกรอง” เพื่อเพิ่มรายชื่อและคะแนนนักเรียน'];
    const ps = [`จากการดำเนินการคัดกรองความสามารถในการอ่านและการเขียนของนักเรียน${g0.full} ถึง${gN.full} ภาคเรียนที่ 1 ปีการศึกษา ${S.settings.year} ${esc(S.settings.school)} มีนักเรียนเข้ารับการคัดกรองทั้งสิ้น <b>${fmt(o.total)}</b> คน โดยกำหนดเกณฑ์ผ่าน คือ ผลการประเมินทุกตัวชี้วัดอยู่ในระดับดีขึ้นไป (ร้อยละ ${R.PASS_MIN} ขึ้นไป) ผลการคัดกรองสรุปได้ดังนี้`];
    o.stats.forEach((s) => {
      if (!s.total) return;
      const indTxt = s.gr.ind.map((k) => { const v = s.per[k]; return `${R.IND_LABEL[k]} ระดับดีมาก <b>${v.vg}</b> คน ดี <b>${v.g}</b> คน พอใช้ <b>${v.f}</b> คน ปรับปรุง <b>${v.p}</b> คน`; }).join(' · ');
      let t = `<b>${s.gr.full}</b> มีนักเรียนทั้งหมด <b>${fmt(s.total)}</b> คน (นักเรียนปกติ ${fmt(s.normal)} คน นักเรียนที่บกพร่อง ${fmt(s.impaired)} คน) ผลการประเมินรายตัวชี้วัด ได้แก่ ${indTxt} `;
      t += `สรุปมีนักเรียนผ่านเกณฑ์ <b>${s.pass.length}</b> คน คิดเป็นร้อยละ ${pct(s.pass.length, s.total, 2)}`;
      t += s.fail.length
        ? ` และไม่ผ่านเกณฑ์ต้องเข้าเรียนซ่อมเสริมภาษาไทย <b>${s.fail.length}</b> คน คิดเป็นร้อยละ ${pct(s.fail.length, s.total, 2)} ได้แก่ ${s.fail.map((x) => `${esc(x.name)} (${weakInd(x).map((k) => R.IND_LABEL[k]).join(', ')})`).join(', ')}`
        : ' นักเรียนทุกคนผ่านเกณฑ์';
      if (s.inc.length) t += ` และยังกรอกคะแนนไม่ครบ ${s.inc.length} คน`;
      ps.push(t);
    });
    const L = o.lv, rd = { good: 0, n: 0 }, wr = { good: 0, n: 0 };
    o.stats.forEach((s) => { rd.good += s.read.good; rd.n += s.read.n; wr.good += s.write.good; wr.n += s.write.n; });
    const qiName = o.qi >= 3.25 ? R.LEVELS[0].name : o.qi >= 2.5 ? R.LEVELS[1].name : o.qi >= 1.75 ? R.LEVELS[2].name : R.LEVELS[3].name;
    ps.push(`<b>สรุปภาพรวม</b> นักเรียนทั้งหมด <b>${fmt(o.total)}</b> คน เป็นนักเรียนปกติ <b>${fmt(o.normal)}</b> คน (ร้อยละ ${pct(o.normal, o.total, 2)}) และนักเรียนที่บกพร่อง <b>${fmt(o.impaired)}</b> คน (ร้อยละ ${pct(o.impaired, o.total, 2)}) ผลการประเมินทุกตัวชี้วัดรวม <b>${fmt(o.n)}</b> รายการ อยู่ในระดับดีมาก <b>${fmt(L.vg)}</b> รายการ (ร้อยละ ${pct(L.vg, o.n, 2)}) ระดับดี <b>${fmt(L.g)}</b> รายการ (ร้อยละ ${pct(L.g, o.n, 2)}) ระดับพอใช้ <b>${fmt(L.f)}</b> รายการ (ร้อยละ ${pct(L.f, o.n, 2)}) และระดับปรับปรุง <b>${fmt(L.p)}</b> รายการ (ร้อยละ ${pct(L.p, o.n, 2)}) ด้านการอ่านมีผลระดับดี–ดีมากร้อยละ <b>${pct(rd.good, rd.n, 2)}</b> ด้านการเขียนร้อยละ <b>${pct(wr.good, wr.n, 2)}</b> ดัชนีคุณภาพเฉลี่ย ${o.qi.toFixed(2)} จาก 4.00 (ระดับ${qiName}) นักเรียนผ่านเกณฑ์ <b>${fmt(o.pass)}</b> คน คิดเป็นร้อยละ <b>${pct(o.pass, o.total, 2)}</b> และไม่ผ่านเกณฑ์ต้องเข้าเรียนซ่อมเสริม <b>${fmt(o.fail)}</b> คน คิดเป็นร้อยละ <b>${pct(o.fail, o.total, 2)}</b>${o.fail ? ` (${o.stats.filter((s) => s.fail.length).map((s) => `${s.gr.short} ${s.fail.length} คน`).join(' ')})` : ''}`);
    // ข้อสังเกตเชิงวิเคราะห์
    const ranked = o.stats.filter((s) => s.total).sort((a, b) => b.pass.length / b.total - a.pass.length / a.total);
    const notes = [];
    if (ranked.length >= 2) {
      const best = ranked[0], worst = ranked[ranked.length - 1];
      notes.push(`ระดับชั้นที่มีสัดส่วนนักเรียนผ่านเกณฑ์สูงสุด คือ ${best.gr.short} (ร้อยละ ${pct(best.pass.length, best.total)}) และต่ำสุด คือ ${worst.gr.short} (ร้อยละ ${pct(worst.pass.length, worst.total)})`);
    }
    if (rd.n && wr.n && rd.good / rd.n !== wr.good / wr.n) notes.push(rd.good / rd.n > wr.good / wr.n ? 'ทักษะด้านการเขียนเป็นจุดที่ต้องพัฒนามากกว่าด้านการอ่าน' : 'ทักษะด้านการอ่านเป็นจุดที่ต้องพัฒนามากกว่าด้านการเขียน');
    const cnt = {};
    o.stats.forEach((s) => s.fail.forEach((x) => weakInd(x).forEach((k) => (cnt[k] = (cnt[k] || 0) + 1))));
    const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
    if (top.length) notes.push(`ตัวชี้วัดที่นักเรียนกลุ่มซ่อมเสริมต่ำกว่าเกณฑ์มากที่สุด ได้แก่ ${joinTh(top.slice(0, 3).map((k) => `${R.IND_LABEL[k]} (${cnt[k]} คน)`))}`);
    if (notes.length) ps.push(`<b>ข้อสังเกตเชิงวิเคราะห์</b> ${notes.join(' ')}`);
    if (o.fail) ps.push(`<b>การนำผลไปใช้</b> โรงเรียนจัดให้นักเรียนที่ไม่ผ่านเกณฑ์ทั้ง ${fmt(o.fail)} คน เข้าเรียนซ่อมเสริมภาษาไทย โดยเน้นพัฒนาตามตัวชี้วัดที่ต่ำกว่าเกณฑ์เป็นรายบุคคล ติดตามและประเมินพัฒนาการทุกเดือน และส่งเสริมนักเรียนที่ผ่านเกณฑ์ ${fmt(o.pass)} คน ให้พัฒนาทักษะการอ่านและการเขียนให้ดียิ่งขึ้นต่อไป`);
    return ps;
  }
  function renderSummary(o) {
    $('#summary').innerHTML = summaryParas(o).map((p) => `<p>${p}</p>`).join('');
  }
  function renderSolutions() {
    const el = $('#solutions'); if (el.dataset.done) return; el.dataset.done = 1;
    const cls = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c1', 'c2'];
    el.innerHTML = R.SOLUTIONS.map((s, i) => `<div class="card feat solution"><div class="no ${cls[i]}">${i + 1}</div><div><h4>${s.t}</h4><p>${s.d}</p></div></div>`).join('');
  }

  /* ---------- data entry modal (คะแนนรายบุคคล) ---------- */
  let entryGrade = R.GRADES[0].id;
  function openModal(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
  function closeModal(m) { m.hidden = true; document.body.style.overflow = ''; if (m.id === 'mEntry' && current === 'results') renderResults(false); applyKpis(false); }
  function renderEntry() {
    $('#entryTabs').innerHTML = R.GRADES.map((g) => `<button data-v="${g.id}" class="${g.id === entryGrade ? 'on' : ''}">${g.short} <small style="opacity:.7">(${S.roster.filter((s) => s.grade === g.id).length})</small></button>`).join('');
    $$('#entryTabs button').forEach((b) => b.addEventListener('click', () => { entryGrade = b.dataset.v; renderEntry(); }));
    const g = GR[entryGrade];
    const rows = S.roster.map((s, i) => ({ s, i })).filter((x) => x.s.grade === g.id);
    $('#entryBody').innerHTML = `<div class="entry-grade" data-g="${g.id}">
        <div class="top"><h4>${g.full}</h4><span data-gstat style="display:flex;gap:6px;flex-wrap:wrap"></span></div>
        <div class="tbl-wrap"><table class="tbl entry-tbl"><thead><tr><th>ที่</th><th class="l">ชื่อ – สกุล</th>${g.ind.map((k) => `<th>${R.IND_LABEL[k]}<br><small style="font-weight:400;color:var(--muted)">ร้อยละ 0–100</small></th>`).join('')}<th>ผล</th><th></th></tr></thead><tbody>
        ${rows.map((x, n) => `<tr data-r="${x.i}"><td class="num">${n + 1}</td><td class="l"><input data-name value="${esc(x.s.name)}" aria-label="ชื่อ – สกุล" style="width:100%;min-width:170px;text-align:left"></td>
          ${g.ind.map((k) => `<td><input type="number" min="0" max="100" step="1" data-k="${k}" aria-label="${R.IND_LABEL[k]}" value="${hasScore(x.s.scores[k]) ? x.s.scores[k] : ''}"></td>`).join('')}
          <td data-st>${statusChip(stuStatus(x.s))}</td>
          <td><button class="icon-btn" type="button" data-del aria-label="ลบ" title="ลบนักเรียน" style="width:30px;height:30px"><svg><use href="#i-trash"/></svg></button></td></tr>`).join('') || `<tr><td colspan="${g.ind.length + 4}" class="empty">ยังไม่มีนักเรียนในชั้นนี้</td></tr>`}
        </tbody></table></div>
        <form class="toolbar" data-add style="margin-top:10px"><input class="input" name="nm" placeholder="ชื่อ – สกุล นักเรียนที่จะเพิ่ม" required style="flex:1;min-width:200px"><button class="btn btn-primary btn-sm" type="submit"><svg><use href="#i-plus"/></svg> เพิ่มนักเรียน</button></form>
      </div>`;
    updateEntryStat();
  }
  function updateEntryStat() {
    const el = $('#entryBody [data-gstat]'); if (!el) return;
    sync();
    const s = gradeStat(GR[entryGrade]);
    el.innerHTML = `<span class="pill">นักเรียน <b>${s.total}</b> คน</span><span class="chk ok">ผ่าน ${s.pass.length}</span><span class="chk bad">ซ่อมเสริม ${s.fail.length}</span>${s.inc.length ? `<span class="chk empty">กรอกไม่ครบ ${s.inc.length}</span>` : ''}<span class="pill">บกพร่อง ${s.impaired} คน <small style="color:var(--muted)">(ภาคผนวก ข)</small></span>`;
  }
  $('#entryBody').addEventListener('input', (e) => {
    const inp = e.target, tr = inp.closest('tr[data-r]'); if (!tr) return;
    const st = S.roster[+tr.dataset.r]; if (!st) return;
    if (inp.dataset.k) {
      if (inp.value === '') { delete st.scores[inp.dataset.k]; inp.style.outline = ''; }
      else {
        const v = Math.max(0, Math.min(100, Math.round(+inp.value || 0)));
        st.scores[inp.dataset.k] = v;
        inp.style.outline = +inp.value !== v ? '2px solid var(--bad)' : '';
      }
      tr.querySelector('[data-st]').innerHTML = statusChip(stuStatus(st));
    } else if (inp.hasAttribute('data-name')) st.name = inp.value.trim();
    save(); updateEntryStat();
  });
  $('#entryBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    const i = +b.closest('tr').dataset.r;
    if (b.dataset.confirm) { S.roster.splice(i, 1); save(); renderEntry(); toast('ลบนักเรียนแล้ว'); }
    else { b.dataset.confirm = 1; b.style.background = 'var(--bad)'; b.style.color = '#fff'; toast('คลิกอีกครั้งเพื่อยืนยันการลบ'); setTimeout(() => { if (b.isConnected) { delete b.dataset.confirm; b.style.background = ''; b.style.color = ''; } }, 3000); }
  });
  $('#entryBody').addEventListener('submit', (e) => {
    const f = e.target.closest('[data-add]'); if (!f) return;
    e.preventDefault();
    const name = f.nm.value.trim(); if (!name) return;
    S.roster.push({ name, grade: entryGrade, scores: {} }); save(); renderEntry();
    const ins = $$('#entryBody tr[data-r] input[data-k]'); if (ins.length) ins[ins.length - GR[entryGrade].ind.length].focus();
    toast('เพิ่มนักเรียนแล้ว — กรอกคะแนนแต่ละตัวชี้วัด');
  });

  /* ---------- export / import ---------- */
  function exportCSV() {
    const o = overall();
    const q = (r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');
    const rows = [[`ผลการคัดกรองความสามารถในการอ่านและการเขียน ${S.settings.school} ปีการศึกษา ${S.settings.year}`], [],
      ['ตอนที่ 1 สรุปรายชั้น'],
      ['ชั้น', 'จำนวนนักเรียนทั้งหมด', 'นักเรียนที่บกพร่อง', 'นักเรียนปกติ', 'ตัวชี้วัด', 'ดีมาก (คน)', 'ดี (คน)', 'พอใช้ (คน)', 'ปรับปรุง (คน)', 'ดีมาก (%)', 'ดี (%)', 'พอใช้ (%)', 'ปรับปรุง (%)', 'ผ่านเกณฑ์ (คน)', 'ซ่อมเสริม (คน)']];
    o.stats.forEach((s) => s.gr.ind.forEach((k, i) => {
      const v = s.per[k];
      rows.push([s.gr.short, s.total, s.impaired, s.normal, R.IND_LABEL[k], v.vg, v.g, v.f, v.p, ...R.LEVELS.map((L) => pct(v[L.key], v.n, 2)), i ? '' : s.pass.length, i ? '' : s.fail.length]);
    }));
    rows.push(['รวม', o.total, o.impaired, o.normal, 'ทุกตัวชี้วัด', o.lv.vg, o.lv.g, o.lv.f, o.lv.p, ...R.LEVELS.map((L) => pct(o.lv[L.key], o.n, 2)), o.pass, o.fail]);
    rows.push([], ['ตอนที่ 2 ผลรายบุคคล (คะแนนร้อยละ)'], ['ที่', 'ชื่อ – สกุล', 'ชั้น', ...R.SKILL_ORDER.map((k) => R.IND_LABEL[k]), 'ผลการคัดกรอง', 'ตัวชี้วัดที่ต้องพัฒนา']);
    let n = 0;
    o.stats.forEach((s) => s.kids.forEach((x) => {
      const st = stuStatus(x);
      rows.push([++n, x.name, s.gr.short, ...R.SKILL_ORDER.map((k) => s.gr.ind.includes(k) && hasScore(x.scores[k]) ? `${x.scores[k]} (${levelOf(+x.scores[k]).name})` : '-'),
        st === 'pass' ? 'ผ่านเกณฑ์' : st === 'fail' ? 'ซ่อมเสริม' : 'กรอกไม่ครบ', weakInd(x).map((k) => R.IND_LABEL[k]).join(', ')]);
    }));
    const csv = '﻿' + rows.map(q).join('\r\n');
    download(`ผลคัดกรองอ่านเขียน_${S.settings.year}.csv`, csv, 'text/csv;charset=utf-8');
    toast('ส่งออกไฟล์ CSV แล้ว — เปิดด้วย Excel ได้ทันที');
  }
  function exportJSON() {
    const { grades, ...data } = S;
    download(`rwr-backup-${S.settings.year}.json`, JSON.stringify({ app: 'READ-WRITE RADAR', version: 2, data, photos }, null, 2), 'application/json');
    toast('สำรองข้อมูลเรียบร้อย');
  }
  function importJSON(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const j = JSON.parse(fr.result);
        if (!j || !j.data || typeof j.data !== 'object') throw new Error('bad');
        const hasRoster = Array.isArray(j.data.roster);
        S = load(j.data); save();
        if (Array.isArray(j.photos)) { photos = j.photos; savePhotos(); }
        applyBindings(); $$('[data-done]').forEach((e) => delete e.dataset.done); route();
        toast(hasRoster ? 'นำเข้าข้อมูลสำเร็จ' : 'นำเข้าการตั้งค่าแล้ว — ไฟล์รุ่นเก่าไม่มีคะแนนรายบุคคล จึงใช้ผลคัดกรองเดิมของโรงเรียน');
      } catch (e) { toast('ไฟล์ไม่ถูกต้อง — ใช้ไฟล์ที่ได้จากปุ่ม “สำรองข้อมูล”'); }
    };
    fr.readAsText(file);
  }

  /* ======================================================
     PAGE 4 — appendix
     ====================================================== */
  let lbList = [], lbIdx = 0;
  function openLB(list, i) {
    lbList = list; lbIdx = i; const lb = $('#lightbox'); lb.hidden = false; showLB();
  }
  function showLB() {
    const it = lbList[lbIdx]; const lb = $('#lightbox');
    lb.querySelector('img').src = it.src; lb.querySelector('.cap').textContent = `${it.cap || ''}  (${lbIdx + 1}/${lbList.length})`;
    $$('.nv', lb).forEach((b) => (b.hidden = lbList.length < 2));
  }
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target.closest('.prev')) { lbIdx = (lbIdx - 1 + lbList.length) % lbList.length; showLB(); }
    else if (e.target.closest('.next')) { lbIdx = (lbIdx + 1) % lbList.length; showLB(); }
    else if (e.target.tagName !== 'IMG') $('#lightbox').hidden = true;
  });

  function renderDocs() {
    const el = $('#docsA');
    el.innerHTML = R.DOCS_A.map((d, i) => `<div class="doc-thumb" data-i="${i}"><img src="${d.src}" alt="${d.cap}" loading="lazy"><span>${d.cap}</span></div>`).join('');
    $$('.doc-thumb', el).forEach((t) => t.addEventListener('click', () => openLB(R.DOCS_A, +t.dataset.i)));
    const qr = (arr) => arr.map((q) => `<div class="card qr-card"><img src="${q.src}" alt="QR ${q.t}"><h4>${q.t}</h4><p>${q.d}</p></div>`).join('');
    $('#qrP').innerHTML = qr(R.QR_P);
  }

  function renderGallery() {
    const all = R.GALLERY.map((g) => ({ ...g, fixed: true })).concat(photos);
    const el = $('#gallery');
    el.innerHTML = all.map((g, i) => `<div class="gal-item" data-i="${i}"><img src="${g.src}" alt="${esc(g.cap)}" loading="lazy"><div class="cap">${esc(g.cap)}</div>${g.fixed ? '' : `<button class="del" data-del="${i - R.GALLERY.length}" aria-label="ลบภาพ"><svg width="16" height="16"><use href="#i-trash"/></svg></button>`}</div>`).join('') +
      `<label class="drop" id="drop"><input type="file" accept="image/*" multiple hidden id="photoIn"><div><svg width="34" height="34"><use href="#i-img"/></svg><br><b>เพิ่มภาพกิจกรรม</b><br><small>คลิกหรือลากไฟล์มาวาง</small></div></label>`;
    $$('.gal-item', el).forEach((it) => it.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) { e.stopPropagation(); photos.splice(+del.dataset.del, 1); savePhotos(); renderGallery(); toast('ลบภาพแล้ว'); return; }
      openLB(all, +it.dataset.i);
    }));
    const drop = $('#drop');
    $('#photoIn').addEventListener('change', (e) => addPhotos(e.target.files));
    ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => addPhotos(e.dataTransfer.files));
  }
  function addPhotos(files) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    let pending = list.length;
    list.forEach((f) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          photos.push({ src: c.toDataURL('image/jpeg', .78), cap: f.name.replace(/\.[^.]+$/, '') });
          if (--pending === 0) { if (!savePhotos()) photos.splice(photos.length - list.length, list.length); renderGallery(); toast(`เพิ่มภาพ ${list.length} ภาพแล้ว`); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(f);
    });
  }

  function renderStudents() {
    const q = ($('#stuSearch').value || '').trim(), fg = $('#stuFilter').value;
    const rows = S.students.map((s, i) => ({ ...s, i })).filter((s) => (!q || s.name.includes(q)) && (!fg || s.grade === fg));
    const gOpt = (sel) => R.GRADES.map((g) => `<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${g.short}</option>`).join('');
    const tOpt = (sel) => R.IMPAIR_TYPES.map((t) => `<option ${t === sel ? 'selected' : ''}>${t}</option>`).join('');
    $('#stuTable').innerHTML = `<thead><tr><th>ที่</th><th class="l">ชื่อ – สกุล</th><th class="l">ประเภทความบกพร่อง</th><th>ระดับชั้น</th><th class="no-print"></th></tr></thead><tbody>` +
      (rows.length ? rows.map((s, n) => `<tr data-i="${s.i}"><td class="num">${n + 1}</td><td class="l" contenteditable="true" data-e="name">${esc(s.name)}</td>
        <td class="l"><select class="input" data-e="type" style="padding:4px 8px">${tOpt(s.type)}</select></td>
        <td><select class="input" data-e="grade" style="padding:4px 8px">${gOpt(s.grade)}</select></td>
        <td class="no-print"><button class="icon-btn" data-del aria-label="ลบ" style="width:32px;height:32px"><svg><use href="#i-trash"/></svg></button></td></tr>`).join('')
        : `<tr><td colspan="5" class="empty">ยังไม่มีรายชื่อ — เพิ่มจากแบบฟอร์มด้านบน</td></tr>`) + '</tbody>';
    renderStuChart();
  }
  function renderStuChart() {
    const counts = R.IMPAIR_TYPES.map((t) => S.students.filter((s) => s.type === t).length);
    const byG = R.GRADES.map((g) => S.students.filter((s) => s.grade === g.id).length);
    $('#stuStat').innerHTML = `<div style="font-size:13px;color:var(--ink-2)">รวมทั้งหมด <b style="color:var(--ink);font-size:18px">${S.students.length}</b> คน</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${R.GRADES.map((g, i) => byG[i] ? `<span class="pill">${g.short} · ${byG[i]}</span>` : '').join('')}</div>`;
    if (!HAS_CHART) { noChart('chStu'); return; }
    chartDefaults(); kill('stu');
    const idx = counts.map((c, i) => [c, i]).filter((x) => x[0]);
    charts.stu = new Chart($('#chStu'), {
      type: 'bar',
      data: { labels: idx.map((x) => R.IMPAIR_TYPES[x[1]].replace('บกพร่องทางการเรียนรู้', 'LD')), datasets: [{ data: idx.map((x) => x[0]), backgroundColor: css('--s-impaired'), borderRadius: 4, maxBarThickness: 22 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: css('--grid') } }, y: { grid: { display: false } } },
        plugins: { tooltip: { callbacks: { title: (c) => R.IMPAIR_TYPES[idx[c[0].dataIndex][1]], label: (c) => ` ${c.raw} คน` } } } }
    });
  }
  function setupStudents() {
    $('#stuType').innerHTML = R.IMPAIR_TYPES.map((t) => `<option>${t}</option>`).join('');
    $('#stuGrade').innerHTML = R.GRADES.map((g) => `<option value="${g.id}">${g.short}</option>`).join('');
    $('#stuFilter').innerHTML = '<option value="">ทุกชั้น</option>' + R.GRADES.map((g) => `<option value="${g.id}">${g.short}</option>`).join('');
    $('#stuForm').addEventListener('submit', (e) => {
      e.preventDefault(); const f = e.target;
      const name = f.name.value.trim(); if (!name) return;
      S.students.push({ name, type: f.type.value, grade: f.grade.value }); save();
      f.name.value = ''; f.name.focus(); renderStudents(); toast('เพิ่มรายชื่อแล้ว');
    });
    $('#stuSearch').addEventListener('input', renderStudents);
    $('#stuFilter').addEventListener('change', renderStudents);
    const tb = $('#stuTable');
    tb.addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]'); if (!b) return;
      const tr = b.closest('tr'); const i = +tr.dataset.i;
      if (b.dataset.confirm) { S.students.splice(i, 1); save(); renderStudents(); toast('ลบรายชื่อแล้ว'); }
      else { b.dataset.confirm = 1; b.style.background = 'var(--bad)'; b.style.color = '#fff'; b.title = 'คลิกอีกครั้งเพื่อยืนยันการลบ'; toast('คลิกอีกครั้งเพื่อยืนยันการลบ'); setTimeout(() => { if (b.isConnected) { delete b.dataset.confirm; b.style.background = ''; b.style.color = ''; } }, 3000); }
    });
    tb.addEventListener('change', (e) => {
      const el = e.target.closest('[data-e]'); if (!el) return;
      S.students[+el.closest('tr').dataset.i][el.dataset.e] = el.value; save(); renderStuChart();
    });
    tb.addEventListener('blur', (e) => {
      const el = e.target.closest('[data-e="name"]'); if (!el) return;
      S.students[+el.closest('tr').dataset.i].name = el.textContent.trim(); save();
    }, true);
  }

  function renderCommittee() {
    const roleCls = { 'ที่ปรึกษา': 'c1', 'ประธาน': 'c2', 'รองประธาน': 'c5', 'ผู้ช่วย': 'c3' };
    $('#committee').innerHTML = `<thead><tr><th>ที่</th><th class="l">ชื่อ – สกุล</th><th class="l">ตำแหน่ง</th><th>หน้าที่</th></tr></thead><tbody>` +
      R.COMMITTEE.map((c, i) => `<tr><td class="num">${i + 1}</td><td class="l" style="min-width:220px"><input data-ci="${i}" value="${esc(S.committee[i] || '')}" placeholder="……………………………………"></td><td class="l">${c[0]}</td><td><span class="role ${roleCls[c[1]]}" style="color:#fff">${c[1]}</span></td></tr>`).join('') + '</tbody>';
    $$('#committee input').forEach((inp) => inp.addEventListener('input', () => { S.committee[+inp.dataset.ci] = inp.value; save(); }));
  }

  function setupAppendix() {
    $$('#apxTabs .tab').forEach((t) => t.addEventListener('click', () => showApx(t.dataset.t)));
  }
  function showApx(k) {
    $$('#apxTabs .tab').forEach((x) => x.classList.toggle('on', x.dataset.t === k));
    $$('.apx').forEach((a) => (a.hidden = a.dataset.apx !== k));
    if (k === 'b') renderStudents();
  }

  /* ======================================================
     ROUTER
     ====================================================== */
  const PAGES = ['principle', 'method', 'results', 'appendix'];
  const TITLES = { principle: 'หลักการและเหตุผล', method: 'วิธีดำเนินการ', results: 'สรุปผลการศึกษา', appendix: 'ภาคผนวก' };
  let current = null;
  function renderPage(p, animate) {
    if (p === 'principle') { renderCycle(); renderDefModel(); applyKpis(animate); }
    if (p === 'method') { renderPDCA(); renderSteps(); renderBand(); renderMatrix(); renderGantt(); }
    if (p === 'results') renderResults(animate);
    if (p === 'appendix') { renderDocs(); renderGallery(); renderCommittee(); renderStudents(); }
  }
  function route() {
    let p = (location.hash || '').replace('#', '');
    if (!PAGES.includes(p)) p = 'principle';
    const changed = p !== current; current = p;
    $$('.page').forEach((s) => (s.hidden = s.dataset.page !== p));
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === p));
    document.title = `${TITLES[p]} | READ•WRITE RADAR ${S.settings.year}`;
    renderPage(p, changed);
    if (changed) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    observeReveal();
  }
  let io;
  function observeReveal() {
    if (!('IntersectionObserver' in window)) { $$('.reveal').forEach((r) => r.classList.add('in')); return; }
    if (!io) io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .08 });
    $$('.page:not([hidden]) .reveal:not(.in)').forEach((r) => io.observe(r));
  }

  /* ---------------- global events ---------------- */
  window.addEventListener('hashchange', route);
  window.addEventListener('scroll', () => {
    const h = document.documentElement; const k = h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight);
    $('#progress').style.width = (k * 100) + '%';
    $('#toTop').hidden = h.scrollTop < 500;
  }, { passive: true });
  $('#toTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function syncThemeIcon() { $('#btnTheme use').setAttribute('href', isDark() ? '#i-sun' : '#i-moon'); }
  $('#btnTheme').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('rwr-theme', next); } catch (e) {}
    syncThemeIcon();
    $$('[data-done]').forEach((e) => delete e.dataset.done);
    renderPage(current, false);
  });

  // print: render all pages so the PDF contains the full report
  $('#btnPrint').addEventListener('click', () => {
    $$('.page').forEach((s) => (s.hidden = false));
    $$('.apx').forEach((a) => (a.hidden = false));
    $$('.reveal').forEach((r) => r.classList.add('in'));
    PAGES.forEach((p) => renderPage(p, false));
    setTimeout(() => window.print(), 400);
  });
  window.addEventListener('afterprint', () => { showApx($('#apxTabs .tab.on').dataset.t); route(); });

  // modals
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(m); }));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') { if (!$('#lightbox').hidden && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { lbIdx = (lbIdx + (e.key === 'ArrowRight' ? 1 : -1) + lbList.length) % lbList.length; showLB(); } return; }
    if (!$('#lightbox').hidden) { $('#lightbox').hidden = true; return; }
    $$('.modal').forEach((m) => { if (!m.hidden) closeModal(m); });
  });
  $('#btnEntry').addEventListener('click', () => { renderEntry(); openModal('#mEntry'); });
  $('#btnReset').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!b.dataset.confirm) { b.dataset.confirm = 1; b.textContent = 'ยืนยันคืนค่า?'; setTimeout(() => { delete b.dataset.confirm; b.textContent = 'คืนค่าผลคัดกรองของโรงเรียน'; }, 3500); return; }
    delete b.dataset.confirm; b.textContent = 'คืนค่าผลคัดกรองของโรงเรียน';
    S.roster = R.initialData().roster; save(); renderEntry(); toast('คืนค่ารายชื่อและคะแนนของโรงเรียนแล้ว');
  });
  $('#btnClear').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!b.dataset.confirm) { b.dataset.confirm = 1; b.lastChild.textContent = ' ยืนยันล้างข้อมูล?'; setTimeout(() => { delete b.dataset.confirm; b.lastChild.textContent = ' ล้างข้อมูลทั้งหมด'; }, 3500); return; }
    delete b.dataset.confirm; b.lastChild.textContent = ' ล้างข้อมูลทั้งหมด';
    S.students = []; S.roster = []; save(); renderEntry(); toast('ล้างข้อมูลแล้ว — เพิ่มนักเรียนและกรอกคะแนนได้ทันที');
  });
  $('#btnCSV').addEventListener('click', exportCSV);
  $('#btnExport').addEventListener('click', exportJSON);
  $('#fileImport').addEventListener('change', (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ''; });
  $('#btnCopy').addEventListener('click', () => {
    const txt = $$('#summary p').map((p) => '\t' + p.textContent).join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('คัดลอกบทสรุปแล้ว — วางลงใน Word ได้ทันที'), () => {
      const r = document.createRange(); r.selectNodeContents($('#summary')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('เลือกข้อความแล้ว กด Ctrl+C เพื่อคัดลอก');
    });
  });
  $$('#segMode button').forEach((b) => b.addEventListener('click', () => {
    stackMode = b.dataset.v; $$('#segMode button').forEach((x) => x.classList.toggle('on', x === b)); renderResults(false);
  }));
  $$('#segTable button').forEach((b) => b.addEventListener('click', () => {
    tableMode = b.dataset.v; $$('#segTable button').forEach((x) => x.classList.toggle('on', x === b)); renderTable();
  }));
  $('#rosFilter').innerHTML = '<option value="">ทุกชั้น</option>' + R.GRADES.map((g) => `<option value="${g.id}">${g.short}</option>`).join('');
  $('#rosFilter').addEventListener('change', renderRoster);
  $('#rosSearch').addEventListener('input', renderRoster);
  $$('#segRoster button').forEach((b) => b.addEventListener('click', () => {
    rosterMode = b.dataset.v; $$('#segRoster button').forEach((x) => x.classList.toggle('on', x === b)); renderRoster();
  }));
  $('#cScore').addEventListener('input', calcLevel);
  $('#cFull').addEventListener('input', calcLevel);

  // settings
  $('#btnSettings').addEventListener('click', () => {
    $('#setSchool').value = S.settings.school; $('#setArea').value = S.settings.area; $('#setYear').value = S.settings.year;
    openModal('#mSettings');
  });
  $('#btnSaveSet').addEventListener('click', () => {
    S.settings.school = $('#setSchool').value.trim() || 'โรงเรียน';
    S.settings.area = $('#setArea').value.trim();
    S.settings.year = parseInt($('#setYear').value, 10) || 2569;
    save(); applyBindings(); closeModal($('#mSettings')); renderPage(current, false); toast('บันทึกการตั้งค่าแล้ว');
  });

  /* ---------------- init ---------------- */
  applyBindings();
  setupStudents();
  setupAppendix();
  syncThemeIcon();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (!document.documentElement.getAttribute('data-theme')) { syncThemeIcon(); $$('[data-done]').forEach((e) => delete e.dataset.done); renderPage(current, false); } });
  route();
})();
