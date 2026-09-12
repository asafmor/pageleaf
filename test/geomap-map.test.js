import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { normalizeGeoMap } from '../src/geomap/data.js';
import { FeatureMap } from '../src/geomap/map.js';
import { FeatureTable } from '../src/geomap/table.js';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
dom.window.eval(await readFile(require.resolve('leaflet/dist/leaflet.js'), 'utf8'));
const L = dom.window.L;
L.Browser.svg = true;
Object.defineProperties(dom.window.HTMLElement.prototype, {
  clientWidth: { get: () => 640 }, clientHeight: { get: () => 420 }
});
let scrolls = 0;
dom.window.HTMLElement.prototype.scrollIntoView = () => scrolls++;
after(() => dom.window.close());

function runtime() {
  const feature = (geometry, name) => ({ type: 'Feature', properties: { name }, geometry });
  const layer = (id, role, features) => ({ id, name: id, role, geojson: { type: 'FeatureCollection', features } });
  const ring = [[10, 40], [11, 40], [11, 41], [10, 40]];
  return normalizeGeoMap({ layers: [
    layer('places', 'poi', [feature({ type: 'Point', coordinates: [2.623, 39.7108] }, 'Same name')]),
    layer('route', 'route', [feature({ type: 'LineString', coordinates: [[2, 39], [8, 42]] }, 'Same name')]),
    layer('alternative', 'route', [feature({ type: 'MultiLineString', coordinates: [[[3, 39], [5, 40]]] }, 'Detour')]),
    layer('area', 'boundary', [feature({ type: 'Polygon', coordinates: [ring] }, 'Area'), feature({ type: 'MultiPolygon', coordinates: [[ring]] }, 'Areas')]),
    layer('collection', 'poi', [feature({ type: 'GeometryCollection', geometries: [
      { type: 'MultiPoint', coordinates: [[4, 40], [5, 41]] }, { type: 'Point', coordinates: [] }
    ] }, 'Collection')])
  ] });
}

function render(data = runtime()) {
  const root = document.createElement('div'), container = document.createElement('div'), toolbar = document.createElement('div');
  root.append(toolbar, container);
  document.body.append(root);
  let map;
  const table = new FeatureTable(root, data, `map-${document.body.children.length}`, {
    onSelect: id => map.focus(id), onHover: id => map.hover(id)
  });
  map = new FeatureMap(L, container, toolbar, data, {
    onSelect: id => table.select(id), onHover: id => table.hover(id), onVisibility: (layer, visible) => table.setLayerVisible(layer, visible)
  });
  map.reducedMotion = true;
  return { map, table, root, toolbar, container };
}

test('real Leaflet renders all geometry types, fits routes and boundaries, and distinguishes routes', () => {
  const { map } = render();
  try {
    assert.equal(map.features.size, 6);
    assert.equal(map.layers.size, 5);
    assert.ok(map.map.getBounds().contains([42, 8]));
    assert.ok(map.map.getBounds().contains([41, 11]));
    assert.ok(map.map.getBounds().contains([39.7108, 2.623]));
    const main = map.features.get('route/0'), alternative = map.features.get('alternative/0');
    assert.notEqual(main.style.color, alternative.style.color);
    assert.notEqual(main.style.dashArray, alternative.style.dashArray);
    assert.equal(map.map.options.scrollWheelZoom, false);
  } finally { map.destroy(); }
});

test('map clicks and hover remain local while table selection reveals, focuses and selects', () => {
  const { map, table, toolbar } = render();
  try {
    table.details.open = false;
    const pointGroup = map.features.get('places/0').geometry;
    const point = pointGroup.getLayers()[0];
    const before = scrolls;
    point.fire('click', { latlng: point.getLatLng() }, true);
    assert.equal(table.details.open, false);
    assert.equal(scrolls, before);
    assert.equal(table.selectedId, 'places/0');
    assert.equal(pointGroup.isPopupOpen(), true);
    assert.equal(pointGroup.getPopup().options.autoPan, false);
    const center = map.map.getCenter();
    table.rows.get('route/0').dispatchEvent(new dom.window.MouseEvent('mouseenter'));
    assert.equal(map.map.getCenter().equals(center), true);
    assert.equal(table.details.open, false);
    assert.equal(scrolls, before);
    const toggle = toolbar.querySelector('input');
    toggle.checked = false;
    toggle.dispatchEvent(new dom.window.Event('change'));
    assert.equal(map.map.hasLayer(map.layers.get('places').group), false);
    assert.equal(table.rows.get('places/0').classList.contains('is-layer-hidden'), true);
    table.rows.get('places/0').querySelector('button').click();
    assert.equal(map.map.hasLayer(map.layers.get('places').group), true);
    assert.equal(toggle.checked, true);
    assert.equal(table.rows.get('places/0').classList.contains('is-layer-hidden'), false);
    assert.equal(scrolls, before + 1);
    assert.ok(map.map.getZoom() >= 15);
    assert.ok(map.map.getCenter().equals([39.7108, 2.623]));
    assert.equal(pointGroup.isPopupOpen(), true);
    toggle.checked = false;
    toggle.dispatchEvent(new dom.window.Event('change'));
    toggle.checked = true;
    toggle.dispatchEvent(new dom.window.Event('change'));
    assert.equal(point.getElement().classList.contains('is-selected'), true);
  } finally { map.destroy(); }
});

test('selection restores normal styles, fits lines and isolates multiple map instances', () => {
  const first = render(), second = render();
  try {
    const route = first.map.features.get('route/0'), path = route.geometry.getLayers()[0];
    first.map.focus('route/0');
    assert.equal(path.options.weight, route.style.weight + 3);
    assert.ok(first.map.map.getBounds().contains([42, 8]));
    first.map.focus('area/0');
    assert.equal(path.options.weight, route.style.weight);
    assert.equal(path.options.dashArray, route.style.dashArray);
    assert.equal(second.table.selectedId, undefined);
    assert.equal(second.map.selectedId, undefined);
    const secondZoom = second.map.map.getZoom();
    first.map.focus('places/0');
    assert.equal(second.map.map.getZoom(), secondZoom);
  } finally { first.map.destroy(); second.map.destroy(); }
});

test('a single point has a sensible initial zoom and empty maps have a usable default', () => {
  const data = runtime();
  data.layers = data.layers.slice(0, 1);
  data.features = data.layers[0].features;
  const single = render(data), empty = render(normalizeGeoMap({ layers: [] }));
  try {
    assert.equal(single.map.map.getZoom(), 15);
    assert.equal(empty.map.map.getZoom(), 2);
    assert.equal(empty.table.rows.size, 0);
  } finally { single.map.destroy(); empty.map.destroy(); }
});
