"""s16 Ленин: детали дня, нарисованные окна, ночь из нового дня, свет статуи, люди-силуэты ночью, цвет G, мягкая маска неба G.
python3 run_s16.py <tests/lenin> <out_frames_dir> [--report DIR]
Источник — копия кадров до s16 (<tests/lenin>/source/night/s15src/), запуск повторяемый."""
import sys, json, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
B=Path(sys.argv[1]); OUT=Path(sys.argv[2]); OUT.mkdir(parents=True,exist_ok=True)
SRC=B/'source/night/s15src'
REP=Path(sys.argv[sys.argv.index('--report')+1]) if '--report' in sys.argv else None
sys.path.insert(0,str(Path(__file__).parent))
import day_s16, details, night_s16, win4
FR=['lenin_1','lenin_2','lenin_3','lenin_4','lenin_6']
bj=json.loads((B/'building.json').read_text())
LAMPS={f['name']:f.get('nightLamps') or [] for f in bj['frames']}
def L(n,suf='',mode='RGB'): return np.asarray(Image.open(SRC/(n+suf+'.webp')).convert(mode))
def save(a,name,q=92):
    Image.fromarray(np.clip(np.round(a),0,255).astype(np.uint8)).save(OUT/(name+'.webp'),quality=q,method=6)
day_s16.F=str(SRC)+'/'
day_s16.ROADS=str(B/'source/roads')+'/'
win4.S=str(SRC)+'/'
STATUE={'lenin_1':(0.0,1.0),'lenin_3':(0.0,1.0),'lenin_4':(0.0,0.9),'lenin_2':(0.0,0.9),'lenin_6':(-1.0,0.9)}
SIL={'lenin_2':[(0.6706,0.6872,-9),(0.5286,0.8022,8),(0.2051,0.8967,10)],'lenin_6':[(0.4583,0.3516,-7),(0.6764,0.7238,-10),(0.0755,0.5407,8),(0.7923,0.6542,9)]}
FLOWERBED={'lenin_3':[[(102,974),(130,971),(160,973),(190,970),(214,973),(214,990),(102,990)],[(556,973),(585,970),(615,972),(645,970),(668,973),(668,990),(556,990)]]}
LAWN2={}   # A: на газоне бульвара цветы почти не видны (61 px) — не добавляем
stats={}
for n in FR:
    d0=L(n); H,W=d0.shape[:2]
    alpha=L(n,'_building','RGBA')[...,3]; env=L(n,'_env').astype(np.float32)/255
    # 1. day details
    if n in ('lenin_2','lenin_6'):
        d1,chg=day_s16.do(n)
    else:
        d1=d0.astype(np.float32); chg=np.zeros((H,W),np.float32)
        if n in LAWN2:
            lm=day_s16.lawn_mask(d0,LAWN2[n]); d1,c=details.flowers(d1,lm,seed=21,density=0.2); chg=np.maximum(chg,c)
        for i,p in enumerate(FLOWERBED.get(n,[])):
            d1,c=details.flowerbed(d1,p,seed=30+i); chg=np.maximum(chg,c)
    chg=chg*(alpha<10)        # здание (памятник) не трогаем
    mvp=B/'frames'/(n+'_motion_mask.png')
    if n in ('lenin_1','lenin_2','lenin_4') and mvp.exists():   # видео остаётся — в маске видео рисунок не меняем (видео хранит отличие от рисунка)
        mv=np.asarray(Image.open(mvp).convert('LA')).astype(np.float32); mv=(mv[...,0]*mv[...,1]/255)>8
        mvf=np.zeros((H,W),bool); mvf[:mv.shape[0],:mv.shape[1]]=mv
        chg=chg*~ndimage.binary_dilation(mvf,iterations=2)
    d1=d0*(1-chg[...,None])+d1*chg[...,None] if chg.any() else d0.astype(np.float32)
    diff=np.abs(d1-d0.astype(np.float32)).max(2)
    stats[n]={'changed_px':int((diff>2).sum()),'outside_mask_px':int(((diff>2)&(chg<=0)).sum())}
    # 2. night from new day
    n0=L(n,'_night').astype(np.float32)
    n1=night_s16.transfer(n0,d0,d1,chg>0.01)
    # 3. painted windows
    nw=0
    if n in ('lenin_1','lenin_2','lenin_6'):
        _,lbl,wins=win4.detect(n)
        n1,lit,nw=night_s16.paint_windows(n,n1,d0,lbl,env=env)
        stats[n]['windows_found']=len(wins); stats[n]['windows_lit']=nw
        if REP is not None:
            ov=d0.astype(np.float32).copy(); ov[lbl>0]=ov[lbl>0]*0.3+np.array([0,220,255])*0.7
            ov[lit>0.05]=np.array([255,140,0])
            Image.fromarray(ov.astype(np.uint8)).save(REP/('windows_overlay_%s.png'%n))
            # proof: lit pixels inside detected windows of the DAY drawing
            stats[n]['lit_px_outside_windows']=int(((lit>0.05)&~ndimage.binary_dilation(lbl>0,iterations=1)).sum())
    # 4. statue light
    side,k=STATUE[n]
    try:
        n1,sm=night_s16.light_statue(n1,d0,alpha,lamp_side=side,k=k)
    except Exception as e:
        stats[n]['statue_err']=str(e)
    # 5. silhouettes
    if n in SIL:
        hk=day_s16.HK[n]; hf=lambda y:hk[0]*y+hk[1]
        pts=[(u*W+dx,v*H+1) for u,v,dx in SIL[n]]
        n1,_=night_s16.silhouettes(n1,pts,hf)
    # 6. layers: bg / building follow day change (outside building only)
    bg0=L(n,'_bg').astype(np.float32)
    r=(d1+6)/(d0.astype(np.float32)+6)
    m=(chg>0.01)[...,None]
    bg1=np.where(m,bg0*r,bg0)
    if n=='lenin_6':   # кадр 5 бледный: насыщенность/контраст к кадру 1 (метод tools/color_match.py — перенос среднего/разброса, сила 0,7 по цвету, 0,55 по яркости; в Lab, бумага темнеет меньше)
        import gcolor
        e1=np.asarray(Image.open(SRC/'lenin_1_env.webp').convert('RGB'))[...,0]<100
        e6=env[...,0]<0.4
        before=gcolor.stats(d1,e6); ref=gcolor.stats(L('lenin_1'),e1)
        p=gcolor.params(before,ref,sL=0.7,sC=0.85)
        d1=gcolor.apply(d1,p); bg1=gcolor.apply(bg1,p)
        bl=L(n,'_building','RGBA').astype(np.float32); bl[...,:3]=gcolor.apply(bl[...,:3],p)
        Image.fromarray(bl.astype(np.uint8),'RGBA').save(OUT/(n+'_building.webp'),quality=92,method=6)
        stats[n]['color']={'frame1':ref,'before':before,'after':gcolor.stats(d1,e6),'params':p}
        # мягкий низ маски неба (линия через небо: маска неба резко обрывалась прямой строкой)
        envi=L(n,'_env').astype(np.float32)
        ys=np.where(envi[...,0].mean(1)>128)[0]; yb=int(ys.max()) if len(ys) else 0
        ramp=np.clip((yb-np.arange(H))/48.0,0,1)[:,None]
        envi[...,0]=np.minimum(envi[...,0],255*ramp**0.8)
        Image.fromarray(envi.astype(np.uint8)).save(OUT/(n+'_env.webp'),lossless=True)
        stats[n]['sky_mask_edge_row']=yb
    if stats[n]['changed_px']>0 or n=='lenin_6':
        save(d1,n); save(bg1,n+'_bg')
    save(n1,n+'_night')
    if REP is not None:
        dn=np.abs(d1-d0.astype(np.float32)).max(2)>2
        Image.fromarray((dn*255).astype(np.uint8)).save(REP/('day_diffmask_%s.png'%n))
        def pair(a,b):
            a=Image.fromarray(np.clip(a,0,255).astype(np.uint8)); b=Image.fromarray(np.clip(b,0,255).astype(np.uint8))
            c=Image.new('RGB',(W*2+12,H),'white'); c.paste(a,(0,0)); c.paste(b,(W+12,0)); return c
        pair(d0,d1).save(REP/('day_%s_before_after.jpg'%n),quality=88)
        pair(n0,n1).save(REP/('night_%s_before_after.jpg'%n),quality=88)
    print(n,stats[n],flush=True)
json.dump(stats,open(OUT/'s16_stats.json','w'),indent=1)
