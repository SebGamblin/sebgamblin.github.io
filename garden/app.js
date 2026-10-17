/* ══════════════════════════════════════════════════
   JARDIN PLANNER — app.js
   ══════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let zones = [];
let selectedColor = '#7A9E7E';
let currentMode = 'select'; // draw | select | circle | line | curve
let isDrawing = false;
let drawingPoints = [];
let drawingPolyline = null;
let drawingPreview = null;
let selectedZoneId = null;
let editingZoneId = null;
let tempTags = [];
let tempPhotos = [];
let ctxZoneId = null;

// Circle
let circleDrawing = false;
let circleCenter = null;
let circlePreviewLayer = null;

// Line / curve
let lineThickness = 4;

// Vertex editing
let vertexEditMode = false;
let vertexMarkers = [];
let editingVertexZoneId = null;

// Visibility (zoneId → boolean)
const zoneVisible = {};

// Filters
let filterText = '';
let filterCategory = '';
let filterTag = '';
let filterMap = false; // appliquer les filtres aussi à la carte
try { filterMap = localStorage.getItem('jardin-filter-map') === '1'; } catch {}

// Mode visite (lecture seule : carte + panneau)
let visitMode = false;

// Visite guidée : { titre, etapes: [{ titre, texte, zones: [ids] }] } (champ « visite » du JSON)
let tour = null;
let tourStep = -1;     // étape affichée, -1 = visite guidée fermée
let tourIds = null;    // Set des zones de l'étape courante

// Chargement groupé : évite de reconstruire la liste à chaque zone
let batching = false;

// Layer registry  zoneId → { layer, label }
const layerMap = {};

// Toast timer (var = hoisted, always safe before first call)
var toastTimer;

// Category → emoji
const CAT_ICON = {
  '🌿 Végétation':     '🌿',
  '🌸 Fleurs & Massifs':'🌸',
  '🥕 Potager':        '🥕',
  '🌊 Eau & Bassin':   '🌊',
  '🛖 Structure':      '🛖',
  '🛤 Chemin & Terrasse':'🛤',
  '🌳 Arbres & Haies': '🌳',
  '⛺ Espace de vie':  '⛺',
  '🪨 Minéral & Gravier':'🪨',
  '💡 Idée future':    '💡',
};

// ═══════════════════════════════════════════════════
//  MAP SETUP
// ═══════════════════════════════════════════════════
const map = L.map('map', { center: [46.5, 2.5], zoom: 18, zoomControl: true, doubleClickZoom: false });

const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 22, maxNativeZoom: 19 });
const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri', maxZoom: 22, maxNativeZoom: 19 });
satLayer.addTo(map);
L.control.layers({ '🛰 Satellite': satLayer, '🗺 Plan': osmLayer }, {}, { position: 'topright' }).addTo(map);

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(pos => {
    // Ne recentrer que si aucune donnée sauvegardée n'existe
    if (zones.length === 0) {
      map.setView([pos.coords.latitude, pos.coords.longitude], 18);
    }
  }, () => {});
}

// ═══════════════════════════════════════════════════
//  GEOMETRY HELPERS
// ═══════════════════════════════════════════════════
function calcArea(latlngs) {
  const R = 6371000, n = latlngs.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lat1 = latlngs[i].lat * Math.PI / 180, lat2 = latlngs[j].lat * Math.PI / 180;
    const lng1 = latlngs[i].lng * Math.PI / 180, lng2 = latlngs[j].lng * Math.PI / 180;
    area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(area * R * R / 2);
}

function fmtArea(a) {
  return a >= 10000 ? (a / 10000).toFixed(2) + ' ha' : Math.round(a) + ' m²';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Ray-casting pour tester si un point est dans un polygone
function pointInPolygon(latlng, points) {
  let inside = false;
  const x = latlng.lat, y = latlng.lng;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lat, yi = points[i].lng;
    const xj = points[j].lat, yj = points[j].lng;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

// Position de l'étiquette : centroïde pour un polygone, milieu du tracé pour une ligne
function labelLatLng(zone, layer) {
  if (zone.isCircle) return L.latLng(zone.center);
  const pts = (zone.isLine || zone.isCurve) ? layer.getLatLngs() : zone.points;
  if (zone.isLine || zone.isCurve) {
    const k = Math.cos(pts[0].lat * Math.PI / 180);
    const seg = pts.slice(1).map((p, i) => Math.hypot(p.lat - pts[i].lat, (p.lng - pts[i].lng) * k));
    let half = seg.reduce((s, d) => s + d, 0) / 2;
    for (let i = 0; i < seg.length; i++) {
      if (half <= seg[i] && seg[i] > 0) {
        const t = half / seg[i];
        return L.latLng(pts[i].lat + (pts[i+1].lat - pts[i].lat) * t, pts[i].lng + (pts[i+1].lng - pts[i].lng) * t);
      }
      half -= seg[i];
    }
    return pts[pts.length - 1];
  }
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j].lng * pts[i].lat - pts[i].lng * pts[j].lat;
    a += f; cx += (pts[j].lng + pts[i].lng) * f; cy += (pts[j].lat + pts[i].lat) * f;
  }
  if (Math.abs(a) < 1e-14) return layer.getBounds().getCenter();
  const c = L.latLng(cy / (3 * a), cx / (3 * a));
  return pointInPolygon(c, pts) ? c : layer.getBounds().getCenter();
}

// Catmull-Rom spline through control points
function bezierPoints(ctrlPts, steps) {
  steps = steps || 16;
  if (ctrlPts.length < 2) return ctrlPts.map(p => L.latLng(p.lat, p.lng));
  const pts = ctrlPts.map(p => ({ lat: p.lat, lng: p.lng }));
  const ext = [pts[0], ...pts, pts[pts.length - 1]];
  const result = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i-1], p1 = ext[i], p2 = ext[i+1], p3 = ext[i+2];
    for (let t = 0; t <= 1; t += 1 / steps) {
      const t2 = t*t, t3 = t2*t;
      result.push(L.latLng(
        0.5*((2*p1.lat)+(-p0.lat+p2.lat)*t+(2*p0.lat-5*p1.lat+4*p2.lat-p3.lat)*t2+(-p0.lat+3*p1.lat-3*p2.lat+p3.lat)*t3),
        0.5*((2*p1.lng)+(-p0.lng+p2.lng)*t+(2*p0.lng-5*p1.lng+4*p2.lng-p3.lng)*t2+(-p0.lng+3*p1.lng-3*p2.lng+p3.lng)*t3)
      ));
    }
  }
  result.push(L.latLng(pts[pts.length-1].lat, pts[pts.length-1].lng));
  return result;
}

// ═══════════════════════════════════════════════════
//  DRAWING — POLYGON / LINE / CURVE
// ═══════════════════════════════════════════════════
let clickTimer = null;
const DBLCLICK_DELAY = 280;

map.on('click', onMapClick);
map.on('dblclick', onMapDblClick);
map.on('mousemove', onMapMouseMove);

function onMapClick(e) {
  if (!['draw','line','curve'].includes(currentMode)) return;
  if (clickTimer) return; // second click of a dblclick — ignore
  clickTimer = setTimeout(() => {
    clickTimer = null;
    drawingPoints.push(e.latlng);
    isDrawing = true;
    updateDrawingVisual();
    setDrawHint(true);
  }, DBLCLICK_DELAY);
}

function onMapDblClick(e) {
  if (!['draw','line','curve'].includes(currentMode)) return;
  // Cancel the pending single-click timeout (first click of the dblclick)
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
  // Add the dblclick position as the final point so the endpoint is included
  drawingPoints.push(e.latlng);
  isDrawing = true;
  if (currentMode === 'draw' && drawingPoints.length < 3) { drawingPoints.pop(); showToast('⚠️ Tracez au moins 3 points'); return; }
  if ((currentMode === 'line' || currentMode === 'curve') && drawingPoints.length < 2) { drawingPoints.pop(); showToast('⚠️ Tracez au moins 2 points'); return; }
  finishDraw();
}

function onMapMouseMove(e) {
  if (!isDrawing || !['draw','line','curve'].includes(currentMode)) return;
  if (drawingPreview) { map.removeLayer(drawingPreview); drawingPreview = null; }
  const pts = [...drawingPoints, e.latlng];
  if (pts.length < 2) return;
  const renderPts = currentMode === 'curve' ? bezierPoints(pts) : pts;
  drawingPreview = L.polyline(renderPts, {
    color: selectedColor,
    weight: currentMode === 'draw' ? 2 : lineThickness,
    dashArray: '6,4', opacity: 0.7
  }).addTo(map);
}

function updateDrawingVisual() {
  if (drawingPolyline) { map.removeLayer(drawingPolyline); drawingPolyline = null; }
  if (drawingPoints.length >= 2) {
    const pts = currentMode === 'curve' ? bezierPoints(drawingPoints) : drawingPoints;
    drawingPolyline = L.polyline(pts, {
      color: selectedColor,
      weight: (currentMode === 'line' || currentMode === 'curve') ? lineThickness : 2.5,
      opacity: 0.9
    }).addTo(map);
  } else if (drawingPoints.length === 1 && currentMode !== 'draw') {
    drawingPolyline = L.circleMarker(drawingPoints[0], {
      radius: 4, color: selectedColor, fillColor: selectedColor, fillOpacity: 1, weight: 0
    }).addTo(map);
  }
}

function finishDraw() {
  if (drawingPolyline) { map.removeLayer(drawingPolyline); drawingPolyline = null; }
  if (drawingPreview) { map.removeLayer(drawingPreview); drawingPreview = null; }
  const pts = [...drawingPoints];
  const mode = currentMode;
  drawingPoints = []; isDrawing = false; setDrawHint(false);
  const modal = document.getElementById('modal-overlay');
  if (mode === 'line' || mode === 'curve') {
    modal._pendingPoints = pts;
    modal._pendingArea = 0;
    modal._circleData = null;
    modal._lineData = { isLine: mode === 'line', isCurve: mode === 'curve', thickness: lineThickness };
  } else {
    const area = calcArea(pts);
    modal._pendingPoints = pts;
    modal._pendingArea = area;
    modal._circleData = null;
    modal._lineData = null;
  }
  openModal(null);
}

function cancelDraw() {
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
  if (drawingPolyline) { map.removeLayer(drawingPolyline); drawingPolyline = null; }
  if (drawingPreview) { map.removeLayer(drawingPreview); drawingPreview = null; }
  drawingPoints = []; isDrawing = false; setDrawHint(false);
}

function setDrawHint(v) { document.getElementById('draw-hint').classList.toggle('visible', v); }

// ═══════════════════════════════════════════════════
//  DRAWING — CIRCLE
// ═══════════════════════════════════════════════════
map.on('mousedown', e => {
  if (currentMode !== 'circle') return;
  circleDrawing = true; circleCenter = e.latlng; setDrawHint(true);
});
map.on('mousemove', e => {
  if (!circleDrawing) return;
  const r = circleCenter.distanceTo(e.latlng);
  if (circlePreviewLayer) { map.removeLayer(circlePreviewLayer); circlePreviewLayer = null; }
  circlePreviewLayer = L.circle(circleCenter, { radius: r, color: selectedColor, fillColor: selectedColor, fillOpacity: 0.2, weight: 2, dashArray: '6,4' }).addTo(map);
});
map.on('mouseup', e => {
  if (!circleDrawing || currentMode !== 'circle') return;
  circleDrawing = false; setDrawHint(false);
  const radius = Math.max(1, Math.round(circleCenter.distanceTo(e.latlng)));
  if (circlePreviewLayer) { map.removeLayer(circlePreviewLayer); circlePreviewLayer = null; }
  const modal = document.getElementById('modal-overlay');
  modal._pendingPoints = null; modal._pendingArea = Math.PI * radius * radius;
  modal._circleData = { isCircle: true, center: circleCenter, radius };
  modal._lineData = null;
  openModal(null);
});

function cancelCircle() {
  circleDrawing = false; circleCenter = null;
  if (circlePreviewLayer) { map.removeLayer(circlePreviewLayer); circlePreviewLayer = null; }
  setDrawHint(false);
}

// ═══════════════════════════════════════════════════
//  VERTEX EDITING
// ═══════════════════════════════════════════════════
function startVertexEdit(zoneId) {
  stopVertexEdit();
  const zone = zones.find(z => z.id === zoneId);
  if (!zone || zone.isCircle || !zone.points || zone.points.length === 0) return;
  vertexEditMode = true; editingVertexZoneId = zoneId;
  showToast('⬡ Glissez les sommets · Échap pour terminer');

  zone.points.forEach((pt, i) => {
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:14px;height:14px;border-radius:50%;background:white;border:2.5px solid ${zone.color};box-shadow:0 1px 4px rgba(0,0,0,0.4);cursor:grab;box-sizing:border-box"></div>`,
      iconSize: [14, 14], iconAnchor: [7, 7],
    });
    const marker = L.marker(pt, { icon, draggable: true, zIndexOffset: 1000 }).addTo(map);

    marker.on('dragstart', () => map.dragging.disable());

    marker.on('drag', e => {
      zone.points[i] = e.target.getLatLng();
      if (zone.isCurve) {
        layerMap[zoneId].layer.setLatLngs(bezierPoints(zone.points));
      } else {
        layerMap[zoneId].layer.setLatLngs(zone.points);
      }
      zone.area = calcArea(zone.points);
      updateStats();
    });

    marker.on('dragend', () => {
      map.dragging.enable();
      try {
        const entry = layerMap[zoneId];
        entry.labelPos = labelLatLng(zone, entry.layer);
        entry.bounds = entry.layer.getBounds();
        entry.label.setLatLng(entry.labelPos);
      } catch(e) {}
      renderSidebar(); scheduleLabels();
    });

    vertexMarkers.push(marker);
  });
  document.getElementById('btn-edit-vertices').classList.add('active');
}

function stopVertexEdit() {
  vertexMarkers.forEach(m => map.removeLayer(m));
  vertexMarkers = []; vertexEditMode = false; editingVertexZoneId = null;
  const btn = document.getElementById('btn-edit-vertices');
  if (btn) btn.classList.remove('active');
  map.dragging.enable();
}

// ═══════════════════════════════════════════════════
//  MODE SWITCHING
// ═══════════════════════════════════════════════════
function setMode(m) {
  stopVertexEdit(); cancelDraw(); cancelCircle();
  currentMode = m;
  ['draw','select','circle','line','curve'].forEach(id => {
    const b = document.getElementById('btn-' + id);
    if (b) b.classList.toggle('active', m === id);
  });
  document.getElementById('map').className = m === 'select' ? 'mode-select' : (m === 'circle' ? 'mode-circle' : '');
  const hint = document.getElementById('draw-hint');
  hint.textContent = hint.dataset[m] || hint.dataset.poly;
  document.getElementById('thickness-group').style.display = (m === 'line' || m === 'curve') ? '' : 'none';
  if (m !== 'select') {
    deselectZone();
    document.getElementById('btn-delete-selected').style.display = 'none';
    document.getElementById('btn-edit-selected').style.display = 'none';
    document.getElementById('btn-edit-vertices').style.display = 'none';
  }
}

document.getElementById('btn-draw').addEventListener('click', () => setMode('draw'));
document.getElementById('btn-select').addEventListener('click', () => setMode('select'));
document.getElementById('btn-circle').addEventListener('click', () => setMode('circle'));
document.getElementById('btn-line').addEventListener('click', () => setMode('line'));
document.getElementById('btn-curve').addEventListener('click', () => setMode('curve'));
document.getElementById('btn-edit-vertices').addEventListener('click', () => { if (selectedZoneId) startVertexEdit(selectedZoneId); });

document.getElementById('line-thickness').addEventListener('input', e => {
  lineThickness = parseInt(e.target.value);
  document.getElementById('thickness-display').textContent = lineThickness + ' px';
  if (selectedZoneId) {
    const z = zones.find(z => z.id === selectedZoneId);
    if (z && (z.isLine || z.isCurve) && layerMap[selectedZoneId]) {
      layerMap[selectedZoneId].layer.setStyle({ weight: lineThickness });
      z.thickness = lineThickness;
    }
  }
});

// ═══════════════════════════════════════════════════
//  ZONE CRUD
// ═══════════════════════════════════════════════════
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function createZone(data) {
  const id = data.id || genId();
  const zone = { id, ...data };
  if (!(id in zoneVisible)) zoneVisible[id] = true;
  zones.push(zone);
  renderZoneOnMap(zone);
  if (!batching) { renderSidebar(); updateStats(); scheduleLabels(); }
  return zone;
}

function renderZoneOnMap(zone) {
  // Remove old
  if (layerMap[zone.id]) {
    map.removeLayer(layerMap[zone.id].layer);
    if (layerMap[zone.id].label) map.removeLayer(layerMap[zone.id].label);
  }

  let layer;

  if (zone.isCircle) {
    layer = L.circle(zone.center, { radius: zone.radius, color: zone.color, fillColor: zone.color, fillOpacity: 0.3, weight: 2.5 });
  } else if (zone.isLine) {
    layer = L.polyline(zone.points, { color: zone.color, weight: zone.thickness || 4, opacity: 0.9, lineJoin: 'round', lineCap: 'round' });
  } else if (zone.isCurve) {
    layer = L.polyline(bezierPoints(zone.points), { color: zone.color, weight: zone.thickness || 4, opacity: 0.9, lineJoin: 'round', lineCap: 'round' });
  } else {
    layer = L.polygon(zone.points, { color: zone.color, fillColor: zone.color, fillOpacity: 0.3, weight: 2.5 });
  }

  if (isShownOnMap(zone)) layer.addTo(map);

  // Nom au survol : utile quand l'étiquette est réduite à son icône ou masquée
  layer.bindTooltip(esc(zone.name || 'Zone'), { sticky: true, direction: 'top', offset: [0, -10], className: 'zone-tip' });

  // Label (son affichage complet / icône / masqué est géré par updateLabels)
  const labelPos = labelLatLng(zone, layer);
  const catIcon = zone.category ? (CAT_ICON[zone.category] || '') : '';
  const labelHtml = `<div class="zone-label-wrap">${catIcon ? `<div class="zone-cat-icon">${catIcon}</div>` : ''}<div class="zone-label-inner">${esc(zone.name || 'Zone')}</div></div>`;
  const label = L.marker(labelPos, {
    icon: L.divIcon({ html: labelHtml, className: 'zone-label', iconSize: null, iconAnchor: [0, 0] }),
    interactive: false,
    keyboard: false,
  }).addTo(map);
  label.getElement().dataset.mode = 'hidden';

  layer.on('click', e => {
    if (currentMode !== 'select') return;
    L.DomEvent.stopPropagation(e);
    // Trouver toutes les zones sous le curseur, sélectionner la plus petite
    const hit = zones.filter(z => {
      if (!layerMap[z.id] || !isShownOnMap(z)) return false;
      if (z.isCircle) {
        return z.center && e.latlng.distanceTo(L.latLng(z.center)) <= z.radius;
      } else if (z.isLine || z.isCurve) {
        return z.id === zone.id; // lignes : pas de surface, on prend celle cliquée
      } else {
        return layerMap[z.id].layer.getBounds().contains(e.latlng) && pointInPolygon(e.latlng, z.points);
      }
    });
    // Trier par surface croissante, prendre la plus petite
    const smallest = hit.sort((a, b) => (a.area || 0) - (b.area || 0))[0];
    const targetId = smallest ? smallest.id : zone.id;
    selectZone(targetId);
    if (visitMode) openFiche(targetId); else openModal(targetId);
  });

  layer.on('contextmenu', e => {
    L.DomEvent.stopPropagation(e); L.DomEvent.preventDefault(e);
    if (visitMode) return;
    showCtxMenu(e.originalEvent.clientX, e.originalEvent.clientY, zone.id);
  });

  layer.on('dblclick', e => {
    L.DomEvent.stopPropagation(e);
    if (!visitMode && !zone.isCircle) startVertexEdit(zone.id);
  });

  layerMap[zone.id] = { layer, label, labelPos, bounds: layer.getBounds() };
  if (tourIds || zone.id === selectedZoneId) applyStyle(zone);
}

function updateZone(id, data) {
  const idx = zones.findIndex(z => z.id === id);
  if (idx === -1) return;
  zones[idx] = { ...zones[idx], ...data };
  renderZoneOnMap(zones[idx]);
  renderSidebar(); updateStats(); scheduleLabels();
}

function deleteZone(id) {
  stopVertexEdit();
  if (layerMap[id]) {
    map.removeLayer(layerMap[id].layer);
    if (layerMap[id].label) map.removeLayer(layerMap[id].label);
    delete layerMap[id];
  }
  delete zoneVisible[id];
  zones = zones.filter(z => z.id !== id);
  if (selectedZoneId === id) { selectedZoneId = null; }
  renderSidebar(); updateStats(); scheduleLabels();
  showToast('🗑 Zone supprimée');
}

// Une zone est dessinée si elle n'est pas masquée (👁) et, quand l'option
// « Appliquer à la carte » est cochée, si elle passe les filtres du panneau.
function isShownOnMap(z) {
  if (tourIds && tourIds.has(z.id)) return true; // une étape de visite montre toujours ses zones
  return zoneVisible[z.id] !== false && (!filterMap || matchesFilter(z));
}

function applyZoneDisplay(z) {
  const entry = layerMap[z.id];
  if (!entry) return;
  const shown = isShownOnMap(z), has = map.hasLayer(entry.layer);
  if (shown && !has) entry.layer.addTo(map);
  if (!shown && has) map.removeLayer(entry.layer);
}

function syncMapVisibility() {
  zones.forEach(applyZoneDisplay);
  scheduleLabels();
}

function toggleZoneVisibility(id, e) {
  e.stopPropagation();
  zoneVisible[id] = zoneVisible[id] === false;
  const z = zones.find(z => z.id === id);
  if (z) applyZoneDisplay(z);
  renderSidebar(); scheduleLabels();
}

// ═══════════════════════════════════════════════════
//  LABELS — anti-chevauchement
// ═══════════════════════════════════════════════════
// Chaque étiquette est affichée en entier, réduite à son icône ou masquée,
// par ordre de priorité : zone sélectionnée, puis les zones les plus grandes
// à l'écran (les très grandes zones de contexte passent en dernier).
const labelMeasure = document.createElement('canvas').getContext('2d');
const labelWidthCache = new Map(); // nom → largeur en px
let labelTimer = null;

function labelTextWidth(name) {
  if (!labelWidthCache.has(name)) {
    labelMeasure.font = '500 12px "DM Sans", sans-serif';
    labelWidthCache.set(name, labelMeasure.measureText(name).width);
  }
  return labelWidthCache.get(name);
}

function scheduleLabels() {
  if (labelTimer) return;
  labelTimer = setTimeout(() => { labelTimer = null; updateLabels(); }, 30);
}

function updateLabels() {
  const size = map.getSize();
  const diag = Math.hypot(size.x, size.y);
  const items = [];
  zones.forEach(z => {
    const entry = layerMap[z.id];
    const el = entry && entry.label.getElement();
    if (!el) return;
    if (!isShownOnMap(z) || (tourIds && !tourIds.has(z.id))) { el.dataset.mode = 'hidden'; return; }
    const p = map.latLngToContainerPoint(entry.labelPos);
    if (p.x < -50 || p.y < -50 || p.x > size.x + 50 || p.y > size.y + 50) { el.dataset.mode = 'hidden'; return; }
    let prio;
    if (z.id === selectedZoneId) prio = Infinity;
    else if (tourIds && tourIds.has(z.id) && tourIds.size <= 3) prio = 1e9;
    else {
      const a = map.latLngToContainerPoint(entry.bounds.getNorthWest());
      const b = map.latLngToContainerPoint(entry.bounds.getSouthEast());
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      prio = span > 0.6 * diag ? -1 : span;
    }
    items.push({ z, el, p, prio });
  });
  items.sort((a, b) => b.prio - a.prio);

  const placed = [];
  const free = r => !placed.some(q => r.x1 < q.x2 && r.x2 > q.x1 && r.y1 < q.y2 && r.y2 > q.y1);
  const box = (p, w, h) => ({ x1: p.x - w / 2 - 2, x2: p.x + w / 2 + 2, y1: p.y - h / 2 - 1, y2: p.y + h / 2 + 1 });
  items.forEach(({ z, el, p }) => {
    const hasIcon = !!CAT_ICON[z.category];
    const full = box(p, labelTextWidth(z.name || 'Zone') + 16, hasIcon ? 43 : 20);
    if (free(full)) { placed.push(full); el.dataset.mode = 'full'; return; }
    const icon = box(p, 22, 22);
    if (hasIcon && free(icon)) { placed.push(icon); el.dataset.mode = 'icon'; return; }
    el.dataset.mode = 'hidden';
  });
}

map.on('zoomend moveend resize', scheduleLabels);

// Style d'une zone selon son état : normal, sélectionnée, ou estompée pendant la visite guidée
function applyStyle(z) {
  const entry = layerMap[z.id];
  if (!entry) return;
  const linear = z.isLine || z.isCurve;
  const dim = tourIds && !tourIds.has(z.id);
  if (z.id === selectedZoneId) entry.layer.setStyle(linear ? { weight: (z.thickness || 4) + 3, opacity: 1 } : { weight: 3.5, opacity: 1, fillOpacity: 0.45 });
  else if (dim) entry.layer.setStyle(linear ? { weight: z.thickness || 4, opacity: 0.18 } : { weight: 1, opacity: 0.25, fillOpacity: 0.05 });
  else if (tourIds) entry.layer.setStyle(linear ? { weight: (z.thickness || 4) + 2, opacity: 1 } : { weight: 3.5, opacity: 1, fillOpacity: 0.42 });
  else entry.layer.setStyle(linear ? { weight: z.thickness || 4, opacity: 0.9 } : { weight: 2.5, opacity: 1, fillOpacity: 0.3 });
}

function selectZone(id) {
  stopVertexEdit(); deselectZone();
  selectedZoneId = id;
  const _z = zones.find(z => z.id === id);
  if (_z) applyStyle(_z);
  document.querySelectorAll('.zone-card').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
  document.getElementById('btn-delete-selected').style.display = '';
  document.getElementById('btn-edit-selected').style.display = '';
  const z = zones.find(z => z.id === id);
  document.getElementById('btn-edit-vertices').style.display = (z && !z.isCircle && z.points && z.points.length > 0) ? '' : 'none';
  if (z && (z.isLine || z.isCurve)) {
    document.getElementById('thickness-group').style.display = '';
    document.getElementById('line-thickness').value = z.thickness || 4;
    document.getElementById('thickness-display').textContent = (z.thickness || 4) + ' px';
  } else if (currentMode !== 'line' && currentMode !== 'curve') {
    document.getElementById('thickness-group').style.display = 'none';
  }
  const card = document.querySelector(`.zone-card[data-id="${id}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  scheduleLabels();
}

function deselectZone() {
  const prev = zones.find(z => z.id === selectedZoneId);
  selectedZoneId = null;
  if (prev) applyStyle(prev);
  document.querySelectorAll('.zone-card').forEach(c => c.classList.remove('selected'));
  if (currentMode !== 'line' && currentMode !== 'curve') document.getElementById('thickness-group').style.display = 'none';
}

map.on('click', () => { if (currentMode === 'select') deselectZone(); closeCtxMenu(); });

document.getElementById('btn-delete-selected').addEventListener('click', () => {
  if (selectedZoneId) deleteZone(selectedZoneId);
  document.getElementById('btn-delete-selected').style.display = 'none';
  document.getElementById('btn-edit-selected').style.display = 'none';
  document.getElementById('btn-edit-vertices').style.display = 'none';
});
document.getElementById('btn-edit-selected').addEventListener('click', () => { if (selectedZoneId) openModal(selectedZoneId); });

// ═══════════════════════════════════════════════════
//  FILTERS
// ═══════════════════════════════════════════════════
function refreshFilterChips() {
  const cats = [...new Set(zones.map(z => z.category).filter(Boolean))];
  const tags = [...new Set(zones.flatMap(z => z.tags || []))];
  document.getElementById('filter-categories').innerHTML = cats.map(c =>
    `<button class="filter-chip${filterCategory === c ? ' active' : ''}" onclick="setFilterCat(this.dataset.val)" data-val="${c.replace(/"/g,'&quot;')}">${c}</button>`
  ).join('');
  document.getElementById('filter-tags').innerHTML = tags.map(t =>
    `<button class="filter-chip tag-chip${filterTag === t ? ' active' : ''}" onclick="setFilterTag(this.dataset.val)" data-val="${t.replace(/"/g,'&quot;')}"># ${t}</button>`
  ).join('');
  document.getElementById('filter-clear').classList.toggle('visible', !!(filterText || filterCategory || filterTag));
}

function onFiltersChanged() {
  renderSidebar();
  if (filterMap) syncMapVisibility();
}

function setFilterCat(cat) { filterCategory = filterCategory === cat ? '' : cat; onFiltersChanged(); }
function setFilterTag(tag) { filterTag = filterTag === tag ? '' : tag; onFiltersChanged(); }

let searchTimer = null;
document.getElementById('filter-search').addEventListener('input', e => {
  filterText = e.target.value.toLowerCase();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(onFiltersChanged, 120);
});
document.getElementById('filter-clear').addEventListener('click', () => {
  filterText = ''; filterCategory = ''; filterTag = '';
  document.getElementById('filter-search').value = '';
  onFiltersChanged();
});

const filterMapBox = document.getElementById('filter-map');
filterMapBox.checked = filterMap;
filterMapBox.addEventListener('change', () => {
  filterMap = filterMapBox.checked;
  try { localStorage.setItem('jardin-filter-map', filterMap ? '1' : '0'); } catch {}
  syncMapVisibility();
});

function matchesFilter(z) {
  if (filterCategory && z.category !== filterCategory) return false;
  if (filterTag && !(z.tags || []).includes(filterTag)) return false;
  if (filterText) {
    const hay = [z.name, z.category, z.notes, ...(z.tags || [])].join(' ').toLowerCase();
    if (!hay.includes(filterText)) return false;
  }
  return true;
}

function getFilteredZones() {
  return zones.filter(matchesFilter);
}

// ═══════════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════════
function renderSidebar() {
  const list = document.getElementById('zones-list');
  refreshFilterChips();

  if (zones.length === 0) {
    list.innerHTML = `<div class="empty-state" id="empty-state"><div class="icon">🌱</div><h3>Commencez à dessiner</h3><p>Cliquez sur la carte pour tracer vos premières zones.</p></div>`;
    document.getElementById('sidebar-subtitle').textContent = 'Aucune zone · 0 m²';
    return;
  }

  const filtered = getFilteredZones();
  const totalArea = zones.reduce((s, z) => s + (z.area || 0), 0);
  const filtArea  = filtered.reduce((s, z) => s + (z.area || 0), 0);
  document.getElementById('sidebar-subtitle').textContent = filtered.length < zones.length
    ? `${filtered.length}/${zones.length} zones · ${fmtArea(filtArea)}`
    : `${zones.length} zone${zones.length > 1 ? 's' : ''} · ${fmtArea(totalArea)}`;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><h3>Aucun résultat</h3><p>Aucune zone ne correspond aux filtres actifs.</p></div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach(z => {
    const visible = zoneVisible[z.id] !== false;
    const card = document.createElement('div');
    card.className = 'zone-card' + (z.id === selectedZoneId ? ' selected' : '') + (!visible ? ' hidden-zone' : '');
    card.dataset.id = z.id;
    card.title = 'Double-clic : ouvrir la fiche';

    const areaLabel = z.isLine ? '╱ ligne' : z.isCurve ? '〜 courbe' : fmtArea(z.area || 0);
    const tagsHtml = z.tags && z.tags.length
      ? `<div style="padding:0 12px 8px;display:flex;gap:4px;flex-wrap:wrap">${z.tags.map(t => `<span style="font-size:0.68rem;background:var(--parchment);border-radius:10px;padding:1px 7px;color:var(--ink-soft)">#${esc(t)}</span>`).join('')}</div>` : '';
    // Vignettes en chargement paresseux : seules celles visibles dans le panneau sont téléchargées
    const photosHtml = z.photos && z.photos.length
      ? `<div class="zone-card-photos">${z.photos.slice(0,5).map(p => `<img class="zone-thumb" src="${esc(p)}" alt="" loading="lazy" decoding="async">`).join('')}</div>` : '';

    card.innerHTML = `
      <div class="zone-card-head">
        <button class="zone-vis-toggle${!visible ? ' hidden' : ''}" title="${visible ? 'Masquer' : 'Afficher'}" onclick="toggleZoneVisibility('${z.id}', event)">${visible ? '👁' : '🙈'}</button>
        <div class="zone-color-badge" style="background:${z.color}"></div>
        <div class="zone-card-title">${z.name ? esc(z.name) : '<em>Sans nom</em>'}</div>
        <div class="zone-card-area">${areaLabel}</div>
      </div>
      ${z.category ? `<div class="zone-card-preview" style="margin-bottom:4px">${esc(z.category)}</div>` : ''}
      ${z.notes ? `<div class="zone-card-preview">${esc(z.notes.slice(0, 220))}</div>` : ''}
      ${tagsHtml}${photosHtml}
    `;

    card.addEventListener('click', ev => {
      if (ev.target.closest('.zone-vis-toggle')) return;
      if (currentMode === 'select') {
        selectZone(z.id);
        if (layerMap[z.id] && isShownOnMap(z)) { try { map.fitBounds(layerMap[z.id].layer.getBounds(), { padding: [60,60], maxZoom: 20 }); } catch(e){} }
      } else {
        openModal(z.id);
      }
    });

    card.addEventListener('dblclick', ev => {
      if (ev.target.closest('.zone-vis-toggle')) return;
      if (visitMode) openFiche(z.id); else openModal(z.id);
    });

    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

// ═══════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════
function updateStats() {
  document.getElementById('stat-zones').textContent = zones.length;
  document.getElementById('stat-area').textContent = fmtArea(zones.reduce((s, z) => s + (z.area || 0), 0));
}

// ═══════════════════════════════════════════════════
//  MODAL
// ═══════════════════════════════════════════════════
function openModal(zoneId) {
  editingZoneId = zoneId;
  tempTags = []; tempPhotos = [];

  const modal   = document.getElementById('modal-overlay');
  const zone    = zoneId ? zones.find(z => z.id === zoneId) : null;

  // Determine type from zone or pending modal data
  const isCircle  = zone ? !!zone.isCircle  : !!(modal._circleData);
  const isLine    = zone ? !!zone.isLine    : !!(modal._lineData?.isLine);
  const isCurve   = zone ? !!zone.isCurve   : !!(modal._lineData?.isCurve);
  const isLinear  = isLine || isCurve;

  const area = zone ? (zone.area || 0) : (modal._pendingArea || 0);

  // Title
  document.getElementById('modal-title').textContent = zone
    ? (zone.name || 'Modifier la zone')
    : (isCircle ? 'Nouvelle zone circulaire' : isLine ? 'Nouvelle ligne' : isCurve ? 'Nouvelle courbe' : 'Nouvelle zone');
  document.getElementById('modal-area-badge').textContent = fmtArea(area);

  // Radius / thickness slider
  const rGroup   = document.getElementById('radius-group');
  const rSlider  = document.getElementById('zone-radius');
  const rDisplay = document.getElementById('radius-display');
  const rLabel   = document.querySelector('#radius-group label');

  if (isCircle) {
    rGroup.style.display = '';
    rLabel.textContent = 'Rayon (mètres)';
    rSlider.min = 1; rSlider.max = 200;
    const r = zone ? zone.radius : (modal._circleData?.radius || 10);
    rSlider.value = Math.round(Math.min(200, Math.max(1, r)));
    rDisplay.textContent = rSlider.value + ' m';
    rSlider.oninput = () => {
      rDisplay.textContent = rSlider.value + ' m';
      if (zone && zone.isCircle && layerMap[zone.id]) {
        const nr = parseInt(rSlider.value);
        layerMap[zone.id].layer.setRadius(nr);
        zone.radius = nr; zone.area = Math.PI * nr * nr;
        document.getElementById('modal-area-badge').textContent = fmtArea(zone.area);
        updateStats();
      }
    };
  } else if (isLinear) {
    rGroup.style.display = '';
    rLabel.textContent = 'Épaisseur (px)';
    rSlider.min = 1; rSlider.max = 30;
    const thick = zone ? (zone.thickness || 4) : (modal._lineData?.thickness || lineThickness);
    rSlider.value = thick;
    rDisplay.textContent = thick + ' px';
    rSlider.oninput = () => {
      rDisplay.textContent = rSlider.value + ' px';
      if (zone && layerMap[zone.id]) layerMap[zone.id].layer.setStyle({ weight: parseInt(rSlider.value) });
    };
  } else {
    rGroup.style.display = 'none';
  }

  // Form values
  document.getElementById('zone-name').value     = zone?.name     || '';
  document.getElementById('zone-category').value = zone?.category || '';
  document.getElementById('zone-notes').value    = zone?.notes    || '';
  tempTags   = zone?.tags   ? [...zone.tags]   : [];
  tempPhotos = zone?.photos ? [...zone.photos] : [];
  renderTags(); renderPhotos();

  modal.classList.add('open');
  setTimeout(() => document.getElementById('zone-name').focus(), 200);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  editingZoneId = null;
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === document.getElementById('modal-overlay')) closeModal(); });

document.getElementById('modal-save').addEventListener('click', () => {
  const name     = document.getElementById('zone-name').value.trim() || 'Zone sans nom';
  const category = document.getElementById('zone-category').value;
  const notes    = document.getElementById('zone-notes').value.trim();
  const modal    = document.getElementById('modal-overlay');

  if (editingZoneId) {
    const z = zones.find(z => z.id === editingZoneId);
    const extra = {};
    if (z && z.isCircle) {
      extra.radius = parseInt(document.getElementById('zone-radius').value);
      extra.area   = Math.PI * extra.radius * extra.radius;
    } else if (z && (z.isLine || z.isCurve)) {
      extra.thickness = parseInt(document.getElementById('zone-radius').value);
    }
    updateZone(editingZoneId, { name, category, notes, tags: [...tempTags], photos: [...tempPhotos], ...extra });
    showToast('✅ Zone mise à jour');
  } else if (modal._circleData) {
    const radius = parseInt(document.getElementById('zone-radius').value) || 10;
    createZone({ name, category, notes, color: selectedColor, isCircle: true,
      center: { lat: modal._circleData.center.lat, lng: modal._circleData.center.lng },
      radius, area: Math.PI * radius * radius, points: [],
      tags: [...tempTags], photos: [...tempPhotos] });
    showToast('✅ Zone circulaire créée');
  } else if (modal._lineData) {
    const thickness = parseInt(document.getElementById('zone-radius').value) || lineThickness;
    createZone({ name, category, notes, color: selectedColor,
      isLine: !!modal._lineData.isLine, isCurve: !!modal._lineData.isCurve,
      thickness, points: modal._pendingPoints, area: 0,
      tags: [...tempTags], photos: [...tempPhotos] });
    showToast('✅ ' + (modal._lineData.isCurve ? 'Courbe' : 'Ligne') + ' créée');
  } else {
    if (!modal._pendingPoints) { closeModal(); return; }
    createZone({ name, category, notes, color: selectedColor, points: modal._pendingPoints, area: modal._pendingArea,
      tags: [...tempTags], photos: [...tempPhotos] });
    showToast('✅ Zone créée — ' + fmtArea(modal._pendingArea));
  }
  closeModal();
});

// ═══════════════════════════════════════════════════
//  TAGS
// ═══════════════════════════════════════════════════
function renderTags() {
  document.getElementById('tags-container').innerHTML = tempTags.map((t, i) =>
    `<span class="tag">${t}<span class="tag-remove" onclick="removeTag(${i})">×</span></span>`
  ).join('');
}
function addTagFromInput() {
  const inp = document.getElementById('tag-input');
  const val = inp.value.trim();
  if (val && !tempTags.includes(val)) { tempTags.push(val); renderTags(); }
  inp.value = ''; inp.focus();
}
function removeTag(i) { tempTags.splice(i, 1); renderTags(); }
document.getElementById('tag-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTagFromInput(); } });

// ═══════════════════════════════════════════════════
//  PHOTOS
// ═══════════════════════════════════════════════════
function triggerPhotoUpload() { document.getElementById('photo-input').click(); }
document.getElementById('photo-input').addEventListener('change', e => {
  Array.from(e.target.files).forEach(f => {
    const r = new FileReader();
    r.onload = ev => { tempPhotos.push(ev.target.result); renderPhotos(); };
    r.readAsDataURL(f);
  });
  e.target.value = '';
});
function addPhotoFromUrl() {
  const inp = document.getElementById('photo-url-input');
  const url = inp.value.trim();
  if (!url) return;
  try { new URL(url); } catch { showToast('❌ URL invalide'); return; }
  tempPhotos.push(url); renderPhotos(); inp.value = '';
  showToast('🔗 Image ajoutée via URL');
}
document.getElementById('photo-url-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addPhotoFromUrl(); } });
function renderPhotos() {
  document.getElementById('photo-grid').innerHTML =
    tempPhotos.map((p, i) => `<div class="photo-item" onclick="openLightbox(${i})"><img src="${p}" alt=""><button class="photo-remove" onclick="event.stopPropagation();removePhoto(${i})">✕</button></div>`).join('') +
    `<button class="photo-add-btn" onclick="triggerPhotoUpload()"><span class="plus">+</span><span>Ajouter</span></button>`;
}
function removePhoto(i) { tempPhotos.splice(i, 1); renderPhotos(); }

// ═══════════════════════════════════════════════════
//  LIGHTBOX
// ═══════════════════════════════════════════════════
let lightboxPhotos = [], lightboxIndex = 0;
function openLightbox(idx, photos) {
  lightboxPhotos = [...(photos || tempPhotos)];
  lightboxIndex = idx;
  renderLightbox();
  document.getElementById('lightbox').classList.add('open');
}
function renderLightbox() {
  document.getElementById('lightbox-img').src = lightboxPhotos[lightboxIndex] || '';
  document.getElementById('lightbox-counter').textContent = lightboxPhotos.length > 1 ? (lightboxIndex+1) + ' / ' + lightboxPhotos.length : '';
  document.getElementById('lightbox-prev').disabled = lightboxIndex === 0;
  document.getElementById('lightbox-next').disabled = lightboxIndex === lightboxPhotos.length - 1;
}
function lightboxNav(dir) {
  const ni = lightboxIndex + dir;
  if (ni < 0 || ni >= lightboxPhotos.length) return;
  const img = document.getElementById('lightbox-img');
  img.classList.add('fading');
  setTimeout(() => { lightboxIndex = ni; renderLightbox(); img.classList.remove('fading'); }, 160);
}
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }
document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox-prev').addEventListener('click', e => { e.stopPropagation(); lightboxNav(-1); });
document.getElementById('lightbox-next').addEventListener('click', e => { e.stopPropagation(); lightboxNav(1); });
document.getElementById('lightbox').addEventListener('click', e => { if (e.target === document.getElementById('lightbox')) closeLightbox(); });

// ═══════════════════════════════════════════════════
//  CONTEXT MENU
// ═══════════════════════════════════════════════════
function showCtxMenu(x, y, id) {
  ctxZoneId = id;
  const m = document.getElementById('ctx-menu');
  m.style.left = x + 'px'; m.style.top = y + 'px';
  m.classList.add('open');
}
function closeCtxMenu() { document.getElementById('ctx-menu').classList.remove('open'); ctxZoneId = null; }
document.getElementById('ctx-edit').addEventListener('click', () => { if (ctxZoneId) openModal(ctxZoneId); closeCtxMenu(); });
document.getElementById('ctx-photo').addEventListener('click', () => { if (ctxZoneId) { openModal(ctxZoneId); closeCtxMenu(); setTimeout(triggerPhotoUpload, 400); } });
document.getElementById('ctx-delete').addEventListener('click', () => { if (ctxZoneId && confirm('Supprimer cette zone ?')) deleteZone(ctxZoneId); closeCtxMenu(); });
document.getElementById('ctx-vis').addEventListener('click', () => {
  if (ctxZoneId) { const fakeEvt = { stopPropagation: () => {} }; toggleZoneVisibility(ctxZoneId, fakeEvt); }
  closeCtxMenu();
});
document.addEventListener('click', e => { if (!document.getElementById('ctx-menu').contains(e.target)) closeCtxMenu(); });

// ═══════════════════════════════════════════════════
//  COLOR PICKER
// ═══════════════════════════════════════════════════
document.querySelectorAll('.color-dot').forEach(dot => dot.addEventListener('click', () => {
  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
  dot.classList.add('selected');
  selectedColor = dot.dataset.color;
}));

// ═══════════════════════════════════════════════════
//  SIDEBAR TOGGLE
// ═══════════════════════════════════════════════════
document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
  setTimeout(() => { map.invalidateSize(); scheduleLabels(); }, 320);
});

// ═══════════════════════════════════════════════════
//  SAVE / LOAD
// ═══════════════════════════════════════════════════
function serializeZones() {
  return zones.map(z => ({
    ...z,
    center: z.center ? { lat: z.center.lat, lng: z.center.lng } : undefined,
    points: (z.points || []).map(p => ({ lat: p.lat, lng: p.lng })),
  }));
}

document.getElementById('btn-save').addEventListener('click', saveData);
document.getElementById('btn-export-pdf').addEventListener('click', () => exportPDF());
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-input').click());
document.getElementById('import-input').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = ev => { try { loadData(JSON.parse(ev.target.result)); showToast('📂 Projet importé'); } catch { showToast('❌ Fichier invalide'); } };
  r.readAsText(file); e.target.value = '';
});

function saveData() {
  const data = { version: 1, savedAt: new Date().toISOString(), mapCenter: map.getCenter(), mapZoom: map.getZoom(), zones: serializeZones(), zoneVisible, ...(tour ? { visite: tour } : {}) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'jardin-' + new Date().toISOString().slice(0,10) + '.json';
  a.click(); URL.revokeObjectURL(a.href);
  try { localStorage.setItem('jardin-planner-backup', JSON.stringify(data)); } catch {}
  showToast('💾 Projet sauvegardé !');
}

function loadData(data) {
  stopVertexEdit();
  if (tourStep >= 0) closeTour();
  tour = data.visite && Array.isArray(data.visite.etapes) && data.visite.etapes.length ? data.visite : null;
  zones.forEach(z => { if (layerMap[z.id]) { map.removeLayer(layerMap[z.id].layer); if (layerMap[z.id].label) map.removeLayer(layerMap[z.id].label); delete layerMap[z.id]; } });
  zones = [];
  if (data.mapCenter) map.setView(data.mapCenter, data.mapZoom || 18);
  // Restore visibility state
  Object.assign(zoneVisible, data.zoneVisible || {});
  batching = true;
  try {
    (data.zones || []).forEach(z => {
      const pts = (z.points || []).map(p => L.latLng(p.lat, p.lng));
      const ctr = z.center ? L.latLng(z.center.lat, z.center.lng) : undefined;
      createZone({ ...z, points: pts, center: ctr });
    });
  } finally { batching = false; }
  renderSidebar(); updateStats(); scheduleLabels();
}

// mon-jardin.json fait foi ; la sauvegarde du navigateur ne sert que s'il est absent
// (avant, les deux étaient chargés l'un après l'autre).
window.addEventListener('load', async () => {
  let loaded = false;
  try {
    const res = await fetch('./mon-jardin.json');
    if (res.ok) { loadData(await res.json()); showToast('🌿 Projet chargé'); loaded = true; }
  } catch {}
  if (!loaded) {
    try {
      const saved = localStorage.getItem('jardin-planner-backup');
      if (saved) { loadData(JSON.parse(saved)); showToast('✨ Projet restauré'); }
    } catch {}
  }
  if (location.hash === '#visite') setVisitMode(true);
  if (location.hash === '#visite-guidee') startTour();
});

// ═══════════════════════════════════════════════════
//  MODE VISITE + FICHE EN LECTURE SEULE
// ═══════════════════════════════════════════════════
function setVisitMode(on) {
  visitMode = on;
  if (on) { setMode('select'); closeModal(); closeCtxMenu(); }
  else { closeFiche(); closeTour(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
  document.body.classList.toggle('visit', on);
  history.replaceState(null, '', on ? '#visite' : location.pathname + location.search);
  map.invalidateSize();
  scheduleLabels();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => showToast('⚠️ Plein écran refusé par le navigateur'));
}

document.addEventListener('fullscreenchange', () => {
  document.getElementById('visit-fullscreen').textContent = document.fullscreenElement ? '🗗 Quitter le plein écran' : '⛶ Plein écran';
  setTimeout(() => { map.invalidateSize(); scheduleLabels(); }, 100);
});

document.getElementById('btn-visit').addEventListener('click', () => setVisitMode(true));
document.getElementById('visit-exit').addEventListener('click', () => setVisitMode(false));
document.getElementById('visit-fullscreen').addEventListener('click', toggleFullscreen);
document.getElementById('visit-panel').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
  setTimeout(() => { map.invalidateSize(); scheduleLabels(); }, 320);
});

function openFiche(id) {
  const z = zones.find(z => z.id === id);
  if (!z) return;
  document.getElementById('fiche-color').style.background = z.color;
  document.getElementById('fiche-title').textContent = z.name || 'Sans nom';
  document.getElementById('fiche-area').textContent = z.isLine ? 'ligne' : z.isCurve ? 'courbe' : fmtArea(z.area || 0);
  document.getElementById('fiche-meta').innerHTML =
    (z.category ? `<span class="fiche-cat">${esc(z.category)}</span>` : '') +
    (z.tags || []).map(t => `<span class="fiche-tag">#${esc(t)}</span>`).join('');
  const photos = z.photos || [];
  const ph = document.getElementById('fiche-photos');
  ph.innerHTML = photos.map((p, i) => `<img src="${esc(p)}" alt="" loading="lazy" decoding="async" data-i="${i}">`).join('');
  ph.style.display = photos.length ? '' : 'none';
  ph.onclick = e => { const img = e.target.closest('img'); if (img) openLightbox(+img.dataset.i, photos); };
  document.getElementById('fiche-notes').textContent = z.notes || 'Pas encore de notes.';
  document.getElementById('fiche-overlay').classList.add('open');
  document.getElementById('fiche').scrollTop = 0;
}

function closeFiche() { document.getElementById('fiche-overlay').classList.remove('open'); }

// ═══════════════════════════════════════════════════
//  VISITE GUIDÉE
// ═══════════════════════════════════════════════════
// Sans parcours écrit dans le JSON, on en fabrique un : les zones étiquetées « zone »
// (ou, à défaut, les surfaces), d'est en ouest, avec le début de leurs notes.
function tourSteps() {
  if (tour) return tour.etapes;
  let base = zones.filter(z => (z.tags || []).includes('zone'));
  if (!base.length) base = zones.filter(z => !z.isLine && !z.isCurve && (z.area || 0) > 50);
  return base
    .map(z => ({ z, lng: layerMap[z.id] ? layerMap[z.id].labelPos.lng : 0 }))
    .sort((a, b) => b.lng - a.lng)
    .map(({ z }) => ({ titre: z.name, texte: (z.notes || '').split('\n\n')[0], zones: [z.id] }));
}

function startTour() {
  if (!tourSteps().length) { showToast('Aucune étape de visite'); return; }
  if (!visitMode) setVisitMode(true);
  closeFiche();
  document.getElementById('tour-panel').classList.add('open');
  showTourStep(0);
}

function closeTour() {
  if (tourStep < 0) return;
  tourStep = -1; tourIds = null;
  document.getElementById('tour-panel').classList.remove('open');
  zones.forEach(applyStyle);
  syncMapVisibility();
}

function showTourStep(i) {
  const steps = tourSteps();
  tourStep = Math.max(0, Math.min(i, steps.length - 1));
  const step = steps[tourStep];
  const stepZones = (step.zones || []).map(id => zones.find(z => z.id === id)).filter(Boolean);
  tourIds = new Set(stepZones.map(z => z.id));
  deselectZone();
  zones.forEach(applyStyle);
  syncMapVisibility();

  document.getElementById('tour-count').textContent = `Étape ${tourStep + 1} / ${steps.length}`;
  document.getElementById('tour-title').textContent = step.titre || (stepZones[0] && stepZones[0].name) || '';
  document.getElementById('tour-text').textContent = step.texte || '';
  document.getElementById('tour-text').scrollTop = 0;
  document.getElementById('tour-dots').innerHTML = steps.map((s, k) =>
    `<button class="tour-dot${k === tourStep ? ' active' : ''}" title="${esc(s.titre || '')}" data-k="${k}"></button>`).join('');
  const photos = stepZones.flatMap(z => z.photos || []);
  const ph = document.getElementById('tour-photos');
  ph.innerHTML = photos.slice(0, 6).map((p, k) => `<img src="${esc(p)}" alt="" loading="lazy" decoding="async" data-i="${k}">`).join('');
  ph.style.display = photos.length ? '' : 'none';
  ph.onclick = e => { const img = e.target.closest('img'); if (img) openLightbox(+img.dataset.i, photos); };
  document.getElementById('tour-zones').innerHTML = stepZones.map(z =>
    `<button class="tour-zone" data-id="${z.id}"><span class="zone-color-badge" style="background:${z.color}"></span>${esc(z.name)}</button>`).join('');
  document.getElementById('tour-prev').disabled = tourStep === 0;
  document.getElementById('tour-next').textContent = tourStep === steps.length - 1 ? 'Terminer ✓' : 'Suivant ▶';

  if (stepZones.length) {
    const b = L.latLngBounds([]);
    stepZones.forEach(z => b.extend(layerMap[z.id].bounds));
    const panel = document.getElementById('tour-panel');
    map.flyToBounds(b, { paddingTopLeft: [40, 60], paddingBottomRight: [40, panel.offsetHeight + 30], maxZoom: 20, duration: 0.8 });
  }
  scheduleLabels();
}

document.getElementById('visit-tour').addEventListener('click', () => tourStep >= 0 ? closeTour() : startTour());
document.getElementById('btn-tour').addEventListener('click', startTour);
document.getElementById('tour-close').addEventListener('click', closeTour);
document.getElementById('tour-prev').addEventListener('click', () => showTourStep(tourStep - 1));
document.getElementById('tour-next').addEventListener('click', () => {
  if (tourStep >= tourSteps().length - 1) closeTour(); else showTourStep(tourStep + 1);
});
document.getElementById('tour-dots').addEventListener('click', e => {
  const d = e.target.closest('.tour-dot'); if (d) showTourStep(+d.dataset.k);
});
document.getElementById('tour-zones').addEventListener('click', e => {
  const b = e.target.closest('.tour-zone'); if (b) openFiche(b.dataset.id);
});
document.getElementById('fiche-close').addEventListener('click', closeFiche);
document.getElementById('fiche-overlay').addEventListener('click', e => { if (e.target.id === 'fiche-overlay') closeFiche(); });

setInterval(() => {
  if (zones.length === 0) return;
  try { localStorage.setItem('jardin-planner-backup', JSON.stringify({ version:1, savedAt: new Date().toISOString(), mapCenter: map.getCenter(), mapZoom: map.getZoom(), zones: serializeZones(), zoneVisible, ...(tour ? { visite: tour } : {}) })); } catch {}
}, 120000);

// ═══════════════════════════════════════════════════
//  HELP MODAL
// ═══════════════════════════════════════════════════
document.getElementById('btn-help').addEventListener('click', () => document.getElementById('help-overlay').classList.add('open'));
function closeHelp() { document.getElementById('help-overlay').classList.remove('open'); }
document.getElementById('help-overlay').addEventListener('click', e => { if (e.target === document.getElementById('help-overlay')) closeHelp(); });

// ═══════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ═══════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS (single listener)
// ═══════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  // Lightbox navigation — highest priority
  if (document.getElementById('lightbox').classList.contains('open')) {
    if (e.key === 'ArrowLeft')  lightboxNav(-1);
    if (e.key === 'ArrowRight') lightboxNav(1);
    if (e.key === 'Escape')     closeLightbox();
    return;
  }
  // Help modal
  if (document.getElementById('help-overlay').classList.contains('open')) {
    if (e.key === 'Escape') closeHelp();
    return;
  }
  // Fiche (lecture seule)
  if (document.getElementById('fiche-overlay').classList.contains('open')) {
    if (e.key === 'Escape') closeFiche();
    return;
  }
  // Mode visite : pas de raccourcis d'édition
  if (visitMode) {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'f') toggleFullscreen();
    if (tourStep >= 0) {
      if (e.key === 'ArrowRight') document.getElementById('tour-next').click();
      if (e.key === 'ArrowLeft' && tourStep > 0) showTourStep(tourStep - 1);
      if (e.key === 'Escape') closeTour();
      return;
    }
    if (e.key === 'Escape' && !document.fullscreenElement) setVisitMode(false);
    return;
  }
  // Vertex edit escape
  if (vertexEditMode && e.key === 'Escape') { stopVertexEdit(); return; }
  // Drawing escape
  if (isDrawing && e.key === 'Escape') { cancelDraw(); return; }

  // Ignore if typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if (e.key === 'd') setMode('draw');
  if (e.key === 's') setMode('select');
  if (e.key === 'c') setMode('circle');
  if (e.key === 'l') setMode('line');
  if (e.key === 'b') setMode('curve');  // b = bézier
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveData(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedZoneId && !vertexEditMode) { e.preventDefault(); deleteZone(selectedZoneId); }
});

// Le rapport PDF est généré par report.js
