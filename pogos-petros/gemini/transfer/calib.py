import numpy as np, itertools, sys
from PIL import Image
def feats(c):
  c=c/255.0; r,g,b=c[...,0],c[...,1],c[...,2]
  t=[np.ones_like(r)]
  for d in range(1,4):
    for comb in itertools.combinations_with_replacement([r,g,b],d): t.append(np.prod(comb,axis=0))
  return np.stack(t,-1)
def fit(shot):
  a=np.asarray(Image.open(shot)).astype(float); L=15; X=[];Y=[]; n=0
  for r in range(L):
    for g in range(L):
      for b in range(L):
        cx,cy=(n%84)*16,(n//84)*16; X.append(a[cy+4:cy+12,cx+4:cx+12].reshape(-1,3).mean(0)); Y.append([round(v*255/(L-1)) for v in (r,g,b)]); n+=1
  X=np.array(X);Y=np.array(Y,float); F=feats(X)
  M,_,_,_=np.linalg.lstsq(F,Y,rcond=None); P=F@M; e=np.abs(P-Y)
  print('fit err mean %.2f p99 %.2f max %.1f'%(e.mean(),np.percentile(e,99),e.max()))
  return M
def apply(M,img):
  a=np.asarray(img.convert('RGB')).astype(float); out=feats(a)@M
  return Image.fromarray(np.clip(np.round(out),0,255).astype(np.uint8))
if __name__=='__main__':
  M=fit(sys.argv[1]); np.save('calibM.npy',M)
