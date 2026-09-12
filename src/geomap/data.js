const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function text(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

export function safeUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function sourceUrl(source) {
  return safeUrl(isObject(source) ? source.url : source);
}

function position(value) {
  if (!Array.isArray(value) || value.length < 2 || !value.every(Number.isFinite)
    || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) {
    throw new Error('Invalid longitude/latitude position');
  }
}

function coordinates(value, child, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum) throw new Error('Invalid coordinate array');
  value.forEach(child);
}

function line(value) {
  coordinates(value, position, 2);
}

function ring(value) {
  coordinates(value, position, 4);
  const first = value[0], last = value.at(-1);
  if (first.length !== last.length || first.some((n, i) => n !== last[i])) {
    throw new Error('Polygon rings must be closed');
  }
}

function polygon(value) {
  coordinates(value, ring, 1);
}

function validateGeometry(geometry, depth = 0) {
  if (geometry === null) return;
  if (!isObject(geometry) || depth > 64) throw new Error('Invalid or excessively nested geometry');
  if (geometry.type === 'GeometryCollection') {
    if (!Array.isArray(geometry.geometries)) throw new Error('Missing geometries array');
    geometry.geometries.forEach(child => {
      if (child === null) throw new Error('Null GeometryCollection member');
      validateGeometry(child, depth + 1);
    });
    return;
  }
  const validators = {
    Point: position,
    MultiPoint: value => coordinates(value, position),
    LineString: line,
    MultiLineString: value => coordinates(value, line),
    Polygon: polygon,
    MultiPolygon: value => coordinates(value, polygon)
  };
  if (!Object.hasOwn(validators, geometry.type)) throw new Error(`Unsupported geometry: ${geometry.type}`);
  // GeoJSON permits empty coordinates as an unlocated geometry. Keep its table entry.
  if (Array.isArray(geometry.coordinates) && geometry.coordinates.length === 0) return;
  validators[geometry.type](geometry.coordinates);
}

function asFeatures(geojson) {
  if (!isObject(geojson)) throw new Error('Missing GeoJSON object');
  const features = geojson.type === 'FeatureCollection' ? geojson.features
    : [geojson.type === 'Feature' ? geojson : { type: 'Feature', properties: {}, geometry: geojson }];
  if (!Array.isArray(features)) throw new Error('Missing features array');
  for (const feature of features) {
    if (!isObject(feature) || feature.type !== 'Feature'
      || !(feature.properties === null || isObject(feature.properties))) {
      throw new Error('Invalid GeoJSON Feature');
    }
    validateGeometry(feature.geometry);
  }
  return features;
}

export function hasGeometry(geometry) {
  if (!geometry) return false;
  if (geometry.type === 'GeometryCollection') return geometry.geometries.some(hasGeometry);
  return geometry.coordinates.length > 0;
}

export function drawableGeometry(geometry) {
  if (!hasGeometry(geometry)) return null;
  if (geometry.type !== 'GeometryCollection') return geometry;
  // Leaflet cannot draw empty collection members, although GeoJSON permits them.
  return { ...geometry, geometries: geometry.geometries.map(drawableGeometry).filter(Boolean) };
}

export function normalizeGeoMap(input) {
  if (!isObject(input) || !Array.isArray(input.layers)) throw new Error('GeoMap requires a layers array');
  const layers = [], features = [], errors = [], ids = new Set();
  input.layers.forEach((layer, layerIndex) => {
    try {
      if (!isObject(layer) || !['id', 'name', 'role'].every(key => typeof layer[key] === 'string' && layer[key].trim())) {
        throw new Error('Layer requires a nonempty id, name and role');
      }
      if (ids.has(layer.id)) throw new Error('Duplicate layer id');
      if (layer.source !== undefined && (!isObject(layer.source)
        || ['url', 'publisher', 'retrievedAt', 'originalFormat'].some(key => layer.source[key] !== undefined && typeof layer.source[key] !== 'string'))) {
        throw new Error('Invalid layer source metadata');
      }
      const entries = asFeatures(layer.geojson).map((feature, index) => {
        const p = feature.properties || {};
        return {
          id: `${layer.id}/${index}`, layerId: layer.id, layerName: layer.name, role: layer.role,
          feature,
          name: text(p.name) || `${layer.name} · ${index + 1}`,
          category: text(p.category, p.type) || layer.role,
          routeSection: text(p.routeSection, p.route_section),
          note: text(p.note, p.description, p.desc),
          sourceUrl: sourceUrl(p.source) || safeUrl(p.sourceUrl) || safeUrl(p.source_url) || sourceUrl(layer.source),
          point: feature.geometry?.type === 'Point' && hasGeometry(feature.geometry) ? feature.geometry.coordinates : null
        };
      });
      ids.add(layer.id);
      layers.push({ id: layer.id, name: layer.name, role: layer.role, features: entries });
      for (const entry of entries) features.push(entry);
    } catch (error) {
      errors.push(`Layer ${layerIndex + 1}: ${error.message}`);
    }
  });
  if (input.layers.length && !layers.length) throw new Error(errors.join('; '));
  return { layers, features, errors };
}
