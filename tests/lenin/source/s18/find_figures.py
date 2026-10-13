"""s18 шаг 1: кандидаты в «фигуры» = объекты, которые s17 вписал из Gemini (патч source/s17/patches/<кадр>.png = отличие от s15).
Компоненты альфы патча (части одного объекта склеиваются), размер/цвет/слой -> черновой тип. Итог правится руками в FIX ниже."""
import sys, json, numpy as np, cv2
from PIL import Image
from scipy import ndimage
sys.path.insert(0,'source/s18'); import esim
OUT='source/s18/figs'; import os; os.makedirs(OUT,exist_ok=True)
res={}
for n in esim.FR:
    P=np.asarray(Image.open('source/s17/patches/%s.png'%n).convert('RGBA')).astype(np.float32)
    a=P[...,3]/255; d=esim.load('.',n).astype(np.float32); al=esim.load('.',n,'_building','RGBA')[...,3]
    H,W=a.shape
    m=a>0.15
    grp=ndimage.binary_dilation(m,iterations=2)
    lab,nn=ndimage.label(grp)
    items=[]
    hsv=cv2.cvtColor(d.astype(np.uint8),cv2.COLOR_RGB2HSV).astype(np.float32)
    for i,sl in enumerate(ndimage.find_objects(lab),1):
        r=(lab[sl]==i)&m[sl]
        if r.sum()<6: continue
        ys,xs=np.where(r); y0,y1=sl[0].start+ys.min(),sl[0].start+ys.max(); x0,x1=sl[1].start+xs.min(),sl[1].start+xs.max()
        h=y1-y0+1; w=x1-x0+1
        sat=float(hsv[...,1][sl][r].mean()); val=float(hsv[...,2][sl][r].mean()); hue=float(np.median(hsv[...,0][sl][r]))*2
        inb=float((al[sl][r]>10).mean())
        dark=float((hsv[...,2][sl][r]<110).mean())
        items.append(dict(id=len(items),box=[int(x0),int(y0),int(x1),int(y1)],h=int(h),w=int(w),px=int(r.sum()),sat=round(sat,1),val=round(val,1),hue=round(hue),bld=round(inb,2),dark=round(dark,2)))
    res[n]=items
    print(n,len(items),'h-dist',sorted([it['h'] for it in items])[::-1][:30])
json.dump(res,open(OUT+'/candidates.json','w'),indent=0)
