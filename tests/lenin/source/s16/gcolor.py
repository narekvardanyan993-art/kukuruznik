import numpy as np, cv2
def stats(rgb,ground):
    lab=cv2.cvtColor(rgb.astype(np.uint8),cv2.COLOR_RGB2LAB).astype(np.float32)
    C=np.hypot(lab[...,1]-128,lab[...,2]-128)
    return dict(C_mean=float(C[ground].mean()),C_p90=float(np.percentile(C[ground],90)),L_mean=float(lab[...,0][ground].mean()),L_std=float(lab[...,0][ground].std()))
def params(src,ref,sL=0.55,sC=0.7):
    kL=1+(ref['L_std']/src['L_std']-1)*sL
    muL=src['L_mean']+(ref['L_mean']-src['L_mean'])*sL
    kC=1+(ref['C_p90']/src['C_p90']-1)*sC
    return dict(kL=kL,muS=src['L_mean'],muL=muL,kC=kC)
def apply(rgb,p):
    lab=cv2.cvtColor(np.clip(rgb,0,255).astype(np.uint8),cv2.COLOR_RGB2LAB).astype(np.float32)
    L=lab[...,0]; a=lab[...,1]-128; b=lab[...,2]-128
    L2=(L-p['muS'])*p['kL']+p['muL']
    L2=np.where(L>p['muS'],L+(L2-L)*0.6,L2)          # бумага темнеет меньше (не «грязная» площадь)
    C=np.hypot(a,b); w=np.clip((C-3)/7,0,1); w=w*w*(3-2*w); k=1+(p['kC']-1)*w
    lab[...,0]=np.clip(L2,0,255); lab[...,1]=np.clip(a*k+128,0,255); lab[...,2]=np.clip(b*k+128,0,255)
    return cv2.cvtColor(lab.astype(np.uint8),cv2.COLOR_LAB2RGB).astype(np.float32)
