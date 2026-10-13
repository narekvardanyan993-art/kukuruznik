"""s17: прожектор на статую ночью. Свет снизу, с земли перед постаментом: тёплый, статуя — самый яркий объект кадра,
лицо и пальто читаются (штрих берётся из дневного рисунка), к верху свет мягко слабеет. Постамент освещён слабее статуи.
Только внутри силуэта (без ореола наружу — урок s8/s14). Пятно тёплого света на земле у основания."""
import numpy as np, cv2
from scipy import ndimage
WARM=np.array([1.0,0.80,0.56])
def to_lin(x): x=np.clip(x/255.0,0,1); return np.where(x<=0.04045,x/12.92,((x+0.055)/1.055)**2.4)
def to_srgb(x): x=np.clip(x,0,1); return 255*np.where(x<=0.0031308,x*12.92,1.055*x**(1/2.4)-0.055)
def soft_inside(m,er=1,blur=0.8):
    inner=cv2.erode(m.astype(np.uint8),np.ones((2*er+1,2*er+1),np.uint8)).astype(np.float32)
    return np.maximum(cv2.GaussianBlur(inner,(0,0),blur),inner)*m
def floodlight(night, day, alpha, st, k=1.0, top=0.62, ped_k=0.42, pool=0.35, ped_w=1.15, ped_h=1.8, pool_on=True, ped_soft=0.0):
    """night, day: RGB float/uint8; alpha: building alpha 0..255; st: маска статуи (bool)."""
    H,W=st.shape
    night=night.astype(np.float32); dl=to_lin(day.astype(np.float32))
    ys=np.where(st.any(1))[0]; y0,y1=ys.min(),ys.max()
    xs=np.where(st[max(y0,y1-int(0.25*(y1-y0))):y1+1].any(0))[0]; fx0,fx1=xs.min(),xs.max()   # ноги/низ статуи
    xsa=np.where(st.any(0))[0]; sx0,sx1=xsa.min(),xsa.max(); cx=(sx0+sx1)/2; sw=max(8,sx1-sx0)
    yy=(np.arange(H,dtype=np.float32)[:,None]-y0)/max(1,(y1-y0))
    # статуя: снизу 1.0 -> к голове top (мягко), чуть сильнее в середине по ширине (луч прожектора)
    g=top+(1-top)*np.clip(yy,0,1)**0.9
    xx=(np.arange(W,dtype=np.float32)[None,:]-cx)/(sw*0.75)
    beam=0.85+0.15*np.exp(-xx**2)
    lit=to_srgb(dl*WARM*(k*g*beam)[...,None])
    w=soft_inside(st)
    out=night*(1-w[...,None])+lit*w[...,None]
    # постамент: под статуей, в пределах ширины ~ped_w ширины статуи, ниже ног; слабее статуи, ярче у ног (свет падает сверху вниз по камню)
    a=alpha.astype(np.float32)/255
    hsv=cv2.cvtColor(np.clip(day,0,255).astype(np.uint8),cv2.COLOR_RGB2HSV).astype(int)
    pink=(((hsv[...,0]<=22)|(hsv[...,0]>=160))&(hsv[...,1]>=22))
    ped=(a>0.5)&~st&ndimage.binary_opening(pink,iterations=1)   # только розовый туф постамента (не бумажная кайма вырезки)
    pw=sw*ped_w; ph=(y1-y0)*ped_h
    px=np.exp(-(((np.arange(W)[None,:]-cx)/pw)**6))
    py=((np.arange(H)[:,None]>=y1-4)&(np.arange(H)[:,None]<=y1+ph)).astype(np.float32)
    pyg=1.0-0.35*np.clip((np.arange(H,dtype=np.float32)[:,None]-y1)/max(1,ph),0,1)
    pm=ped*px*py
    pm=cv2.GaussianBlur(pm.astype(np.float32),(0,0),1.5)*ped
    if ped_soft>0:   # виды сверху: мягкий тёплый свет по постаменту и вокруг без края вырезки (иначе «ореол» по кайме)
        Y,X=np.mgrid[0:H,0:W].astype(np.float32)
        yc=y1+ph*0.35
        f=np.exp(-(((X-cx)/(pw*1.3))**2+((Y-yc)/(ph*0.6))**2))*(1-cv2.GaussianBlur(st.astype(np.float32),(0,0),1.0))
        out=out*(1+ped_soft*k*f[...,None]*(WARM-0.2)[None,None,:])
    else:
        plit=to_srgb(dl*WARM*(k*ped_k*pyg)[...,None])
        out=out*(1-pm[...,None])+np.maximum(plit,out)*pm[...,None]
    # тёплое пятно на земле у основания постамента (только вне здания)
    pb=None
    if pool_on:
        col=ped&(np.abs(np.arange(W)[None,:]-cx)<pw)
        rows=np.where(col.any(1))[0]
        if len(rows):
            yb=rows.max(); rx=pw*1.4; ry=max(6,pw*0.35)
            Y,X=np.mgrid[0:H,0:W].astype(np.float32)
            e=np.exp(-(((X-cx)/rx)**2+((Y-(yb+ry*0.5))/ry)**2))*(a<0.1)
            out=out*(1+pool*k*e[...,None]*(WARM-0.25)[None,None,:])
            pb=yb
    return np.clip(out,0,255), dict(y0=int(y0),y1=int(y1),cx=float(cx),sw=int(sw),pool_y=pb)
def clean_statue(st, day):
    """маска статуи без просветов неба/бумаги (между ног — «дыра», урок s8) и без зелени/фона вокруг мелкой статуи на видах сверху.
    Светлое в ВЕРХНЕЙ трети (лысина, блики) — оставляем: это сама статуя."""
    hsv=cv2.cvtColor(np.clip(day,0,255).astype(np.uint8),cv2.COLOR_RGB2HSV).astype(int)
    h,s,v=hsv[...,0],hsv[...,1],hsv[...,2]
    green=(h>=30)&(h<=85)&(s>35)
    skyish=((h>=85)&(h<=135)&(s>18))|((v>215)&(s<50))
    ys=np.where(st.any(1))[0]; y0,y1=ys.min(),ys.max()
    lab,nn=ndimage.label(skyish&st)
    gap=np.zeros_like(st)
    for i,sl in enumerate(ndimage.find_objects(lab),1):
        r=lab[sl]==i; yc=sl[0].start+np.argwhere(r)[:,0].mean()
        if yc>y0+0.33*(y1-y0) and r.sum()>=6: gap[sl]|=r
    gap=ndimage.binary_dilation(gap,iterations=2)&st
    gap=ndimage.binary_fill_holes(ndimage.binary_closing(gap,iterations=4))&st   # обрывки облаков внутри просвета
    out=st&~gap&~green
    if st.sum()<12000: out&=(v<205); out=cv2.erode(out.astype(np.uint8),np.ones((3,3),np.uint8)).astype(bool)   # мелкая статуя (виды сверху): край маски заходит на светлый фон — только тёмная бронза
    out=ndimage.binary_opening(out,iterations=1)
    lab2,n2=ndimage.label(out)
    if n2>1:   # самый большой кусок + всё, что не мельче 2 % от него
        sz=ndimage.sum(out,lab2,range(1,n2+1)); keep=[i+1 for i,z in enumerate(sz) if z>=(0.02 if st.sum()>=12000 else 0.5)*sz.max()]   # мелкая статуя: без осколков карниза
        out=np.isin(lab2,keep)
    return out, gap
