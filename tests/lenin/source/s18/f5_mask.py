"""s18: маска мощения кадра 5 (lenin_6): гладкие (без штриховки) жёлтые и кремово-белые места земли, большие связные куски.
Стены домов (штриховка) и розовый туф, бассейн, зелень, небо и вырезка памятника — не входят."""
import numpy as np, cv2
from scipy import ndimage
def paving_mask(d, al, env_sky, patch_a):
    H,W=d.shape[:2]
    hsv=cv2.cvtColor(d.astype(np.uint8),cv2.COLOR_RGB2HSV).astype(np.float32)
    h=hsv[...,0]*2; s=hsv[...,1]/255; v=hsv[...,2]/255
    g=cv2.cvtColor(d.astype(np.uint8),cv2.COLOR_RGB2GRAY).astype(np.float32)
    mu=cv2.blur(g,(9,9)); sd=np.sqrt(np.maximum(cv2.blur(g*g,(9,9))-mu*mu,0))
    col=((h>=28)&(h<=75)&(v>0.70))|((s<0.12)&(v>0.80))
    smooth=sd<14
    cand=col&smooth&(al<10)&(env_sky<100)
    cand=ndimage.binary_closing(cand,iterations=3)
    lab,n=ndimage.label(cand); sz=ndimage.sum(cand,lab,range(1,n+1))
    keep=np.isin(lab,[i+1 for i,z in enumerate(sz) if z>=6000])
    keep=ndimage.binary_dilation(keep,iterations=5)&col&(al<10)   # и пиксели у линий рисунка (у штриха нет «гладкости») — иначе светлые ореолы вдоль линий
    lab,n=ndimage.label(keep); sz=ndimage.sum(keep,lab,range(1,n+1))
    keep=np.isin(lab,[i+1 for i,z in enumerate(sz) if z>=6000])
    yel=keep&(h>=28)&(h<=75)&(s>=0.12)
    wht=keep&~yel
    return yel,wht
if __name__=='__main__':
    import sys; sys.path.insert(0,'source/s18'); import esim
    from PIL import Image
    d=esim.load('.','lenin_6'); al=esim.load('.','lenin_6','_building','RGBA')[...,3]; env=esim.load('.','lenin_6','_env')[...,0]
    pa=np.asarray(Image.open('source/s17/patches/lenin_6.png'))[...,3]/255
    yel,wht=paving_mask(d,al,env,pa)
    vis=d.copy().astype(np.float32); vis[yel]=vis[yel]*0.45+np.array([255,0,0])*0.55; vis[wht]=vis[wht]*0.45+np.array([0,0,255])*0.55
    Image.fromarray(vis.astype(np.uint8)).resize((384,682)).save('source/s18/figs/z_f5_regions2.jpg')
    print(int(yel.sum()),int(wht.sum()))
