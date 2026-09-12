export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function externalLink(url, label) {
  const link = element('a', '', label);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  // Links are independent actions inside an otherwise selectable row.
  link.addEventListener('click', event => event.stopPropagation());
  return link;
}

export function popupContent(feature) {
  const content = element('div', 'geomap-popup');
  content.append(element('strong', '', feature.name));
  for (const [label, value] of [['Category', feature.category], ['Layer', feature.layerName], ['Route section', feature.routeSection]]) {
    if (value) content.append(element('div', '', `${label}: ${value}`));
  }
  if (feature.note) content.append(element('p', '', feature.note));
  if (feature.sourceUrl) content.append(externalLink(feature.sourceUrl, 'Source ↗'));
  return content;
}
