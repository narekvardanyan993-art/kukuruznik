"""s18: «фигуры» — мелкие объекты рисунка, которые движок e1.22 чуть оживляет на месте (FIGURES): люди, игроки в нарды, голуби,
шарик, листья, трава. Источник — объекты, вписанные в s17 из Gemini (альфа патча source/s17/patches = отличие от s15),
кандидаты — find_figures.py (figs/candidates.json), выбор и тип — SPEC ниже (полуавтомат: глазами по figs/cand_<кадр>.jpg).
Итог: frames/<кадр>_fig.png (мягкая маска, 0..255) и список в building.json: frames[i].figures.items = [[u0, v0, u1, v1, тип, сторона]].
python3 build_figures.py <tests/lenin> [--write]"""
import sys, json, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
B=Path(sys.argv[1]); WRITE='--write' in sys.argv
sys.path.insert(0,str(B/'source/s18')); import esim
C=json.load(open(B/'source/s18/figs/candidates.json'))
# ('c', id, тип[, opts]) — кандидат целиком; ('s', id, тип, opts) — кандидат-группа делится на части (min px, max штук);
# ('r', [x0, y0, x1, y1], тип[, opts]) — прямоугольник (пиксели кадра) по альфе патча; opts: side +1/−1 (куда смотрит), clip
SPEC={
 'lenin_1':[('c',0,'stand'),('c',3,'pigeon'),('s',7,'pigeon',dict(min=150,max=4)),('c',9,'pigeon'),('c',10,'pigeon'),('c',11,'pigeon'),('c',15,'pigeon'),
            ('c',1,'grass'),('c',6,'grass'),('c',16,'grass'),('c',17,'grass'),('c',19,'grass'),
            ('c',13,'leaf'),('c',20,'leaf'),('c',24,'leaf'),('c',25,'leaf'),('c',26,'leaf')],
 'lenin_2':[('c',0,'stand'),('c',1,'stand'),('c',3,'stand'),('c',6,'stand'),('c',10,'stand'),('c',2,'balloon'),('c',4,'stand'),
            ('c',13,'sit'),('c',17,'sit'),
            ('s',5,'pigeon',dict(min=15,max=3)),('c',7,'pigeon'),('s',12,'pigeon',dict(min=15,max=4)),('c',15,'pigeon'),('s',33,'pigeon',dict(min=15,max=5))],
 'lenin_3':[('r',[597,916,643,1005],'chess',dict(side=1)),('r',[671,916,715,980],'chess',dict(side=-1)),('r',[728,912,755,980],'stand'),
            ('c',3,'pigeon'),('s',4,'pigeon',dict(min=300,max=2)),('c',8,'pigeon'),('s',12,'pigeon',dict(min=300,max=1)),('c',14,'pigeon'),
            ('c',2,'grass'),('c',5,'grass'),('c',7,'grass'),('c',9,'grass'),('c',11,'grass'),('c',17,'grass'),('c',19,'grass'),('c',24,'grass'),('c',27,'grass'),('c',28,'grass')],
 'lenin_4':[('c',0,'leaf'),('c',1,'leaf'),('c',13,'grass'),('c',15,'grass'),('c',14,'grass'),('c',16,'grass')],
 'lenin_6':[('c',0,'stand'),('c',1,'stand'),('c',2,'stand'),('c',3,'stand'),('c',4,'stand'),('c',5,'stand'),('c',6,'stand'),('c',7,'stand'),('c',18,'stand'),('c',10,'stand'),
            ('c',27,'balloon'),('c',8,'balloon'),
            ('s',22,'pigeon',dict(min=15,max=3)),('s',35,'pigeon',dict(min=15,max=5)),('s',16,'pigeon',dict(min=15,max=2)),('c',34,'pigeon'),('c',36,'pigeon')],
}
TYPES=['sit','stand','chess','pigeon','balloon','leaf','grass']
def side_auto(m):
    """куда смотрит (голубь: голова — верхняя часть самого крупного куска; крошки/тени рядом не в счёт)"""
    lab,n=ndimage.label(m>0.4)
    if n==0: return 1
    sz=ndimage.sum(m>0.4,lab,range(1,n+1)); big=lab==(int(np.argmax(sz))+1)
    ys,xs=np.where(big)
    if len(ys)<4: return 1
    top=ys<=ys.min()+0.3*(ys.max()-ys.min()+1)
    return 1 if xs[top].mean()>=(xs.min()+xs.max())/2 else -1
out={}; report={}
for n,spec in SPEC.items():
    P=np.asarray(Image.open(B/'source/s17/patches'/(n+'.png')).convert('RGBA')).astype(np.float32); a=P[...,3]/255
    H,W=a.shape; cand={c['id']:c for c in C[n]}
    m0=a>0.15; grp=ndimage.binary_dilation(m0,iterations=2); lab,_=ndimage.label(grp)
    # сам объект — где рисунок s17 отличается от s15 (ΔE Lab > 12) внутри патча: альфа патча — сплошное пятно (птицы стаи в одном),
    # отличие от s15 — силуэт: голуби стаи разделяются, земля вокруг почти не двигается
    d0=esim.load(str(B),n,d='source/night/s15src').astype(np.float32); d1=d0*(1-a[...,None])+P[...,:3]*a[...,None]
    dE=np.sqrt(((cv2.cvtColor(d1/255,cv2.COLOR_RGB2LAB)-cv2.cvtColor(d0/255,cv2.COLOR_RGB2LAB))**2).sum(-1))
    obj=ndimage.binary_fill_holes(ndimage.binary_closing((dE>12)&(a>0.1),iterations=1))
    objs=np.where(obj,np.maximum(a,0.5),0).astype(np.float32)   # мягкость края — из альфы патча
    figs=[]
    for e in spec:
        kind,ref,typ=e[0],e[1],e[2]; opt=e[3] if len(e)>3 else {}
        parts=[]
        if kind=='r':
            x0,y0,x1,y1=ref; mm=np.zeros_like(a); mm[y0:y1+1,x0:x1+1]=objs[y0:y1+1,x0:x1+1]; parts=[mm]
        else:
            b=cand[ref]['box']; sl=(slice(b[1],b[3]+1),slice(b[0],b[2]+1))
            ids=np.unique(lab[sl][m0[sl]]); ids=ids[ids>0]
            comp=np.isin(lab,ids)&m0
            boxm=np.zeros_like(obj); boxm[max(0,b[1]-3):b[3]+4,max(0,b[0]-3):b[2]+4]=True   # только свой кандидат (соседние группы не захватывать)
            reg=ndimage.binary_dilation(comp,iterations=2)&obj&boxm
            if kind=='c':
                mm=np.zeros_like(a); mm[reg]=objs[reg]
                if mm.sum()<6: mm[comp]=a[comp]
                parts=[mm]
            elif reg.sum()>0:
                fl,k=ndimage.label(ndimage.binary_dilation(reg,iterations=1)&reg)
                cs=sorted([(int((fl==f).sum()),f) for f in range(1,k+1) if (fl==f).sum()>=opt.get('min',30)],reverse=True)
                for _,f in cs[:opt.get('max',9)]:
                    r=fl==f; mm=np.zeros_like(a); mm[r]=objs[r]; parts.append(mm)
            else:
                # группа (стая): водораздел по расстоянию до края, метки — ядра после сужения (тени-перемычки между птицами рвутся)
                from skimage.segmentation import watershed
                core=comp&(a>0.35)
                mk,_=ndimage.label(ndimage.binary_erosion(core,iterations=opt.get('erode',1)))
                ws=watershed(-ndimage.distance_transform_edt(comp),mk,mask=comp)
                cs=[]
                for f in np.unique(ws[ws>0]):
                    r=ws==f
                    if r.sum()>=opt.get('min',30): cs.append((int(r.sum()),f))
                cs.sort(reverse=True)
                for _,f in cs[:opt.get('max',9)]:
                    r=ws==f; mm=np.zeros_like(a); mm[r]=a[r]; parts.append(mm)
        for mm in parts:
            core=mm>0.05
            if core.sum()<6: continue
            soft=np.maximum(cv2.GaussianBlur(cv2.dilate(mm,np.ones((3,3),np.uint8)),(0,0),1.2)*1.25,mm)
            soft=np.clip(soft,0,1); soft[soft<0.02]=0
            ys,xs=np.where(soft>0)
            x0,x1,y0,y1=max(0,xs.min()-1),min(W-1,xs.max()+1),max(0,ys.min()-1),min(H-1,ys.max()+1)
            side=opt.get('side') or side_auto(mm)
            figs.append(dict(type=typ,side=int(side),box=[int(x0),int(y0),int(x1),int(y1)],mask=soft,src=(kind,ref)))
    mask=np.zeros((H,W),np.float32)
    for f in figs: mask=np.maximum(mask,f['mask'])
    al=np.asarray(Image.open(B/'frames'/(n+'_building.webp')).convert('RGBA'))[...,3]
    def layer(f):   # 1 — фигура на слое здания (кадр 4: листья и трава на постаменте)
        mm=f['mask']>0.3; return 1 if mm.sum() and (al[mm]>128).mean()>0.5 else 0
    items=[[round(f['box'][0]/W,5),round(f['box'][1]/H,5),round((f['box'][2]+1)/W,5),round((f['box'][3]+1)/H,5),f['type'],f['side']]+([1] if layer(f) else []) for f in figs]
    out[n]=items
    report[n]=dict(n=len(items),by_type={t:sum(1 for f in figs if f['type']==t) for t in TYPES if any(f['type']==t for f in figs)},
                   max_h_px=max(f['box'][3]-f['box'][1]+1 for f in figs),mask_px=int((mask>0.02).sum()))
    report[n]['on_building_layer']=sum(1 for it in items if len(it)==7)
    print(n,report[n])
    if WRITE:
        Image.fromarray(np.clip(np.round(mask*255),0,255).astype(np.uint8),'L').save(B/'frames'/(n+'_fig.png'),optimize=True)
    # оверлей: рамки + тип
    d=Image.fromarray(esim.load(str(B),n)); from PIL import ImageDraw
    k=2; bx=np.array([f['box'] for f in figs]); X0,Y0=max(0,bx[:,0].min()-24),max(0,bx[:,1].min()-24); X1,Y1=min(W,bx[:,2].max()+24),min(H,bx[:,3].max()+24)
    c=d.crop((X0,Y0,X1,Y1)).resize(((X1-X0)*k,(Y1-Y0)*k),Image.LANCZOS); dr=ImageDraw.Draw(c)
    col={'pigeon':(0,110,255),'sit':(230,0,0),'stand':(220,0,200),'chess':(255,110,0),'balloon':(0,170,0),'leaf':(140,80,0),'grass':(90,140,0)}
    for i,f in enumerate(figs):
        b=f['box']; cc=col[f['type']]
        dr.rectangle([(b[0]-X0)*k,(b[1]-Y0)*k,(b[2]-X0+1)*k,(b[3]-Y0+1)*k],outline=cc,width=2)
        dr.text(((b[0]-X0)*k,(b[1]-Y0)*k-11),'%d %s%s'%(i,f['type'],'>' if f['side']>0 else '<'),fill=cc)
    (B/'report/s18').mkdir(parents=True,exist_ok=True)
    c.save(B/'report/s18'/('figures_overlay_%d.jpg'%esim.VIEW[n]),quality=88)
json.dump(dict(items=out,report=report),open(B/'source/s18/figs/figures.json','w'),indent=1)
if WRITE:   # building.json: frames[i].figures — вставка текстом (ручное оформление файла не трогаем), старые figures заменяются
    txt=(B/'building.json').read_text(encoding='utf-8')
    def span(t,start):   # объект JSON с началом в start ('{'): индекс закрывающей скобки
        d=0; q=False; e=False
        for k in range(start,len(t)):
            ch=t[k]
            if q:
                if e: e=False
                elif ch=='\\': e=True
                elif ch=='"': q=False
                continue
            if ch=='"': q=True
            elif ch in '{[': d+=1
            elif ch in '}]':
                d-=1
                if d==0: return k
        raise ValueError
    import re
    for name,items in out.items():
        m=re.search(r'"name":\s*"%s"'%name,txt); st=txt.rfind('{',0,m.start()); en=span(txt,st)
        obj=txt[st:en+1]
        fm=re.search(r',\s*"figures":\s*\{',obj)
        if fm: obj=obj[:fm.start()]+obj[span(obj,fm.end()-1)+1:]
        body=obj.rstrip()[:-1].rstrip()
        ind='      '
        lines=',\n'.join(ind+'  '+json.dumps(it,ensure_ascii=False) for it in items)
        obj=body+',\n'+ind+'"figures": {"items": [\n'+lines+'\n'+ind+']}\n    }'
        txt=txt[:st]+obj+txt[en+1:]
    json.loads(txt)
    (B/'building.json').write_text(txt,encoding='utf-8')
