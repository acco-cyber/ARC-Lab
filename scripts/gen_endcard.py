#!/usr/bin/env python3
"""ARC Lab — end card PNG (1280x720) for the demo video."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
BG = (10, 14, 20)
GRID = (24, 31, 42)
WHITE = (240, 244, 248)
MUTED = (139, 152, 169)
SOFT = (215, 222, 232)
EMERALD = (52, 211, 153)
DIM = (107, 118, 134)
LOGO = [(255, 65, 54), (46, 204, 64), (255, 220, 0), (240, 18, 190)]

BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# faint grid backdrop
for x in range(0, W, 32):
    d.line([(x, 0), (x, H)], fill=GRID, width=1)
for y in range(0, H, 32):
    d.line([(0, y), (W, y)], fill=GRID, width=1)

# logo: 2x2 squares
sq, gap = 30, 8
lw, lh = sq * 2 + gap, sq * 2 + gap
lx, ly = (W - lw) // 2, 96
for i, c in enumerate(LOGO):
    ox = lx + (i % 2) * (sq + gap)
    oy = ly + (i // 2) * (sq + gap)
    d.rounded_rectangle([ox, oy, ox + sq, oy + sq], radius=6, fill=c)

def center(text, font, y, fill):
    tw = d.textlength(text, font=font)
    d.text(((W - tw) / 2, y), text, font=font, fill=fill)

f_title = ImageFont.truetype(BOLD, 88)
f_sub = ImageFont.truetype(REG, 21)
f_tag = ImageFont.truetype(BOLD, 30)
f_link = ImageFont.truetype(BOLD, 25)
f_small = ImageFont.truetype(REG, 18)

center("ARC Lab", f_title, ly + lh + 26, WHITE)
center("R E A S O N I N G   L A B O R A T O R Y", f_sub, ly + lh + 138, MUTED)
center("Solve it yourself. Build the rule.", f_tag, 392, SOFT)
center("Watch AI attempt the same puzzle.", f_tag, 436, SOFT)
center("github.com/acco-cyber/ARC-Lab", f_link, 536, EMERALD)
center("huggingface.co/spaces/koushikz1/ARC-Lab", f_link, 578, EMERALD)
center("Open source · MIT · 100 curriculum levels + 1,120 official ARC-AGI-2 tasks", f_small, 664, DIM)

img.save("/home/z/my-project/media-tmp/endcard.png")
print("endcard.png written")
