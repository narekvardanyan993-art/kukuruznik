import numpy as np, os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
R=Path.home()/'mnt/chka.am/pogos-petros'; B=R/'build/frames'
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20) if os.path.exists('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf') else ImageFont.load_default()
w,h=230,409; cols=['день','маска здания','глубина','ночь','снег / призрак']
rows=['A','B','C','D','E','F']
S=Image.new('RGB',(90+len(cols)*(w+8),40+len(rows)*(h+8)),(245,240,230)); d=ImageDraw.Draw(S)
for j,c in enumerate(cols): d.text((90+j*(w+8),10),c,fill=(20,20,20),font=font)
for i,r in enumerate(rows):
  f='pogos_'+r.lower(); y=40+i*(h+8); d.text((10,y+h//2),r if r!='F' else 'F/F0',fill=(20,20,20),font=font)
  day=Image.open(B/(f+'.webp')).convert('RGB')
  bl=np.asarray(Image.open(B/(f+'_building.webp')))
  a=bl[...,3:4]/255.0; dd=np.asarray(day).astype(float)
  m=(dd*a+np.array([255,0,255])*(1-a)*0.55+dd*(1-a)*0.45).astype(np.uint8)
  dep=Image.open(B/(f+'_depth.webp')).convert('RGB')
  nt=Image.open(B/(f+'_night.webp')).convert('RGB')
  if r=='F': last=Image.open(R/'frames/F.png').convert('RGB')
  elif (B/(f+'_snow.webp')).exists():
    sn=np.asarray(Image.open(B/(f+'_snow.webp')).convert('L'))[...,None]/255.0
    last=Image.fromarray((dd*(1-sn*0.85)+np.array([30,120,255])*sn*0.85).astype(np.uint8))
  else: last=None
  for j,im in enumerate([day,Image.fromarray(m),dep,nt,last]):
    if im is not None: S.paste(im.resize((w,h),Image.LANCZOS),(90+j*(w+8),y))
    else: d.text((90+j*(w+8)+20,y+h//2),'нет (рисунок/интерьер)',fill=(120,110,100),font=font)
S.save(R/'frames/step4_sheet.jpg',quality=85); print(S.size)
