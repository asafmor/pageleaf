let loading;

export function loadLeaflet() {
  if (loading) return loading;
  // Load only on pages with maps; one failure must not block Markdown or its tables.
  loading = Promise.all([
    loadAsset('link', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='),
    loadAsset('script', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=')
  ]).then(() => {
    if (!window.L) throw new Error('Leaflet did not initialize');
    return window.L;
  });
  return loading;
}

function loadAsset(tag, url, integrity) {
  return new Promise((resolve, reject) => {
    const node = document.createElement(tag);
    if (tag === 'link') { node.rel = 'stylesheet'; node.href = url; }
    else node.src = url;
    node.integrity = integrity;
    node.crossOrigin = 'anonymous';
    const timer = setTimeout(() => finish(new Error('Leaflet download timed out')), 15000);
    const finish = error => {
      clearTimeout(timer);
      node.onload = node.onerror = null;
      if (error) { node.remove(); reject(error); }
      else resolve();
    };
    node.onload = () => finish();
    node.onerror = () => finish(new Error('Leaflet download failed'));
    document.head.append(node);
  });
}
