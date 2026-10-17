/* ══════════════════════════════════════════════════
   JARDIN PLANNER — report.js : rapport PDF
   ══════════════════════════════════════════════════
   - Police DejaVu Sans intégrée : accents, ², ≈, →, ⚠… s'affichent correctement
     (les polices standard de jsPDF ne connaissent que le Latin-1).
   - Plan aérien recalculé à partir des tuiles satellite (projection Web Mercator)
     au lieu d'une capture d'écran de la carte, qui déformait la vue.
   - Photos du moodboard téléchargées, recadrées et intégrées.
   Le rapport reprend les zones affichées sur la carte (zones masquées exclues,
   filtres pris en compte si « Appliquer à la carte » est coché). */

const PDF_LIBS = {
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  font: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf',
  fontBold: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf',
};
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

let pdfFonts = null;                // polices en base64, chargées une seule fois
const tileCache = new Map();        // url → Promise<Image|null>

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('script introuvable : ' + src));
    document.head.appendChild(s);
  });
}

async function fetchBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('police introuvable');
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// DejaVu ne couvre pas les émojis (🌿, 🛖…) : on les retire, en gardant ⚠ ✔ ✓
const PDF_KEEP = new Set(['⚠', '✔', '✓', '☀']);
function pdfText(s) {
  return String(s ?? '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}️‍]/gu, m => PDF_KEEP.has(m) ? m : '')
    .replace(/[ \t]+\n/g, '\n').trim();
}

function loadImg(src) {
  return new Promise(resolve => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

// Photo recadrée en 4:3 (« cover ») et compressée en JPEG ; null si illisible
async function photoData(src, w = 520) {
  const im = await loadImg(src);
  if (!im || !im.naturalWidth) return null;
  const h = Math.round(w * 3 / 4);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const s = Math.max(w / im.naturalWidth, h / im.naturalHeight);
  c.getContext('2d').drawImage(im, (w - im.naturalWidth * s) / 2, (h - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
  try { return c.toDataURL('image/jpeg', 0.82); } catch { return null; } // serveur sans CORS
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const k = next++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

function tileImg(z, x, y) {
  const url = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  if (!tileCache.has(url)) tileCache.set(url, loadImg(url));
  return tileCache.get(url);
}

function worldPx(ll, z) {
  const n = 256 * 2 ** z, s = Math.sin(ll.lat * Math.PI / 180);
  return { x: (ll.lng + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

// Vue aérienne de `bounds` dans un canvas wPx × hPx (même rapport que le cadre du PDF :
// aucune déformation). `focus` : zones mises en avant, les autres sont estompées.
async function renderPlan(list, num, { bounds, wPx, hPx, focus = null }) {
  bounds = L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast()).extend(bounds.getCenter().toBounds(45));
  const a = worldPx(bounds.getNorthWest(), 0), b = worldPx(bounds.getSouthEast(), 0);
  const fit = Math.min(wPx / ((b.x - a.x) * 1.12), hPx / ((b.y - a.y) * 1.12)); // px canvas par px monde (z0)
  const z = Math.max(1, Math.min(19, Math.ceil(Math.log2(fit))));               // 19 = résolution native Esri
  const k = fit / 2 ** z;
  const ox = (a.x + b.x) / 2 * 2 ** z - wPx / 2 / k, oy = (a.y + b.y) / 2 * 2 ** z - hPx / 2 / k;

  const c = document.createElement('canvas'); c.width = wPx; c.height = hPx;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d9d2c0'; ctx.fillRect(0, 0, wPx, hPx);
  const jobs = [];
  for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + wPx / k) / 256); tx++)
    for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + hPx / k) / 256); ty++)
      jobs.push(tileImg(z, tx, ty).then(im => ({ im, tx, ty })));
  for (const { im, tx, ty } of await Promise.all(jobs))
    if (im) ctx.drawImage(im, (tx * 256 - ox) * k, (ty * 256 - oy) * k, 256 * k + 1, 256 * k + 1);

  const P = ll => { const p = worldPx(ll, z); return [(p.x - ox) * k, (p.y - oy) * k]; };
  const mPerPx = 156543.03392 * Math.cos(bounds.getCenter().lat * Math.PI / 180) / 2 ** z / k;
  const order = [...list].sort((p, q) => (q.area || 0) - (p.area || 0)); // grandes zones dessous
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const zn of order) {
    const dim = focus && !focus.has(zn.id);
    ctx.strokeStyle = ctx.fillStyle = zn.color || '#7A9E7E';
    if (zn.isLine || zn.isCurve) {
      const pts = (zn.isCurve ? bezierPoints(zn.points) : zn.points).map(P);
      ctx.globalAlpha = dim ? 0.2 : 0.95;
      ctx.lineWidth = Math.max(2, (zn.thickness || 4) * 0.2 / mPerPx); // épaisseur ≈ px à zoom 19 → mètres
      ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      continue;
    }
    ctx.beginPath();
    if (zn.isCircle) { const [x, y] = P(L.latLng(zn.center)); ctx.arc(x, y, Math.max(3, zn.radius / mPerPx), 0, 2 * Math.PI); }
    else { zn.points.map(P).forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); }
    ctx.globalAlpha = dim ? 0.06 : 0.32; ctx.fill();
    ctx.globalAlpha = dim ? 0.3 : 1; ctx.lineWidth = Math.max(2, wPx / 700); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Pastilles numérotées (renvoient aux fiches) ; les petites zones par-dessus
  const r = Math.round(wPx / 95);
  ctx.font = `bold ${Math.round(r * 1.05)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const zn of order) {
    if (focus && !focus.has(zn.id)) continue;
    const [x, y] = P(layerMap[zn.id].labelPos);
    if (x < -r || y < -r || x > wPx + r || y > hPx + r) continue;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
    ctx.lineWidth = Math.max(2, r / 4); ctx.strokeStyle = zn.color || '#7A9E7E'; ctx.stroke();
    ctx.fillStyle = '#2A2519'; ctx.fillText(String(num.get(zn.id)), x, y + 1);
  }

  // Flèche du nord + échelle
  const s = Math.round(wPx / 40);
  ctx.fillStyle = 'rgba(42,37,25,0.8)'; ctx.fillRect(wPx - s * 2.2, s * 0.6, s * 1.6, s * 2.2);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(wPx - s * 1.4, s * 0.9); ctx.lineTo(wPx - s * 1.8, s * 1.9); ctx.lineTo(wPx - s * 1.0, s * 1.9); ctx.fill();
  ctx.font = `bold ${Math.round(s * 0.6)}px sans-serif`; ctx.fillText('N', wPx - s * 1.4, s * 2.35);
  const niceM = [5, 10, 20, 25, 50, 100, 200].find(m => m / mPerPx > wPx / 8) || 200;
  const len = niceM / mPerPx;
  ctx.fillStyle = 'rgba(42,37,25,0.8)'; ctx.fillRect(s * 0.6, hPx - s * 1.7, len + s * 1.2, s * 1.1);
  ctx.fillStyle = '#fff'; ctx.fillRect(s * 1.2, hPx - s * 0.95, len, Math.max(3, s * 0.12));
  ctx.font = `${Math.round(s * 0.5)}px sans-serif`; ctx.fillText(niceM + ' m', s * 1.2 + len / 2, hPx - s * 1.3);
  return c.toDataURL('image/jpeg', 0.86);
}

async function exportPDF() {
  if (!zones.length) { showToast('Aucune zone à exporter'); return; }
  const btn = document.getElementById('btn-export-pdf');
  btn.disabled = true;
  try { await buildReport(); }
  catch (e) { console.error(e); showToast('❌ Rapport impossible : ' + e.message); }
  finally { btn.disabled = false; }
}

async function buildReport() {
  showToast('📄 Rapport : chargement des outils…');
  await loadScript(PDF_LIBS.jspdf);
  if (!pdfFonts) pdfFonts = await Promise.all([fetchBase64(PDF_LIBS.font), fetchBase64(PDF_LIBS.fontBold)]);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('DejaVuSans.ttf', pdfFonts[0]); doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', pdfFonts[1]); doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');

  // ── Zones du rapport, dans l'ordre de la visite guidée puis par catégorie ──
  const list = zones.filter(z => zoneVisible[z.id] !== false && (!filterMap || matchesFilter(z)) && layerMap[z.id]);
  const steps = tour ? tour.etapes : [];
  const ordered = [], seen = new Set();
  steps.forEach(s => (s.zones || []).forEach(id => {
    const z = list.find(q => q.id === id);
    if (z && !seen.has(id)) { seen.add(id); ordered.push(z); }
  }));
  list.filter(z => !seen.has(z.id))
    .sort((a, b) => pdfText(a.category).localeCompare(pdfText(b.category)) || (a.name || '').localeCompare(b.name || ''))
    .forEach(z => ordered.push(z));
  const num = new Map(ordered.map((z, i) => [z.id, i + 1]));

  // ── Photos ──
  const urls = [...new Set(ordered.flatMap(z => (z.photos || []).slice(0, 6)))];
  let done = 0;
  const imgs = new Map();
  await mapLimit(urls, 6, async u => {
    imgs.set(u, await photoData(u));
    if (++done % 5 === 0 || done === urls.length) showToast(`📷 Photos ${done} / ${urls.length}`);
  });

  // ── Mise en page ──
  const W = 210, H = 297, M = 16, CW = W - 2 * M, BOTTOM = H - 16;
  const COL = { ink: [42, 37, 25], soft: [110, 98, 80], cream: [245, 240, 232], parch: [237, 229, 208], sage: [78, 116, 82], terra: [193, 127, 74], white: [255, 255, 255] };
  const rgb = h => /^#[0-9a-f]{6}$/i.test(h || '') ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : [122, 158, 126];
  const font = (style, size, color = COL.ink) => { doc.setFont('DejaVu', style); doc.setFontSize(size); doc.setTextColor(...color); };
  const lineH = size => size * 0.3528 * 1.45;
  let y = 0, section = '';

  const header = () => {
    doc.setFillColor(...COL.ink); doc.rect(0, 0, W, 13, 'F');
    font('bold', 9.5, COL.cream); doc.text(section, M, 8.6);
  };
  const newPage = title => { doc.addPage(); if (title) section = title; header(); y = 22; };
  const ensure = h => { if (y + h > BOTTOM) newPage(); };
  const para = (text, size = 9, color = COL.ink, indent = 0, style = 'normal') => {
    font(style, size, color);
    const lh = lineH(size);
    for (const line of doc.splitTextToSize(pdfText(text), CW - indent)) {
      ensure(lh);
      doc.text(line, M + indent, y + lh * 0.72);
      y += lh;
    }
  };
  const boundsOf = ids => {
    const b = L.latLngBounds([]);
    ids.forEach(id => layerMap[id] && b.extend(layerMap[id].bounds));
    return b;
  };
  const typeLabel = z => z.isLine ? 'ligne' : z.isCurve ? 'courbe' : fmtArea(z.area || 0);
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  // ── Page 1 : couverture + plan général ──
  doc.setFillColor(...COL.cream); doc.rect(0, 0, W, H, 'F');
  doc.setFillColor(...COL.ink); doc.rect(0, 0, W, 52, 'F');
  font('bold', 24, COL.cream); doc.text('Carnet de projet', M, 22);
  font('normal', 13, [232, 201, 154]); doc.text(pdfText(tour ? tour.titre : 'Jardin'), M, 31);
  const terrain = list.filter(z => !z.isLine && !z.isCurve).sort((a, b) => (b.area || 0) - (a.area || 0))[0];
  const nPhotos = [...imgs.values()].filter(Boolean).length;
  font('normal', 8.5, [200, 190, 170]);
  doc.text(`${today}  ·  ${ordered.length} zones  ·  ${terrain ? 'parcelle ' + fmtArea(terrain.area || 0) + '  ·  ' : ''}${nPhotos} photos${steps.length ? '  ·  ' + steps.length + ' étapes de visite' : ''}`, M, 42);
  showToast('🛰 Rapport : plan général…');
  // Hauteur du cadre adaptée à la forme du terrain (une parcelle allongée ne laisse pas de vide)
  const all = boundsOf(ordered.map(z => z.id));
  const pa = worldPx(all.getNorthWest(), 0), pb = worldPx(all.getSouthEast(), 0);
  const planH = Math.max(100, Math.min(BOTTOM - 62, CW * (pb.y - pa.y) / (pb.x - pa.x) * 1.08));
  const plan = await renderPlan(list, num, { bounds: all, wPx: 2000, hPx: Math.round(2000 * planH / CW) });
  doc.addImage(plan, 'JPEG', M, 58, CW, planH, 'plan', 'FAST');
  doc.setDrawColor(...COL.soft); doc.setLineWidth(0.2); doc.rect(M, 58, CW, planH);
  font('normal', 7.5, COL.soft);
  doc.text('Plan général — chaque numéro renvoie à la fiche de la zone (voir la légende page suivante).', M, 58 + planH + 5);

  // ── Légende : pages réservées, remplies à la fin avec les numéros de page ──
  const ROWS = Math.floor((BOTTOM - 24) / 5.4), PER_PAGE = ROWS * 2;
  const legendPages = [];
  for (let i = 0; i < Math.ceil(ordered.length / PER_PAGE); i++) { newPage('Légende du plan'); legendPages.push(doc.getNumberOfPages()); }

  // ── Parcours de visite ──
  if (steps.length) {
    newPage('Parcours de visite');
    var parcoursPage = doc.getNumberOfPages();
    para(`Le parcours suit le chemin d'un visiteur, en ${steps.length} étapes. Sur chaque vue, les zones de l'étape sont mises en avant ; les numéros renvoient aux fiches.`, 9, COL.soft);
    y += 4;
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      const ids = (st.zones || []).filter(id => num.has(id));
      showToast(`🗺 Parcours : étape ${i + 1} / ${steps.length}`);
      ensure(92);
      font('bold', 7.5, COL.sage); doc.text(`ÉTAPE ${i + 1} / ${steps.length}`, M, y + 3); y += 5;
      para(st.titre || '', 12.5, COL.ink, 0, 'bold'); y += 1.5;
      if (ids.length) {
        const mh = 68;
        const img = await renderPlan(list, num, { bounds: boundsOf(ids), wPx: 1400, hPx: Math.round(1400 * mh / CW), focus: new Set(ids) });
        doc.addImage(img, 'JPEG', M, y, CW, mh, 'etape' + i, 'FAST');
        y += mh + 3;
      }
      para(st.texte || '', 9.2);
      if (ids.length) { y += 1; para('Zones : ' + ids.map(id => `${num.get(id)} · ${zones.find(z => z.id === id).name}`).join('   '), 7.8, COL.soft); }
      y += 7;
    }
  }

  // ── Fiches des zones ──
  newPage('Fiches des zones');
  const fichesPage = doc.getNumberOfPages();
  const pageOf = new Map();
  let lastCat = null;
  for (const z of ordered) {
    const cat = pdfText(z.category) || 'Sans catégorie';
    if (!steps.length && cat !== lastCat) { ensure(30); font('bold', 11, COL.sage); doc.text(cat, M, y + 4); y += 9; lastCat = cat; }
    ensure(28);
    pageOf.set(z.id, doc.getNumberOfPages());
    const col = rgb(z.color);
    doc.setFillColor(...col); doc.roundedRect(M, y, 9, 7, 1.2, 1.2, 'F');
    font('bold', 8.5, COL.white); doc.text(String(num.get(z.id)), M + 4.5, y + 4.9, { align: 'center' });
    font('bold', 8.5, COL.soft); doc.text(typeLabel(z), M + CW, y + 5, { align: 'right' });
    const nameLines = (font('bold', 12.5), doc.splitTextToSize(pdfText(z.name || 'Sans nom'), CW - 40));
    nameLines.forEach((l, i) => doc.text(l, M + 12, y + 5.3 + i * lineH(12.5)));
    y += 3 + nameLines.length * lineH(12.5);
    para([cat, ...(z.tags || []).map(t => '#' + t)].join('   '), 8, COL.soft, 12);
    y += 1;
    doc.setDrawColor(...COL.parch); doc.setLineWidth(0.4); doc.line(M, y, M + CW, y); y += 3;
    if (z.notes) para(z.notes, 9);
    const photos = (z.photos || []).slice(0, 6);
    if (photos.length) {
      y += 2;
      const gap = 3, cw = (CW - 2 * gap) / 3, ch = cw * 3 / 4;
      for (let r = 0; r < photos.length; r += 3) {
        ensure(ch + gap);
        photos.slice(r, r + 3).forEach((u, i) => {
          const x = M + i * (cw + gap), data = imgs.get(u);
          if (data) doc.addImage(data, 'JPEG', x, y, cw, ch, u, 'FAST');
          else {
            doc.setFillColor(...COL.parch); doc.rect(x, y, cw, ch, 'F');
            font('normal', 7, COL.soft); doc.text('image indisponible', x + cw / 2, y + ch / 2, { align: 'center' });
          }
        });
        y += ch + gap;
      }
    }
    y += 8;
  }

  // ── Légende (remplissage des pages réservées) ──
  const colW = (CW - 8) / 2;
  ordered.forEach((z, i) => {
    const page = legendPages[Math.floor(i / PER_PAGE)], k = i % PER_PAGE;
    doc.setPage(page);
    const x = M + (k >= ROWS ? colW + 8 : 0), yy = 22 + (k % ROWS) * 5.4;
    doc.setFillColor(...rgb(z.color)); doc.circle(x + 2, yy + 1.9, 1.7, 'F');
    font('bold', 7.5); doc.text(String(i + 1), x + 9, yy + 3, { align: 'right' });
    font('normal', 7.8);
    let name = pdfText(z.name || 'Sans nom');
    while (name.length > 4 && doc.getTextWidth(name) > colW - 24) name = name.slice(0, -2).trimEnd() + '…';
    doc.text(name, x + 11, yy + 3);
    font('normal', 7.2, COL.soft); doc.text('p. ' + pageOf.get(z.id), x + colW, yy + 3, { align: 'right' });
  });

  // ── Sommaire sur la couverture, s'il reste de la place sous le plan ──
  const sy = 58 + planH + 16;
  if (BOTTOM - sy > 34) {
    doc.setPage(1);
    font('bold', 11, COL.ink); doc.text('Sommaire', M, sy);
    const toc = [['Légende du plan', legendPages[0]], ...(steps.length ? [['Parcours de visite', parcoursPage]] : []), ['Fiches des zones', fichesPage]];
    toc.forEach(([t, p], i) => {
      font('normal', 9.5, COL.ink); doc.text(t, M, sy + 8 + i * 6.5);
      font('normal', 9.5, COL.soft); doc.text('p. ' + p, M + 80, sy + 8 + i * 6.5, { align: 'right' });
    });
  }

  // ── Pieds de page ──
  const total = doc.getNumberOfPages();
  for (let p = 2; p <= total; p++) {
    doc.setPage(p);
    font('normal', 7, COL.soft);
    doc.text(`Carnet de projet — ${today}`, M, H - 8);
    doc.text(`${p} / ${total}`, W - M, H - 8, { align: 'right' });
  }

  doc.save('jardin-rapport-' + new Date().toISOString().slice(0, 10) + '.pdf');
  showToast(`✅ Rapport PDF exporté (${total} pages)`);
}
