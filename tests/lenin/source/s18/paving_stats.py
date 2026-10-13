import sys, numpy as np, cv2, json
sys.path.insert(0,'source/s18'); import esim
from PIL import Image
def lab(rgb): 
    l=cv2.cvtColor(np.clip(rgb,0,255).astype(np.uint8),cv2.COLOR_RGB2LAB).astype(np.float32); return l[...,0]*100/255, l[...,1]-128, l[...,2]-128
def regions6(d,al,patch):
    H,W=d.shape[:2]; hsv=cv2.cvtColor(d.astype(np.uint8),cv2.COLOR_RGB2HSV).astype(np.float32)
    h=hsv[...,0]*2; s=hsv[...,1]/255; v=hsv[...,2]/255
    Y=np.arange(H)[:,None]*np.ones((1,W))
    base=(al<10)&(patch<0.02)&(Y>=380)
    yel=base&(h>=30)&(h<=65)&(s>=0.07)&(v>0.6)
    wht=base&(s<0.07)&(v>0.78)
    return yel,wht
def region1(d,al,patch):
    H,W=d.shape[:2]; Y=np.arange(H)[:,None]*np.ones((1,W))
    hsv=cv2.cvtColor(d.astype(np.uint8),cv2.COLOR_RGB2HSV).astype(np.float32); v=hsv[...,2]/255
    return (al<10)&(patch<0.02)&(Y>=1040)&(v>0.6)
def stats(d,m):
    L,a,b=lab(d.astype(np.float32)); C=np.hypot(a,b)
    return dict(px=int(m.sum()),L=round(float(L[m].mean()),1),chroma=round(float(C[m].mean()),2),chroma_p90=round(float(np.percentile(C[m],90)),2),hue=round(float(np.degrees(np.arctan2(b[m].mean(),a[m].mean()))%360),1))
if __name__=='__main__':
    P=lambda n: np.asarray(Image.open('source/s17/patches/%s.png'%n))[...,3]/255
    d1=esim.load('.','lenin_1'); a1=esim.load('.','lenin_1','_building','RGBA')[...,3]
    r1=region1(d1,a1,P('lenin_1'))
    d6=esim.load('.','lenin_6'); a6=esim.load('.','lenin_6','_building','RGBA')[...,3]
    yel,wht=regions6(d6,a6,P('lenin_6'))
    out=dict(frame1_paving=stats(d1,r1),frame5_yellow=stats(d6,yel),frame5_white=stats(d6,wht),frame5_all=stats(d6,yel|wht))
    print(json.dumps(out,indent=0))
    vis=d6.copy().astype(np.float32); vis[yel]=vis[yel]*0.5+np.array([255,0,0])*0.5; vis[wht]=vis[wht]*0.5+np.array([0,0,255])*0.5
    Image.fromarray(vis.astype(np.uint8)).resize((384,682)).save('source/s18/figs/z_f5_regions.jpg')
