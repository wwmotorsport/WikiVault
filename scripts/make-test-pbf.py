#!/usr/bin/env python3
"""Writes the small OpenStreetMap extracts the tests read (test/fixtures/*.osm.pbf).

The data is made up. Needs pyosmium (pip install osmium). The files are kept in the repository, so this is
only run when the fixtures are to be changed.

  east-a.osm.pbf   written the usual way: dense nodes, compressed blocks
  east-b.osm.pbf   nodes written one by one and blocks left uncompressed, which the format also allows
"""
import os, sys
import osmium
from osmium.osm.mutable import Node, Way, Relation

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'test', 'fixtures')
os.makedirs(out, exist_ok=True)

def write(name, options, nodes, ways, relations):
    path = os.path.join(out, name)
    if os.path.exists(path): os.remove(path)
    w = osmium.SimpleWriter(osmium.io.File(path, options))
    for i, lon, lat, tags in nodes: w.add_node(Node(id=i, location=(lon, lat), tags=tags))
    for i, refs, tags in ways: w.add_way(Way(id=i, nodes=refs, tags=tags))
    for i, members, tags in relations: w.add_relation(Relation(id=i, members=members, tags=tags))
    w.close()
    print(name, os.path.getsize(path), 'bytes')

# Around 35.2 north, 80.8 west. Ids are large on purpose: today's are past 2^32.
B = 13_000_000_000
a_nodes = [
    (B + 1, -80.8000, 35.2000, {'amenity': 'hospital', 'name': 'Mercy General', 'emergency': 'yes', 'beds': '185', 'addr:housenumber': '2001', 'addr:street': 'Vale Avenue', 'addr:city': 'Riverton', 'addr:state': 'NC', 'addr:postcode': '28207', 'phone': '+1 555 0100'}),
    (B + 2, -80.8100, 35.2100, {'shop': 'bakery', 'name': 'Not a kind that is kept'}),
    (B + 3, -80.8400, 35.2200, {'place': 'city', 'name': 'Riverton', 'population': '874579', 'name:el': 'Ρίβερτον'}),
    (B + 4, -100.0000, 35.0000, {'amenity': 'pharmacy', 'name': 'Outside the region'}),
    # the corners of a fuel station
    (B + 10, -80.9000, 35.3000, {}), (B + 11, -80.8990, 35.3000, {}), (B + 12, -80.8990, 35.3010, {}), (B + 13, -80.9000, 35.3010, {}),
    # the corners of a hospital site that is a relation of two ways
    (B + 20, -80.7000, 35.1000, {}), (B + 21, -80.6980, 35.1000, {}), (B + 22, -80.6980, 35.1020, {}), (B + 23, -80.7000, 35.1020, {}),
    (B + 24, -80.6995, 35.1005, {}), (B + 25, -80.6985, 35.1005, {}), (B + 26, -80.6985, 35.1015, {}),
    (B + 30, -80.5000, 35.4000, {'amenity': 'drinking_water'}),
]
# plain nodes, so that the file has more than one block's worth of the usual kind
a_nodes += [(B + 1000 + i, -81.0 + i * 0.0001, 35.5 + (i % 50) * 0.0001, {}) for i in range(9000)]
a_ways = [
    (B + 100, [B + 10, B + 11, B + 12, B + 13, B + 10], {'amenity': 'fuel', 'name': 'Corner Fuel', 'brand': 'Avia', 'fuel:diesel': 'yes', 'opening_hours': '24/7'}),
    (B + 101, [B + 20, B + 21, B + 22, B + 23, B + 20], {}),   # outer ring of the hospital site
    (B + 102, [B + 24, B + 25, B + 26, B + 24], {}),           # inner ring
    (B + 103, [B + 1000, B + 1001, B + 1002], {'highway': 'residential', 'name': 'A street, not a place'}),
    (B + 104, [B + 900001, B + 900002, B + 900003], {'power': 'substation', 'name': 'Its nodes are in the next extract'}),
]
a_relations = [
    (B + 200, [('w', B + 101, 'outer'), ('w', B + 102, 'inner')], {'type': 'multipolygon', 'amenity': 'hospital', 'name': 'County Hospital'}),
    (B + 201, [('w', B + 103, '')], {'type': 'route', 'route': 'bus', 'name': 'Not a place'}),
]
write('east-a.osm.pbf', 'pbf', a_nodes, a_ways, a_relations)

# Around 31 north, 89 west, with one node the two extracts share (they overlap at their edges).
b_nodes = [
    (B + 1, -80.8000, 35.2000, {'amenity': 'hospital', 'name': 'Mercy General', 'emergency': 'yes', 'beds': '185'}),
    (B + 500, -89.0000, 31.0000, {'amenity': 'hospital', 'name': 'Far Away General'}),
    (B + 501, -89.1000, 31.1000, {'amenity': 'pharmacy', 'name': 'Far Away Pharmacy'}),
    (B + 510, -89.2000, 31.2000, {}), (B + 511, -89.1990, 31.2000, {}), (B + 512, -89.1990, 31.2010, {}),
]
b_ways = [(B + 600, [B + 510, B + 511, B + 512, B + 510], {'man_made': 'water_tower', 'name': 'Far Away Tower'})]
write('east-b.osm.pbf', 'pbf,pbf_dense_nodes=false,pbf_compression=none', b_nodes, b_ways, [])
