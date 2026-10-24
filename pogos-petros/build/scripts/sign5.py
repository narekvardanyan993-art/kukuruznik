import numpy as np, cv2
from PIL import Image
a=np.asarray(Image.open('frames/_rejected/F0_v1_sign.png').convert('RGB')).astype(np.float32)
H,W=a.shape[:2]
poly=np.array([(130,170),(128,118),(560,92),(760,56),(925,40),(930,104),(770,124),(560,152),(330,162)],np.int32)+np.array([250,1300])
reg=np.zeros((H,W),np.uint8); cv2.fillPoly(reg,[poly],1)
R,G,B=a[...,0],a[...,1],a[...,2]; L=a.mean(2)
lett=((R-B>22)&(L>110))|((L<95)&(reg>0))   # yellow letters + dark outlines inside the sign area
lett=lett&(reg>0)
n,lab,st,_=cv2.connectedComponentsWithStats(lett.astype(np.uint8),8)
m=np.zeros((H,W),np.uint8)
for i in range(1,n):
  if st[i,cv2.CC_STAT_AREA]>=5: m[lab==i]=1
m=cv2.dilate(m,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7)))&reg
print('mask',int(m.sum()))
out=a.copy()
ys,xs=np.nonzero(m)
for x in np.unique(xs):
  col=m[:,x]; idx=np.nonzero(col)[0]
  # runs
  runs=np.split(idx,np.nonzero(np.diff(idx)>1)[0]+1)
  for r in runs:
    t,b=r[0]-1,r[-1]+1
    top=np.median(a[max(t-3,0):t+1,x],0); bot=np.median(a[b:b+3,x],0)
    w=np.linspace(0,1,len(r)+2)[1:-1,None]
    out[r,x]=top*(1-w)+bot*w
out=out.astype(np.float32)
sm=cv2.GaussianBlur(out,(0,0),1.5); mm=cv2.GaussianBlur(m.astype(np.float32),(0,0),1.5)[...,None]
out=out*(1-mm)+sm*mm
rng=np.random.default_rng(3); grain=rng.normal(0,2.5,(H,W)).astype(np.float32)
out+=grain[...,None]*mm
# glow along sign centreline (from mask)
cx=[];cyv=[]
for b0 in range(xs.min(),xs.max(),20):
  s=(xs>=b0)&(xs<b0+20)
  if s.sum()>30: cx.append(b0+10); cyv.append(np.median(ys[s]))
coef=np.polyfit(cx,cyv,2); xx=np.arange(W); cy=np.polyval(coef,xx)
xa,xb=xs.min()-6,xs.max()+6
d=np.abs(np.arange(H)[:,None]-cy[None,:])
band=np.clip(1-(d-8)/12,0,1)*np.clip(np.minimum(xx-xa,xb-xx)/45,0,1)[None,:]
band=cv2.GaussianBlur((band*reg).astype(np.float32),(0,0),3)
warm=np.array([255,230,170],np.float32); al=(band*0.5)[...,None]
out=out*(1-al)+(out*0.3+warm*0.7)*al
img=Image.fromarray(np.clip(out,0,255).astype(np.uint8)); img.save('frames/F0.png')
img.crop((250,1300,1300,1560)).save('gemini/prev/F0_sign5.jpg',quality=92)
