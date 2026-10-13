"""s18 Ленин: s17 (патчи Gemini, ночь, окна) + статуя — тёмная бронза с патиной днём и ночью (bronze.py), кадр 5 — мощение насыщеннее
(только жёлтое и кремово-белое мощение, f5_mask.py), ночь кадра 2 — без светлой бумажной полосы у края (paper_edge).
python3 run_s18.py <tests/lenin> <out_frames_dir> [--report DIR]   (повторяемый: источник — source/night/s15src + source/s17/patches)"""
import sys, json, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
B=Path(sys.argv[1]); OUT=Path(sys.argv[2]); OUT.mkdir(parents=True,exist_ok=True)
SRC=B/'source/night/s15src'; HERE=Path(__file__).parent
REP=Path(sys.argv[sys.argv.index('--report')+1]) if '--report' in sys.argv else None
if REP: REP.mkdir(parents=True,exist_ok=True)
for q in ('s17','s16'): sys.path.insert(0,str(B/'source'/q))
sys.path.insert(0,str(HERE))
import common, night_s17, nightcheck, night_s16, win4, gcolor, bronze, f5_mask, esim
win4.S=str(SRC)+'/'
FR=common.FR
def L(n,suf='',mode='RGB'): return np.asarray(Image.open(SRC/(n+suf+'.webp')).convert(mode))
def save(a,name,q=92):
    Image.fromarray(np.clip(np.round(a),0,255).astype(np.uint8)).save(OUT/(name+'.webp'),quality=q,method=6)
TARGET=2.2
POOL={'lenin_4':False,'lenin_2':False,'lenin_6':False}
FL={'lenin_2':dict(ped_soft=0.35),'lenin_6':dict(ped_soft=0.35)}
FEET={'lenin_2':481}   # кадр 2: ниже — верх постамента (по снимку 6×)
S17=json.load(open(B/'report/s17/s17_stats.json'))
# кадр 5: мощение — цвет теплее и гуще (L* −, хрома ×, оттенок к кадру 1), белое — кремовее; бассейн/зелень/дома не трогаем
PAV=dict(dL=-4.5, kC=1.3, addC=3.0, hue_to=76.0, hue_k=0.5)
def paving_boost(img, wgt):
    lab=bronze.to_lab(img.astype(np.float32)); Lc,a,b=lab[...,0],lab[...,1],lab[...,2]
    C=np.hypot(a,b); h=np.degrees(np.arctan2(b,a))
    h2=h+(PAV['hue_to']-h)*PAV['hue_k']*np.clip(C/10,0,1)          # почти белое — без поворота оттенка (его нет)
    C2=C*PAV['kC']+PAV['addC']
    h0=np.where(C<1.5,PAV['hue_to'],h2)                               # совсем белое -> тёплый крем
    a2=C2*np.cos(np.radians(h0)); b2=C2*np.sin(np.radians(h0))
    L2=Lc+PAV['dL']*np.clip((Lc-55)/30,0,1)                           # тёмный карандаш не трогаем
    out=bronze.from_lab(np.dstack([L2,a2,b2]))
    return img*(1-wgt[...,None])+out*wgt[...,None]
def paper_edge(night, day, env_sky):
    """светлая бумага у края кадра в ночной картинке (кадр 2: полоса слева от горизонта вниз и низ кадра) -> местный ночной тон"""
    lum=night.astype(np.float32).mean(2); H,W=lum.shape
    bright=(lum>110)&(env_sky<100)&(day.astype(np.float32).mean(2)>190)
    lab,n=ndimage.label(bright)
    edge=np.zeros_like(bright)
    for i,sl in enumerate(ndimage.find_objects(lab),1):
        if sl[1].start<=2 or sl[1].stop>=W-2 or sl[0].stop>=H-2:
            r=lab[sl]==i
            if r.sum()>=300: edge[sl]|=r
    edge=ndimage.binary_closing(edge,iterations=3)
    edge=ndimage.binary_dilation(edge,iterations=4)&(env_sky<100)
    wgt=np.clip(cv2.GaussianBlur(edge.astype(np.float32),(0,0),3)*1.6,0,1)*(env_sky<100)
    good=(~ndimage.binary_dilation(edge,iterations=6)).astype(np.float32)*(env_sky<100)
    num=cv2.GaussianBlur(lum*good,(0,0),45); den=cv2.GaussianBlur(good,(0,0),45)+1e-4
    target=num/den
    loc=cv2.GaussianBlur(lum,(0,0),6)+1
    ratio=np.clip(target/loc,0.15,1.0)
    out=night.astype(np.float32)*(1-wgt[...,None]+wgt[...,None]*ratio[...,None])
    return out, int(edge.sum())
def sky_ratio(nl,st,env_sky,alpha):
    """статуя / небо в итоге движка: кольцо неба вокруг (кадры 1, 3, 4), иначе всё небо кадра (виды сверху 2, 5)"""
    m=nightcheck.measure(nl,st,env_sky,exclude=alpha>128)
    if m['around_kind']=='sky': return m['ratio'], m
    e=nightcheck.engine_night(nl); Lm=nightcheck.lum(e)
    r=float(Lm[st].mean())/max(float(Lm[env_sky].mean()),1e-4)
    return r, dict(m, ratio_frame_sky=round(r,2), statue_vs_ground=m['ratio'])
stats={}
for n in FR:
    st_={}
    d0=L(n).astype(np.float32); H,W=d0.shape[:2]
    alpha=L(n,'_building','RGBA')[...,3]; env=L(n,'_env').astype(np.float32)/255
    P=np.asarray(Image.open(B/'source/s17/patches'/(n+'.png')).convert('RGBA')).astype(np.float32)
    a=P[...,3]/255; d1=d0*(1-a[...,None])+P[...,:3]*a[...,None]
    chg=a
    bg0=L(n,'_bg').astype(np.float32); r=(d1+6)/(d0+6)
    bg1=np.where((chg>0.01)[...,None]&(alpha<10)[...,None],bg0*r,bg0)
    bl=L(n,'_building','RGBA').astype(np.float32)
    if ((chg>0.01)&(alpha>=10)).any():
        m=(chg>0.01)&(alpha>=10); bl[...,:3][m]=d1[m]
    d1n=d1.copy()
    # статуя: бронза (маска по дню s15 — как в s17)
    st0,_,_,_=night_s16.statue_mask(d0.astype(np.uint8),alpha)
    stm,gap=night_s17.clean_statue(st0,d0)
    stm=bronze.small_statue(st0,stm,d0,feet=FEET.get(n))
    w=bronze.weight(st0,stm,alpha,gap)*(1-np.clip(a*3,0,1))   # листья/травинки Gemini на плите (кадр 4) — не бронза
    before_day=esim.lab_stats(esim.day(d1),stm)
    d1=bronze.recolor(d1,stm,w,seed=7); d1n=bronze.recolor(d1n,stm,w,seed=7)
    bl[...,:3]=bl[...,:3]*(1-w[...,None])+d1n*w[...,None]
    st_['statue_day']=dict(before_engine=before_day, after_engine=esim.lab_stats(esim.day(d1),stm), after_image=esim.lab_stats(d1,stm), px=int(stm.sum()))
    if n=='lenin_6':
        e1=L('lenin_1','_env')[...,0]<100; e6=env[...,0]<0.4
        before=gcolor.stats(d1,e6); ref=gcolor.stats(L('lenin_1'),e1)
        p=gcolor.params(before,ref,sL=0.7,sC=0.85)
        half=lambda x: x+0.5*(gcolor.apply(x,p)-x)
        keep=w>0.01
        d1h=half(d1); d1=np.where(keep[...,None],d1,d1h); bg1=half(bg1)
        blh=half(bl[...,:3]); bl[...,:3]=np.where(keep[...,None],bl[...,:3],blh)
        yel,wht=f5_mask.paving_mask(d1,np.zeros_like(alpha),(env[...,0]*255),a)   # и кайма вырезки памятника (там тоже мощение) — иначе бледный ореол
        pav=yel|wht
        Y=np.arange(H)[:,None]*np.ones((1,W)); pav&=(Y>=360)
        wgt=np.clip(cv2.GaussianBlur(pav.astype(np.float32),(0,0),2.0)*1.3,0,1)*(1-a)*(w<0.01)
        import paving_stats as ps
        st_['paving_before']=dict(yellow=ps.stats(esim.day(d1),yel&(Y>=360)),white=ps.stats(esim.day(d1),wht&(Y>=360)))
        d1=paving_boost(d1,wgt); bg1=paving_boost(bg1,wgt); bl[...,:3]=paving_boost(bl[...,:3],wgt)
        st_['paving_after']=dict(yellow=ps.stats(esim.day(d1),yel&(Y>=360)),white=ps.stats(esim.day(d1),wht&(Y>=360)),mask_px=int((wgt>0.5).sum()))
        if REP is not None: Image.fromarray((wgt*255).astype(np.uint8)).save(REP/'frame5_paving_mask.png')
    save(d1,n); save(bg1,n+'_bg')
    Image.fromarray(np.clip(np.round(bl),0,255).astype(np.uint8),'RGBA').save(OUT/(n+'_building.webp'),quality=92,method=6)
    # ночь: как s17 (перенос патча, окна, прожектор s17 — для постамента и пятна), затем статуя — бронза под прожектором
    n0=L(n,'_night').astype(np.float32)
    dn0=L(n).astype(np.float32); dn1=dn0*(1-a[...,None])+P[...,:3]*a[...,None]
    n1=night_s16.transfer(n0,d0,dn1,chg>0.01)
    if n in ('lenin_1','lenin_2','lenin_6'):
        _,lbl,wins=win4.detect(n)
        n1,lit,nw=night_s16.paint_windows(n,n1,d0.astype(np.uint8),lbl,env=env)
    k17=S17[n]['statue']['k']
    n17,_=night_s17.floodlight(n1,dn1,alpha,stm,k=k17,pool_on=POOL.get(n,True),**FL.get(n,{}))
    if n in FL:   # виды сверху: мягкое поле постамента s17 светило и деревья вокруг — ореол по контуру; теперь только внутри памятника
        hsv=cv2.cvtColor(dn1.astype(np.uint8),cv2.COLOR_RGB2HSV).astype(int)
        pink=ndimage.binary_opening(((hsv[...,0]<=22)|(hsv[...,0]>=160))&(hsv[...,1]>=22),iterations=1)   # только розовый туф постамента
        core=cv2.erode((alpha>128).astype(np.uint8),np.ones((7,7),np.uint8)).astype(bool)&pink
        if n in FEET: core[:FEET[n]-2]=False   # выше ступней — фон вырезки, не постамент
        M=cv2.GaussianBlur(core.astype(np.float32),(0,0),1.0)
        n17=n1+(n17-n1)*M[...,None]
    n1=n17
    sky=env[...,0]>0.4
    before_night=esim.lab_stats(esim.night(n1),stm)
    k=0.8
    for it in range(40):
        nl=bronze.floodlight(n1,d1n,alpha,stm,w,k=k)
        ratio,m=sky_ratio(nl,stm,sky,alpha)
        if ratio>=TARGET or k>=12: break
        k*=1.08
    n1=nl
    st_['statue_night']=dict(before_engine_s17=before_night, after_engine=esim.lab_stats(esim.night(n1),stm), k=round(k,3), ratio_to_sky=round(ratio,2), measure=m)
    if n=='lenin_2':
        n1,px=paper_edge(n1,d1,env[...,0]*255); st_['paper_edge_px']=px
    save(n1,n+'_night')
    stats[n]=st_
    print(n,json.dumps({k_:v for k_,v in st_.items() if k_ in ('statue_night','paper_edge_px')},default=float)[:300],flush=True)
json.dump(stats,open((REP or OUT)/'s18_stats.json','w'),indent=1,default=float,ensure_ascii=False)
