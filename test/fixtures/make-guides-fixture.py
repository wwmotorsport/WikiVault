import io, sys
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from libzim.writer import Creator, Item, StringProvider, Hint

def pdf1():
    b = io.BytesIO(); c = canvas.Canvas(b, pagesize=letter, pageCompression=1)
    for n in (1, 2):
        c.setFont('Helvetica', 9); c.drawString(72, 760, 'Field Water Notes'); c.drawRightString(540, 760, 'Page %d of 2' % n)
        if n == 1:
            c.setFont('Helvetica-Bold', 20); c.drawString(72, 700, 'Making a sand filter')
            c.setFont('Helvetica', 11)
            for i, t in enumerate(['A sand filter clears cloudy water before it is boiled. Fill a clean bucket with', 'layers of gravel, coarse sand and fine sand, and let the water drip through slowly.', 'Filtering does not kill germs: boil the water afterwards.']):
                c.drawString(72, 670 - i * 14, t)
            # the drawing: a bucket with three layers, and labels
            c.setLineWidth(1.5); c.rect(180, 420, 200, 180)
            for y in (480, 540): c.line(180, y, 380, y)
            for k in range(12): c.circle(195 + k * 16, 440, 5)
            c.setFont('Helvetica', 9); c.drawString(250, 565, 'fine sand'); c.drawString(245, 505, 'coarse sand'); c.drawString(262, 455, 'gravel')
            c.setFont('Helvetica', 10); c.drawString(72, 395, 'Fig. 1. The layers of a sand filter, finest at the top.')
        else:
            c.setFont('Helvetica-Bold', 14); c.drawString(72, 700, 'Boiling')
            c.setFont('Helvetica', 11)
            c.drawString(72, 676, 'Bring the filtered water to a rolling boil for one full minute, then let it cool')
            c.drawString(72, 662, 'in a covered pot. At high altitude boil it for three minutes.')
        c.showPage()
    c.save(); return b.getvalue()

def pdf2():
    b = io.BytesIO(); c = canvas.Canvas(b, pagesize=letter)
    c.setFont('Helvetica-Bold', 18); c.drawString(72, 700, 'Storing water')
    c.setFont('Helvetica', 11); c.drawString(72, 670, 'Keep one gallon of water for each person for each day, in clean covered containers'); c.drawString(72, 656, 'away from sunlight. Replace stored water every six months.')
    c.showPage(); c.save(); return b.getvalue()

class It(Item):
    def __init__(self, path, title, mime, data): super().__init__(); self.p, self.t, self.m, self.d = path, title, mime, data
    def get_path(self): return self.p
    def get_title(self): return self.t
    def get_mimetype(self): return self.m
    def get_contentprovider(self): return StringProvider(self.d)
    def get_hints(self): return {Hint.FRONT_ARTICLE: self.m == 'text/html'}

db = "var DATABASE = [\n{'_id': '00000', 'ti': 'Sand Filters and Boiling', 'dsc': 'Clearing and treating water in the field', 'aut': 'Field Water Notes', 'fp': ['Water (1).pdf']},\n{'_id': '00001', 'ti': 'Storing Water', 'dsc': 'How much to keep and how', 'aut': 'Field Water Notes', 'fp': ['Water (2).pdf']},\n];\n"
out = sys.argv[1]
with Creator(out).config_indexing(False, 'eng') as cr:
    cr.set_mainpath('home')
    cr.add_item(It('home', 'Water', 'text/html', b'<html><head><title>Water</title></head><body><h1>Water</h1><script src="database.js"></script></body></html>'))
    cr.add_item(It('database.js', 'database.js', 'text/javascript', db.encode()))
    cr.add_item(It('files/Water (1).pdf', 'files/Water (1).pdf', 'application/pdf', pdf1()))
    cr.add_item(It('files/Water (2).pdf', 'files/Water (2).pdf', 'application/pdf', pdf2()))
    for k, v in {'Name': 'zimgit-water_en', 'Title': 'Water', 'Creator': 'test', 'Publisher': 'test', 'Date': '2024-08-01', 'Description': 'A stand-in collection', 'Language': 'eng'}.items(): cr.add_metadata(k, v)
print('made', out)
