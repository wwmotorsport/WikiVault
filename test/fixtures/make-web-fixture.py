import io, sys
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from libzim.writer import Creator, Item, StringProvider, Hint

def pdf(title, lines, meta=None):
    b = io.BytesIO(); c = canvas.Canvas(b, pagesize=letter)
    if meta: c.setTitle(meta)
    c.setFont('Helvetica-Bold', 18); c.drawString(72, 700, title)
    c.setFont('Helvetica', 11)
    for i, t in enumerate(lines): c.drawString(72, 670 - i * 14, t)
    c.showPage(); c.save(); return b.getvalue()

class It(Item):
    def __init__(self, path, title, mime, data): super().__init__(); self.p, self.t, self.m, self.d = path, title, mime, data
    def get_path(self): return self.p
    def get_title(self): return self.t
    def get_mimetype(self): return self.m
    def get_contentprovider(self): return StringProvider(self.d)
    def get_hints(self): return {Hint.FRONT_ARTICLE: self.m == 'text/html'}

index = b'<html><head><title>Field Medicine</title></head><body><h1>Field Medicine</h1><ul><li><a href="bandage.pdf">Bandaging and Splinting</a></li><li><a href="bandage.pdf">PDF</a></li></ul></body></html>'
out = sys.argv[1]
with Creator(out).config_indexing(False, 'eng') as cr:
    cr.set_mainpath('site.test/manuals/index.html')
    cr.add_item(It('site.test/manuals/index.html', 'Field Medicine', 'text/html', index))
    cr.add_item(It('site.test/manuals/bandage.pdf', 'site.test/manuals/bandage.pdf', 'application/pdf', pdf('Bandaging', ['Cover the wound with a clean dressing and bind it firmly,', 'but not so tightly that the fingers turn pale or cold.'])))
    cr.add_item(It('site.test/manuals/field-hygiene_2.pdf', 'site.test/manuals/field-hygiene_2.pdf', 'application/pdf', pdf('Hygiene', ['Dig the latrine at least two hundred feet from any water', 'and downhill from the camp.'], meta='Field Hygiene and Sanitation')))
    for k, v in {'Name': 'site.test_en_manuals', 'Title': 'Field Medicine', 'Creator': 'test', 'Publisher': 'test', 'Date': '2026-10-01', 'Description': 'A stand-in web copy', 'Language': 'eng'}.items(): cr.add_metadata(k, v)
