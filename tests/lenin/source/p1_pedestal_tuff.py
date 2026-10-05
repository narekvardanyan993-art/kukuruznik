"""Ленин P1 (05.10.2026), решение Нарека: C/D/E постамент розовый как lenin_1.
Запуск: python3 p1_pedestal_tuff.py <src.jpg> <dst.jpg> <lenin_N> [overlay.jpg]
Recolor gray pedestal/tribunes to pink tuff (Lab ab shift, L untouched → pencil lines intact)."""
import sys, numpy as np, cv2
from PIL import Image, ImageDraw
TUFF=(10.5,9.0); STEPS=(5.5,8.0)
POLY={
 'lenin_3':{'stone':[[(640,1115),(900,1115),(900,1745),(640,1745)],[(0,1735),(1536,1735),(1536,2005),(0,2005)]],
            'steps':[[(0,2000),(1536,2000),(1536,2115),(0,2115)]]},
 'lenin_4':{'stone':[[(190,1962),(1350,1962),(1350,2320),(1475,2320),(1475,2752),(65,2752),(65,2320),(190,2320)]],'steps':[]},
 'lenin_5':{'stone':[[(118,1122),(330,1122),(330,1580),(680,1580),(680,1850),(160,1850),(160,1600),(118,1600)],
                     [(0,1380),(190,1420),(190,1900),(0,2480)],
                     [(1150,1945),(1536,1985),(1536,2340),(1150,2010)]],
            'steps':[[(380,1850),(900,2040),(1310,2205),(1310,2300),(720,2325),(380,1905)]]},
}
def mask(shape,polys):
    m=Image.new('L',(shape[1],shape[0]),0); d=ImageDraw.Draw(m)
    for p in polys: d.polygon(p,fill=255)
    return cv2.GaussianBlur(np.array(m,np.float32)/255,(0,0),6)
def run(src,dst,fid,ov):
    rgb=np.array(Image.open(src).convert('RGB')).astype(np.float32)/255
    lab=cv2.cvtColor(rgb,cv2.COLOR_RGB2LAB); L,a,b=lab[...,0],lab[...,1],lab[...,2]
    C=np.hypot(a,b)
    gray=np.clip((20-C)/8,0,1)*(b>-4)          # trees (C>20) and sky blue excluded
    hl=np.clip((97-L)/10,0,1)                  # paper-white highlights stay
    out_a,out_b=a.copy(),b.copy()
    for key,tgt in (('stone',TUFF),('steps',STEPS)):
        if not POLY[fid][key]: continue
        m=mask(L.shape,POLY[fid][key]); w=m*gray*hl
        sel=(m>0.5)&(gray>0.5)
        ma,mb=a[sel].mean(),b[sel].mean()
        na,nb=a-ma+tgt[0],b-mb+tgt[1]          # keep wash texture, move mean to tuff
        out_a=out_a*(1-w)+na*w; out_b=out_b*(1-w)+nb*w
        print(fid,key,'before a%.1f b%.1f'%(ma,mb))
    lab2=np.dstack([L,out_a,out_b]); res=np.clip(cv2.cvtColor(lab2,cv2.COLOR_LAB2RGB),0,1)
    Image.fromarray((res*255+.5).astype(np.uint8)).save(dst,quality=98,subsampling=0)
    if ov:
        o=(rgb*255).astype(np.uint8).copy(); mm=np.zeros(L.shape,np.float32)
        for k in ('stone','steps'):
            if POLY[fid][k]: mm=np.maximum(mm,mask(L.shape,POLY[fid][k])*gray)
        o[...,1]=(o[...,1]*(1-mm*.6)).astype(np.uint8); Image.fromarray(o).save(ov)
if __name__=='__main__': run(sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4] if len(sys.argv)>4 else None)
