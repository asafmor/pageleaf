import { normalizeGeoMap } from './data.js';
import { element } from './dom.js';
import { FeatureTable } from './table.js';
import { FeatureMap } from './map.js';
import { loadLeaflet } from './leaflet.js';

export function install(md, { loadMapLibrary = loadLeaflet } = {}) {
  const originalFence = md.renderer.rules.fence;
  const parsed = new WeakMap(), pending = new Map(), components = new WeakMap();
  let nextId = 0;
  md.renderer.rules.fence = (tokens, index, ...args) => {
    const token = tokens[index];
    if (token.info.trim().split(/\s+/)[0] !== 'geomap') return originalFence(tokens, index, ...args);
    if (!parsed.has(token)) {
      try {
        const runtime = normalizeGeoMap(JSON.parse(token.content));
        runtime.errors.forEach(error => console.warn('GeoMap:', error));
        parsed.set(token, runtime);
      } catch (error) {
        console.error('GeoMap:', error);
        parsed.set(token, null);
      }
    }
    const runtime = parsed.get(token);
    if (!runtime) return '<p class="geomap-error" role="status">Map data could not be rendered.</p>';
    const id = `geomap-${++nextId}`;
    pending.set(id, runtime);
    return `<div class="geomap" data-geomap-id="${id}"></div>`;
  };

  function enhance(root, { interactive = true } = {}) {
    const active = components.get(root) || [];
    for (const node of root.querySelectorAll('[data-geomap-id]')) {
      const id = node.dataset.geomapId, runtime = pending.get(id);
      if (!runtime) continue;
      pending.delete(id);
      const component = { disposed: false };
      active.push(component);
      const toolbar = element('div', 'geomap-toolbar');
      const container = element('div', 'geomap-map');
      container.id = `${id}-map`;
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', 'Interactive geographic map');
      const status = element('p', 'geomap-message', interactive ? 'Loading map…' : 'Geographic features');
      status.setAttribute('role', 'status');
      container.append(status);
      node.append(toolbar, container);
      const table = new FeatureTable(node, runtime, id, {
        onSelect: featureId => { table.select(featureId); component.map?.focus(featureId); },
        onHover: featureId => component.map?.hover(featureId)
      });
      if (runtime.errors.length) node.prepend(element('p', 'geomap-message', 'Some map layers could not be rendered.'));
      if (!interactive) { table.details.open = true; continue; }
      Promise.resolve().then(loadMapLibrary).then(L => {
        if (component.disposed || !node.isConnected) return;
        status.remove();
        component.map = new FeatureMap(L, container, toolbar, runtime, {
          onSelect: featureId => table.select(featureId),
          onHover: featureId => table.hover(featureId),
          onVisibility: (layer, visible) => table.setLayerVisible(layer, visible)
        });
      }).catch(error => {
        if (component.disposed) return;
        console.error('GeoMap:', error);
        toolbar.replaceChildren();
        container.replaceChildren(element('p', 'geomap-message', 'Map unavailable. Geographic features and links are listed below.'));
      });
    }
    components.set(root, active);
  }

  function dispose(root) {
    for (const component of components.get(root) || []) {
      component.disposed = true;
      component.map?.destroy();
    }
    components.delete(root);
  }

  return { enhance, dispose };
}
