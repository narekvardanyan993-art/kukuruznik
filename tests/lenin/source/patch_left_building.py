import numpy as np, cv2
from PIL import Image
S=2; OFF=1280
SRC='/mnt/user-data/uploads/chka.am/tests/lenin/source/'
def run(path,out):
    im=np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    H,W=im.shape[:2]
    X1=384; Y0=OFF+200; Y1=OFF+447
    ref=im[Y0-14:Y0-4, 0:X1].mean(0)
    ref=cv2.GaussianBlur(ref[None],(0,0),sigmaX=25)[0]
    g=im[OFF+8:OFF+8+120, 0:X1]; g=np.concatenate([g,g[::-1],g,g[::-1]],0)[:Y1-Y0]
    grain=g-cv2.GaussianBlur(g,(0,0),6)
    fill=np.repeat(ref[None],Y1-Y0,0)+grain*0.8
    m=np.ones((Y1-Y0,X1),np.float32); r=56
    m[:, -r:]=np.linspace(1,0,r)[None,:]; m[:24]*=np.linspace(0,1,24)[:,None]; m[-6:]*=np.linspace(1,0,6)[:,None]
    reg=im[Y0:Y1,0:X1]; im[Y0:Y1,0:X1]=reg*(1-m[...,None])+fill*m[...,None]
    SKY=None
    def stamp(sx0,sy0,sx1,sy1,dx,dyb,flip,scale):
        p=im[sy0*S:sy1*S, sx0*S:sx1*S].copy()
        if flip: p=p[:, ::-1]
        if scale!=1: p=cv2.resize(p,(int(p.shape[1]*scale),int(p.shape[0]*scale)),interpolation=cv2.INTER_AREA)
        ph,pw=p.shape[:2]
        sky=SKY
        dist=np.abs(p-sky).sum(2)
        a=np.clip((dist-45)/25,0,1)
        a=cv2.morphologyEx(a,cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))
        a=cv2.GaussianBlur(a,(0,0),1.0)
        f=int(14*S); ramp=np.linspace(0,1,f,dtype=np.float32); a[:,:f]*=ramp[None,:]; a[:,-f:]*=ramp[::-1][None,:]
        yy=dyb*S-ph; xx=dx*S
        xs0=max(xx,0); xe=min(xx+pw,W)
        reg=im[yy:yy+ph, xs0:xe]; mm=a[:, (xs0-xx):(xe-xx)]
        im[yy:yy+ph, xs0:xe]=reg*(1-mm[...,None])+p[:,(xs0-xx):(xe-xx)]*mm[...,None]
    SKY=im[OFF+150:OFF+160,100:140].reshape(-1,3).mean(0)
    srcim=im.copy()
    # источник: роща справа (из исходной копии, до штампов)
    def stamp2(*a):
        nonlocal_im=None
    Image.fromarray(np.clip(im,0,255).astype(np.uint8)).save(out,quality=94)
    Image.fromarray(np.clip(im,0,255).astype(np.uint8)).crop((0,OFF,840,OFF+640)).save(out+'.crop.png')
run(SRC+'lenin_916_bg.jpg','/tmp/W/bg_p3.jpg')
run(SRC+'lenin_916.jpg','/tmp/W/fr_p3.jpg')
