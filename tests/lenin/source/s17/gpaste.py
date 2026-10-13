"""s17: вписать детали из правки Gemini в исходный рисунок.
Берутся только НОВЫЕ мелкие объекты в ПУСТЫХ местах исходника (низкая текстура), без неба, здания (вырезки), маски видео.
Каждая капля: пиксели Gemini + сдвиг тона по кольцу вокруг (фон = исходник), мягкий край. Вне маски — исходник пиксель в пиксель."""
import numpy as np, cv2
from scipy import ndimage
def lab(a): return cv2.cvtColor(np.clip(a,0,255).astype(np.uint8),cv2.COLOR_RGB2LAB).astype(np.float32)
def _hull(r):
    h=np.zeros(r.shape,np.uint8); pts=np.argwhere(r)[:,::-1].astype(np.int32)
    cv2.fillPoly(h,[cv2.convexHull(pts)],1); return h.astype(bool)|r
def detect(o,w,forbid,empty_t=7.0,de_t=16.0,dark_t=14.0,amin=6,hmax=40,wmax=60,empty_frac=0.6,grow=2,group=5,blue_drop=True,yhmax=None,hp=4.0,bg_t=5.0,near=12,thin_pass=False):
    """группа = соседние отличия (в пределах group px) = один объект; объект целиком берётся или отбрасывается.
    hmax/wmax — предел размера объекта (px), yhmax(y)->hmax по высоте кадра (перспектива)."""
    lo,lw=lab(o),lab(w)
    Lo=lo[...,0]*100/255
    m=cv2.GaussianBlur(Lo,(0,0),2.5); sd=np.sqrt(np.maximum(cv2.GaussianBlur(Lo*Lo,(0,0),2.5)-m*m,0))
    empty=sd<empty_t
    a=cv2.GaussianBlur(lo,(0,0),0.8); b=cv2.GaussianBlur(lw,(0,0),0.8)
    # только «штрих и мазок» (высокие частоты): разница общей заливки Gemini (другая акварель площади) не считается объектом
    ha=a-cv2.GaussianBlur(a,(0,0),hp); hb=b-cv2.GaussianBlur(b,(0,0),hp)
    dark=(ha[...,0]-hb[...,0])*100/255
    dC=np.sqrt(((ha[...,1:]-hb[...,1:])**2).sum(-1))*100/255
    cand=(dark>dark_t)|(dC>de_t)
    cand=ndimage.binary_closing(cand,iterations=1)
    # фон вокруг объекта: если Gemini там перерисовал саму землю (газон вместо мостовой) — объект не берём
    nm=(~ndimage.binary_dilation(cand,iterations=2)).astype(np.float32); den=cv2.GaussianBlur(nm,(0,0),5)+1e-3
    mb=lambda x: cv2.GaussianBlur(x*nm[...,None],(0,0),5)/den[...,None]
    bgd=np.sqrt(((mb(lo)-mb(lw))**2).sum(-1))*100/255
    bg_ref=float(np.median(bgd[empty&~forbid])) if (empty&~forbid).any() else 0.0
    def bg_bad(sl,r):
        y0,y1=max(0,sl[0].start-8),sl[0].stop+8; x0,x1=max(0,sl[1].start-8),sl[1].stop+8
        rr=np.zeros((y1-y0,x1-x0),bool); rr[sl[0].start-y0:sl[0].start-y0+r.shape[0],sl[1].start-x0:sl[1].start-x0+r.shape[1]]=r
        ring=ndimage.binary_dilation(rr,iterations=6)&~ndimage.binary_dilation(rr,iterations=2)
        v=bgd[y0:y1,x0:x1][ring[:bgd[y0:y1,x0:x1].shape[0],:bgd[y0:y1,x0:x1].shape[1]]]
        return len(v)>0 and np.median(v)>bg_ref+bg_t
    # A: объекты — группировка по «ядру» (без тонких линий: сдвинутые линии сетки/штриха не склеивают объекты)
    core=ndimage.binary_opening(cand,structure=np.ones((3,3)))
    # люди высокие: склеиваем по вертикали сильнее (верх тела на ступенях + ноги на плитах = один объект)
    kern=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*group+1,4*group+1)).astype(bool)
    grp,n=ndimage.label(ndimage.binary_dilation(core,structure=kern))
    grp=grp*(ndimage.binary_dilation(cand,structure=kern)&ndimage.binary_dilation(core,structure=kern))
    keep=np.zeros_like(cand); rejm=np.zeros_like(cand); bigm=np.zeros_like(cand); acc=[]; info=[]; rej={'small':0,'big':0,'notempty':0,'forbid':0,'blue':0,'thin':0}
    for i,sl in enumerate(ndimage.find_objects(grp),1):
        if sl is None: continue
        r=(grp[sl]==i)&cand[sl]; ar=int(r.sum())
        if ar<amin: rej['small']+=1; continue
        ys,xs=np.where(r); h=ys.max()-ys.min()+1; wd=xs.max()-xs.min()+1
        hm=yhmax(sl[0].start+ys.max()) if yhmax else hmax
        if h>hm or wd>max(wmax,hm*1.5): rej['big']+=1; rejm[sl]|=r; bigm[sl]|=True; rej.setdefault('L',[]).append(('big',sl[1].start,sl[0].start,int(h),int(wd))); continue
        if (forbid[sl][r]).mean()>0.02: rej['forbid']+=1; rejm[sl]|=r; bigm[sl]|=(h>=10); rej.setdefault('L',[]).append(('forbid',sl[1].start,sl[0].start,int(h),int(wd))); continue
        ef=float(empty[sl][r].mean())
        if ef<empty_frac: rej['notempty']+=1; rejm[sl]|=r; bigm[sl]|=(h>=10); rej.setdefault('L',[]).append(('ne',sl[1].start,sl[0].start,int(h),int(wd),round(ef,2))); continue
        if bg_bad(sl,r): rej['bg']=rej.get('bg',0)+1; rejm[sl]|=r; bigm[sl]|=(h>=10); continue
        if blue_drop:
            bb=b[sl][r]; 
            if np.median(bb[...,2])-128<-14 and np.median(bb[...,0])>90: rej['blue']+=1; rejm[sl]|=r; bigm[sl]|=(h>=10); continue
        hull=np.zeros(r.shape,np.uint8); pts=np.argwhere(r)[:,::-1].astype(np.int32)
        cv2.fillPoly(hull,[cv2.convexHull(pts)],1); hull=hull.astype(bool)|r
        acc.append((sl,hull)); info.append((int(sl[1].start),int(sl[0].start),ar,int(h),round(ef,2)))
    # объект рядом с отброшенным крупным (шарик отброшенной мамы, сумка) — тоже не берём: обрывки не нужны
    bigd=ndimage.binary_dilation(bigm,iterations=near)
    for sl,hull in acc:
        if (bigd[sl]&hull).any(): rej['nearbig']=rej.get('nearbig',0)+1; rejm[sl]|=hull; continue
        keep[sl]|=hull
    rejm=ndimage.binary_dilation(rejm,iterations=8)
    # B: тонкие метки (трещины, листья) — отдельно, только целиком в пустом месте
    thin=cand&~ndimage.binary_dilation(core,structure=kern)
    if not thin_pass: thin[:]=False   # s17: тонкие одиночные штрихи давали «призрачные дуги» (контур лужи без заливки) — по умолчанию не берём
    tl,tn=ndimage.label(thin)
    for i,sl in enumerate(ndimage.find_objects(tl),1):
        if sl is None: continue
        r=tl[sl]==i; ar=int(r.sum())
        if ar<amin or (sl[0].stop-sl[0].start)>30 or (sl[1].stop-sl[1].start)>40: continue
        if forbid[sl][r].any() or empty[sl][r].mean()<0.9 or rejm[sl][r].any(): continue
        if bg_bad(sl,r): rej['bg']=rej.get('bg',0)+1; continue
        keep[sl]|=r; rej['thin']+=1
    keep=ndimage.binary_dilation(keep,iterations=grow)&~forbid
    rej['bg_ref']=round(bg_ref,1)
    return keep,info,rej
def paste(o,w,keep,feather=1.2):
    o=o.astype(np.float32); w=w.astype(np.float32)
    lbl,n=ndimage.label(keep)
    wc=w.copy()
    for i,sl in enumerate(ndimage.find_objects(lbl),1):
        y0,y1=max(0,sl[0].start-6),sl[0].stop+6; x0,x1=max(0,sl[1].start-6),sl[1].stop+6
        r=lbl[y0:y1,x0:x1]==i
        ring=ndimage.binary_dilation(r,iterations=4)&~ndimage.binary_dilation(r,iterations=1)&~keep[y0:y1,x0:x1]
        if ring.sum()<5: continue
        off=np.median(o[y0:y1,x0:x1][ring]-w[y0:y1,x0:x1][ring],axis=0)
        sub=wc[y0:y1,x0:x1]; sub[r]=sub[r]+off
    a=cv2.GaussianBlur(keep.astype(np.float32),(0,0),feather)
    a=np.where(keep,np.maximum(a,0.0),a)
    a=np.clip(a*1.6,0,1)*ndimage.binary_dilation(keep,iterations=3)
    out=o*(1-a[...,None])+wc*a[...,None]
    paste.wc=wc   # пиксели Gemini после подгонки тона (для патча)
    return out,a
