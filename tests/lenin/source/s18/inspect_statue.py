import sys, json, numpy as np
from PIL import Image
sys.path.insert(0,'source/s18'); sys.path.insert(0,'source/s16'); sys.path.insert(0,'source/s17')
import esim, night_s16, night_s17
B='.'
rows=[]; tiles=[]
for n in esim.FR:
    d15=esim.load(B,n,d='source/night/s15src'); d17=esim.load(B,n); a=esim.load(B,n,'_building','RGBA')[...,3]
    st,_,_,_=night_s16.statue_mask(d15,a); st,_=night_s17.clean_statue(st,d15)
    nt=esim.load(B,n,'_night')
    r=dict(frame=esim.VIEW[n],px=int(st.sum()),s15_day=esim.lab_stats(d15,st),s17_day=esim.lab_stats(d17,st),
           s17_day_engine=esim.lab_stats(esim.day(d17),st),s17_night_engine=esim.lab_stats(esim.night(nt),st))
    rows.append(r); print(json.dumps(r))
    ys,xs=np.where(st); y0,y1,x0,x1=ys.min(),ys.max(),xs.min(),xs.max(); pad=10
    sl=(slice(max(0,y0-pad),y1+pad),slice(max(0,x0-pad),x1+pad))
    ims=[d15[sl],d17[sl],esim.day(d17)[sl],esim.night(nt)[sl]]
    h=ims[0].shape[0]; sc=300/h
    t=[Image.fromarray(np.clip(i,0,255).astype(np.uint8)).resize((max(1,int(i.shape[1]*sc)),300)) for i in ims]
    W=sum(x.width for x in t)+30; c=Image.new('RGB',(W,300),'white'); x=0
    for q in t: c.paste(q,(x,0)); x+=q.width+10
    tiles.append(c)
W=max(t.width for t in tiles); S=Image.new('RGB',(W,310*len(tiles)),'white')
for i,t in enumerate(tiles): S.paste(t,(0,i*310))
S.save('report/s18/_statue_before_sheet.jpg',quality=85)
json.dump(rows,open('report/s18/_statue_before.json','w'),indent=1)
