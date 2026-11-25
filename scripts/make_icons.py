import sys, os
from PIL import Image
basket, out = sys.argv[1], sys.argv[2]
b = Image.open(basket).convert("RGBA")
BG = (227,238,213,255)  # #E3EED5
def icon(size, scale, bg=BG):
    c = Image.new("RGBA",(size,size),bg)
    s = int(size*scale); bb = b.resize((s,s), Image.LANCZOS)
    c.alpha_composite(bb, ((size-s)//2,(size-s)//2)); return c
os.makedirs(f"{out}/ios", exist_ok=True); os.makedirs(f"{out}/android", exist_ok=True)
# iOS: single 1024 opaque, no alpha
icon(1024,0.80).convert("RGB").save(f"{out}/ios/AppIcon-1024.png")
# Android legacy + round + adaptive foreground (108dp canvas, art within 66dp safe zone)
dens = {"mdpi":1,"hdpi":1.5,"xhdpi":2,"xxhdpi":3,"xxxhdpi":4}
for d,f in dens.items():
    p=f"{out}/android/mipmap-{d}"; os.makedirs(p,exist_ok=True)
    L=int(48*f); icon(L,0.80).save(f"{p}/ic_launcher.png")
    r=icon(L,0.72); m=Image.new("L",(L,L),0)
    from PIL import ImageDraw; ImageDraw.Draw(m).ellipse((0,0,L-1,L-1),fill=255)
    rr=Image.new("RGBA",(L,L),(0,0,0,0)); rr.paste(r,(0,0),m); rr.save(f"{p}/ic_launcher_round.png")
    F=int(108*f); icon(F,0.58,(0,0,0,0)).save(f"{p}/ic_launcher_foreground.png")
icon(512,0.80).convert("RGB").save(f"{out}/android/playstore-512.png")
print("ok")
