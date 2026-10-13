"""s17 отчёт: до (s16, что сейчас в frames/) / после (новые кадры) — день и ночь в ИТОГЕ движка (математика ночи viewer.js), таблица статуи.
python3 make_report.py <tests/lenin> <new_frames_dir> <report_dir>"""
import sys, json, numpy as np
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0,str(Path(__file__).parent)); import nightcheck, common
B=Path(sys.argv[1]); NEW=Path(sys.argv[2]); REP=Path(sys.argv[3]); REP.mkdir(parents=True,exist_ok=True)
OLD=B/'frames'; FR=common.FR
dim=json.loads((B/'building.json').read_text())['look']['night']['dim']
def im(p): return np.asarray(Image.open(p).convert('RGB'))
def eng(p): return (nightcheck.engine_night(im(p),dim)*255).clip(0,255).astype(np.uint8)
def get(d,n,suf):
    p=d/(n+suf+'.webp'); return p if p.exists() else OLD/(n+suf+'.webp')
def sheet(cols,labels,h=900):
    ims=[Image.fromarray(c) for c in cols]; ims=[i.resize((int(i.width*h/i.height),h)) for i in ims]
    W=sum(i.width for i in ims)+10*(len(ims)-1); c=Image.new('RGB',(W,h+28),'white'); x=0; dr=ImageDraw.Draw(c)
    for i,l in zip(ims,labels): c.paste(i,(x,28)); dr.text((x+6,6),l,fill=(0,0,0)); x+=i.width+10
    return c
for i,n in enumerate(FR,1):
    sheet([im(OLD/(n+'.webp')),im(get(NEW,n,'')),eng(OLD/(n+'_night.webp')),eng(get(NEW,n,'_night'))],
          ['%d %s day BEFORE (s16)'%(i,n),'day AFTER (s17)','night BEFORE (engine)','night AFTER (engine)']).save(REP/('frame%d_%s_before_after.jpg'%(i,n)),quality=86)
rows=[sheet([im(get(NEW,n,'')) for n in FR],['%d day'%i for i in range(1,6)],700),
      sheet([eng(get(NEW,n,'_night')) for n in FR],['%d night (engine)'%i for i in range(1,6)],700)]
c=Image.new('RGB',(max(r.width for r in rows),sum(r.height for r in rows)+10),'white'); y=0
for r in rows: c.paste(r,(0,y)); y+=r.height+10
c.save(REP/'all_frames_day_night_after.jpg',quality=86)
st=json.load(open(NEW/'s17_stats.json'))
L=['# s17 — статуя ночью (итог движка: cn *= mix(%.2f, 1, smoothstep(0.30, 0.60, luma)))'%dim,'',
   'Яркость — относительная (linear, Rec.709) средняя по силуэту статуи; «вокруг» — кольцо 12–60 px вокруг статуи (небо; на видах сверху — земля). Цель ≥ 2×.','',
   '| кадр | файл | было s16 (статуя / вокруг / ×) | стало s17 (статуя / вокруг / ×) | сила k |','|---|---|---|---|---|']
for i,n in enumerate(FR,1):
    s=st[n]['statue']
    sky=common.load(str(B),n,'_env')[...,0]>100
    sys.path.insert(0,str(B/'source/s16')); import night_s16
    stm,_,_,_=night_s16.statue_mask(common.load(str(B),n),common.load(str(B),n,'_building','RGBA')[...,3])
    import cv2; from scipy import ndimage
    d0=common.load(str(B),n); al=common.load(str(B),n,'_building','RGBA')[...,3]
    import night_s17; stm,_=night_s17.clean_statue(stm,d0)
    o=nightcheck.measure(im(OLD/(n+'_night.webp')),stm,sky,exclude=al>128)
    s['s16']='%.3f / %.3f / %.2f'%(o['statue'],o['around'],o['ratio'])
    L.append('| %d | %s | %s | %.3f / %.3f / %.2f (%s) | %.2f |'%(i,n,s.get('s16','—'),s['after']['statue'],s['after']['around'],s['after']['ratio'],s['after']['around_kind'],s['k']))
(REP/'statue_luminance.md').write_text('\n'.join(L)+'\n')
print('ok')
