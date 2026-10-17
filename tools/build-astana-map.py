"""Build the offline Astana basemap from a local OpenStreetMap extract.

Preparation only: uv run --with osmium==4.3.1 python tools/build-astana-map.py
--source kazakhstan.osm.pbf
--output PersonnelStatus/PersonalRecordFront/public/maps/astana
--source-date 2026-10-11T20:21:06Z.
The application consumes only the resulting local JSON; it needs no Python,
OSM server, geocoding service, map library or network connection.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

import osmium

ZOOM = 16
WORLD = 256 * 2 ** ZOOM
BOUNDS = {"west": 71.15, "south": 50.98, "east": 71.70, "north": 51.35}


def project(longitude, latitude):
    radians = math.radians(latitude)
    return (round((longitude + 180) / 360 * WORLD),
            round((1 - math.asinh(math.tan(radians)) / math.pi) / 2 * WORLD))


def feature_kind(tags):
    if tags.get("building") not in (None, "no"):
        return "building"
    highway = tags.get("highway")
    if highway in {"motorway", "motorway_link", "trunk", "trunk_link"}:
        return "trunk"
    if highway in {"primary", "primary_link"}:
        return "primary"
    if highway in {"secondary", "secondary_link", "tertiary", "tertiary_link"}:
        return "secondary"
    if highway in {"residential", "living_street", "unclassified", "service", "pedestrian"}:
        return "road"
    if highway in {"path", "footway", "cycleway", "steps", "track"}:
        return "path"
    if tags.get("natural") == "water" or tags.get("landuse") == "reservoir":
        return "water"
    if tags.get("waterway") in {"river", "canal", "stream"}:
        return "river"
    if tags.get("leisure") in {"park", "garden", "recreation_ground"} or tags.get("landuse") in {"forest", "grass", "recreation_ground", "meadow", "village_green", "cemetery"} or tags.get("natural") == "wood":
        return "green"
    if tags.get("railway") in {"rail", "light_rail", "tram"}:
        return "rail"
    return None


class Extractor(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.raw_nodes = {}
        self.used_nodes = {}
        self.coordinates = []
        self.features = []
        self.labels = []
        self.center = {"longitude": (BOUNDS["west"] + BOUNDS["east"]) / 2,
                       "latitude": (BOUNDS["south"] + BOUNDS["north"]) / 2}

    def node(self, node):
        if not node.location.valid():
            return
        lon, lat = node.location.lon, node.location.lat
        if not (BOUNDS["west"] <= lon <= BOUNDS["east"] and BOUNDS["south"] <= lat <= BOUNDS["north"]):
            return
        point = project(lon, lat)
        self.raw_nodes[node.id] = point
        place = node.tags.get("place")
        name = node.tags.get("name:ru") or node.tags.get("name")
        if name and place in {"city", "town", "suburb", "neighbourhood"}:
            self.labels.append({"x": point[0], "y": point[1], "name": str(name), "kind": place})
            if place == "city" and "астана" in name.lower():
                self.center = {"longitude": lon, "latitude": lat}

    def way(self, way):
        tags = dict(way.tags)
        kind = feature_kind(tags)
        if kind is None:
            return
        refs = [node.ref for node in way.nodes]
        closed = bool(refs) and refs[0] == refs[-1]
        if kind in {"building", "water", "green"}:
            if not closed or len(refs) < 4 or any(ref not in self.raw_nodes for ref in refs):
                return
            segments = [refs]
        else:
            segments, segment = [], []
            for ref in refs:
                if ref in self.raw_nodes:
                    segment.append(ref)
                else:
                    if len(segment) > 1:
                        segments.append(segment)
                    segment = []
            if len(segment) > 1:
                segments.append(segment)
        for segment in segments:
            indices, points = [], []
            for ref in segment:
                point = self.raw_nodes[ref]
                points.append(point)
                if ref not in self.used_nodes:
                    self.used_nodes[ref] = len(self.coordinates) // 2
                    self.coordinates.extend(point)
                indices.append(self.used_nodes[ref])
            self.features.append({"kind": kind, "name": str(tags.get("name:ru") or tags.get("name") or ""),
                                  "nodes": indices, "bounds": [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]})


def build(source, output, source_date=None):
    extractor = Extractor()
    extractor.apply_file(str(source))
    if not extractor.features:
        raise ValueError("The source contains no supported map geometry inside Astana bounds")
    output.mkdir(parents=True, exist_ok=True)
    geometry = {"coordinates": extractor.coordinates, "features": extractor.features, "labels": extractor.labels}
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    manifest = {"format": 1, "projectionZoom": ZOOM, "bounds": BOUNDS, "center": extractor.center,
                "source": "https://download.geofabrik.de/asia/kazakhstan.html", "sourceDate": source_date,
                "sourceSha256": digest.hexdigest(), "builtAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "attribution": "© OpenStreetMap contributors", "license": "ODbL 1.0",
                "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
                "featureCount": len(extractor.features), "nodeCount": len(extractor.coordinates) // 2,
                "featureKinds": dict(Counter(row["kind"] for row in extractor.features))}
    (output / "geometry.json").write_text(json.dumps(geometry, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    (output / "ATTRIBUTION.txt").write_text("Map data © OpenStreetMap contributors, licensed under ODbL 1.0.\nhttps://www.openstreetmap.org/copyright\nhttps://opendatacommons.org/licenses/odbl/1-0/\nExtract: https://download.geofabrik.de/asia/kazakhstan.html\nThe prepared Astana database is distributed under the same ODbL 1.0 license.\n", encoding="utf-8", newline="\n")
    print(json.dumps({"features": manifest["featureCount"], "nodes": manifest["nodeCount"], "kinds": manifest["featureKinds"], "bytes": (output / "geometry.json").stat().st_size}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-date")
    args = parser.parse_args()
    build(args.source, args.output, args.source_date)
