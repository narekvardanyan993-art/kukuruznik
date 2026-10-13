import numpy as np, cv2, json
from PIL import Image
from scipy import ndimage
import win4
WARM=np.array([255,204,138.])
def transfer(night,day_old,day_new,changed):
    r=(day_new.astype(np.float32)+6)/(day_old.astype(np.float32)+6)
    r=np.clip(r,0.25,1.35)**0.65
    m=np.clip(cv2.GaussianBlur(changed.astype(np.float32),(0,0),0.6)*1.5,0,1)[...,None]
    return night*(1-m)+night*r*m
def paint_windows(n,night,day,lbl,seed=16,frac=0.42,env=None):
    H,W=day.shape[:2]; rng=np.random.default_rng(seed)
    lab=cv2.cvtColor(day,cv2.COLOR_RGB2LAB).astype(np.float32); L=lab[...,0]
    Lb=cv2.GaussianBlur(L,(0,0),1.1)
    ref=cv2.GaussianBlur(cv2.dilate(Lb,np.ones((11,11))),(0,0),3)
    k=lbl.max(); out=night.astype(np.float32).copy()
    litmask=np.zeros((H,W),np.float32); spill=np.zeros((H,W),np.float32)
    objs=ndimage.find_objects(lbl)
    nlit=0
    for i,sl in enumerate(objs,1):
        if sl is None or rng.random()>frac: continue
        nlit+=1
        b=0.55+0.45*rng.random()
        if rng.random()<0.2: b*=0.6           # за шторой
        tint=WARM*np.array([1,0.97+0.06*rng.random(),0.9+0.2*rng.random()])
        y0,y1=sl[0].start,sl[0].stop; x0,x1=sl[1].start,sl[1].stop
        yy0,yy1,xx0,xx1=max(0,y0-1),min(H,y1+1),max(0,x0-1),min(W,x1+1)
        win=lbl[yy0:yy1,xx0:xx1]==i
        Lw=L[yy0:yy1,xx0:xx1]
        mull=np.clip((Lw-30)/110,0,1)                 # тёмный штрих (переплёт) остаётся темнее
        edge=win&~ndimage.binary_erosion(win)
        a=win*np.where(edge,0.7,0.95)
        col=tint*b*(0.62+0.38*mull[...,None])
        sub=out[yy0:yy1,xx0:xx1]
        out[yy0:yy1,xx0:xx1]=sub*(1-a[...,None])+col*a[...,None]
        litmask[yy0:yy1,xx0:xx1]=np.maximum(litmask[yy0:yy1,xx0:xx1],win*b)
    # faint glow on the wall below and around lit windows
    g1=cv2.GaussianBlur(litmask,(0,0),1.1)
    g1=cv2.warpAffine(g1,np.float32([[1,0,0],[0,1,2.0]]),(W,H))
    glow=np.clip(0.22*g1,0,0.22)*(litmask<0.05)
    if env is not None: glow*=(env[...,0]<0.3)
    out=out+glow[...,None]*WARM*0.55*(0.4+0.6*out/255.0)
    return np.clip(out,0,255),litmask,nlit
def statue_mask(day,alpha):
    hsv=cv2.cvtColor(day,cv2.COLOR_RGB2HSV).astype(int); h,s=hsv[...,0],hsv[...,1]
    pink=((h<=12)|(h>=165))&(s>=38)
    a=alpha.astype(np.float32)/255
    st=(a>0.5)&~pink
    ys=np.where((a>0.5).any(1))[0]; top=ys.min()
    st=cv2.morphologyEx(st.astype(np.uint8),cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
    nn,lab,stt,_=cv2.connectedComponentsWithStats(st)
    cand=[i for i in range(1,nn) if stt[i][1]<=top+6 and stt[i][4]>150]
    m=np.isin(lab,cand)
    m=cv2.morphologyEx(m.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((7,7),np.uint8)).astype(bool)&(a>0.5)
    ys=np.where(m.any(1))[0]
    return m,a,ys.min(),ys.max()
def light_statue(night,day,alpha,lamp_side=0.0,k=1.0,moon_side=1.0):
    """natural light: cool moon base + warm lamp light from below (side-biased) + faint cool rim on the moon side"""
    m,a,y0,y1=statue_mask(day,alpha)
    H,W=m.shape
    inner=cv2.erode(m.astype(np.uint8),np.ones((3,3),np.uint8)).astype(np.float32)
    wgt=np.maximum(cv2.GaussianBlur(inner,(0,0),0.8),inner)*m
    lumd=cv2.cvtColor(day,cv2.COLOR_RGB2GRAY).astype(np.float32)
    wgt*=np.clip((215-lumd)/40,0,1)
    xs=np.where(m.any(0))[0]; x0,x1=xs.min(),xs.max(); cx=(x0+x1)/2; hw=max(1,(x1-x0)/2)
    yy=(np.arange(H)[:,None]-y0)/max(1,(y1-y0))
    xx=(np.arange(W)[None,:]-cx)/hw
    up=np.clip(yy,0,1)**1.6                      # feet brighter, soft
    side=np.clip(0.75+0.35*lamp_side*xx,0.4,1.1) # lamp on one side
    d=day.astype(np.float32); g=d.mean(-1,keepdims=True); d=g+(d-g)*0.65
    cool=np.array([0.46,0.51,0.66]); warm=np.array([1.0,0.78,0.52])
    lit=d*(cool*0.47+warm*((0.16+0.44*up)*side*k)[...,None])
    # moon rim: inside silhouette, 1-3 px from the edge facing the moon
    dist=ndimage.distance_transform_edt(m)
    gx=cv2.Sobel(m.astype(np.float32),cv2.CV_32F,1,0,ksize=5); gy=cv2.Sobel(m.astype(np.float32),cv2.CV_32F,0,1,ksize=5)
    nx=-gx/np.maximum(np.hypot(gx,gy),1e-3); ny=-gy/np.maximum(np.hypot(gx,gy),1e-3)
    nx=cv2.GaussianBlur(nx,(0,0),2); ny=cv2.GaussianBlur(ny,(0,0),2)
    facing=np.clip(nx*moon_side*0.8-ny*0.6,0,1)
    rim=np.exp(-((dist-2.2)/1.3)**2)*facing*(dist>1)
    lit=lit+rim[...,None]*np.array([150,168,205.])*0.22*(lumd[...,None]/255+0.3)
    out=night*(1-wgt[...,None])+lit*wgt[...,None]
    rimout=rim*(1-wgt)*0  # edge band left as night (no outline)
    # warm pool on pedestal top under the feet
    ped=(a>0.6)&~m
    yy2=np.arange(H)[:,None]-y1
    pool=np.exp(-np.clip(yy2,0,None)/28.0)*(yy2>-2)*ped
    xs2=np.where(m[max(0,y1-5):y1].any(0))[0]
    if len(xs2):
        c2,h2=(xs2.min()+xs2.max())/2,(xs2.max()-xs2.min())/2+20
        pool=pool*np.exp(-((np.arange(W)[None,:]-c2)/h2)**4)
    pool=cv2.GaussianBlur(pool.astype(np.float32),(0,0),3)*0.4*k
    out=out*(1+pool[...,None]*(warm-0.35))
    return np.clip(out,0,255),m
def silhouettes(night,pts,hfun,seed=3):
    """tiny dark people in lamp light: pts (x,y feet)"""
    H,W=night.shape[:2]; SS=4
    big=np.zeros((H*SS,W*SS),np.uint8); rng=np.random.default_rng(seed)
    for x,y in pts:
        h=hfun(y)*0.42; w=h*0.28
        X,Y=x*SS,y*SS
        body=np.array([[X-w*SS/2,Y],[X-w*SS*0.42,Y-h*SS*0.78],[X+w*SS*0.42,Y-h*SS*0.78],[X+w*SS/2,Y]],np.int32)
        cv2.fillPoly(big,[body],255,cv2.LINE_AA)
        cv2.circle(big,(int(X),int(Y-h*SS*0.88)),max(1,int(w*SS*0.36)),255,-1,cv2.LINE_AA)
    a=cv2.resize(big.astype(np.float32)/255,(W,H),interpolation=cv2.INTER_AREA)
    a=np.clip(a*0.85,0,1)[...,None]
    return night*(1-a)+np.array([24,24,32.])*a, a[...,0]
