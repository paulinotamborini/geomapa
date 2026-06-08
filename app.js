/**
 * app.js — Visor de Obras Municipales · Municipalidad de Rosario
 * Stack: Leaflet.js + GeoJSON + JS nativo (ES6+)
 */

'use strict';

/* ============================================================
   CONFIGURACIÓN GLOBAL
   ============================================================ */
const CONFIG = {
  map: {
    center: [-32.9575, -60.6394],
    zoom: 13,
    minZoom: 10,
    maxZoom: 19,
    tileUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  },
  dataUrl: 'obras.geojson',
  markerRadius: 10,
};

const ESTADO_CONFIG = {
  'Planificado':   { color: '#2563eb', cssClass: 'planificado', label: 'Planificado' },
  'En Ejecución':  { color: '#d97706', cssClass: 'ejecucion',   label: 'En Ejecución' },
  'Completado':    { color: '#16a34a', cssClass: 'completado',  label: 'Completado' },
};

/* ============================================================
   ESTADO DE LA APLICACIÓN
   ============================================================ */
const state = {
  allFeatures: [],          // GeoJSON features completos
  filteredFeatures: [],     // Features visibles según filtros activos
  activeEstados: new Set(), // Set vacío = "todos"
  activeDistrito: 'todos',
  markers: [],              // Referencia a los círculos Leaflet activos
  map: null,
  layerGroup: null,
};

/* ============================================================
   REFERENCIAS AL DOM
   ============================================================ */
const dom = {
  toggleSidebarBtn: document.getElementById('toggle-sidebar'),
  sidebar:          document.getElementById('sidebar'),
  sidebarOverlay:   document.getElementById('sidebar-overlay'),
  resultsCount:     document.getElementById('results-count'),
  filterAll:        document.getElementById('filter-all'),
  filterEstados:    document.querySelectorAll('.filter-btn[data-estado]'),
  filterDistrito:   document.getElementById('filter-distrito'),
  projectList:      document.getElementById('project-list'),
  emptyState:       document.getElementById('empty-state'),
  resetZoomBtn:     document.getElementById('reset-zoom'),
};

/* ============================================================
   MAPA
   ============================================================ */
function initMap() {
  state.map = L.map('map', {
    center: CONFIG.map.center,
    zoom: CONFIG.map.zoom,
    minZoom: CONFIG.map.minZoom,
    maxZoom: CONFIG.map.maxZoom,
    zoomControl: false,
  });

  L.tileLayer(CONFIG.map.tileUrl, {
    attribution: CONFIG.map.tileAttribution,
    subdomains: 'abcd',
    maxZoom: CONFIG.map.maxZoom,
  }).addTo(state.map);

  // Controles de zoom reposicionados
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);

  state.layerGroup = L.layerGroup().addTo(state.map);
}

/* ============================================================
   CARGA DE DATOS
   ============================================================ */
async function loadData() {
  try {
    const res = await fetch(CONFIG.dataUrl);
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    const geojson = await res.json();

    state.allFeatures = geojson.features || [];
    state.filteredFeatures = [...state.allFeatures];

    populateDistrictFilter();
    updateCountBadges();
    renderMap();
    renderProjectList();
  } catch (err) {
    console.error('Error al cargar datos GeoJSON:', err);
    showErrorBanner();
  }
}

/* ============================================================
   FILTROS
   ============================================================ */
/** Aplica los filtros activos y actualiza mapa + lista */
function applyFilters() {
  state.filteredFeatures = state.allFeatures.filter(feature => {
    const { estado, distrito } = feature.properties;

    const estadoOk = state.activeEstados.size === 0
      || state.activeEstados.has(estado);

    const distritoOk = state.activeDistrito === 'todos'
      || distrito === state.activeDistrito;

    return estadoOk && distritoOk;
  });

  renderMap();
  renderProjectList();
  updateCountBadges();
  updateFilterUI();
}

/** Activa o desactiva un estado en el filtro (toggle multiselecci&oacute;n) */
function toggleEstadoFilter(estado) {
  if (estado === 'todos') {
    state.activeEstados.clear();
  } else {
    if (state.activeEstados.has(estado)) {
      state.activeEstados.delete(estado);
    } else {
      state.activeEstados.add(estado);
    }
  }
  applyFilters();
}

/** Actualiza la clase .active en los botones de filtro */
function updateFilterUI() {
  const allActive = state.activeEstados.size === 0;
  dom.filterAll.classList.toggle('active', allActive);

  dom.filterEstados.forEach(btn => {
    btn.classList.toggle('active', state.activeEstados.has(btn.dataset.estado));
  });
}

/** Rellena el select de distritos dinámicamente desde los datos */
function populateDistrictFilter() {
  const distritos = [...new Set(
    state.allFeatures.map(f => f.properties.distrito).filter(Boolean)
  )].sort();

  distritos.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    dom.filterDistrito.appendChild(opt);
  });
}

/** Actualiza los contadores en los badges de los botones */
function updateCountBadges() {
  const totals = { 'Planificado': 0, 'En Ejecución': 0, 'Completado': 0 };

  // Contamos en los features YA filtrados por distrito (para que el badge
  // refleje cuántos hay del estado en el contexto actual del filtro de distrito)
  const baseFeatures = state.activeDistrito === 'todos'
    ? state.allFeatures
    : state.allFeatures.filter(f => f.properties.distrito === state.activeDistrito);

  baseFeatures.forEach(f => {
    if (totals[f.properties.estado] !== undefined) {
      totals[f.properties.estado]++;
    }
  });

  const total = baseFeatures.length;
  dom.filterAll.querySelector('.filter-btn-count').textContent = total;

  dom.filterEstados.forEach(btn => {
    const count = totals[btn.dataset.estado] ?? 0;
    btn.querySelector('.filter-btn-count').textContent = count;
  });

  dom.resultsCount.textContent =
    `${state.filteredFeatures.length} resultado${state.filteredFeatures.length !== 1 ? 's' : ''}`;
}

/* ============================================================
   RENDERIZADO DEL MAPA
   ============================================================ */
function renderMap() {
  // Limpiamos los marcadores anteriores
  state.layerGroup.clearLayers();
  state.markers = [];

  state.filteredFeatures.forEach(feature => {
    const marker = createMarker(feature);
    if (marker) {
      marker.addTo(state.layerGroup);
      state.markers.push(marker);
    }
  });
}

function createMarker(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  if (lat == null || lng == null) return null;

  const { estado, proyecto } = feature.properties;
  const cfg = ESTADO_CONFIG[estado] ?? ESTADO_CONFIG['Planificado'];

  const circle = L.circleMarker([lat, lng], {
    radius: CONFIG.markerRadius,
    fillColor: cfg.color,
    color: '#ffffff',
    weight: 2.5,
    opacity: 1,
    fillOpacity: 0.92,
    className: `marker-${cfg.cssClass}`,
  });

  // Tooltip hover
  circle.bindTooltip(proyecto, {
    direction: 'top',
    offset: [0, -12],
    className: 'custom-tooltip',
  });

  // Popup al hacer clic
  circle.bindPopup(() => buildPopupContent(feature), {
    maxWidth: 320,
    minWidth: 260,
    autoPan: true,
    autoPanPaddingTopLeft: [20, 20],
  });

  // Efecto hover en el marcador
  circle.on('mouseover', () => {
    circle.setStyle({ radius: CONFIG.markerRadius + 3, weight: 3 });
  });
  circle.on('mouseout', () => {
    circle.setStyle({ radius: CONFIG.markerRadius, weight: 2.5 });
  });

  // Vincula el marker a su feature para navegar desde la lista
  circle._featureId = feature.properties.proyecto;

  return circle;
}

/* ============================================================
   POPUP
   ============================================================ */
function buildPopupContent(feature) {
  const p = feature.properties;
  const cfg = ESTADO_CONFIG[p.estado] ?? ESTADO_CONFIG['Planificado'];

  const row = (label, value) => value
    ? `<div class="popup-row">
         <span class="popup-row-label">${label}</span>
         <span class="popup-row-value">${value}</span>
       </div>`
    : '';

  return `
    <div>
      <div class="popup-header ${cfg.cssClass}">
        <div class="popup-estado">${p.estado}</div>
        <div class="popup-nombre">${p.proyecto}</div>
      </div>
      <div class="popup-body">
        ${row('Tipo', p.tipo)}
        ${row('Distrito', p.distrito)}
        ${row('Inicio', p.inicio)}
        ${row('Finalización', p.fin_estimado)}
        ${p.descripcion ? `<div class="popup-desc">${p.descripcion}</div>` : ''}
      </div>
    </div>
  `;
}

/* ============================================================
   LISTA DE PROYECTOS
   ============================================================ */
function renderProjectList() {
  dom.projectList.innerHTML = '';

  if (state.filteredFeatures.length === 0) {
    dom.emptyState.classList.add('visible');
    return;
  }

  dom.emptyState.classList.remove('visible');

  state.filteredFeatures.forEach((feature, idx) => {
    const item = buildProjectListItem(feature, idx);
    dom.projectList.appendChild(item);
  });
}

function buildProjectListItem(feature, idx) {
  const p = feature.properties;
  const cfg = ESTADO_CONFIG[p.estado] ?? ESTADO_CONFIG['Planificado'];

  const item = document.createElement('div');
  item.className = 'project-item';
  item.style.animationDelay = `${idx * 30}ms`;
  item.setAttribute('role', 'button');
  item.setAttribute('tabindex', '0');
  item.setAttribute('aria-label', `${p.proyecto} — ${p.estado}`);

  item.innerHTML = `
    <div class="project-item-dot" style="background:${cfg.color}"></div>
    <div class="project-item-info">
      <div class="project-item-name">${p.proyecto}</div>
      <div class="project-item-meta">${p.tipo} · ${p.distrito}</div>
    </div>
  `;

  const activate = () => flyToFeature(feature);
  item.addEventListener('click', activate);
  item.addEventListener('keydown', e => e.key === 'Enter' && activate());

  return item;
}

/** Vuela al marcador correspondiente y abre su popup */
function flyToFeature(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  state.map.flyTo([lat, lng], 16, { duration: 0.8 });

  // Buscamos el marker correcto y abrimos su popup
  const marker = state.markers.find(
    m => m._featureId === feature.properties.proyecto
  );
  if (marker) {
    setTimeout(() => marker.openPopup(), 700);
  }

  // En mobile cerramos el sidebar al navegar
  if (window.innerWidth <= 640) {
    closeSidebar();
  }
}

/* ============================================================
   SIDEBAR MOBILE
   ============================================================ */
function toggleSidebar() {
  const isOpen = dom.sidebar.classList.toggle('open');
  dom.sidebarOverlay.classList.toggle('visible', isOpen);
  dom.toggleSidebarBtn.setAttribute('aria-expanded', isOpen);
}

function closeSidebar() {
  dom.sidebar.classList.remove('open');
  dom.sidebarOverlay.classList.remove('visible');
  dom.toggleSidebarBtn.setAttribute('aria-expanded', false);
}

/* ============================================================
   UTILITIES
   ============================================================ */
function showErrorBanner() {
  dom.emptyState.classList.add('visible');
  dom.emptyState.querySelector('p').textContent =
    'No se pudieron cargar los datos. Verificá que el archivo obras.geojson esté disponible.';
}

/* ============================================================
   EVENT LISTENERS
   ============================================================ */
function bindEvents() {
  // Toggle sidebar mobile
  dom.toggleSidebarBtn.addEventListener('click', toggleSidebar);
  dom.sidebarOverlay.addEventListener('click', closeSidebar);

  // Filtro "Todos"
  dom.filterAll.addEventListener('click', () => toggleEstadoFilter('todos'));

  // Filtros por estado
  dom.filterEstados.forEach(btn => {
    btn.addEventListener('click', () => toggleEstadoFilter(btn.dataset.estado));
  });

  // Filtro por distrito
  dom.filterDistrito.addEventListener('change', e => {
    state.activeDistrito = e.target.value;
    applyFilters();
  });

  // Reset zoom
  dom.resetZoomBtn.addEventListener('click', () => {
    state.map.flyTo(CONFIG.map.center, CONFIG.map.zoom, { duration: 0.8 });
  });

  // Teclado: cerrar sidebar con Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSidebar();
  });
}

/* ============================================================
   BOOTSTRAP
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  bindEvents();
  loadData();
});
