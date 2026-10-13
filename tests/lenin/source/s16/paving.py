import numpy as np, cv2
from PIL import Image
from scipy import ndimage
SS=4
OVAL={
 'lenin_2':[(247,630),(255,610),(270,592),(295,585),(420,571),(440,577),(455,590),(640,735),(655,755),(656,775),(645,792),(620,805),(480,845),(450,852),(425,845),(400,827),(385,810),(252,647)],
 'lenin_6':[(135,650),(150,605),(200,575),(290,562),(340,567),(500,607),(560,627),(600,657),(622,705),(622,755),(605,805),(565,835),(480,850),(425,845),(300,795),(200,757),(145,715),(130,680)],
}
def chaikin(p,it=3):
    p=np.array(p,float)
    for _ in range(it):
        q=[]
        for i in range(len(p)):
            a=p[i];b=p[(i+1)%len(p)]
            q+= [0.75*a+0.25*b,0.25*a+0.75*b]
        p=np.array(q)
    return p
def oval_mask(n,H,W,shrink=3):
    p=chaikin(OVAL[n])
    m=np.zeros((H*SS,W*SS),np.uint8)
    cv2.fillPoly(m,[np.round(p*SS).astype(np.int32)],1)
    m=cv2.resize(m.astype(np.float32),(W,H),interpolation=cv2.INTER_AREA)
    m=m>0.5
    return ndimage.binary_erosion(m,iterations=shrink), p
def lines_intersect(p1,p2,p3,p4):
    x1,y1=p1;x2,y2=p2;x3,y3=p3;x4,y4=p4
    d=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4)
    t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/d
    return (x1+t*(x2-x1),y1+t*(y2-y1))
# quad sides (two points each): top,right,bottom,left
SIDES={
 'lenin_2':[((295,585),(420,571)),((455,590),(640,735)),((620,805),(480,845)),((385,810),(252,647))],
 'lenin_6':[((290,562),(500,607)),((622,705),(622,755)),((480,850),(300,795)),((145,715),(150,605))],
}
def quad(n):
    t,r,b,l=SIDES[n]
    TL=lines_intersect(*l,*t); TR=lines_intersect(*t,*r); BR=lines_intersect(*r,*b); BL=lines_intersect(*b,*l)
    return np.float32([TL,TR,BR,BL])
def uvmap(n,H,W):
    q=quad(n); M=cv2.getPerspectiveTransform(q,np.float32([[0,0],[1,0],[1,1],[0,1]]))
    ys,xs=np.mgrid[0:H,0:W].astype(np.float32)
    pts=np.stack([xs,ys],-1).reshape(-1,1,2)
    uv=cv2.perspectiveTransform(pts,M).reshape(H,W,2)
    return uv,M,q
