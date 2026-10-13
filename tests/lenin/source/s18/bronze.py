"""s18: статуя — тёмная патинированная бронза (день и ночь), а не «золото/хаки».
recolor(): только цвет внутри силуэта статуи; штрих (яркость рисунка) сохраняется: средняя L* статуи -> L_T, контраст штриха ×KC.
Тон: светлые места (по площади, размытие σ 4 px) — тёплая бронза; тени и складки — зелёная патина; карандашные линии — почти без цвета.
floodlight(): прожектор ночью почти белым светом (3500 K), бронза остаётся бронзой; блики на складках и лице ярче, тени глубже."""
import numpy as np, cv2
from scipy import ndimage
L_T=34.0; KC=1.05
# цвета вне полосы «зелени» движка (HSV 36–162°, engine/viewer.js GREEN_*): блик — тёплый коричневый (HSV ~25°), патина — сине-зелёная
# «медянка» (HSV ~185°): движок их не перекрашивает, отдельная настройка движка не нужна
HI=np.array([8.0,13.0]); MID=np.array([3.0,5.5]); PAT=np.array([-7.0,-2.5])   # (a*, b*) блика, середины, патины
LIGHT=np.array([1.0,0.92,0.80])
def ss(a,b,x): t=np.clip((x-a)/(b-a),0,1); return t*t*(3-2*t)
def to_lab(rgb):
    l=cv2.cvtColor(np.clip(rgb/255.0,0,1).astype(np.float32),cv2.COLOR_RGB2LAB); return l   # float: L 0..100, a/b ±
def from_lab(lab): return np.clip(cv2.cvtColor(lab.astype(np.float32),cv2.COLOR_LAB2RGB),0,1)*255
def weight(st0, st, alpha, gap):
    """мягкий вес перекраски: чистая маска статуи (clean_statue) + 1 px внутрь грубой (контур), без просветов неба"""
    m=(st|(cv2.dilate(st.astype(np.uint8),np.ones((3,3),np.uint8)).astype(bool)&st0))&~gap&(alpha>100)
    inner=cv2.erode(m.astype(np.uint8),np.ones((3,3),np.uint8)).astype(np.float32)
    return np.maximum(cv2.GaussianBlur(inner,(0,0),0.7),inner)*m
def recolor(d, st, w, seed=0):
    lab=to_lab(d.astype(np.float32)); L=lab[...,0]
    Lm=float(L[st].mean())
    La=cv2.GaussianBlur(L,(0,0),4.0)                         # тон по площади (складки, свет), не по штриху
    sd=float(La[st].std())+1e-3
    t=np.clip((La-Lm)/sd,-2.5,2.5)
    hi=ss(0.2,1.6,t); sh=ss(-0.1,-1.4,t)
    rng=np.random.RandomState(seed); nz=cv2.GaussianBlur(rng.rand(*L.shape).astype(np.float32),(0,0),9); nz=(nz-nz.mean())/(nz.std()+1e-6)
    pat=np.clip(sh*0.85+0.2*nz+0.2,0,1)*(1-hi)
    ab=MID[None,None,:]*(1-hi[...,None])+HI[None,None,:]*hi[...,None]
    ab=ab*(1-pat[...,None])+PAT[None,None,:]*pat[...,None]
    L2=np.clip(L_T+(L-Lm)*KC,4,82)
    ab*=ss(6,22,L2)[...,None]                                  # тёмный карандаш — почти без цвета
    out=np.dstack([L2,ab[...,0],ab[...,1]])
    rgb=from_lab(out)
    return d*(1-w[...,None])+rgb*w[...,None]
def to_lin(x): x=np.clip(x/255.0,0,1); return np.where(x<=0.04045,x/12.92,((x+0.055)/1.055)**2.4)
def to_srgb(x): x=np.clip(x,0,1); return 255*np.where(x<=0.0031308,x*12.92,1.055*x**(1/2.4)-0.055)
def floodlight(night, day_bronze, alpha, st, w, k=1.0, top=0.62, gamma=0.45, chroma=1.3):
    """статуя ночью = бронза дня (линейно, цвет ×chroma) × свет; свет снизу ярче, к голове top; (Y/Ym)^gamma — блики ярче, тени глубже."""
    H,W=st.shape
    lab=to_lab(day_bronze.astype(np.float32)); lab[...,1:]*=chroma
    dl=to_lin(from_lab(lab))
    Y=(dl*np.array([0.2126,0.7152,0.0722])).sum(-1); Ym=float(Y[st].mean())+1e-5
    Ya=cv2.GaussianBlur(Y,(0,0),1.2)
    ys=np.where(st.any(1))[0]; y0,y1=ys.min(),ys.max()
    xsa=np.where(st.any(0))[0]; cx=(xsa.min()+xsa.max())/2; sw=max(8,xsa.max()-xsa.min())
    yy=(np.arange(H,dtype=np.float32)[:,None]-y0)/max(1,(y1-y0))
    g=top+(1-top)*np.clip(yy,0,1)**0.9
    xx=(np.arange(W,dtype=np.float32)[None,:]-cx)/(sw*0.75)
    beam=0.85+0.15*np.exp(-xx**2)
    rel=np.clip(Ya/Ym,0.05,6)**gamma
    lit=to_srgb(dl*LIGHT*(k*g*beam*rel)[...,None])
    out=night.astype(np.float32)*(1-w[...,None])+lit*w[...,None]
    return np.clip(out,0,255)

def small_statue(st0, st, day, feet=None):
    """мелкая статуя (виды сверху, кадры 2 и 5): маска clean_statue захватывала светлый фон у верха постамента («бежевое пятно» ночью
    на кадре 2). Здесь: тёмный контур бронзы -> закрыть дыры (светлая сторона статуи внутри контура) -> не ниже ступней (feet) ->
    самый крупный кусок и соседи в 2 px."""
    if st.sum()>=6000: return st          # кадры 1, 3, 4 — статуя крупная, clean_statue хватает
    g=cv2.cvtColor(np.clip(day,0,255).astype(np.uint8),cv2.COLOR_RGB2GRAY)
    m=st0&(g<125)
    m=ndimage.binary_fill_holes(ndimage.binary_closing(m,iterations=2))&st0
    if feet is not None: m[feet+1:]=False
    lab,n=ndimage.label(m)
    if n==0: return st
    sz=ndimage.sum(m,lab,range(1,n+1)); big=lab==(int(np.argmax(sz))+1)
    near=ndimage.binary_dilation(big,iterations=2)
    keep=np.isin(lab,[i for i in range(1,n+1) if (near&(lab==i)).any()])
    out=keep|(ndimage.binary_dilation(keep,iterations=1)&st0&(g<160))
    if feet is not None: out[feet+1:]=False
    return out
