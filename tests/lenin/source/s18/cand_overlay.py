import sys, json, numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0,'source/s18'); import esim
C=json.load(open(sys.argv[1])); key=sys.argv[2] if len(sys.argv)>2 else None
for n,items in C.items():
    d=Image.fromarray(esim.load('.',n)); H=d.height
    bx=np.array([it['box'] for it in items])
    x0,y0=max(0,bx[:,0].min()-20),max(0,bx[:,1].min()-20); x1,y1=min(768,bx[:,2].max()+20),min(H,bx[:,3].max()+20)
    k=2; c=d.crop((x0,y0,x1,y1)).resize(((x1-x0)*k,(y1-y0)*k),Image.LANCZOS); dr=ImageDraw.Draw(c)
    for it in items:
        b=it['box']; col={'pigeon':(0,120,255),'sit':(255,0,0),'stand':(255,0,200),'chess':(255,120,0),'balloon':(0,200,0),'leaf':(140,90,0)}.get(it.get('type'),(90,90,90))
        dr.rectangle([(b[0]-x0-1)*k,(b[1]-y0-1)*k,(b[2]-x0+1)*k,(b[3]-y0+1)*k],outline=col,width=2)
        dr.text(((b[0]-x0)*k,(b[1]-y0)*k-11),str(it['id'])+(' '+it['type'] if it.get('type') else ''),fill=col)
    c.save('source/s18/figs/%s_%s.jpg'%(key or 'cand',n),quality=88)
    print(n,c.size)
