import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { normalizeGeoMap } from '../src/geomap/data.js';
import { popupContent } from '../src/geomap/dom.js';
import { FeatureTable } from '../src/geomap/table.js';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
after(() => dom.window.close());

function data(count = 2) {
  return normalizeGeoMap({ layers: [{
    id: 'places', name: 'Points of interest', role: 'poi',
    source: { url: 'https://example.com/source' },
    geojson: { type: 'FeatureCollection', features: Array.from({ length: count }, (_, i) => ({
      type: 'Feature', properties: { name: `Place ${i}`, category: i === 1 ? 'water' : 'settlement', route_section: 'Core', note: i === 1 ? 'Spring' : '' },
      geometry: i === 1 ? { type: 'LineString', coordinates: [[2, 39], [3, 40]] } : { type: 'Point', coordinates: [2.623, 39.7108] }
    })) }
  }] });
}

function render(runtime = data(), handlers = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const table = new FeatureTable(root, runtime, 'geomap-test', handlers);
  return { root, table };
}

test('Google Maps is an icon-only point column with longitude and latitude reversed', () => {
  const selected = [];
  const { root } = render(data(), { onSelect: id => selected.push(id) });
  const cells = root.querySelectorAll('.map-link-cell');
  const link = cells[0].querySelector('a');
  assert.equal(cells[0].textContent, '📍');
  assert.equal(cells[1].textContent, '');
  assert.equal(link.href, 'https://www.google.com/maps?q=39.7108,2.623');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.getAttribute('aria-label'), 'Open Place 0 in Google Maps');
  // Cancel browser navigation after exercising the real bubbling path.
  link.addEventListener('click', event => event.preventDefault());
  link.click();
  const source = root.querySelector('td:last-child a');
  source.addEventListener('click', event => event.preventDefault());
  source.click();
  assert.deepEqual(selected, []);
  root.querySelector('tbody td').click();
  root.querySelector('tbody button').click();
  assert.deepEqual(selected, ['places/0', 'places/0']);
});

test('selection never expands the table or scrolls and hidden layers keep their rows', () => {
  const runtime = data(9);
  const { root, table } = render(runtime);
  let scrolls = 0;
  dom.window.HTMLElement.prototype.scrollIntoView = () => scrolls++;
  assert.equal(table.details.open, false);
  table.select('places/0');
  table.select('places/1');
  assert.equal(table.details.open, false);
  assert.equal(scrolls, 0);
  assert.equal(root.querySelectorAll('.is-selected').length, 1);
  assert.equal(table.rows.get('places/1').querySelector('button').getAttribute('aria-current'), 'true');
  table.setLayerVisible(runtime.layers[0], false);
  assert.equal(root.querySelectorAll('tbody tr').length, 9);
  assert.equal(root.querySelector('tbody tr').hidden, false);
  assert.equal(root.querySelector('.geomap-layer-state').hidden, false);
  table.setLayerVisible(runtime.layers[0], true);
  assert.equal(root.querySelector('.geomap-layer-state').hidden, true);
});

test('filtering searches human properties without changing layer state or selection', () => {
  const { root, table } = render(data(10));
  const input = root.querySelector('input');
  for (const [query, expected] of [['SPRING', 1], ['water', 1], ['core', 10], ['points of interest', 10], ['missing', 0], ['', 10]]) {
    input.value = query;
    input.dispatchEvent(new dom.window.Event('input'));
    assert.equal([...root.querySelectorAll('tbody tr')].filter(row => !row.hidden).length, expected);
  }
  input.value = 'missing';
  input.dispatchEvent(new dom.window.Event('input'));
  table.select('places/0');
  assert.equal(table.rows.get('places/0').hidden, true);
  assert.equal(input.value, 'missing');
  assert.equal(root.querySelector('.geomap-filter-status').textContent, '0 of 10 features');
});

test('table and popup properties are text and never execute or expose arbitrary metadata', () => {
  const runtime = data(1), feature = runtime.features[0];
  feature.name = '<img src=x onerror="window.pwned=1">';
  feature.note = '</script><script>window.pwned=1</script>';
  feature.category = '<svg onload="window.pwned=1">';
  const { root } = render(runtime);
  const popup = popupContent(feature);
  assert.equal(root.querySelector('img, script, svg'), null);
  assert.equal(popup.querySelector('img, script, svg'), null);
  assert.ok(root.textContent.includes(feature.name));
  assert.ok(popup.textContent.includes(feature.note));
  assert.equal(popup.querySelector('[href*="google.com"]'), null);
});

test('small tables open by default and absent optional columns stay absent', () => {
  const runtime = data(1);
  Object.assign(runtime.features[0], { note: '', routeSection: '', sourceUrl: '', point: null });
  const { root, table } = render(runtime);
  assert.equal(table.details.open, true);
  assert.deepEqual([...root.querySelectorAll('th')].map(th => th.textContent), ['Name', 'Category / Type', 'Layer']);
  assert.equal(root.querySelector('input'), null);
  assert.equal(root.querySelector('summary').textContent, 'Map locations and features (1)');
});
