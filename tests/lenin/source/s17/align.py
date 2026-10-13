"""s17: выравнивание правки Gemini (полный кадр) к исходному рисунку: масштаб + ECC (аффинно)."""
import numpy as np, cv2
def align(orig, gem, iters=200):
    H,W=orig.shape[:2]
    g=cv2.resize(gem,(W,int(round(gem.shape[0]*W/gem.shape[1]))),interpolation=cv2.INTER_AREA)
    # стартовая догадка: растянуть по высоте
    g=cv2.resize(g,(W,H),interpolation=cv2.INTER_AREA)
    a=cv2.GaussianBlur(cv2.cvtColor(orig,cv2.COLOR_RGB2GRAY).astype(np.float32)/255,(0,0),2)
    b=cv2.GaussianBlur(cv2.cvtColor(g,cv2.COLOR_RGB2GRAY).astype(np.float32)/255,(0,0),2)
    M=np.eye(2,3,dtype=np.float32)
    s=0.5
    a2=cv2.resize(a,None,fx=s,fy=s); b2=cv2.resize(b,None,fx=s,fy=s)
    try:
        cc,M=cv2.findTransformECC(a2,b2,M,cv2.MOTION_AFFINE,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,iters,1e-6),None,5)
        M[:,2]/=s
        cc,M=cv2.findTransformECC(a,b,M,cv2.MOTION_AFFINE,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,60,1e-6),None,5)
    except cv2.error as e:
        cc=-1
    w=cv2.warpAffine(g,M,(W,H),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_REFLECT)
    return w,float(cc),M
def refine(orig, w, sigma=12):
    """локальная доводка: плавное поле сдвигов (Farneback, сильно сглаженное), чтобы линии рисунка Gemini легли на линии исходника"""
    a=cv2.cvtColor(orig,cv2.COLOR_RGB2GRAY); b=cv2.cvtColor(w,cv2.COLOR_RGB2GRAY)
    f=cv2.calcOpticalFlowFarneback(a,b,None,0.5,4,31,5,7,1.5,0)
    f[...,0]=cv2.GaussianBlur(f[...,0],(0,0),sigma); f[...,1]=cv2.GaussianBlur(f[...,1],(0,0),sigma)
    f=np.clip(f,-4,4)
    H,W=a.shape; gx,gy=np.meshgrid(np.arange(W,dtype=np.float32),np.arange(H,dtype=np.float32))
    out=cv2.remap(w,gx+f[...,0],gy+f[...,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT)
    return out, float(np.abs(f).mean())
