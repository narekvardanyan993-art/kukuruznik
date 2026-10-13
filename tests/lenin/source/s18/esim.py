"""s18: математика движка в numpy (для замеров цвета, без снимков сайта).
day(): дневная обработка зелени из engine/viewer.js (GREEN_HUE/PULL/SAT, DAY_MIX), без неба; night(): NIGHT_DIM."""
import numpy as np, cv2, sys
from PIL import Image
from pathlib import Path
FR=['lenin_1','lenin_2','lenin_3','lenin_4','lenin_6']
VIEW={n:i+1 for i,n in enumerate(FR)}            # номера Нарека 1–5 = порядок просмотра
def ss(a,b,x): t=np.clip((x-a)/(b-a),0,1); return t*t*(3-2*t)
def rgb2hsv(c):
    r,g,b=c[...,0],c[...,1],c[...,2]; mx=c.max(-1); mn=c.min(-1); d=mx-mn
    h=np.zeros_like(mx)
    m=d>1e-8
    rr=m&(mx==r); gg=m&(mx==g)&~rr; bb=m&~rr&~gg
    h[rr]=((g-b)[rr]/d[rr])%6; h[gg]=(b-r)[gg]/d[gg]+2; h[bb]=(r-g)[bb]/d[bb]+4
    h=h/6.0; s=np.where(mx>1e-8,d/np.maximum(mx,1e-8),0)
    return np.stack([h,s,mx],-1)
def hsv2rgb(hv):
    h,s,v=hv[...,0],hv[...,1],hv[...,2]
    K=np.array([1,2/3,1/3,3.0])
    p=np.abs(((h[...,None]+K[:3])%1.0)*6-K[3])
    return v[...,None]*((1-s[...,None])+np.clip(p-1,0,1)*s[...,None])
def day(rgb255, hue=0.3, pull=0.78, sat=1.9, mix=0.8, skyW=None, bld_alpha=None, bld_green=True):
    c=rgb255.astype(np.float32)/255; hv=rgb2hsv(c)
    gw=ss(.10,.16,hv[...,0])*(1-ss(.36,.45,hv[...,0]))*ss(.06,.16,hv[...,1])*ss(.18,.40,hv[...,2])
    if skyW is not None: gw*=(1-skyW)
    if bld_alpha is not None and not bld_green: gw*=(1-bld_alpha)
    h2=hv.copy(); h2[...,0]=hv[...,0]+(hue-hv[...,0])*gw*pull
    h2[...,1]=np.clip(hv[...,1]*(1+gw*(sat-1))+gw*0.05,0,1)
    c2=np.where((gw>0.001)[...,None],hsv2rgb(h2),c)
    return np.clip(c+(c2-c)*mix,0,1)*255
def night(rgb255, dim=0.64):
    c=rgb255.astype(np.float32)/255
    l=(c*np.array([0.299,0.587,0.114])).sum(-1)
    return c*(dim+(1-dim)*ss(.30,.60,l))[...,None]*255
def lab_stats(rgb255, m):
    lab=cv2.cvtColor(np.clip(rgb255,0,255).astype(np.uint8),cv2.COLOR_RGB2LAB).astype(np.float32)
    L=lab[...,0]*100/255; a=lab[...,1]-128; b=lab[...,2]-128
    a_,b_=a[m].mean(),b[m].mean()
    hue=float(np.degrees(np.arctan2(b_,a_))%360); C=float(np.hypot(a[m],b[m]).mean())
    hsv=cv2.cvtColor(np.clip(rgb255,0,255).astype(np.uint8),cv2.COLOR_RGB2HSV).astype(np.float32)
    return dict(L=round(float(L[m].mean()),1),a=round(float(a_),1),b=round(float(b_),1),hue_lab=round(hue,1),chroma=round(C,1),
                hsv_h=round(float(np.median(hsv[...,0][m]))*2,1),hsv_s=round(float(hsv[...,1][m].mean())/255,3))
def load(B,n,suf='',mode='RGB',d='frames'):
    return np.asarray(Image.open(f'{B}/{d}/{n}{suf}.webp').convert(mode))
