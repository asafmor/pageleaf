import { element, externalLink } from './dom.js';

function locationLink(feature) {
  const [longitude, latitude] = feature.point;
  const link = externalLink(`https://www.google.com/maps?q=${latitude},${longitude}`, '📍');
  link.setAttribute('aria-label', `Open ${feature.name} in Google Maps`);
  link.title = 'Open in Google Maps';
  return link;
}

export class FeatureTable {
  constructor(root, runtime, id, { onSelect, onHover } = {}) {
    this.rows = new Map();
    this.details = element('details', 'geomap-data');
    this.details.open = runtime.features.length <= 8;
    this.details.append(element('summary', '', `Map locations and features (${runtime.features.length})`));
    const wrapper = element('div', 'geomap-table-wrapper');
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Map locations and features table');
    const table = element('table', 'geomap-table');
    table.id = `${id}-table`;
    const caption = element('caption', 'geomap-sr-only', 'Geographic features. Select a name to focus it on the map.');
    table.append(caption);
    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Category / Type' },
      { key: 'layerName', label: 'Layer' },
      { key: 'routeSection', label: 'Route section' },
      { key: 'note', label: 'Details' },
      { key: 'point', label: '📍' },
      { key: 'sourceUrl', label: 'Source' }
    ].filter(column => ['name', 'category', 'layerName'].includes(column.key) || runtime.features.some(f => f[column.key]));
    const head = element('thead'), heading = element('tr');
    for (const column of columns) {
      const th = element('th', column.key === 'point' ? 'map-link-header' : '', column.label);
      th.scope = 'col';
      if (column.key === 'point') th.setAttribute('aria-label', 'Google Maps location');
      heading.append(th);
    }
    head.append(heading);
    table.append(head);
    const body = element('tbody');
    for (const feature of runtime.features) {
      const row = element('tr');
      row.dataset.featureId = `${id}/${feature.id}`;
      for (const column of columns) {
        const cell = element('td', column.key === 'point' ? 'map-link-cell' : '');
        if (column.key === 'name') {
          const button = element('button', 'geomap-feature-button', feature.name);
          button.type = 'button';
          button.setAttribute('aria-label', `Show ${feature.name} on map`);
          button.addEventListener('click', event => { event.stopPropagation(); onSelect?.(feature.id); });
          cell.append(button);
        } else if (column.key === 'point') {
          if (feature.point) cell.append(locationLink(feature));
        } else if (column.key === 'sourceUrl') {
          if (feature.sourceUrl) cell.append(externalLink(feature.sourceUrl, 'Source ↗'));
        } else {
          cell.textContent = feature[column.key] || '—';
          if (column.key === 'layerName') {
            const state = element('span', 'geomap-layer-state', ' (hidden on map)');
            state.hidden = true;
            cell.append(state);
          }
        }
        row.append(cell);
      }
      row.addEventListener('click', event => {
        if (!event.target.closest('a, button') && !window.getSelection()?.toString()) onSelect?.(feature.id);
      });
      row.addEventListener('mouseenter', () => onHover?.(feature.id));
      row.addEventListener('mouseleave', () => onHover?.(null));
      row.addEventListener('focusin', () => onHover?.(feature.id));
      row.addEventListener('focusout', () => onHover?.(null));
      this.rows.set(feature.id, row);
      body.append(row);
    }
    table.append(body);
    wrapper.append(table);
    if (runtime.features.length > 8) this.addSearch(runtime.features, id);
    this.details.append(wrapper);
    if (!runtime.features.length) this.details.append(element('p', 'geomap-message', 'No geographic features.'));
    root.append(this.details);
  }

  addSearch(features, id) {
    const controls = element('div', 'geomap-table-controls');
    const label = element('label', '', 'Search locations');
    const input = element('input');
    input.id = `${id}-search`;
    input.type = 'search';
    input.placeholder = 'Search locations…';
    label.htmlFor = input.id;
    const status = element('span', 'geomap-filter-status', `${features.length} of ${features.length} features`);
    status.setAttribute('role', 'status');
    const searchText = new Map(features.map(f => [f.id, [f.name, f.category, f.layerName, f.routeSection, f.note].join(' ').toLocaleLowerCase()]));
    input.addEventListener('input', () => {
      const query = input.value.trim().toLocaleLowerCase();
      let count = 0;
      for (const [id, row] of this.rows) {
        row.hidden = !searchText.get(id).includes(query);
        if (!row.hidden) count += 1;
      }
      status.textContent = `${count} of ${features.length} features`;
    });
    controls.append(label, input, status);
    this.details.append(controls);
  }

  select(id) {
    this.rows.get(this.selectedId)?.classList.remove('is-selected');
    this.rows.get(this.selectedId)?.querySelector('button').removeAttribute('aria-current');
    this.rows.get(id)?.classList.add('is-selected');
    this.rows.get(id)?.querySelector('button').setAttribute('aria-current', 'true');
    this.selectedId = id;
    // Map selection never changes disclosure, filtering or document scroll position.
  }

  hover(id) {
    this.rows.get(this.hoveredId)?.classList.remove('is-hovered');
    this.rows.get(id)?.classList.add('is-hovered');
    this.hoveredId = id;
  }

  setLayerVisible(layer, visible) {
    for (const feature of layer.features) {
      const row = this.rows.get(feature.id);
      row.classList.toggle('is-layer-hidden', !visible);
      row.querySelector('.geomap-layer-state').hidden = visible;
    }
  }
}
