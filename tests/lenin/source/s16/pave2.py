import numpy as np, cv2
from PIL import Image
from scipy import ndimage
import paving
BASALT=np.array([120,114,122.]); TUFF=np.array([224,140,124.]); CREAM=np.array([242,222,186.])
LONG={'lenin_2':'v','lenin_6':'u'}
ASP={'lenin_2':1.9,'lenin_6':2.1}
def lowfreq(H,W,seed,s=18):
    r=np.random.default_rng(seed).random((H//4+2,W//4+2)).astype(np.float32)
    r=cv2.resize(r,(W,H),interpolation=cv2.INTER_CUBIC)
    r=cv2.GaussianBlur(r,(0,0),s/4); r=(r-r.mean())/(r.std()+1e-6); return r
def band(x,a,b,soft):
    return np.clip((x-a)/soft+0.5,0,1)*np.clip((b-x)/soft+0.5,0,1)
def paint(n, day, NU=22, NV=9, draw_grid=False, seed=5):
    H,W=day.shape[:2]
    m,poly=paving.oval_mask(n,H,W,shrink=2)
    uv,M,q=paving.uvmap(n,H,W)
    u,v=uv[...,0],uv[...,1]
    if LONG[n]=='v': lo,sh=v,u
    else: lo,sh=u,v
    A=ASP[n]
    lc=lo[m].mean(); sc=sh[m].mean()
    # rounded-rect distance in short-side units (from oval contour): use pixel distance normalised by local scale
    dist=ndimage.distance_transform_edt(m)
    # local scale: pixels per short-side unit = |d(sh)/dy|^-1 approx
    gy,gx=np.gradient(sh); scale=1/np.maximum(np.hypot(gx,gy),1e-4)
    d=dist/scale
    r=np.hypot((lo-lc)*A,(sh-sc))/0.30
    soft_d=1.2/scale; soft_r=1.2/(scale*0.30)
    layers=[ (band(d,0.035,0.07,soft_d),BASALT,0.26),
             (band(d,0.095,0.115,soft_d),TUFF,0.30),
             (band(r,0.0,0.30,soft_r),CREAM,0.22),
             (band(r,0.30,0.58,soft_r),TUFF,0.30),
             (band(r,0.58,0.70,soft_r),BASALT,0.30),
             (band(r,0.70,0.96,soft_r),TUFF,0.16)]
    out=day.astype(np.float32)
    nz=np.clip(1+0.22*lowfreq(H,W,seed+1),0.6,1.4)
    tot=np.zeros((H,W),np.float32)
    for w,col,a in layers:
        w=w.astype(np.float32); al=w*a*nz*m
        # watercolor pooling: slightly darker at band edges
        e=np.clip(w*(1-w)*4,0,1); al=al*(1+0.35*e)
        out=out*(1-al[...,None]+al[...,None]*col/255.0); tot+=al
    pencil=np.zeros((H,W),np.float32)
    for w,col,a in layers[:2]+layers[3:5]:
        # pencil outline at band edges: where w crosses 0.5
        w=w.astype(np.float32); g=np.abs(cv2.Sobel(w,cv2.CV_32F,1,0,ksize=3))+np.abs(cv2.Sobel(w,cv2.CV_32F,0,1,ksize=3))
        pencil=np.maximum(pencil,np.clip(g*0.9,0,1))
    if draw_grid:
        R=2048; img=np.zeros((R,R),np.float32)
        for k in range(1,NU): x=int(round(k/NU*R)); img[:,max(0,x-2):x+2]=1
        for k in range(1,NV): y=int(round(k/NV*R)); img[max(0,y-2):y+2,:]=1
        Mi=cv2.getPerspectiveTransform(np.float32([[0,0],[R,0],[R,R],[0,R]]),q*4)
        big=cv2.warpPerspective(img,Mi,(W*4,H*4),flags=cv2.INTER_LINEAR)
        gridA=np.clip(cv2.resize(big,(W,H),interpolation=cv2.INTER_AREA)*1.5,0,1)
        pencil=np.maximum(pencil,gridA*0.55)
    pa=pencil*m*0.32*np.clip(1+0.3*lowfreq(H,W,seed+2),0.5,1.5)
    out=out*(1-pa[...,None])+np.array([92,80,72.])*pa[...,None]
    changed=np.clip(tot*3+pa*3,0,1)
    return np.clip(out,0,255), changed
if __name__=='__main__':
    S='/mnt/user-data/uploads/chka.am/tests/lenin/frames/'
    for n,g in [('lenin_2',False),('lenin_6',True)]:
        d=np.asarray(Image.open(S+n+'.webp').convert('RGB'))
        o,c=paint(n,d,draw_grid=g)
        Image.fromarray(o.astype(np.uint8)).save('out/'+n+'_pave.png')
