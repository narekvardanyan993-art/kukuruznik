"""s17: проверка яркости статуи ночью в ИТОГЕ движка (математика ночи из engine/viewer.js: cn *= mix(NIGHT_DIM,1,smoothstep(.30,.60,luma)))."""
import numpy as np, cv2
from scipy import ndimage
def engine_night(n_rgb, dim=0.64):
    c=n_rgb.astype(np.float32)/255
    l=(c*np.array([0.299,0.587,0.114])).sum(-1)
    t=np.clip((l-0.30)/0.30,0,1); t=t*t*(3-2*t)
    return c*(dim+(1-dim)*t)[...,None]
def lum(c): return (c*np.array([0.2126,0.7152,0.0722])).sum(-1)
def measure(night_rgb, statue, sky, dim=0.64, r0=12, r1=60, exclude=None):
    e=engine_night(night_rgb,dim); L=lum(e)
    ring=ndimage.binary_dilation(statue,iterations=r1)&~ndimage.binary_dilation(statue,iterations=r0)
    if exclude is not None: ring=ring&~exclude   # постамент/здание и своё пятно света — не «фон вокруг»
    around=ring&sky if (ring&sky).sum()>200 else ring
    s=float(L[statue].mean()); a=float(L[around].mean())
    return dict(statue=round(s,4),around=round(a,4),ratio=round(s/max(a,1e-4),2),around_kind='sky' if (ring&sky).sum()>200 else 'ground')
