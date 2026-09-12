# GeoMap fences

Put a JSON object with a `layers` array inside a `geomap` Markdown code fence. Generate the page as usual:

```bash
npx pageleaf examples/geomap.md --open
```

See the [complete example](../examples/geomap.md) for points, routes, a boundary, and multiple maps.

Each layer requires nonempty `id`, `name`, and `role` strings and a `geojson` object. IDs must be unique within a map. GeoJSON may be a FeatureCollection, Feature, or raw geometry; all standard geometry types are supported. Optional layer `source` metadata accepts string fields `url`, `publisher`, `retrievedAt`, and `originalFormat`. GPX conversion must happen before rendering; source files are never downloaded or converted by Pageleaf.

The map uses [Leaflet 1.9.4](https://leafletjs.com/download.html) and OpenStreetMap tiles. It needs internet access for those assets. Pageleaf embeds its own map component in the HTML, so the generated file needs no adjacent scripts or backend. If Leaflet cannot load, the feature table and its links remain available. The document itself still needs the existing Markdown-it CDN dependency.

All layers start visible and can be toggled under **Layers**. Routes use different colors and line patterns. Point categories select a marker symbol where recognized; unknown categories use a generic marker. The initial view includes every visible geometry, with a maximum initial zoom of 15 for isolated points.

The table contains one row per Feature, including a named fallback for raw geometries. It opens by default for up to eight rows; larger tables start collapsed and offer a text filter. Optional columns appear when the data supplies them:

| Column | Property |
| --- | --- |
| Name | `name`, or layer name and feature number |
| Category / Type | `category`, then `type`, then layer role |
| Layer | Layer name; hidden layers retain their rows with a visible state label |
| Route section | `routeSection` or `route_section` |
| Details | `note`, `description`, or `desc` |
| 📍 | Google Maps link for Point coordinates only; other geometry cells stay empty |
| Source | Feature `source.url`, `source` URL string, `sourceUrl`, or `source_url`; falls back to layer `source.url` |

Select a name with the keyboard, or click a row, to reveal its layer, scroll to the map, focus the geometry, and open its popup. Selecting a map feature highlights it and its row without scrolling the page, expanding the table, or changing its filter. Hover highlights do not move the map. Google Maps and source links open a separate tab without selecting the row. Printed pages include expanded feature tables.

Invalid JSON displays a local error. Invalid layers are omitted while valid siblings remain visible. Empty collections and unlocated features are accepted. Coordinates must be finite longitude/latitude values; polygon rings must be closed. Technical details go to the browser console. Feature text is rendered as text, and source URLs accept only HTTP or HTTPS.

For development, `npm test` builds the template and tests normalization, the table, actual Leaflet interactions, failure handling, and the generated HTML. GeoMap modules live in `src/geomap/`; the build inlines their bundle and CSS into `dist/template.html`. Run `npm run build:template` after editing them to refresh the editable root `index.html` page's bundle.
