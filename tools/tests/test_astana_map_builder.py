import json
import subprocess
import sys
from pathlib import Path


def test_real_osm_geometry_is_bounded_and_keeps_roads_buildings_and_names(tmp_path):
    source = tmp_path / 'tiny.osm'
    source.write_text('''<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="ux-test">
<node id="1" lat="51.12" lon="71.42"/>
<node id="2" lat="51.12" lon="71.43"/>
<node id="3" lat="51.13" lon="71.43"/>
<node id="4" lat="51.13" lon="71.42"/>
<node id="5" lat="43.25" lon="76.95"/>
<node id="6" lat="43.26" lon="76.95"/>
<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="name" v="Тестовый проспект"/></way>
<way id="11"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="building" v="yes"/></way>
<way id="12"><nd ref="5"/><nd ref="6"/><tag k="highway" v="primary"/><tag k="name" v="Другой город"/></way>
</osm>''', encoding='utf-8')
    output = tmp_path / 'map'
    script = Path(__file__).resolve().parents[1] / 'build-astana-map.py'
    result = subprocess.run([sys.executable, str(script), '--source', str(source), '--output', str(output)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    manifest = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
    data = json.loads((output / 'geometry.json').read_text(encoding='utf-8'))
    assert manifest['projectionZoom'] == 16
    assert manifest['featureCount'] == 2
    assert 'OpenStreetMap' in manifest['attribution']
    assert len(data['coordinates']) == 8
    kinds = {row['kind'] for row in data['features']}
    assert kinds == {'primary', 'building'}
    assert [row['name'] for row in data['features'] if row['kind'] == 'primary'] == ['Тестовый проспект']
    road = next(row for row in data['features'] if row['kind'] == 'primary')
    west, east = road['nodes']
    assert data['coordinates'][west * 2] < data['coordinates'][east * 2]
    assert data['coordinates'][west * 2 + 1] == data['coordinates'][east * 2 + 1]
