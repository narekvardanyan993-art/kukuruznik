"""s18: фигуры движка e1.22 без браузера — та же математика сдвига, что в шейдере (figWarp), движение — из engine/viewer.js
(fig_motion_dump.js, шаг 60 Гц). Лента 6 кадров за 10 с и GIF 40 кадров за 10 с для 3 вырезок (увеличено ×4).
python3 fig_preview.py <tests/lenin> <out_dir>"""
import sys, json, subprocess, numpy as np, cv2
from pathlib import Path
from PIL import Image, ImageDraw
B=Path(sys.argv[1]); OUT=Path(sys.argv[2]); OUT.mkdir(parents=True,exist_ok=True)
HERE=Path(__file__).parent
FR=['lenin_1','lenin_2','lenin_3','lenin_4','lenin_6']; TYPES=['sit','stand','chess','pigeon','balloon','leaf','grass']
def ss(a,b,x): t=np.clip((x-a)/(b-a),0,1); return t*t*(3-2*t)
def motion(idx,T,N):
    r=subprocess.run(['node',str(HERE/'fig_motion_dump.js'),str(B/'building.json'),str(idx),str(T),str(N)],capture_output=True,text=True,check=True)
    return json.loads(r.stdout)
def half_mask(n,H,W):
    fig=np.asarray(Image.open(B/'frames'/(n+'_fig.png')).convert('L')).astype(np.float32)
    env=np.asarray(Image.open(B/'frames'/(n+'_env.webp')).convert('RGB'))
    ew,eh=(W+1)//2,(H+1)//2; ys,xs=np.mgrid[0:eh,0:ew]
    s0=(np.minimum(H-1,ys*2),np.minimum(W-1,xs*2)); s1=(np.minimum(H-1,ys*2+1),np.minimum(W-1,xs*2+1))
    tree=((env[s0][...,1].astype(int)+env[s1][...,1])>>1)
    a=((fig[s0].astype(int)+fig[s1].astype(int))>>1).astype(np.float32)
    a[tree>2]=0
    return a/255, tree/255
def bilin(img,x,y):   # img HxW(xC), x,y — координаты в пикселях текстуры (центр пикселя = i+0.5)
    return cv2.remap(img.astype(np.float32),(x-0.5).astype(np.float32),(y-0.5).astype(np.float32),cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
def warp(n,day,buf,items,box):
    H,W=day.shape[:2]; x0,y0,x1,y1=box
    am,tb=half_mask(n,H,W); eh,ew=am.shape
    ys,xs=np.mgrid[y0:y1,x0:x1].astype(np.float32); u=(xs+0.5)/W; v=(ys+0.5)/H
    m=bilin(am,u*ew,v*eh); t_b=bilin(tb,u*ew,v*eh)
    best=np.full(u.shape,1e3,np.float32); dx=np.zeros_like(u); dy=np.zeros_like(u)
    F=np.array(buf,np.float32).reshape(-1,8)
    cand=[]
    for j,f in enumerate(F):
        rx,ry,rz,rw=f[:4]; rwid=rz-np.floor(rz); s=(u-rx)/rwid; t=(v-ry)/rw
        inside=(s>=0)&(s<=1)&(t>=0)&(t<=1); dd=(s-0.5)**2+(t-0.5)**2
        upd=inside&(dd<best); best=np.where(upd,dd,best)
        cand.append((upd,j,s,t))
    owner=np.full(u.shape,-1)
    for upd,j,s,t in cand: owner[upd]=j
    for upd,j,s,t in cand:
        sel=owner==j
        if not sel.any(): continue
        f=F[j]; code=np.floor(f[2]); ty=np.floor(code*0.5+0.01); side=1.0 if code-2*ty>0.5 else -1.0
        M=f[4:]; fs=s if side>0 else 1-s
        if ty<2.5:
            body=np.clip((0.62-t)/0.62,0,1) if ty<0.5 else 1-t; head=1-ss(0.16,0.32,t)
            vx=M[0]*body; vy=M[1]*body+M[3]*head
            if ty>1.5:
                arm=ss(0.42,0.8,fs)*ss(0.22,0.4,t)*(1-ss(0.6,0.8,t)); vx=vx+side*M[2]*arm; vy=vy+0.35*M[2]*arm
            else: vx=vx+M[2]*(s-0.5)*2*head
        elif ty<3.5:
            hz=ss(0.42,0.72,fs)*(1-ss(0.42,0.7,t)); vx=M[0]+side*M[2]*hz; vy=M[1]+M[3]*hz
        elif ty<4.5: k=1-ss(0.38,0.75,t); vx=M[0]*k; vy=M[1]*k
        elif ty<5.5: k=0.6+0.4*(1-t); vx=M[0]*k; vy=M[1]*k
        else: k=(1-t)**2; vx=M[0]*k; vy=M[1]*k
        rp=((f[2]-np.floor(f[2]))*W, f[3]*H); edge=np.minimum(np.minimum(s,1-s)*rp[0],np.minimum(t,1-t)*rp[1])
        g=m*ss(0,2,edge)*(t_b<0.008)
        dx=np.where(sel,vx*g,dx); dy=np.where(sel,vy*g,dy)
    out=np.dstack([bilin(day[...,c],xs+0.5-dx,ys+0.5-dy) for c in range(3)])   # сдвиг в px кадра: выборка из q − d
    return out, float(np.abs(dx).max()), float(np.abs(dy).max())
CROPS=[('lenin_3',[570,905,768,1012],'nardy (frame 3)'),('lenin_1',[120,1095,345,1215],'pigeons (frame 1)'),('lenin_6',[300,920,390,995],'balloon (frame 5)')]
T=10.0; strips=[]; gif=[]; info={}
for n,box,label in CROPS:
    idx=FR.index(n); day=np.asarray(Image.open(B/'frames'/(n+'.webp')).convert('RGB')).astype(np.float32)
    S6=motion(idx,T,6); S40=motion(idx,T,40)
    k=4; tiles=[]
    for fr in S6['frames']:
        o,mx,my=warp(n,day,fr['buf'],S6['items'],box); tiles.append(Image.fromarray(np.clip(o,0,255).astype(np.uint8)).resize(((box[2]-box[0])*k,(box[3]-box[1])*k),Image.LANCZOS))
    w=tiles[0].width; h=tiles[0].height; st=Image.new('RGB',(w*6+5*6,h+16),'white'); d=ImageDraw.Draw(st)
    for i,tl in enumerate(tiles): st.paste(tl,(i*(w+6),16)); d.text((i*(w+6)+4,2),'%s  t=%.1f s'%(label,S6['frames'][i]['t']),fill=(0,0,0))
    strips.append(st)
    fr40=[]; mxs=[]
    for fr in S40['frames']:
        o,mx,my=warp(n,day,fr['buf'],S40['items'],box); mxs.append(max(mx,my)); fr40.append(Image.fromarray(np.clip(o,0,255).astype(np.uint8)).resize(((box[2]-box[0])*2,(box[3]-box[1])*2),Image.LANCZOS))
    gif.append(fr40); info[label]=dict(frame=idx+1,max_shift_px=round(max(mxs),2))
W_=max(s.width for s in strips); S=Image.new('RGB',(W_,sum(s.height+8 for s in strips)),'white'); y=0
for s in strips: S.paste(s,(0,y)); y+=s.height+8
S.save(OUT/'figures_strip_6x10s.jpg',quality=88)
# GIF: три вырезки рядом, 40 кадров за 10 с (0,25 с на кадр)
frames=[]
for i in range(40):
    ims=[g[i] for g in gif]; Wt=sum(im.width for im in ims)+8*(len(ims)-1); Ht=max(im.height for im in ims)
    c=Image.new('RGB',(Wt,Ht),'white'); x=0
    for im in ims: c.paste(im,(x,0)); x+=im.width+8
    frames.append(c.convert('P',palette=Image.ADAPTIVE,colors=96))
frames[0].save(OUT/'figures_10s.gif',save_all=True,append_images=frames[1:],duration=250,loop=0,optimize=True)
json.dump(info,open(OUT/'figures_preview.json','w'),ensure_ascii=False,indent=1); print(info)
