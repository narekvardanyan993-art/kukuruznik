import sys, json, numpy as np
from PIL import Image
sys.path.insert(0,'source/s18'); sys.path.insert(0,'source/s16'); sys.path.insert(0,'source/s17')
import esim, night_s16, night_s17, nightcheck, bronze
tiles=[]; rows=[]
for n in esim.FR:
    d=esim.load('.',n).astype(np.float32); a=esim.load('.',n,'_building','RGBA')[...,3]; nt=esim.load('.',n,'_night').astype(np.float32)
    st0,_,_,_=night_s16.statue_mask(d.astype(np.uint8),a); st,gap=night_s17.clean_statue(st0,d)
    w=bronze.weight(st0,a,gap)
    db=bronze.recolor(d,st,w)
    env=esim.load('.',n,'_env')[...,0]>100
    k=1.0
    for it in range(30):
        nl=bronze.floodlight(nt,db,a,st,w,k=k); m=nightcheck.measure(nl,st,env,exclude=a>128)
        if m['ratio']>=2.2: break
        k*=1.12
    r=dict(frame=esim.VIEW[n],k=round(k,2),ratio=m,day=esim.lab_stats(esim.day(db,bld_alpha=a/255,bld_green=False),st),night=esim.lab_stats(esim.night(nl),st))
    print(json.dumps(r)); rows.append(r)
    ys,xs=np.where(st); y0,y1,x0,x1=ys.min(),ys.max(),xs.min(),xs.max(); pad=12
    sl=(slice(max(0,y0-pad),y1+pad),slice(max(0,x0-pad),x1+pad))
    ims=[esim.day(d)[sl],esim.day(db,bld_alpha=a/255,bld_green=False)[sl],esim.night(nt)[sl],esim.night(nl)[sl]]
    sc=300/ims[0].shape[0]
    t=[Image.fromarray(np.clip(i,0,255).astype(np.uint8)).resize((max(1,int(i.shape[1]*sc)),300),Image.LANCZOS) for i in ims]
    c=Image.new('RGB',(sum(x.width for x in t)+30,300),'white'); x=0
    for q in t: c.paste(q,(x,0)); x+=q.width+10
    tiles.append(c)
W=max(t.width for t in tiles); S=Image.new('RGB',(W,310*len(tiles)),'white')
for i,t in enumerate(tiles): S.paste(t,(0,i*310))
S.save('source/s18/figs/z_statue_proto.jpg',quality=88)
