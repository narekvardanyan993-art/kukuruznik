import sys, subprocess, numpy as np, cv2
from PIL import Image
name, label, out = sys.argv[1], sys.argv[2], sys.argv[3]
H2,W2=1364,768
p=subprocess.run(['ffmpeg','-v','error','-i','tests/lenin/frames/%s_motion.mp4'%name,'-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True).stdout
fr=np.frombuffer(p,np.uint8).reshape(-1,H2,W2,3); N=len(fr); fps=20
lz=np.asarray(Image.open('tests/lenin/report/s9/cine/lanes_mask_%s.png'%name))[:H2,:W2]>0
ys,xs=np.nonzero(lz); y0,y1=max(0,ys.min()-20),min(H2,ys.max()+20); x0,x1=max(0,xs.min()-20),min(W2,xs.max()+20)
start=N-6*fps   # 12 с через стык ролика (конец → начало)
tiles=[]
for k in range(24):
    t=(start+k*10)%N; im=np.ascontiguousarray(fr[t,y0:y1,x0:x1]).copy()
    s=400/im.shape[1]; im=cv2.resize(im,(400,int(im.shape[0]*s)))
    sec=((start+k*10)/fps)%(N/fps)
    txt='%s  %.1f c%s'%(label,sec,'  <- стык' if k==12 else '')
    cv2.rectangle(im,(0,0),(260,26),(255,255,255),-1); cv2.putText(im,('%s %.1fs'%(label,sec))+(' LOOP SEAM' if k==12 else ''),(6,19),cv2.FONT_HERSHEY_SIMPLEX,0.6,(200,0,0) if k==12 else (0,0,0),2)
    tiles.append(im)
h=max(t.shape[0] for t in tiles); tiles=[np.pad(t,((0,h-t.shape[0]),(0,0),(0,0)),constant_values=255) for t in tiles]
rows=[np.concatenate(tiles[r*6:(r+1)*6],1) for r in range(4)]
Image.fromarray(np.concatenate(rows,0)).save(out,quality=82)
print(out, N, (x0,y0,x1,y1))
