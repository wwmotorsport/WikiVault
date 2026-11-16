"""Builds the tiny Wikipedia-shaped .zim files used by the tests.
Usage: python3 scripts/make-test-zim.py OUT.zim [extra]
Needs: pip install libzim
"""
import sys
from libzim.writer import Creator, Item, StringProvider, Hint

class Art(Item):
    def __init__(self, path, title, html):
        super().__init__(); self._p=path; self._t=title; self._h=html
    def get_path(self): return self._p
    def get_title(self): return self._t
    def get_mimetype(self): return "text/html"
    def get_contentprovider(self): return StringProvider(self._h)
    def get_hints(self): return {Hint.FRONT_ARTICLE: True}

def page(title, lead, sections):
    body = f'<h1 id="firstHeading">{title}</h1><div id="mw-content-text"><table class="infobox"><tr><th>Type</th><td>Test article</td></tr></table><p>{lead}<sup class="reference"><a href="#cite1">[1]</a></sup></p>'
    for h, paras in sections:
        hid = h.replace(' ', '_')
        body += f'<details data-level="2" open><summary class="section-heading"><h2 id="{hid}">{h}</h2></summary>'
        for p in paras: body += f'<p>{p}</p>'
        body += '</details>'
    body += '<details data-level="2" open><summary class="section-heading"><h2 id="References">References</h2></summary><ol class="references"><li id="cite1">Some citation text that should be ignored.</li></ol></details>'
    body += '<p><a href="https://example.org/outside">External site</a> and <a href="Photosynthesis">internal link</a></p></div>'
    return f'<!DOCTYPE html><html><head><meta charset="utf-8"><title>{title}</title><style>.x{{color:red}}</style></head><body>{body}<script>var a=1;</script></body></html>'

arts = {
 "Apollo_11": ("Apollo 11", "Apollo 11 was the American spaceflight that first landed humans on the Moon. Commander Neil Armstrong and lunar module pilot Buzz Aldrin landed the Apollo Lunar Module Eagle on July 20, 1969.", [
   ("Mission", ["Apollo 11 was launched by a Saturn V rocket from Kennedy Space Center on Merritt Island, Florida, on July 16, 1969.", "Michael Collins flew the command module Columbia alone in lunar orbit while Armstrong and Aldrin were on the Moon's surface."]),
   ("Legacy", ["Armstrong's first step onto the lunar surface was broadcast on live TV to a worldwide audience.", "The mission fulfilled a national goal proposed in 1961 by President John F. Kennedy."])]),
 "Saturn_V": ("Saturn V", "The Saturn V is a retired American super heavy-lift launch vehicle developed by NASA under the Apollo program for human exploration of the Moon.", [
   ("Design", ["The rocket was human-rated, had three stages, and was powered by liquid fuel.", "The first stage used five F-1 engines burning RP-1 and liquid oxygen."]),
   ("History", ["The Saturn V was launched 13 times from Kennedy Space Center with no loss of crew or payload."])]),
 "Photosynthesis": ("Photosynthesis", "Photosynthesis is a system of biological processes by which photosynthetic organisms, such as most plants, algae, and cyanobacteria, convert light energy, typically from sunlight, into the chemical energy necessary to fuel their metabolism.", [
   ("Overview", ["Most photosynthetic organisms are photoautotrophs, which means that they are able to synthesize food directly from carbon dioxide and water using energy from light.", "Chlorophyll absorbs light mostly in the blue and red portions of the spectrum."]),
   ("Efficiency", ["Plants usually convert light into chemical energy with a photosynthetic efficiency of 3 to 6 percent."])]),
 "Neil_Armstrong": ("Neil Armstrong", "Neil Alden Armstrong (August 5, 1930 – August 25, 2012) was an American astronaut and aeronautical engineer who in 1969 became the first person to walk on the Moon.", [
   ("Early life", ["Armstrong was born near Wapakoneta, Ohio.", "He studied aeronautical engineering at Purdue University."]),
   ("Apollo program", ["Armstrong served as commander of Apollo 11, the first crewed Moon landing mission."])]),
 "Moon": ("Moon", "The Moon is Earth's only natural satellite. It orbits at an average distance of 384,400 km, about 30 times the diameter of Earth.", [
   ("Exploration", ["The first human-made object to reach the Moon was the Soviet Union's Luna 2 uncrewed spacecraft in 1959.", "The United States' Apollo 11 mission made the first crewed landing in 1969."])]),
}
if len(sys.argv) > 2:
    arts["Buzz_Aldrin"] = ("Buzz Aldrin", "Buzz Aldrin is an American former astronaut, engineer and fighter pilot. As the Lunar Module Eagle pilot on the 1969 Apollo 11 mission, he was the second person to walk on the Moon.", [
        ("Career", ["Aldrin made three spacewalks as pilot of the 1966 Gemini 12 mission.", "He earned a doctorate in astronautics from the Massachusetts Institute of Technology."])])
out = sys.argv[1]
with Creator(out).config_indexing(True, "eng") as c:
    c.set_mainpath("Main_Page")
    for k,(t,lead,secs) in arts.items():
        c.add_item(Art(k, t, page(t, lead, secs)))
    links = ''.join(f'<li><a href="{k}">{v[0]}</a></li>' for k,v in arts.items())
    c.add_item(Art("Main_Page", "Main Page", f'<html><head><title>Main Page</title></head><body><h1>Test wiki</h1><ul>{links}</ul></body></html>'))
    for name, val in {"Title":"Test Wikipedia","Language":"eng","Name":"wikipedia_en_all","Flavour":"maxi","Creator":"test","Publisher":"test","Date":"2026-10-01","Description":"Test"}.items():
        c.add_metadata(name, val)
print("ok")
