import numpy as np, cv2
from collections import deque
from PIL import Image
SS=4
INK=np.array([66,60,56.])
def sk_path(sk,a,b):
    ys,xs=np.nonzero(sk); pts=np.stack([xs,ys],1)
    def snap(p): i=np.argmin(((pts-np.array(p))**2).sum(1)); return tuple(pts[i])
    s,t=snap(a),snap(b); H,W=sk.shape
    prev={s:None}; q=deque([s])
    while q:
        c=q.popleft()
        if c==t: break
        x,y=c
        for dx in(-1,0,1):
            for dy in(-1,0,1):
                n=(x+dx,y+dy)
                if 0<=n[0]<W and 0<=n[1]<H and sk[n[1],n[0]] and n not in prev:
                    prev[n]=c; q.append(n)
    if t not in prev: return None
    p=[];c=t
    while c is not None: p.append(c); c=prev[c]
    return np.array(p[::-1],float)
def resample(p,step):
    d=np.r_[0,np.cumsum(np.hypot(*np.diff(p,axis=0).T))]
    s=np.arange(0,d[-1],step)
    return np.stack([np.interp(s,d,p[:,0]),np.interp(s,d,p[:,1])],1),d[-1]
def smooth(p,k=15):
    if len(p)<k: return p
    ker=np.ones(k)/k; pad=k//2
    x=np.convolve(np.r_[[p[0,0]]*pad,p[:,0],[p[-1,0]]*pad],ker,'valid')
    y=np.convolve(np.r_[[p[0,1]]*pad,p[:,1],[p[-1,1]]*pad],ker,'valid')
    return np.stack([x,y],1)
def wire_layer(H,W,paths,hfun,sep=0.07,sag=0.07,span=2.6):
    """paths: list of ground polylines. returns alpha (H,W) of wires drawn above ground by hfun(y)"""
    big=np.zeros((H*SS,W*SS),np.uint8)
    for p in paths:
        p=smooth(p,21); p,Ltot=resample(p,1.0)
        h=hfun(p[:,1])
        # tangent
        tg=np.gradient(p,axis=0); tg/=np.maximum(np.linalg.norm(tg,axis=1,keepdims=True),1e-6)
        nrm=np.stack([-tg[:,1],tg[:,0]],1)
        # supports spacing ~ span*h
        s=np.r_[0,np.cumsum(np.hypot(*np.diff(p,axis=0).T))]
        sp=span*h.mean(); phase=(s%sp)/sp
        sagpx=sag*h*4*phase*(1-phase)
        for side in (-1,1):
            q=p.copy(); q[:,1]-=0.5*h; q+=nrm*(side*sep*h)[:,None]; q[:,1]+=sagpx
            pts=np.round(q*SS).astype(np.int32).reshape(-1,1,2)
            cv2.polylines(big,[pts],False,255,thickness=3,lineType=cv2.LINE_AA)
        # hangers at supports: small ticks
        idx=np.nonzero(np.diff(np.floor(s/sp))>0)[0]
        for i in idx:
            a=p[i]-np.array([0,0.5*h[i]]); 
            for side in (-1,1):
                c=a+nrm[i]*side*sep*h[i]*1.9
                cv2.line(big,tuple(np.round(a*SS).astype(int)),tuple(np.round(c*SS).astype(int)),200,2,cv2.LINE_AA)
    return cv2.resize(big.astype(np.float32)/255,(W,H),interpolation=cv2.INTER_AREA)
def apply_ink(img,alpha,col=INK,k=0.6):
    a=np.clip(alpha*k,0,1)[...,None]
    return img*(1-a)+col*a
def flowers(img,mask,seed,density=0.13,box=None):
    rng=np.random.default_rng(seed); H,W=mask.shape
    out=img.copy(); ch=np.zeros((H,W),np.float32)
    ys,xs=np.nonzero(mask)
    pick=rng.random(len(ys))<density
    cols=np.array([[206,52,48],[228,96,128],[238,196,64],[244,238,224],[214,84,40]],float)
    for y,x in zip(ys[pick],xs[pick]):
        c=cols[rng.integers(0,len(cols))]*(0.92+0.12*rng.random())
        a=0.75+0.2*rng.random()
        out[y,x]=out[y,x]*(1-a)+c*a; ch[y,x]=1
        if rng.random()<0.35 and x+1<W:
            out[y,x+1]=out[y,x+1]*(1-a*0.5)+c*a*0.5; ch[y,x+1]=1
    return out,ch
def bench(big_alpha_seat,big_alpha_ink,x,y,ang,L):
    """draw one bench at SS scale: seat (light wood) + backrest/legs (ink)"""
    t=np.radians(ang); d=np.array([np.cos(t),np.sin(t)]); n=np.array([-d[1],d[0]])
    p0=np.array([x,y])-d*L/2; p1=np.array([x,y])+d*L/2
    P=lambda p: tuple(np.round(p*SS).astype(int))
    cv2.line(big_alpha_ink,P(p0+np.array([0.6,0.8])),P(p1+np.array([0.6,0.8])),120,4,cv2.LINE_AA)   # shadow
    cv2.line(big_alpha_seat,P(p0),P(p1),255,5,cv2.LINE_AA)
    cv2.line(big_alpha_ink,P(p0-np.array([0,1.4])),P(p1-np.array([0,1.4])),255,3,cv2.LINE_AA)       # backrest
    for p in (p0,p1):
        cv2.line(big_alpha_ink,P(p),P(p+np.array([0,1.3])),255,2,cv2.LINE_AA)
def benches(img,lst):
    H,W=img.shape[:2]
    s=np.zeros((H*SS,W*SS),np.uint8); k=np.zeros_like(s)
    for b in lst: bench(s,k,*b)
    s=cv2.resize(s.astype(np.float32)/255,(W,H),interpolation=cv2.INTER_AREA)
    k=cv2.resize(k.astype(np.float32)/255,(W,H),interpolation=cv2.INTER_AREA)
    out=img*(1-0.85*s[...,None])+np.array([150,104,70.])*0.85*s[...,None]
    out=out*(1-0.8*k[...,None])+np.array([60,46,38.])*0.8*k[...,None]
    return out,np.clip(s+k,0,1)
def flowerbed(img,poly,seed,density=0.38):
    H,W=img.shape[:2]; rng=np.random.default_rng(seed)
    m=np.zeros((H*SS,W*SS),np.uint8)
    cv2.fillPoly(m,[np.round(np.array(poly)*SS).astype(np.int32)],255,cv2.LINE_AA)
    a=cv2.resize(m.astype(np.float32)/255,(W,H),interpolation=cv2.INTER_AREA)
    # bushy top: modulate with noise
    nz=cv2.GaussianBlur(rng.random((H,W)).astype(np.float32),(0,0),1.0); nz=(nz-nz.mean())/(nz.std()+1e-6)
    a=np.clip(a*(1+0.25*nz),0,1)
    green=np.array([104,146,74.])
    out=img*(1-0.6*a[...,None])+img*(green/255.0)*0.6*a[...,None]
    # pencil edge along bottom
    edge=np.clip(cv2.Sobel(a,cv2.CV_32F,0,1,ksize=3)*-1,0,1)
    out=out*(1-0.35*edge[...,None])+np.array([70,62,54.])*0.35*edge[...,None]
    o2,ch=flowers(out,a>0.5,seed,density=density)
    return o2,np.clip(a+ch,0,1)
