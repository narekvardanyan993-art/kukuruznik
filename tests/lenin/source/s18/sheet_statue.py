"""лист: статуя s17 и s18 (день — математика движка, у s18 с look.day.bldGreen false; ночь — NIGHT_DIM) + таблица"""
import sys, json, numpy as np
from PIL import Image
sys.path.insert(0,'source/s18'); sys.path.insert(0,'source/s16'); sys.path.insert(0,'source/s17')
import esim, night_s16, night_s17
NEW=sys.argv[1]; OUTP=sys.argv[2]; OLD=sys.argv[3] if len(sys.argv)>3 else None   # OLD — папка с кадрами s17 (run_s17.py)
tiles=[]
for n in esim.FR:
    d15=esim.load('.',n,d='source/night/s15src'); a=esim.load('.',n,'_building','RGBA')[...,3]
    st0,_,_,_=night_s16.statue_mask(d15,a); st,_=night_s17.clean_statue(st0,d15)
    o=np.asarray(Image.open(f'{OLD}/{n}.webp').convert('RGB')) if OLD else esim.load('.',n); on=np.asarray(Image.open(f'{OLD}/{n}_night.webp').convert('RGB')) if OLD else esim.load('.',n,'_night'); nw=np.asarray(Image.open(f'{NEW}/{n}.webp').convert('RGB')); nn=np.asarray(Image.open(f'{NEW}/{n}_night.webp').convert('RGB'))
    ys,xs=np.where(st); y0,y1,x0,x1=ys.min(),ys.max(),xs.min(),xs.max(); pad=max(12,int(0.08*(y1-y0)))
    sl=(slice(max(0,y0-pad),y1+pad),slice(max(0,x0-pad),x1+pad))
    ims=[esim.day(o)[sl],esim.day(nw)[sl],esim.night(on)[sl],esim.night(nn)[sl]]
    sc=320/ims[0].shape[0]
    t=[Image.fromarray(np.clip(i,0,255).astype(np.uint8)).resize((max(1,int(i.shape[1]*sc)),320),Image.LANCZOS) for i in ims]
    c=Image.new('RGB',(sum(x.width for x in t)+40,320),'white'); x=0
    for q in t: c.paste(q,(x,0)); x+=q.width+12
    tiles.append(c)
W=max(t.width for t in tiles); S=Image.new('RGB',(W,330*len(tiles)),'white')
for i,t in enumerate(tiles): S.paste(t,(0,i*330))
S.save(OUTP,quality=88)
