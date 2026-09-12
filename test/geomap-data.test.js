import assert from 'node:assert/strict';
import test from 'node:test';
import { drawableGeometry, normalizeGeoMap, safeUrl } from '../src/geomap/data.js';

const point = { type: 'Point', coordinates: [2.623, 39.7108] };
const line = { type: 'LineString', coordinates: [[2, 39], [3, 40]] };
const polygon = { type: 'Polygon', coordinates: [[[2, 39], [3, 39], [3, 40], [2, 39]]] };
const feature = (geometry, properties = {}) => ({ type: 'Feature', properties, geometry });
const layer = (geojson, extra = {}) => ({ id: 'places', name: 'Places', role: 'poi', geojson, ...extra });
const normalize = (...layers) => normalizeGeoMap({ layers });

test('normalization supports every GeoJSON geometry and preserves feature granularity', () => {
  const geometries = [point, line, polygon,
    { type: 'MultiPoint', coordinates: [point.coordinates, [3, 40]] },
    { type: 'MultiLineString', coordinates: [line.coordinates] },
    { type: 'MultiPolygon', coordinates: [polygon.coordinates] },
    { type: 'GeometryCollection', geometries: [point, line, polygon] }
  ];
  const input = { layers: geometries.map((geometry, i) => layer(geometry, { id: String(i) })) };
  const before = JSON.stringify(input);
  const runtime = normalizeGeoMap(input);
  assert.equal(runtime.layers.length, 7);
  assert.equal(runtime.features.length, 7);
  assert.equal(runtime.features.filter(f => f.point).length, 1);
  assert.deepEqual(runtime.features[0].point, [2.623, 39.7108]);
  assert.equal(JSON.stringify(input), before);
});

test('large authoritative tracks produce one feature and retain every coordinate', () => {
  const coordinates = Array.from({ length: 12000 }, (_, i) => [2 + i / 12000, 39 + i / 12000]);
  const runtime = normalize(layer(feature({ type: 'LineString', coordinates }), { role: 'route' }));
  assert.equal(runtime.features.length, 1);
  assert.equal(runtime.features[0].feature.geometry.coordinates, coordinates);
  assert.equal(runtime.features[0].point, null);
});

test('property aliases and safe feature provenance precede layer fallback', () => {
  const runtime = normalize(layer({ type: 'FeatureCollection', features: [
    feature(point, { name: 'Same name', category: '', type: 'custom category', route_section: 'Core', desc: 'A village', source: { url: 'https://feature.example/path' }, technical: { large: [] } }),
    feature(point, { name: 'Same name', routeSection: 'Detour', note: null, description: 'A refuge', source: { url: 'javascript:alert(1)' } }),
    feature(null, null)
  ] }, { source: { url: 'https://layer.example/route.gpx', originalFormat: 'gpx' } }));
  const [first, second, anonymous] = runtime.features;
  assert.equal(first.sourceUrl, 'https://feature.example/path');
  assert.equal(second.sourceUrl, 'https://layer.example/route.gpx');
  assert.equal(first.category, 'custom category');
  assert.equal(first.routeSection, 'Core');
  assert.equal(first.note, 'A village');
  assert.equal(second.note, 'A refuge');
  assert.notEqual(first.id, second.id);
  assert.equal(anonymous.name, 'Places · 3');
  assert.equal(anonymous.point, null);
  assert.equal(first.technical, undefined);
});

test('malformed roots fail locally and invalid layers do not discard valid siblings', () => {
  for (const input of [null, [], 1, {}, { layers: {} }]) assert.throws(() => normalizeGeoMap(input), /layers array/);
  const invalid = [
    null, layer(point, { id: '' }), layer(point, { name: null }), layer(point, { role: 3 }),
    layer(point, { source: { retrievedAt: 42 } }), layer({ type: 'FeatureCollection', features: {} }),
    layer(feature(point, [])), layer({ type: 'Unknown', coordinates: [] }),
    layer({ type: 'Point', coordinates: [2, 91] }), layer({ type: 'Point', coordinates: [181, 39] }),
    layer({ type: 'Point', coordinates: ['2', 39] }), layer({ type: 'Point', coordinates: [2, NaN] }),
    layer({ type: 'LineString', coordinates: [[2, 39]] }),
    layer({ type: 'Polygon', coordinates: [[[2, 39], [3, 39], [3, 40], [4, 40]]] }),
    layer({ type: 'GeometryCollection', geometries: [null] })
  ];
  for (const bad of invalid) {
    const runtime = normalize(bad, layer(point, { id: 'valid' }));
    assert.equal(runtime.layers.length, 1);
    assert.equal(runtime.layers[0].id, 'valid');
    assert.equal(runtime.errors.length, 1);
  }
  assert.throws(() => normalize(layer({ type: 'NoSuchGeometry' })), /Unsupported geometry/);
});

test('duplicate IDs are rejected while duplicate names and special object keys stay safe', () => {
  const runtime = normalize(layer(point, { id: '__proto__' }), layer(line, { id: '__proto__' }), layer(line, { id: 'constructor' }));
  assert.equal(runtime.layers.length, 2);
  assert.equal(runtime.errors.length, 1);
  assert.equal(new Set(runtime.features.map(f => f.id)).size, 2);
});

test('empty and unlocated GeoJSON remain valid and do not reach Leaflet as invalid points', () => {
  assert.equal(normalize().features.length, 0);
  assert.equal(normalize(layer({ type: 'FeatureCollection', features: [] })).features.length, 0);
  const empty = { type: 'Point', coordinates: [] };
  const collection = { type: 'GeometryCollection', geometries: [empty, point, { type: 'GeometryCollection', geometries: [] }] };
  assert.equal(normalize(layer(feature(null))).features.length, 1);
  assert.equal(normalize(layer(empty)).features[0].point, null);
  assert.equal(drawableGeometry(empty), null);
  assert.deepEqual(drawableGeometry(collection).geometries, [point]);
  assert.equal(collection.geometries.length, 3);
});

test('source URLs permit only absolute HTTP and HTTPS URLs', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/a', '/relative', '//example.com', {}, null]) assert.equal(safeUrl(value), '');
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeUrl('http://example.com/a'), 'http://example.com/a');
});
