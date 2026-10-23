import sys, numpy as np
from PIL import Image
from calib import apply
def stitch(W,H,tiles,pack):
  full=Image.new('RGB',(W,H))
  for ty,f in enumerate(tiles):
    im=Image.open(f); h=min(700,H-ty*700); full.paste(im.crop((0,0,min(1300,W),h)),(0,ty*700))
  if pack:
    p=Image.open(pack); w=W-1300
    for k in range((H+699)//700):
      h=min(700,H-k*700); full.paste(p.crop((k*(w+4),0,k*(w+4)+w,h)),(1300,k*700))
  a=np.asarray(full); assert ((a[...,0]>220)&(a[...,1]<80)&(a[...,2]>220)).sum()<50, 'magenta'
  return full
def sig(a,gx=12,gy=22):
  H,W=a.shape[:2]; out=[]
  for j in range(gy):
    for i in range(gx):
      x0,x1=int(i*W/gx),int((i+1)*W/gx); y0,y1=int(j*H/gy),int((j+1)*H/gy)
      out.append(a[y0:y1:2,x0:x1:2].reshape(-1,3).mean(0))
  return np.array(out)
