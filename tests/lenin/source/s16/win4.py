import numpy as np, cv2, sys
from PIL import Image
from scipy import ndimage
S='/mnt/user-data/uploads/chka.am/tests/lenin/frames/'
def detect(n, excl=(), dl=58, wallmin=0.08):
    d=np.asarray(Image.open(S+n+'.webp').convert('RGB'))
    env=np.asarray(Image.open(S+n+'_env.webp').convert('RGB')).astype(np.float32)/255
    bld=np.asarray(Image.open(S+n+'_building.webp'))[...,3]>20
    lab=cv2.cvtColor(d,cv2.COLOR_RGB2LAB).astype(np.float32)
    L,a,b=lab[...,0],lab[...,1]-128,lab[...,2]-128
    H,W=L.shape
    wall=(a>6)&(b>4)&(L>150)
    wallf=cv2.blur(wall.astype(np.float32),(15,15))
    Lb=cv2.GaussianBlur(L,(0,0),1.1)
    ref=cv2.GaussianBlur(cv2.dilate(Lb,np.ones((11,11))),(0,0),3)
    wl=cv2.blur(np.where(wall,L,0),(25,25))/np.maximum(cv2.blur(wall.astype(np.float32),(25,25)),1e-3)
    ref=np.where(cv2.blur(wall.astype(np.float32),(25,25))>0.05, np.minimum(ref,wl+10), ref)
    glass=(Lb<ref-dl)&(Lb>35)&(wallf>wallmin)&(env.max(2)<0.3)&~ndimage.binary_dilation(bld,iterations=3)
    for (x0,y0,x1,y1) in excl: glass[y0:y1,x0:x1]=False
    lab_,k=ndimage.label(glass)
    objs=ndimage.find_objects(lab_)
    cand=[]
    for i,sl in enumerate(objs,1):
        if sl is None: continue
        h=sl[0].stop-sl[0].start; w=sl[1].stop-sl[1].start
        if h<3 or w<2 or h>26 or w>18: continue
        m=lab_[sl]==i; area=int(m.sum())
        if area<5 or area>300: continue
        if not (0.2<=w/h<=2.4): continue
        mf=ndimage.binary_fill_holes(ndimage.binary_closing(np.pad(m,2),iterations=1))[2:-2,2:-2]
        af=mf.sum()
        if af/(w*h)<0.6: continue
        hull=cv2.convexHull(np.argwhere(mf)[:,::-1].astype(np.int32)); ha=max(cv2.contourArea(hull),1)
        if af/ (ha+ 0.5*cv2.arcLength(hull,True)+1) <0.7: continue
        cand.append((i,sl,w,h,area))
    keep=[]
    for i,(li,sl,w,h,a_) in enumerate(cand):
        y=sl[0].start;x=sl[1].start; ok=False
        for j,(lj,sl2,w2,h2,a2) in enumerate(cand):
            if i==j: continue
            y2=sl2[0].start;x2=sl2[1].start
            if abs(h-h2)<=max(3,0.45*h) and abs(w-w2)<=max(3,0.6*w):
                if abs((y+h/2)-(y2+h2/2))<=max(5,0.7*h) and abs(x-x2)<=8*max(w,4): ok=True;break
                if abs(x-x2)<=4 and abs(y-y2)<=4*h: ok=True;break
        if ok: keep.append((li,sl,w,h,a_))
    lbl=np.zeros((H,W),np.int32); wins=[]
    for k_,(li,sl,w,h,a_) in enumerate(keep,1):
        m=lab_[sl]==li; m=ndimage.binary_fill_holes(ndimage.binary_closing(np.pad(m,2),iterations=1))[2:-2,2:-2]; lbl[sl][m&(lbl[sl]==0)]=k_; wins.append([int(sl[1].start),int(sl[0].start),int(w),int(h),a_])
    return d,lbl,wins
if __name__=='__main__':
    n=sys.argv[1]
    d,lbl,w=detect(n)
    o=d.astype(float).copy(); o[lbl>0]=[0,220,255]
    Image.fromarray(o.astype(np.uint8)).save('win/'+n+'_ov4.png'); print(n,len(w))
