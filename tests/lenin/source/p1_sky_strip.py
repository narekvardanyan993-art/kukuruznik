"""Ленин P1 (05.10.2026), решение Нарека: G — полоска неба.
Запуск: python3 p1_sky_strip.py <lenin_6.jpg> <lenin_3.jpg (источник текстуры неба)> <dst.jpg>
G (lenin_6) — strip of watercolor sky at the top, wash texture taken from lenin_3 (same series, same paper)."""
import sys, numpy as np, cv2
from PIL import Image
g=np.array(Image.open(sys.argv[1]).convert('RGB')).astype(np.float32)/255
s=np.array(Image.open(sys.argv[2]).convert('RGB')).astype(np.float32)/255
H,W=g.shape[:2]; TOP,FADE0,FADE1=262,165,250
gl=cv2.cvtColor(g,cv2.COLOR_RGB2LAB); sl=cv2.cvtColor(s[:TOP],cv2.COLOR_RGB2LAB)
paperL=np.percentile(gl[:150,...,0],60)
rng=np.random.default_rng(6)
noise=cv2.GaussianBlur(rng.standard_normal((TOP,W)).astype(np.float32),(0,0),25); noise/=noise.std()+1e-6
y=np.arange(TOP,dtype=np.float32)[:,None]+noise*11      # ragged watercolor edge
alpha=np.clip((FADE1-y)/(FADE1-FADE0),0,1)
alpha=cv2.GaussianBlur(alpha,(0,0),3)
out=gl.copy(); band=out[:TOP]
band[...,0]=np.clip(band[...,0]+alpha*(sl[...,0]-paperL),0,100)
band[...,1]=band[...,1]*(1-alpha)+sl[...,1]*alpha
band[...,2]=band[...,2]*(1-alpha)+sl[...,2]*alpha
res=np.clip(cv2.cvtColor(out,cv2.COLOR_LAB2RGB),0,1)
Image.fromarray((res*255+.5).astype(np.uint8)).save(sys.argv[3],quality=98,subsampling=0)
