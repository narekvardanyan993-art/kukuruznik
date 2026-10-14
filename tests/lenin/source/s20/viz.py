import sys, numpy as np
from PIL import Image
from pathlib import Path
B=Path(__file__).resolve().parents[1].parent
def comp(bl,bg,dx):
    a=bl[...,3:]/255; s=np.roll(bl,dx,axis=1); a=s[...,3:]/255
    return s[...,:3]*a+bg*(1-a)
def mag(bl):
    a=bl[...,3:]/255; return bl[...,:3]*a+np.array([255,0,255])*(1-a)
n=sys.argv[1]; box=tuple(map(int,sys.argv[2].split(','))); out=sys.argv[3]; z=float(sys.argv[4]) if len(sys.argv)>4 else 2
old=np.asarray(Image.open(B/'refs/s20/s19src'/f'{n}_building.webp').convert('RGBA')).astype(float)
new=np.asarray(Image.open(B/f'refs/s20/build/{n}_building.png').convert('RGBA')).astype(float)
bg=np.asarray(Image.open(B/'refs/s20/s19src'/f'{n}_bg.webp').convert('RGB')).astype(float)
ims=[mag(old),comp(old,bg,4),mag(new),comp(new,bg,4)]
x0,y0,x1,y1=box; w=int((x1-x0)*z); h=int((y1-y0)*z)
c=Image.new('RGB',(w*4,h))
for i,im in enumerate(ims): c.paste(Image.fromarray(np.clip(im,0,255).astype('uint8')).crop(box).resize((w,h),Image.LANCZOS),(i*w,0))
c.save(out,quality=90)
