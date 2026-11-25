import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
W, H = im.size
names = {(0,0):"cabbage",(1,0):"shrimp",(0,1):"pork_belly",(1,1):"basket"}
for (cx,cy),n in names.items():
    q = im.crop((cx*W//2, cy*H//2, (cx+1)*W//2, (cy+1)*H//2))
    a = q.split()[3].point(lambda v: 255 if v>8 else 0)
    bb = a.getbbox(); q = q.crop(bb)
    s = max(q.size); pad = int(s*0.06); S = s+2*pad
    c = Image.new("RGBA",(S,S),(0,0,0,0)); c.paste(q,((S-q.size[0])//2,(S-q.size[1])//2),q)
    c = c.resize((512,512), Image.LANCZOS)
    c.save(f"{out}/{n}.png", optimize=True); c.save(f"{out}/{n}.webp", quality=90, method=6)
    print(n, bb, c.getpixel((2,2)))
