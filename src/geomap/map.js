import { drawableGeometry } from './data.js';
import { element, popupContent } from './dom.js';
import { emphasize, layerStyle, pointMarker } from './style.js';

export class FeatureMap {
  constructor(L, container, toolbar, runtime, { onSelect, onHover, onVisibility }) {
    this.L = L;
    this.container = container;
    this.layers = new Map();
    this.features = new Map();
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.map = L.map(container, {
      scrollWheelZoom: false,
      fadeAnimation: !this.reducedMotion,
      zoomAnimation: !this.reducedMotion,
      markerZoomAnimation: !this.reducedMotion
    }).setView([20, 0], 2);
    try {
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
      }).addTo(this.map);
      let routeIndex = 0;
      const controls = element('details', 'geomap-layers');
      controls.append(element('summary', '', 'Layers'));
      const fields = element('fieldset');
      fields.append(element('legend', 'geomap-sr-only', 'Visible map layers'));
      for (const layer of runtime.layers) {
        const style = layerStyle(layer.role, layer.role === 'route' ? routeIndex++ : 0);
        const group = L.featureGroup().addTo(this.map);
        const label = element('label');
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) group.addTo(this.map);
          else this.map.removeLayer(group);
          onVisibility(layer, checkbox.checked);
          this.refresh(this.selectedId);
          this.refresh(this.hoveredId);
        });
        const swatch = element('span', 'geomap-layer-swatch');
        swatch.style.borderTopColor = style.color;
        swatch.style.borderTopStyle = style.dashArray ? 'dashed' : 'solid';
        swatch.setAttribute('aria-hidden', 'true');
        label.append(checkbox, swatch, document.createTextNode(layer.name));
        fields.append(label);
        this.layers.set(layer.id, { group, checkbox, layer });
        for (const feature of layer.features) {
          const drawable = drawableGeometry(feature.feature.geometry);
          if (!drawable) continue;
          const geometry = L.geoJSON({ ...feature.feature, geometry: drawable }, {
            style: () => style,
            pointToLayer: (_, latlng) => pointMarker(L, latlng, feature)
          });
          geometry.bindPopup(() => popupContent(feature), { maxWidth: 300, autoPan: false });
          geometry.on('click', () => this.select(feature.id));
          geometry.on('mouseover', () => this.hover(feature.id));
          geometry.on('mouseout', () => this.hover(null));
          geometry.addTo(group);
          this.features.set(feature.id, { geometry, style, feature });
        }
      }
      controls.append(fields);
      toolbar.append(controls);
      const bounds = L.latLngBounds([]);
      for (const { group } of this.layers.values()) {
        const layerBounds = group.getBounds();
        if (layerBounds.isValid()) bounds.extend(layerBounds);
      }
      if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
      // Navigation and responsive layout can resize an existing map without a window resize.
      if (window.ResizeObserver) {
        this.observer = new ResizeObserver(() => this.map.invalidateSize({ pan: false }));
        this.observer.observe(container);
      }
      this.onVisibility = onVisibility;
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  refresh(id) {
    const binding = this.features.get(id);
    if (binding) emphasize(binding.geometry, binding.style, id === this.selectedId ? 2 : id === this.hoveredId ? 1 : 0);
  }

  select(id) {
    const previous = this.selectedId;
    this.selectedId = id;
    this.refresh(previous);
    this.refresh(id);
    this.onSelect(id);
  }

  hover(id) {
    const previous = this.hoveredId;
    this.hoveredId = id;
    this.refresh(previous);
    this.refresh(id);
    this.onHover(id);
  }

  focus(id) {
    const binding = this.features.get(id);
    if (!binding) { this.select(id); return; }
    const { geometry, feature } = binding;
    const entry = this.layers.get(feature.layerId);
    entry.group.addTo(this.map);
    entry.checkbox.checked = true;
    this.onVisibility(entry.layer, true);
    this.select(id);
    this.container.scrollIntoView({ behavior: this.reducedMotion ? 'instant' : 'smooth', block: 'start' });
    this.map.invalidateSize({ pan: false });
    if (feature.point) {
      const [longitude, latitude] = feature.point;
      this.map.flyTo([latitude, longitude], Math.max(this.map.getZoom(), 15), { animate: !this.reducedMotion });
    } else {
      const bounds = geometry.getBounds();
      if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16, animate: !this.reducedMotion });
    }
    geometry.openPopup();
  }

  destroy() {
    this.observer?.disconnect();
    this.map.remove();
  }
}
