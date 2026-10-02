"""Ленин: левый край кадра закрыт зеленью бульвара (вместо здания, которое не удалось определить; см. tests/lenin/sources.md).

Вход (лежат рядом): lenin_916_noleft.jpg, lenin_916_bg_noleft.jpg (здание убрано, небо дозаполнено, patch_left_building.py).
Выход: lenin_916_green.jpg, lenin_916_bg_green.jpg — те же правки в кадре и фоне:
  1) fix_sky: вертикальный оранжевый «клин» в небе (след прошлой заплатки) заменён гладкой поверхностью, зерно бумаги осталось;
  2) продолжение ряда деревьев бульвара влево: маленькие деревья ряда клонируются со сжатием к точке схода (VX), с воздушной перспективой
     (к цвету дымки), мягким верхом и краями; те же штампы и тот же seed в кадре и фоне.
Дальше: tools/build_building_layers.py (--src lenin_916_green.jpg --bg lenin_916_bg_green.jpg --spec tests/lenin/layers.json), затем
        python3 tests/lenin/source/depth_pin_ground.py <папка кадров> lenin_1   (параллакс, п.2)
Запуск:  python3 tests/lenin/source/patch_left_green.py
"""
import numpy as np, cv2, sys
from PIL import Image
from pathlib import Path
SRC=str(Path(__file__).resolve().parent)+'/'
HY=1722   # линия горизонта слева (строка на кадре 1536x2752)
def fix_sky(im, X1=900, Y0=1150, Y1=1740):
    """Убирает вертикальный оранжевый «клин» в небе слева (след прошлой заплатки): низкие частоты неба заменяются
    гладкой квадратичной поверхностью по небесным пикселям, зерно бумаги (высокие частоты) остаётся."""
    reg=im[Y0:Y1, 0:X1]
    h,w=reg.shape[:2]
    lum=reg.mean(2)
    rowref=np.median(reg[:, 40:120],axis=1)                   # (h,3) типичное небо в строке
    dist=np.abs(reg-rowref[:,None,:]).sum(2)
    sky=(dist<70)&(lum>150)
    sky=cv2.erode(sky.astype(np.uint8),np.ones((5,5),np.uint8)).astype(bool)
    yy,xx=np.mgrid[0:h,0:w].astype(np.float64); xn=xx/w; yn=yy/h
    A=np.stack([np.ones_like(xn),xn,yn,xn*yn,xn**2,yn**2,xn*yn**2,yn**3],-1)
    idx=np.flatnonzero(sky.ravel())[::7]
    out=np.zeros_like(reg)
    for c in range(3):
        coef,*_=np.linalg.lstsq(A.reshape(-1,A.shape[-1])[idx], reg[...,c].ravel()[idx], rcond=None)
        out[...,c]=(A@coef).astype(np.float32)
    # высокие частоты исходника (зерно, крапинки) — по небу, без деревьев
    mk=sky.astype(np.float32)
    lowc=np.stack([cv2.GaussianBlur(reg[...,c]*mk,(0,0),7)/np.maximum(cv2.GaussianBlur(mk,(0,0),7),1e-3) for c in range(3)],-1)
    hf=reg-lowc
    new=out+hf*0.9
    wgt=cv2.GaussianBlur(mk,(0,0),3)
    top=np.clip((yy-0)/100.0,0,1)[...,None].astype(np.float32)
    right=np.clip((w-1-xx)/80.0,0,1)[...,None].astype(np.float32)
    a=wgt[...,None]*top*np.minimum(1,right+0.0)
    im[Y0:Y1,0:X1]=reg*(1-a)+new*a

def build(path_in, out, dbg=None):
    im=np.asarray(Image.open(path_in).convert('RGB')).astype(np.float32)
    H,W=im.shape[:2]
    for xs,xe,ys,ye in [(322,346,1540,1660)]:
        colref=im[ys:ye, xs-14:xs-4].mean(1)
        im[ys:ye, xs:xe]=colref[:,None,:]+(im[ys:ye, xs-30:xs-6].mean(1)[:,None,:]*0)
    fix_sky(im)
    base=im.copy()
    # цвет дымки по строкам (небо у горизонта) — из чистой колонки слева
    ref=im[:, 40:120].mean(1)                      # (H,3)
    ref=cv2.GaussianBlur(ref[None],(0,0),sigmaX=6)[0]
    def stamp(sx0,sx1,sy0,sy1,scale,dx,flip=False,haze=0.0,sink=0):
        p=base[sy0:sy1, sx0:sx1].copy()
        rr=ref[sy0:sy1]
        if flip: p=p[:, ::-1]
        dist=np.abs(p-rr[:,None,:]).sum(2)
        a=np.clip((dist-40)/28,0,1)
        a=cv2.morphologyEx(a,cv2.MORPH_CLOSE,np.ones((7,7),np.uint8))
        a=cv2.GaussianBlur(a,(0,0),1.0)
        h,w=p.shape[:2]; nh,nw=int(h*scale),int(w*scale)
        p=cv2.resize(p,(nw,nh),interpolation=cv2.INTER_AREA); a=cv2.resize(a,(nw,nh),interpolation=cv2.INTER_AREA)
        # воздушная перспектива: к цвету дымки
        yb=HY+sink; yt=yb-nh
        rrs=ref[yt:yb][:,None,:]
        p=p*(1-haze)+rrs*haze
        # края: плавно по бокам и по низу
        if nw<8 or nh<6: return
        f=max(2,min(int(nw*0.14),nw//3)); ramp=np.linspace(0,1,f,dtype=np.float32)
        a[:,:f]*=ramp[None,:]; a[:,-f:]*=ramp[::-1][None,:]
        ft=max(4,int(nh*0.22)); a[:ft]*=(np.linspace(0,1,ft)**1.5)[:,None]
        fb=max(4,int(nh*0.05)); a[-fb:]*=np.linspace(1,0,fb)[:,None]
        x0=dx; x1=dx+nw
        if x1<=0 or x0>=W: return
        xs=max(x0,0); xe=min(x1,W)
        reg=im[yt:yb, xs:xe]; m=a[:, xs-x0:xe-x0]
        im[yt:yb, xs:xe]=reg*(1-m[...,None])+p[:, xs-x0:xe-x0]*m[...,None]
    return im, stamp

def run(path_in,out,crop_png=None,seed=7):
    rng=np.random.default_rng(seed)
    im,stamp=build(path_in,out)
    VX=-60.0; X0=396.0
    s_of=lambda x:(x-VX)/(X0-VX)
    boxes=[(388,438,1598,1750),(394,446,1598,1750),(390,430,1604,1750)]
    x=X0; stamps=[]
    while x>-30:
        s=s_of(x)
        if s<0.10: break
        stamps.append((x,s)); x-=max(5,rng.uniform(0.34,0.55)*50*s)
    k=0
    for x,s in reversed(stamps):          # от дальних (слева) к ближним
        b=boxes[rng.integers(len(boxes))]; flip=bool(rng.integers(2)); k+=1
        sj=s*rng.uniform(0.88,1.12)
        bw=(b[1]-b[0])*sj
        stamp(*b,sj,int(x-bw/2),flip=flip,haze=min(0.55,0.6*(1-s)),sink=int(rng.integers(0,4)*s))
    Image.fromarray(np.clip(im,0,255).astype(np.uint8)).save(out,quality=94)
    if crop_png: Image.fromarray(np.clip(im,0,255).astype(np.uint8)).crop((0,1450,900,1850)).save(crop_png)
    print(len(stamps),'штампов')
if __name__=='__main__':
    run(SRC+'lenin_916_noleft.jpg',SRC+'lenin_916_green.jpg')
    run(SRC+'lenin_916_bg_noleft.jpg',SRC+'lenin_916_bg_green.jpg')
