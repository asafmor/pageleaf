import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, mock, test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import MarkdownIt from 'markdown-it';
import { embedDocument } from '../lib/pageleaf.js';
import { install } from '../src/geomap/index.js';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
after(() => dom.window.close());
mock.method(console, 'error', () => {});
after(() => mock.restoreAll());
const data = { layers: [{ id: 'poi', name: 'Places', role: 'poi', geojson: { type: 'Point', coordinates: [2.623, 39.7108] } }] };
const fence = value => '```geomap\n' + JSON.stringify(value) + '\n```\n';

function renderer(loadMapLibrary = () => Promise.reject(new Error('CDN offline'))) {
  const md = new MarkdownIt({ html: false });
  const extension = install(md, { loadMapLibrary });
  const root = document.createElement('article');
  document.body.append(root);
  return { md, extension, root };
}

test('fences fail independently, preserve ordinary code, and use unique component IDs', () => {
  const { md, extension, root } = renderer();
  root.innerHTML = md.render('Before\n\n' + fence(data) + '\n```geomap\n{bad json\n```\n\n' + fence([]) + '\n```json\n{}\n```\n\n' + fence(data) + '\nAfter');
  extension.enhance(root, { interactive: false });
  assert.equal(root.querySelectorAll('.geomap').length, 2);
  assert.equal(root.querySelectorAll('.geomap-error').length, 2);
  assert.equal(root.querySelector('pre code').className, 'language-json');
  assert.ok(root.textContent.includes('Before'));
  assert.ok(root.textContent.includes('After'));
  const ids = [...root.querySelectorAll('[id]')].map(node => node.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(root.querySelectorAll('tbody tr').length, 2);
});

test('tables and links survive CDN failure and map initialization failure', async () => {
  for (const loader of [() => Promise.reject(new Error('CDN offline')), () => ({ map() { throw new Error('Map unavailable'); } })]) {
    const { md, extension, root } = renderer(loader);
    root.innerHTML = md.render(fence(data));
    extension.enhance(root);
    assert.equal(root.querySelectorAll('tbody tr').length, 1);
    assert.ok(root.querySelector('.map-link-cell a'));
    await setImmediate();
    assert.match(root.querySelector('.geomap-map').textContent, /Map unavailable/);
    root.querySelector('tbody button').click();
    assert.equal(root.querySelectorAll('.is-selected').length, 1);
  }
});

test('navigation disposes maps waiting on a download and print reuses normalized data', async () => {
  let resolve, initialized = 0;
  const promise = new Promise(done => { resolve = done; });
  const { md, extension, root } = renderer(() => promise);
  const tokens = md.parse(fence(data), {});
  root.innerHTML = md.renderer.render(tokens, md.options, {});
  extension.enhance(root);
  extension.dispose(root);
  root.replaceChildren();
  resolve({ map() { initialized++; throw new Error('Must not initialize a disposed map'); } });
  await setImmediate();
  assert.equal(initialized, 0);
  // Rendering for print must not interpret the same JSON a second time.
  tokens[0].content = 'invalid after initial parse';
  root.innerHTML = md.renderer.render(tokens, md.options, {});
  extension.enhance(root, { interactive: false });
  assert.equal(root.querySelectorAll('tbody tr').length, 1);
  assert.equal(root.querySelector('details').open, true);
});

test('the packaged single HTML runs GeoMaps without adjacent scripts and protects script boundaries', async () => {
  const template = await readFile(new URL('../dist/template.html', import.meta.url), 'utf8');
  assert.doesNotMatch(template, /(?:src|href)="(?:src\/geomap|dist\/geomap)/);
  const input = structuredClone(data);
  input.layers[0].geojson = { type: 'Feature', geometry: data.layers[0].geojson, properties: { name: '</script><script>window.pwned=1</script>' } };
  const html = embedDocument(template, '# Map\n\n' + fence(input));
  const page = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://pageleaf.example/' });
  try {
    page.window.markdownit = MarkdownIt;
    // External assets stay blocked, but the real bundled app still renders its table.
    for (const script of page.window.document.querySelectorAll('script:not([src]):not([type="text/plain"])')) page.window.eval(script.textContent);
    assert.equal(page.window.document.getElementById('status').hidden, true);
    assert.equal(page.window.document.querySelectorAll('#article tbody tr').length, 1);
    assert.equal(page.window.pwned, undefined);
    assert.equal(page.window.document.querySelector('#article button').textContent, input.layers[0].geojson.properties.name);
    page.window.dispatchEvent(new page.window.Event('beforeprint'));
    assert.equal(page.window.document.querySelectorAll('#print-content tbody tr').length, 1);
    assert.equal(page.window.document.querySelector('#print-content details').open, true);
    await setImmediate();
  } finally { page.window.close(); }
});
