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
        const c = layerMap[zoneId].layer.getBounds().getCenter();
        layerMap[zoneId].label.setLatLng(c);
      } catch(e) {}
      renderSidebar();
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
  renderSidebar();
  updateStats();
  return zone;
}

function renderZoneOnMap(zone) {
  // Remove old
  if (layerMap[zone.id]) {
    map.removeLayer(layerMap[zone.id].layer);
    if (layerMap[zone.id].label) map.removeLayer(layerMap[zone.id].label);
  }

  const visible = zoneVisible[zone.id] !== false;
  let layer, center;

  if (zone.isCircle) {
    layer = L.circle(zone.center, { radius: zone.radius, color: zone.color, fillColor: zone.color, fillOpacity: 0.3, weight: 2.5 });
    center = L.latLng(zone.center);
  } else if (zone.isLine) {
    layer = L.polyline(zone.points, { color: zone.color, weight: zone.thickness || 4, opacity: 0.9, lineJoin: 'round', lineCap: 'round' });
    center = layer.getBounds().getCenter();
  } else if (zone.isCurve) {
    layer = L.polyline(bezierPoints(zone.points), { color: zone.color, weight: zone.thickness || 4, opacity: 0.9, lineJoin: 'round', lineCap: 'round' });
    center = layer.getBounds().getCenter();
  } else {
    layer = L.polygon(zone.points, { color: zone.color, fillColor: zone.color, fillOpacity: 0.3, weight: 2.5 });
    center = layer.getBounds().getCenter();
  }

  if (visible) layer.addTo(map);

  // Label
  const catIcon = zone.category ? (CAT_ICON[zone.category] || '') : '';
  const labelHtml = `<div class="zone-label-wrap">${catIcon ? `<div class="zone-cat-icon">${catIcon}</div>` : ''}<div class="zone-label-inner">${zone.name || 'Zone'}</div></div>`;
  const label = L.marker(center, {
    icon: L.divIcon({ html: labelHtml, className: 'zone-label', iconSize: null, iconAnchor: [0, 0] }),
    interactive: false,
    opacity: visible ? 1 : 0,
  }).addTo(map);


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

  // Events — only on visible; but we always attach (layer may be off-map when hidden)
layer.on('click', e => {
    if (currentMode !== 'select') return;
    L.DomEvent.stopPropagation(e);
    // Trouver toutes les zones sous le curseur, sélectionner la plus petite
    const hit = zones.filter(z => {
      if (!layerMap[z.id] || zoneVisible[z.id] === false) return false;
      const lyr = layerMap[z.id].layer;
      if (z.isCircle) {
        return z.center && e.latlng.distanceTo(L.latLng(z.center)) <= z.radius;
      } else if (z.isLine || z.isCurve) {
        return z.id === zone.id; // lignes : pas de surface, on prend celle cliquée
      } else {
        return lyr.getBounds().contains(e.latlng) &&
               L.Polygon.prototype.contains
                 ? lyr.contains ? lyr.contains(e.latlng)
                 : pointInPolygon(e.latlng, z.points)
                 : pointInPolygon(e.latlng, z.points);
      }
    });
    // Trier par surface croissante, prendre la plus petite
    const smallest = hit.sort((a, b) => (a.area || 0) - (b.area || 0))[0];
    const targetId = smallest ? smallest.id : zone.id;
    if (currentMode === 'select'){
      selectZone(targetId);
      openModal(targetId);
    }
  });

  layer.on('contextmenu', e => {
    L.DomEvent.stopPropagation(e); L.DomEvent.preventDefault(e);
    showCtxMenu(e.originalEvent.clientX, e.originalEvent.clientY, zone.id);
  });

  layer.on('dblclick', e => {
    L.DomEvent.stopPropagation(e);
    if (!zone.isCircle) startVertexEdit(zone.id);
  });

  layerMap[zone.id] = { layer, label };
}

function updateZone(id, data) {
  const idx = zones.findIndex(z => z.id === id);
  if (idx === -1) return;
  zones[idx] = { ...zones[idx], ...data };
  renderZoneOnMap(zones[idx]);
  renderSidebar(); updateStats();
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
  renderSidebar(); updateStats();
  showToast('🗑 Zone supprimée');
}

function toggleZoneVisibility(id, e) {
  e.stopPropagation();
  zoneVisible[id] = !zoneVisible[id];
  const visible = zoneVisible[id];
  if (layerMap[id]) {
    if (visible) { layerMap[id].layer.addTo(map); layerMap[id].label.setOpacity(1); }
    else { map.removeLayer(layerMap[id].layer); layerMap[id].label.setOpacity(0); }
  }
  renderSidebar();
}

function selectZone(id) {
  stopVertexEdit(); deselectZone();
  selectedZoneId = id;
  if (layerMap[id]) {
    const _z = zones.find(z => z.id === id);
    if (_z && (_z.isLine || _z.isCurve)) layerMap[id].layer.setStyle({ weight: (_z.thickness || 4) + 3, opacity: 1 });
    else layerMap[id].layer.setStyle({ weight: 3.5, fillOpacity: 0.45 });
  }
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
}

function deselectZone() {
  if (selectedZoneId && layerMap[selectedZoneId]) {
    const z = zones.find(z => z.id === selectedZoneId);
    if (z) {
      if (z.isLine || z.isCurve) layerMap[selectedZoneId].layer.setStyle({ weight: z.thickness || 4, opacity: 0.9 });
      else if (!z.isCircle) layerMap[selectedZoneId].layer.setStyle({ weight: 2.5, fillOpacity: 0.3 });
    }
  }
  selectedZoneId = null;
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

function setFilterCat(cat) { filterCategory = filterCategory === cat ? '' : cat; refreshFilterChips(); renderSidebar(); }
function setFilterTag(tag) { filterTag = filterTag === tag ? '' : tag; refreshFilterChips(); renderSidebar(); }

document.getElementById('filter-search').addEventListener('input', e => {
  filterText = e.target.value.toLowerCase();
  document.getElementById('filter-clear').classList.toggle('visible', !!(filterText || filterCategory || filterTag));
  renderSidebar();
});
document.getElementById('filter-clear').addEventListener('click', () => {
  filterText = ''; filterCategory = ''; filterTag = '';
  document.getElementById('filter-search').value = '';
  refreshFilterChips(); renderSidebar();
});

function getFilteredZones() {
  return zones.filter(z => {
    if (filterCategory && z.category !== filterCategory) return false;
    if (filterTag && !(z.tags || []).includes(filterTag)) return false;
    if (filterText) {
      const hay = [z.name, z.category, z.notes, ...(z.tags || [])].join(' ').toLowerCase();
      if (!hay.includes(filterText)) return false;
    }
    return true;
  });
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

  list.innerHTML = '';
  filtered.forEach(z => {
    const visible = zoneVisible[z.id] !== false;
    const card = document.createElement('div');
    card.className = 'zone-card' + (z.id === selectedZoneId ? ' selected' : '') + (!visible ? ' hidden-zone' : '');
    card.dataset.id = z.id;

    const areaLabel = z.isLine ? '╱ ligne' : z.isCurve ? '〜 courbe' : fmtArea(z.area || 0);
    const tagsHtml = z.tags && z.tags.length
      ? `<div style="padding:0 12px 8px;display:flex;gap:4px;flex-wrap:wrap">${z.tags.map(t => `<span style="font-size:0.68rem;background:var(--parchment);border-radius:10px;padding:1px 7px;color:var(--ink-soft)">#${t}</span>`).join('')}</div>` : '';
    const photosHtml = z.photos && z.photos.length
      ? `<div class="zone-card-photos">${z.photos.slice(0,5).map(p => `<img class="zone-thumb" src="${p}" alt="">`).join('')}</div>` : '';

    card.innerHTML = `
      <div class="zone-card-head">
        <button class="zone-vis-toggle${!visible ? ' hidden' : ''}" title="${visible ? 'Masquer' : 'Afficher'}" onclick="toggleZoneVisibility('${z.id}', event)">${visible ? '👁' : '🙈'}</button>
        <div class="zone-color-badge" style="background:${z.color}"></div>
        <div class="zone-card-title">${z.name || '<em>Sans nom</em>'}</div>
        <div class="zone-card-area">${areaLabel}</div>
      </div>
      ${z.category ? `<div class="zone-card-preview" style="padding-bottom:4px">${z.category}</div>` : ''}
      ${z.notes ? `<div class="zone-card-preview">${z.notes}</div>` : ''}
      ${tagsHtml}${photosHtml}
    `;

    card.addEventListener('click', ev => {
      if (ev.target.closest('.zone-vis-toggle')) return;
      if (currentMode === 'select') {
        selectZone(z.id);
        if (layerMap[z.id]) { try { map.fitBounds(layerMap[z.id].layer.getBounds(), { padding: [60,60] }); } catch(e){} }
      } else {
        openModal(z.id);
      }
    });

    list.appendChild(card);
  });
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
function openLightbox(idx) {
  lightboxPhotos = [...tempPhotos];
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
document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-input').click());
document.getElementById('import-input').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = ev => { try { loadData(JSON.parse(ev.target.result)); showToast('📂 Projet importé'); } catch { showToast('❌ Fichier invalide'); } };
  r.readAsText(file); e.target.value = '';
});

function saveData() {
  const data = { version: 1, savedAt: new Date().toISOString(), mapCenter: map.getCenter(), mapZoom: map.getZoom(), zones: serializeZones(), zoneVisible };
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
  zones.forEach(z => { if (layerMap[z.id]) { map.removeLayer(layerMap[z.id].layer); if (layerMap[z.id].label) map.removeLayer(layerMap[z.id].label); delete layerMap[z.id]; } });
  zones = [];
  if (data.mapCenter) map.setView(data.mapCenter, data.mapZoom || 18);
  // Restore visibility state
  Object.assign(zoneVisible, data.zoneVisible || {});
  (data.zones || []).forEach(z => {
    const pts = (z.points || []).map(p => L.latLng(p.lat, p.lng));
    const ctr = z.center ? L.latLng(z.center.lat, z.center.lng) : undefined;
    createZone({ ...z, points: pts, center: ctr });
  });
}

window.addEventListener('load', async () => {
  try {
    const saved = localStorage.getItem('jardin-planner-backup');
    if (saved) { loadData(JSON.parse(saved)); showToast('✨ Projet restauré'); }
  } catch {}
  try {
    const res = await fetch('./mon-jardin.json');
    if (res.ok) { loadData(await res.json()); showToast('🌿 Projet chargé'); }
  } catch {}
});

setInterval(() => {
  if (zones.length === 0) return;
  try { localStorage.setItem('jardin-planner-backup', JSON.stringify({ version:1, savedAt: new Date().toISOString(), mapCenter: map.getCenter(), mapZoom: map.getZoom(), zones: serializeZones(), zoneVisible })); } catch {}
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

// ═══════════════════════════════════════════════════
//  PDF EXPORT — Rapport de projet jardin
// ═══════════════════════════════════════════════════

async function exportPDF() {
  showToast('📄 Génération du rapport… patience');

  // Dynamic load of jsPDF + html2canvas via CDN
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W = 210, H = 297;
  const MARGIN = 18;
  const CONTENT_W = W - MARGIN * 2;

  // ── Palette / style helpers ──
  const COL = {
    ink:      [42, 37, 25],
    inkSoft:  [92, 82, 68],
    cream:    [245, 240, 232],
    parchment:[237, 229, 208],
    sage:     [122, 158, 126],
    sageDark: [78, 116, 82],
    terra:    [193, 127, 74],
    white:    [255, 255, 255],
  };

  const setFont = (style, size, color) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...(color || COL.ink));
  };

  // Convert hex color string to [r,g,b]
  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return [r,g,b];
  }

  // Draw a filled rounded rect
  function roundRect(x, y, w, h, r, fillColor, strokeColor) {
    doc.setFillColor(...fillColor);
    if (strokeColor) doc.setDrawColor(...strokeColor); else doc.setDrawColor(0,0,0,0);
    doc.roundedRect(x, y, w, h, r, r, strokeColor ? 'FD' : 'F');
  }

  // ─────────────────────────────────────────────
  //  PAGE 1 — COVER
  // ─────────────────────────────────────────────
  // Background
  doc.setFillColor(...COL.ink);
  doc.rect(0, 0, W, H, 'F');

  // Decorative sage band
  doc.setFillColor(...COL.sage);
  doc.rect(0, H * 0.38, W, H * 0.28, 'F');

  // Cream lower strip
  doc.setFillColor(...COL.cream);
  doc.rect(0, H * 0.66, W, H * 0.34, 'F');

  // Title
  setFont('bold', 32, COL.cream);
  doc.text('Carnet de Projet', W / 2, 72, { align: 'center' });
  setFont('italic', 20, [232, 201, 154]);
  doc.text('Jardin', W / 2, 84, { align: 'center' });

  // Divider line
  doc.setDrawColor(...COL.sage);
  doc.setLineWidth(0.4);
  doc.line(MARGIN + 30, 90, W - MARGIN - 30, 90);

  // Stats on sage band
  const totalArea = zones.reduce((s, z) => s + (z.area || 0), 0);
  const polygones = zones.filter(z => !z.isCircle && !z.isLine && !z.isCurve).length;
  const cercles   = zones.filter(z => z.isCircle).length;
  const lignes    = zones.filter(z => z.isLine || z.isCurve).length;

  setFont('bold', 28, COL.white);
  doc.text(String(zones.length), W / 2, H * 0.47, { align: 'center' });
  setFont('normal', 10, COL.cream);
  doc.text('zones tracées', W / 2, H * 0.47 + 6, { align: 'center' });

  // 3 mini stats
  const stats = [
    { label: fmtArea(totalArea), sub: 'surface totale' },
    { label: polygones + ' poly · ' + cercles + ' cercles', sub: 'zones surfaciques' },
    { label: lignes + ' tracé' + (lignes > 1 ? 's' : ''), sub: 'lignes & courbes' },
  ];
  stats.forEach((s, i) => {
    const x = MARGIN + (CONTENT_W / 3) * i + CONTENT_W / 6;
    setFont('bold', 11, COL.white);
    doc.text(s.label, x, H * 0.56, { align: 'center' });
    setFont('normal', 8, COL.cream);
    doc.text(s.sub, x, H * 0.56 + 4.5, { align: 'center' });
  });

  // Date & footer
  setFont('normal', 9, COL.inkSoft);
  doc.text('Généré le ' + new Date().toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' }),
    W / 2, H * 0.76, { align: 'center' });

  setFont('normal', 8, [150, 140, 125]);
  doc.text('Jardin Planner · jardin-planner.html', W / 2, H - 12, { align: 'center' });

  // ─────────────────────────────────────────────
  //  CAPTURE MAP
  // ─────────────────────────────────────────────
  showToast('📷 Capture de la carte…');
  let mapImageData = null;
  try {
    const mapEl = document.getElementById('map');
    const canvas = await html2canvas(mapEl, { useCORS: true, allowTaint: true, scale: 1.5, logging: false });
    mapImageData = canvas.toDataURL('image/jpeg', 0.88);
  } catch(e) { console.warn('Map capture failed', e); }

  // ─────────────────────────────────────────────
  //  PAGE 2 — VUE D'ENSEMBLE CARTE
  // ─────────────────────────────────────────────
  doc.addPage();
  doc.setFillColor(...COL.cream);
  doc.rect(0, 0, W, H, 'F');

  // Header bar
  doc.setFillColor(...COL.ink);
  doc.rect(0, 0, W, 18, 'F');
  setFont('bold', 11, COL.cream);
  doc.text('Vue d\'ensemble du jardin', MARGIN, 12);
  setFont('normal', 8, [180,170,155]);
  doc.text('Carte satellite', W - MARGIN, 12, { align: 'right' });

  if (mapImageData) {
    // Map image fills most of the page
    const imgY = 24, imgH = H - imgY - 28;
    roundRect(MARGIN - 1, imgY - 1, CONTENT_W + 2, imgH + 2, 3, COL.parchment);
    doc.addImage(mapImageData, 'JPEG', MARGIN, imgY, CONTENT_W, imgH, '', 'FAST');
    // Shadow border
    doc.setDrawColor(...COL.inkSoft);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, imgY, CONTENT_W, imgH, 2, 2, 'S');
  } else {
    roundRect(MARGIN, 24, CONTENT_W, H - 52, 3, COL.parchment);
    setFont('italic', 11, COL.inkSoft);
    doc.text('(Capture de carte non disponible)', W / 2, H / 2, { align: 'center' });
  }

  // Legend strip at bottom
  roundRect(MARGIN, H - 26, CONTENT_W, 16, 2, COL.ink);
  setFont('normal', 7.5, COL.cream);
  const visZones = zones.slice(0, 8);
  visZones.forEach((z, i) => {
    const x = MARGIN + 6 + i * (CONTENT_W / 8);
    const col = z.color ? hexToRgb(z.color) : COL.sage;
    doc.setFillColor(...col);
    doc.roundedRect(x, H - 22, 3, 3, 0.5, 0.5, 'F');
    doc.setTextColor(...COL.cream);
    doc.setFontSize(5.5);
    const label = (z.name || 'Zone').substring(0, 10);
    doc.text(label, x + 4.5, H - 20.3);
  });

  // Page number
  setFont('normal', 7.5, COL.inkSoft);
  doc.text('2', W - MARGIN, H - 6, { align: 'right' });

  // ─────────────────────────────────────────────
  //  PAGES 3+ — FICHES DE ZONES
  // ─────────────────────────────────────────────
  const ZONES_PER_PAGE = 2;
  const pagesNeeded = Math.ceil(zones.length / ZONES_PER_PAGE);
  let pageNum = 3;

  for (let pg = 0; pg < pagesNeeded; pg++) {
    doc.addPage();
    doc.setFillColor(...COL.cream);
    doc.rect(0, 0, W, H, 'F');

    // Header
    doc.setFillColor(...COL.ink);
    doc.rect(0, 0, W, 18, 'F');
    setFont('bold', 11, COL.cream);
    doc.text('Fiches des zones', MARGIN, 12);
    setFont('normal', 8, [180,170,155]);
    doc.text(`Page ${pageNum} / ${pagesNeeded + 2}`, W - MARGIN, 12, { align: 'right' });

    const zoneSlice = zones.slice(pg * ZONES_PER_PAGE, (pg + 1) * ZONES_PER_PAGE);
    const cardH = (H - 30) / ZONES_PER_PAGE;

    for (let ci = 0; ci < zoneSlice.length; ci++) {
      const z = zoneSlice[ci];
      const cardY = 22 + ci * cardH;
      const innerH = cardH - 6;

      // Card background
      roundRect(MARGIN, cardY, CONTENT_W, innerH, 3, COL.white, COL.parchment);

      // Color accent left bar
      const zCol = z.color ? hexToRgb(z.color) : COL.sage;
      doc.setFillColor(...zCol);
      doc.roundedRect(MARGIN, cardY, 4, innerH, 2, 2, 'F');

      // Zone number badge
      roundRect(MARGIN + 8, cardY + 5, 7, 7, 1, zCol);
      setFont('bold', 7, COL.white);
      doc.text(String(zones.indexOf(z) + 1), MARGIN + 11.5, cardY + 10, { align: 'center' });

      // Title row
      setFont('bold', 13, COL.ink);
      doc.text(z.name || 'Zone sans nom', MARGIN + 18, cardY + 11);

      // Category & type badge
      if (z.category) {
        const cat = z.category;
        const tw = doc.getTextWidth(cat) + 6;
        roundRect(MARGIN + 18, cardY + 13.5, tw, 6, 1.5, zCol);
        setFont('normal', 6.5, COL.white);
        doc.text(cat, MARGIN + 21, cardY + 17.5);
      }

      // Area / type chip
      const areaLabel = z.isLine ? '╱ ligne' : z.isCurve ? '〜 courbe' : fmtArea(z.area || 0);
      setFont('bold', 8.5, [100,90,75]);
      doc.text(areaLabel, W - MARGIN - 5, cardY + 11, { align: 'right' });

      // Separator
      doc.setDrawColor(...COL.parchment);
      doc.setLineWidth(0.3);
      doc.line(MARGIN + 6, cardY + 21, W - MARGIN - 5, cardY + 21);

      // Notes
      let curY = cardY + 27;
      if (z.notes) {
        setFont('bold', 7.5, COL.sageDark);
        doc.text('NOTES & IDÉES', MARGIN + 8, curY);
        curY += 4.5;
        setFont('normal', 8.5, COL.ink);
        const lines = doc.splitTextToSize(z.notes, CONTENT_W * 0.55);
        const maxLines = Math.min(lines.length, 5);
        doc.text(lines.slice(0, maxLines), MARGIN + 8, curY);
        curY += maxLines * 4.5 + 3;
      }

      // Tags
      if (z.tags && z.tags.length) {
        setFont('bold', 7, COL.inkSoft);
        doc.text('ÉTIQUETTES', MARGIN + 8, curY);
        curY += 4;
        let tx = MARGIN + 8;
        z.tags.forEach(tag => {
          const tw = doc.getTextWidth('#' + tag) + 5;
          if (tx + tw > W - MARGIN - 5) { tx = MARGIN + 8; curY += 6; }
          roundRect(tx, curY - 4, tw, 5, 1.2, COL.parchment);
          setFont('normal', 6.5, COL.inkSoft);
          doc.text('#' + tag, tx + 2.5, curY);
          tx += tw + 2;
        });
        curY += 5;
      }

      // Photos moodboard (right column)
      if (z.photos && z.photos.length > 0) {
        const photoX = MARGIN + CONTENT_W * 0.6;
        const photoW = CONTENT_W * 0.38;
        const photoAreaH = innerH - 24;
        const cols = 3, rows = Math.min(2, Math.ceil(z.photos.length / cols));
        const thumbW = (photoW - (cols - 1) * 2) / cols;
        const thumbH = Math.min(thumbW, (photoAreaH - (rows - 1) * 2) / rows);

        setFont('bold', 7, COL.inkSoft);
        doc.text('PHOTOS', photoX, cardY + 27);

        let photoY = cardY + 30;
        let photoCount = 0;

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            if (photoCount >= z.photos.length) break;
            const src = z.photos[photoCount];
            const px = photoX + col * (thumbW + 2);
            const py = photoY + row * (thumbH + 2);
            roundRect(px, py, thumbW, thumbH, 1.5, COL.parchment);
            try {
              // Only embed if it's a data URL (base64)
              if (src.startsWith('data:image')) {
                const fmt = src.includes('data:image/png') ? 'PNG' : 'JPEG';
                doc.addImage(src, fmt, px, py, thumbW, thumbH, '', 'FAST');
              } else {
                // External URL — draw placeholder
                setFont('italic', 6, COL.inkSoft);
                doc.text('🔗', px + thumbW / 2, py + thumbH / 2, { align: 'center' });
              }
            } catch(e) {
              // Image failed — just leave the placeholder
            }
            photoCount++;
          }
        }
      }
    }

    pageNum++;
  }

  // ─────────────────────────────────────────────
  //  LAST PAGE — RÉCAPITULATIF
  // ─────────────────────────────────────────────
  doc.addPage();
  doc.setFillColor(...COL.cream);
  doc.rect(0, 0, W, H, 'F');

  doc.setFillColor(...COL.ink);
  doc.rect(0, 0, W, 18, 'F');
  setFont('bold', 11, COL.cream);
  doc.text('Récapitulatif des zones', MARGIN, 12);
  setFont('normal', 8, [180,170,155]);
  doc.text(`Page ${pageNum} / ${pageNum}`, W - MARGIN, 12, { align: 'right' });

  // Table header
  let ty = 26;
  roundRect(MARGIN, ty, CONTENT_W, 8, 1.5, COL.ink);
  setFont('bold', 8, COL.cream);
  const cols = [
    { label: '#',        x: MARGIN + 3,    w: 8 },
    { label: 'Nom',      x: MARGIN + 13,   w: 55 },
    { label: 'Catégorie',x: MARGIN + 70,   w: 55 },
    { label: 'Type',     x: MARGIN + 127,  w: 25 },
    { label: 'Surface',  x: MARGIN + 154,  w: 25 },
  ];
  cols.forEach(c => doc.text(c.label, c.x, ty + 5.5));
  ty += 10;

  zones.forEach((z, i) => {
    const rowH = 7;
    const bg = i % 2 === 0 ? COL.white : COL.cream;
    roundRect(MARGIN, ty, CONTENT_W, rowH, 0, bg);

    // Color swatch
    doc.setFillColor(...(z.color ? hexToRgb(z.color) : COL.sage));
    doc.circle(MARGIN + 4.5, ty + 3.5, 2, 'F');

    setFont('bold', 7.5, COL.ink);
    doc.text(String(i + 1), MARGIN + 3, ty + 5);

    setFont('normal', 7.5, COL.ink);
    doc.text(doc.splitTextToSize(z.name || '—', 50)[0], MARGIN + 13, ty + 5);

    setFont('normal', 7, COL.inkSoft);
    doc.text(doc.splitTextToSize(z.category || '—', 52)[0], MARGIN + 70, ty + 5);

    const typeLabel = z.isLine ? 'Ligne' : z.isCurve ? 'Courbe' : z.isCircle ? 'Cercle' : 'Polygone';
    doc.text(typeLabel, MARGIN + 127, ty + 5);

    const areaLabel = (z.isLine || z.isCurve) ? '—' : fmtArea(z.area || 0);
    doc.text(areaLabel, MARGIN + 154, ty + 5);

    ty += rowH;
    if (ty > H - 20) {
      doc.addPage();
      doc.setFillColor(...COL.cream); doc.rect(0,0,W,H,'F');
      doc.setFillColor(...COL.ink); doc.rect(0,0,W,18,'F');
      ty = 26;
    }
  });

  // Total row
  roundRect(MARGIN, ty + 2, CONTENT_W, 8, 1.5, COL.sageDark);
  setFont('bold', 8, COL.cream);
  doc.text('TOTAL', MARGIN + 13, ty + 7.5);
  doc.text(fmtArea(zones.reduce((s,z) => s + (z.area||0), 0)), MARGIN + 154, ty + 7.5);

  // ── SAVE ──
  const filename = 'jardin-rapport-' + new Date().toISOString().slice(0,10) + '.pdf';
  doc.save(filename);
  showToast('✅ Rapport PDF exporté !');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}
