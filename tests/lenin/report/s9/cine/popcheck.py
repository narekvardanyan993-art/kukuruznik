"""Проверка стыков: в готовом ролике машины (капли отличия от рисунка) не должны появляться/пропадать посреди кадра."""
import sys, subprocess, numpy as np, cv2, json
from PIL import Image
name, mp4 = sys.argv[1], sys.argv[2]
day=np.asarray(Image.open('tests/lenin/frames/%s.webp'%name).convert('RGB')).astype(np.float32)
mk=np.asarray(Image.open('tests/lenin/frames/%s_motion_mask.png'%name).convert('LA'))[...,1]/255.
H2,W2=mk.shape; day=day[:H2,:W2]
p=subprocess.run(['ffmpeg','-v','error','-i',mp4,'-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True).stdout
fr=np.frombuffer(p,np.uint8).reshape(-1,H2,W2,3)
allow=mk>0.3
import os
LZ=sys.argv[5] if len(sys.argv)>5 else None
lz=np.asarray(Image.open(LZ))[:H2,:W2]>0 if LZ else np.ones((H2,W2),bool)
lz=cv2.dilate(lz.astype(np.uint8),np.ones((15,15),np.uint8))>0
dist=cv2.distanceTransform(np.pad(allow,1).astype(np.uint8),cv2.DIST_L2,3)[1:-1,1:-1]
AMIN=int(sys.argv[4]) if len(sys.argv)>4 else 500
prev=[]; pops=[]
N=len(fr)
for t in range(N+1):
    f=fr[t%N].astype(np.float32)
    D=cv2.GaussianBlur(np.abs(f-day).max(-1),(0,0),1.5)
    fg=((D>22)&allow).astype(np.uint8); fg=cv2.morphologyEx(fg,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
    n,lab,st,cen=cv2.connectedComponentsWithStats(fg)
    cur=[(cen[i],st[i][4]) for i in range(1,n) if st[i][4]>=AMIN and lz[int(cen[i][1]),int(cen[i][0])]]
    if t>0:
        for c,a in cur:   # появилась: рядом в прошлом кадре нет капли
            if not any(np.hypot(*(c-c2))<14+0.3*np.sqrt(a) for c2,a2 in prev):
                if dist[int(c[1]),int(c[0])]>0.8*np.sqrt(a)+10: pops.append(('appear',t,int(c[0]),int(c[1]),int(a)))
        for c,a in prev:
            if not any(np.hypot(*(c-c2))<14+0.3*np.sqrt(a) for c2,a2 in cur):
                if dist[int(c[1]),int(c[0])]>0.8*np.sqrt(a)+10: pops.append(('vanish',t,int(c[0]),int(c[1]),int(a)))
    prev=cur
print(name, 'frames', N, 'mid-frame pops', len(pops))
for q in pops[:30]: print(q)
json.dump({'frames':N,'pops':pops},open(sys.argv[3],'w'))
