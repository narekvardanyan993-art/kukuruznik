import json, shutil, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
R=Path.home()/'mnt/chka.am/pogos-petros'; B=R/'build'; G=R/'gemini/in'
pre='Gemini_Generated_Image_'
F={'a':('A','arf1tqarf1tqarf1','s3s9bfs3s9bfs3s9','4d15x64d15x64d15'),
   'b':('B','zb3yrfzb3yrfzb3y','wsthv1wsthv1wsth','lp06xnlp06xnlp06'),
   'c':('C','pjvzg7pjvzg7pjvz','kfjlpdkfjlpdkfjl','ro1svsro1svsro1s'),
   'd':('D',None,'c7v5v8c7v5v8c7v5',None),
   'e':('E',None,'nbyl1wnbyl1wnbyl',None),
   'f':('F0','mn3smxmn3smxmn3s','bhquehbhquehbhqu','r5g7j9r5g7j9r5g7')}
def crop(src,dst):
  im=Image.open(src).convert('RGB'); W,H=im.size; h=round(W*16/9)
  if H>h: im=im.crop((0,H-h,W,H))
  Image.fromarray(np.asarray(im)).save(dst)
base=json.loads((Path.home()/'mnt/chka.am/tests/lenin/layers.json').read_text())
(B/'frames').mkdir(parents=True,exist_ok=True); (B/'source/night').mkdir(parents=True,exist_ok=True); (B/'refs/s22').mkdir(parents=True,exist_ok=True); (B/'report/s22').mkdir(parents=True,exist_ok=True)
for k,(L,bg,ni,wi) in F.items():
  fid='pogos_'+k; fd=B/'source'/fid; fd.mkdir(parents=True,exist_ok=True)
  shutil.copyfile(R/'frames'/(L+'.png'), fd/(fid+'.png'))
  if bg: crop(G/(pre+bg+'.jpeg'), fd/(fid+'_bg.png'))
  if ni: crop(G/(pre+ni+'.jpeg'), B/'source/night'/('gemini_night_%s.png'%fid))
  if wi: crop(G/(pre+wi+'.jpeg'), B/'refs/s22'/('%s_winter_a.png'%fid))
  s={k2:v for k2,v in base.items()}; s['name']=fid; s['size']=[768,1365]
  s['cutout']={kk:vv for kk,vv in base['cutout'].items() if kk!='add'}
  a=np.asarray(Image.open(fd/(fid+'.png')).convert('RGB').resize((768,1365),Image.LANCZOS)).astype(np.float32)
  if bg:
    b=np.asarray(Image.open(fd/(fid+'_bg.png')).convert('RGB').resize((768,1365),Image.LANCZOS)).astype(np.float32)
    d=ndimage.gaussian_filter(np.abs(a-b).mean(-1),2)
    m=d>35; m=ndimage.binary_opening(m,iterations=2)
    lab,n=ndimage.label(m); 
    if n>1:
      sz=ndimage.sum(m,lab,range(1,n+1)); m=np.isin(lab,1+np.nonzero(sz>0.02*sz.max())[0])
    m=ndimage.binary_dilation(m,iterations=22)
    cs,_=cv2.findContours(m.astype(np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    hull=cv2.convexHull(np.vstack(cs)); reg=[[int(min(767,max(0,p[0][0]))),int(min(1365,max(0,p[0][1])))] for p in hull]
    s['cutout']['region']=reg
    print(fid,'bg diff outside', round(float(np.abs(a-b).mean(-1)[~m].mean()),2),'region pts',len(reg),'obj%',round(m.mean()*100,1))
  else:
    s.pop('cutout')
    if k=='d': s['polygon']=[[40,1150],[40,330],[300,250],[560,330],[560,1150]]; s['extra_box']=[20,240,580,1170]
    if k=='e': s['polygon']=[[490,1100],[768,1080],[768,1365],[520,1365]]; s['extra_box']=[470,1040,768,1365]
  if k in ('d','e','f'): s['trees']=False
  (fd/'layers.json').write_text(json.dumps(s,ensure_ascii=False,indent=1))
