# GeoMap example

This illustrative dataset demonstrates places, routes, and a boundary. The route lines are examples, not navigation tracks.

Select a name in the table to focus the map. Map clicks stay on the map. Point rows also have a small Google Maps link.

```geomap
{
  "layers": [
    {
      "id": "places",
      "name": "Points of interest",
      "role": "poi",
      "source": { "url": "https://www.openstreetmap.org/" },
      "geojson": {
        "type": "FeatureCollection",
        "features": [
          {
            "type": "Feature",
            "properties": { "name": "Valldemossa", "category": "settlement", "routeSection": "Core", "note": "Village reference point." },
            "geometry": { "type": "Point", "coordinates": [2.62300, 39.71080] }
          },
          {
            "type": "Feature",
            "properties": { "name": "Illustrative viewpoint", "category": "viewpoint", "routeSection": "Detour" },
            "geometry": { "type": "Point", "coordinates": [2.641, 39.721] }
          }
        ]
      }
    },
    {
      "id": "route",
      "name": "Example route",
      "role": "route",
      "geojson": {
        "type": "Feature",
        "properties": { "name": "Illustrative route", "description": "One table entry for the entire line." },
        "geometry": { "type": "LineString", "coordinates": [[2.623, 39.7108], [2.632, 39.716], [2.647, 39.719]] }
      }
    },
    {
      "id": "detour",
      "name": "Example detour",
      "role": "route",
      "geojson": {
        "type": "Feature",
        "properties": { "name": "Illustrative detour", "route_section": "Detour" },
        "geometry": { "type": "MultiLineString", "coordinates": [[[2.632, 39.716], [2.641, 39.721]], [[2.641, 39.721], [2.647, 39.719]]] }
      }
    },
    {
      "id": "boundary",
      "name": "Example boundary",
      "role": "boundary",
      "geojson": {
        "type": "Feature",
        "properties": { "name": "Illustrative area" },
        "geometry": { "type": "Polygon", "coordinates": [[[2.629, 39.71], [2.648, 39.71], [2.648, 39.725], [2.629, 39.71]]] }
      }
    }
  ]
}
```

Multiple maps have independent layers and selection:

```geomap
{
  "layers": [
    {
      "id": "single-point",
      "name": "Single point",
      "role": "poi",
      "geojson": { "type": "Point", "coordinates": [2.62300, 39.71080] }
    }
  ]
}
```
