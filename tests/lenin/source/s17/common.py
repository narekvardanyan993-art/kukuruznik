import numpy as np
from PIL import Image
from scipy import ndimage
FR=['lenin_1','lenin_2','lenin_3','lenin_4','lenin_6']
VIDEO=('lenin_1','lenin_2','lenin_4')   # кадры с видео (s16): в маске видео рисунок не меняем
def load(B,n,suf='',mode='RGB',src='source/night/s15src'):
    return np.asarray(Image.open(f'{B}/{src}/{n}{suf}.webp').convert(mode))
def motion_mask(B,n,H,W):
    p=f'{B}/frames/{n}_motion_mask.png'
    out=np.zeros((H,W),bool)
    if n not in VIDEO: return out
    mv=np.asarray(Image.open(p).convert('LA')).astype(np.float32); mv=(mv[...,0]*mv[...,1]/255)>8
    h,w=min(H,mv.shape[0]),min(W,mv.shape[1]); out[:h,:w]=mv[:h,:w]; return out
def forbid(B,n,grow=3):
    o=load(B,n); H,W=o.shape[:2]
    al=load(B,n,'_building','RGBA')[...,3]>10
    env=load(B,n,'_env')[...,0]>100
    mv=motion_mask(B,n,H,W)
    m=al|env|mv
    if grow>0: m=ndimage.binary_dilation(m,iterations=grow)   # iterations=0 у scipy = «до упора» (урок 06.10)
    return m, dict(alpha=al,sky=env,video=mv)
PEDESTAL_OK=('lenin_4',)   # крупный план: текстуры (листья, трещины, травинки) разрешены на постаменте, статуя — нет
def statue(B,n):
    import sys; sys.path.insert(0,f'{B}/source/s16')
    import night_s16
    m,a,y0,y1=night_s16.statue_mask(load(B,n),load(B,n,'_building','RGBA')[...,3])
    return m
def forbid2(B,n,grow=3):
    fb,d=forbid(B,n,grow)
    if n in PEDESTAL_OK:
        st=statue(B,n); st[940:]=False   # ниже ботинок — бронзовая плита: на ней листья можно
        st=ndimage.binary_dilation(st,iterations=1)
        fb=d["sky"]|d["video"]
        if grow>0: fb=ndimage.binary_dilation(fb,iterations=grow)
        fb=fb|st
    return fb,d
