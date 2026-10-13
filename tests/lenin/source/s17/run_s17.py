"""s17 Ленин: откат кодовых деталей s16 (день/фон — снова s15), детали Gemini (патчи make_patches.py), кадр 5 — цвет к кадру 1 вполсилы s16,
ночь из нового дня (метод s16) + нарисованные окна (s16) + прожектор на статую (night_s17), без кодовых силуэтов людей.
python3 run_s17.py <tests/lenin> <out_frames_dir> [--report DIR]   (повторяемый: источник — source/night/s15src + source/s17/patches)"""
import sys, json, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
B=Path(sys.argv[1]); OUT=Path(sys.argv[2]); OUT.mkdir(parents=True,exist_ok=True)
SRC=B/'source/night/s15src'; HERE=Path(__file__).parent
REP=Path(sys.argv[sys.argv.index('--report')+1]) if '--report' in sys.argv else None
if REP: REP.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(HERE)); sys.path.insert(0,str(B/'source/s16'))
import common, night_s17, nightcheck, night_s16, win4, gcolor
win4.S=str(SRC)+'/'
FR=common.FR
def L(n,suf='',mode='RGB'): return np.asarray(Image.open(SRC/(n+suf+'.webp')).convert(mode))
def save(a,name,q=92):
    Image.fromarray(np.clip(np.round(a),0,255).astype(np.uint8)).save(OUT/(name+'.webp'),quality=q,method=6)
TARGET=2.2          # статуя ночью ≥ 2× фона вокруг (с запасом)
POOL={'lenin_4':False,'lenin_2':False,'lenin_6':False}   # виды сверху: пятно на земле давало ореол вокруг постамента
FL={'lenin_2':dict(ped_soft=0.35),'lenin_6':dict(ped_soft=0.35)}   # виды сверху: постамент и пятно скромнее
stats={}
for n in FR:
    st_={}
    d0=L(n).astype(np.float32); H,W=d0.shape[:2]
    alpha=L(n,'_building','RGBA')[...,3]; env=L(n,'_env').astype(np.float32)/255
    # 1. день: s15 + патч Gemini (вне патча — пиксель в пиксель s15)
    P=np.asarray(Image.open(HERE/'patches'/(n+'.png')).convert('RGBA')).astype(np.float32)
    a=P[...,3]/255; d1=d0*(1-a[...,None])+P[...,:3]*a[...,None]
    diff=np.abs(d1-d0).max(2)
    st_['patch_px']=int((a>0.01).sum()); st_['changed_px']=int((diff>0.5).sum()); st_['changed_outside_patch_px']=int(((diff>0.5)&(a<=0)).sum())
    fb,_=common.forbid2(str(B),n,grow=0)
    st_['changed_in_forbidden_px']=int(((diff>0.5)&fb).sum())
    if REP is not None: Image.fromarray(((diff>0.5)*255).astype(np.uint8)).save(REP/('day_diffmask_%s.png'%n))
    chg=a
    # 2. фон и вырезка следуют за днём
    bg0=L(n,'_bg').astype(np.float32); r=(d1+6)/(d0+6)
    bg1=np.where((chg>0.01)[...,None]&(alpha<10)[...,None],bg0*r,bg0)
    bl=L(n,'_building','RGBA').astype(np.float32); bl_changed=False
    if ((chg>0.01)&(alpha>=10)).any():          # кадр 4: листья/травинки на постаменте — и в слой вырезки
        m=(chg>0.01)&(alpha>=10); bl[...,:3][m]=d1[m]; bl_changed=True
    d1n=d1.copy()   # день до цветокоррекции — для ночи (как в s16)
    if n=='lenin_6':   # кадр 5: цвет к кадру 1 ВПОЛСИЛЫ s16 (s16: sL 0,7, sC 0,85 -> здесь половина результата)
        e1=L('lenin_1','_env')[...,0]<100; e6=env[...,0]<0.4
        before=gcolor.stats(d1,e6); ref=gcolor.stats(L('lenin_1'),e1)
        p=gcolor.params(before,ref,sL=0.7,sC=0.85)
        half=lambda x: x+0.5*(gcolor.apply(x,p)-x)
        d1=half(d1); bg1=half(bg1); bl[...,:3]=half(bl[...,:3]); bl_changed=True
        st_['color']={'frame1':ref,'before':before,'after':gcolor.stats(d1,e6),'params_full_s16':p,'strength':0.5}
    save(d1,n); save(bg1,n+'_bg')
    if bl_changed: Image.fromarray(np.clip(np.round(bl),0,255).astype(np.uint8),'RGBA').save(OUT/(n+'_building.webp'),quality=92,method=6)
    # 3. ночь из нового дня (s16), окна (s16), без кодовых людей
    n0=L(n,'_night').astype(np.float32)
    n1=night_s16.transfer(n0,d0,d1n,chg>0.01)
    if n in ('lenin_1','lenin_2','lenin_6'):
        _,lbl,wins=win4.detect(n)
        n1,lit,nw=night_s16.paint_windows(n,n1,d0.astype(np.uint8),lbl,env=env)
        st_['windows_found']=len(wins); st_['windows_lit']=nw
    # 4. прожектор на статую: подбираем силу, пока в ИТОГЕ движка статуя ≥ TARGET× фона вокруг
    stm,_,_,_=night_s16.statue_mask(d0.astype(np.uint8),alpha)
    stm,gap=night_s17.clean_statue(stm,d0)
    st_['statue_gap_px']=int(gap.sum())
    excl=alpha>128
    sky=env[...,0]>0.4
    before=nightcheck.measure(n1,stm,sky,exclude=excl)
    k=0.9
    for it in range(12):
        nl,info=night_s17.floodlight(n1,d1n,alpha,stm,k=k,pool_on=POOL.get(n,True),**FL.get(n,{}))
        m=nightcheck.measure(nl,stm,sky,exclude=excl)
        if m['ratio']>=TARGET or k>=2.4: break
        k*=1.12
    n1=nl
    st_['statue']=dict(before_s15night=before,after=m,k=round(k,3),**info)
    save(n1,n+'_night')
    if REP is not None:
        def pair(x,y):
            x=Image.fromarray(np.clip(x,0,255).astype(np.uint8)); y=Image.fromarray(np.clip(y,0,255).astype(np.uint8))
            c=Image.new('RGB',(W*2+12,H),'white'); c.paste(x,(0,0)); c.paste(y,(W+12,0)); return c
        pair(d0,d1).save(REP/('day_%s_s15_vs_s17.jpg'%n),quality=88)
    stats[n]=st_
    print(n,json.dumps(st_,ensure_ascii=False,default=float)[:400],flush=True)
json.dump(stats,open(OUT/'s17_stats.json','w'),indent=1,default=float,ensure_ascii=False)
