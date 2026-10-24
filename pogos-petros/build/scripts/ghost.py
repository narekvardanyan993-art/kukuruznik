import numpy as np, cv2
from pathlib import Path
from PIL import Image
R=Path.home()/'mnt/chka.am/pogos-petros'; B=R/'build/frames'
F0=np.asarray(Image.open(R/'frames/F0.png').convert('RGB')).astype(np.float32); H,W=F0.shape[:2]   # 2731x1536
A=np.asarray(Image.open(R/'frames/A.png').convert('RGB')).astype(np.float32)
am=np.asarray(Image.open(B/'pogos_a_building.webp'))[...,3].astype(np.float32)/255
am=cv2.resize(am,(W,H),interpolation=cv2.INTER_LINEAR)
am[int(0.778*H):]=0
am[int(0.70*H):,int(0.585*W):]=0   # ruined wall in front of the church is not the church
fm=np.asarray(Image.open(B/'pogos_f_building.webp'))[...,3].astype(np.float32)/255
fm=cv2.resize(fm,(W,H),interpolation=cv2.INTER_LINEAR)
def bbox(m):
  ys,xs=np.nonzero(m>0.5); return xs.min(),ys.min(),xs.max(),ys.max()
ax0,ay0,ax1,ay1=bbox(am); fx0,fy0,fx1,fy1=bbox(fm)
print('church bbox',ax0,ay0,ax1,ay1,'cinema bbox',fx0,fy0,fx1,fy1)
# scale: church height = 1.3 x cinema height (church with belfry was taller than the cinema block)
s=1340/(ay1-ay0)
crop=lambda a: a[ay0:ay1+1,ax0:ax1+1]
ch=cv2.resize(crop(A),None,fx=s,fy=s,interpolation=cv2.INTER_AREA)
cm=cv2.resize(crop(am),None,fx=s,fy=s,interpolation=cv2.INTER_AREA)
h,w=cm.shape
cx=W//2; bx=int(cx-(0.61*W-ax0)*s); by=int(0.77*H-h)   # belfry over the middle of the cinema, church base on the colonnade base line            # base of church on the cinema's base line, centred on the facade
L=ch.mean(-1)/255
line=np.array([120,150,205],np.float32); pale=np.array([236,242,255],np.float32)
gcol=line*(1-L[...,None])**0.8*0+0  # placeholder
gcol=pale*L[...,None]+line*(1-L[...,None])
ga=cm*(0.30+0.40*(1-L))
G=np.zeros((H,W,4),np.float32)
y0,x0=max(by,0),max(bx,0); y1,x1=min(by+h,H),min(bx+w,W)
G[y0:y1,x0:x1,:3]=gcol[y0-by:y1-by,x0-bx:x1-bx]; G[y0:y1,x0:x1,3]=ga[y0-by:y1-by,x0-bx:x1-bx]
# soft halo around the silhouette
sil=np.zeros((H,W),np.float32); sil[y0:y1,x0:x1]=cm[y0-by:y1-by,x0-bx:x1-bx]
halo=cv2.GaussianBlur(sil,(0,0),14)*0.22*(1-sil)
G[...,:3]=np.where(halo[...,None]>G[...,3:4],pale,G[...,:3]); G[...,3]=np.maximum(G[...,3],halo)
out=F0*(1-G[...,3:4])+G[...,:3]*G[...,3:4]
Image.fromarray(np.clip(G*np.array([1,1,1,255],np.float32),0,255).astype(np.uint8),'RGBA').save(R/'frames/F_ghost.png')
Image.fromarray(np.clip(out,0,255).astype(np.uint8)).save(R/'frames/F.png')
Image.fromarray(np.clip(out,0,255).astype(np.uint8)).resize((512,910)).save(R/'gemini/prev/F_ghost_prev.jpg',quality=88)
print('scale',round(s,3),'placed at',bx,by,w,h)
