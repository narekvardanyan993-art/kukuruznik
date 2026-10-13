import numpy as np, cv2, json, sys
from PIL import Image
from scipy import ndimage
import pave2, details
SRC=sys.argv[1] if len(sys.argv)>1 else '/mnt/user-data/uploads/chka.am/tests/lenin/'
F=SRC+'frames/'
def load(n,suf='',mode='RGB'): return np.asarray(Image.open(F+n+suf+'.webp').convert(mode))
WIRES={'lenin_2':[[(60,1285),(520,1075)],[(520,1075),(760,950)],[(225,605),(465,895)],[(465,895),(520,1075)],[(235,600),(400,555)],[(400,555),(600,580)]],
       'lenin_6':[[(95,700),(380,555)],[(380,555),(655,700)]]}
HK={'lenin_2':(0.01958,24.33),'lenin_6':(0.01909,20.68)}
LAWN={'lenin_2':[(56,866,136,944)],'lenin_6':[(364,418,431,476),(645,470,701,536)]}
BENCH={'lenin_2':[(265,781,59,6),(285,812,59,6),(482,567,-12,7),(560,573,-12,7)],
       'lenin_6':[(432,497,13,7),(482,508,13,7),(545,522,13,7)]}
ROADS=None
def skel(n):
    from skimage.morphology import skeletonize
    m=np.asarray(Image.open(ROADS+n+'_roads.png').convert('L'))>128
    m=cv2.GaussianBlur(m.astype(np.float32),(0,0),6)>0.5
    return skeletonize(m)
def lawn_mask(day,boxes):
    lab=cv2.cvtColor(day,cv2.COLOR_RGB2LAB).astype(np.float32); a=lab[...,1]-128; L=lab[...,0]
    g=(a<-5)&(L>110)
    m=np.zeros(g.shape,bool)
    for x0,y0,x1,y1 in boxes: m[y0:y1,x0:x1]=True
    g=g&m
    g=ndimage.binary_opening(g,iterations=1)
    # smooth lawns only (exclude tree hatching: local std)
    sd=np.sqrt(np.maximum(cv2.blur(L*L,(5,5))-cv2.blur(L,(5,5))**2,0))
    g&=sd<14
    return g
def do(n):
    day=load(n); H,W=day.shape[:2]
    out=day.astype(np.float32); changed=np.zeros((H,W),np.float32)
    if n in ('lenin_2','lenin_6'):
        out,c=pave2.paint(n,day,draw_grid=(n=='lenin_6')); changed=np.maximum(changed,c)
        sk=skel(n)
        paths=[]
        for a,b in WIRES[n]:
            p=details.sk_path(sk,a,b)
            if p is not None: paths.append(p)
        k=HK[n]; hf=lambda y: k[0]*y+k[1]
        wa=details.wire_layer(H,W,paths,hf)
        env=load(n,'_env').astype(np.float32)/255; bld=load(n,'_building','RGBA')[...,3]>20
        lab=cv2.cvtColor(day,cv2.COLOR_RGB2LAB).astype(np.float32)
        tree=(lab[...,1]-128<-6)
        wa*= (1-cv2.GaussianBlur(tree.astype(np.float32),(0,0),0.8))*(1-bld)*(env[...,0]<0.5)
        out=details.apply_ink(out,wa,k=0.5); changed=np.maximum(changed,np.clip(wa*2,0,1))
    if n in LAWN:
        lm=lawn_mask(day,LAWN[n])
        out,c=details.flowers(out,lm,seed=11,density=0.16); changed=np.maximum(changed,c)
    if n in BENCH:
        out,c=details.benches(out,BENCH[n]); changed=np.maximum(changed,c)
    return np.clip(out,0,255),changed
if __name__=='__main__':
    for n in sys.argv[2:] or ['lenin_2','lenin_6']:
        o,c=do(n)
        Image.fromarray(np.round(o).astype(np.uint8)).save('out/'+n+'_day.png')
        Image.fromarray((c*255).astype(np.uint8)).save('out/'+n+'_chg.png')
        print(n,'changed px',int((c>0.02).sum()))
