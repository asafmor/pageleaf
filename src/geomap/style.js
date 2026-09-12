import { element } from './dom.js';

const routeColors = ['#1769aa', '#a33a14', '#7041a0', '#00796b'];
const routePatterns = [null, '12 7', '3 7', '14 5 3 5'];
const categoryIcons = new Map(Object.entries({
  settlement: '⌂', accommodation: '▣', transport: '↔', water: '≈', pass: '⋈',
  viewpoint: '◉', historic: '♜', 'trail-access': '↗', summit: '▲', food: '♨'
}));

export function layerStyle(role, routeIndex) {
  if (role === 'route') return { color: routeColors[routeIndex % routeColors.length], weight: 4, dashArray: routePatterns[routeIndex % routePatterns.length], fillOpacity: 0.12 };
  if (role === 'boundary') return { color: '#79532b', weight: 2, dashArray: '6 5', fillOpacity: 0.14 };
  return { color: '#28614b', weight: 3, dashArray: null, fillOpacity: 0.18 };
}

export function pointMarker(L, latlng, feature) {
  const icon = element('span', 'geomap-marker-symbol', categoryIcons.get(feature.category.toLowerCase()) || '●');
  icon.setAttribute('aria-hidden', 'true');
  return L.marker(latlng, {
    icon: L.divIcon({ className: 'geomap-marker', html: icon, iconSize: [30, 30], iconAnchor: [15, 15] }),
    title: feature.name,
    alt: feature.name,
    // Keyboard focus should not unexpectedly move the document or the map.
    autoPanOnFocus: false,
    bubblingMouseEvents: false
  });
}

export function emphasize(group, style, level) {
  const apply = layer => {
    if (layer.eachLayer) { layer.eachLayer(apply); return; }
    if (layer.setStyle) layer.setStyle({ ...style, weight: style.weight + (level === 2 ? 3 : level), fillOpacity: style.fillOpacity + level * 0.08 });
    const icon = layer.getElement?.();
    icon?.classList.toggle('is-selected', level === 2);
    icon?.classList.toggle('is-hovered', level === 1);
    if (layer.setZIndexOffset) layer.setZIndexOffset(level * 500);
  };
  apply(group);
}
