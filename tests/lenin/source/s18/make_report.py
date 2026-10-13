"""s18 отчёт: all_frames_day_night_after.jpg (математика движка: день, ночь NIGHT_DIM), статуя s17/s18, таблицы цвета."""
import sys, json, numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0,'source/s18'); import esim
R='report/s18/'; S=json.load(open(R+'s18_stats.json'))
cols=[]
for n in esim.FR:
    d=esim.day(esim.load('.',n)); nt=esim.night(esim.load('.',n,'_night'))
    c=np.concatenate([d,np.full((8,768,3),255.0),nt],0)
    cols.append(Image.fromarray(np.clip(c,0,255).astype(np.uint8)).resize((384,(1365*2+8)//2),Image.LANCZOS))
A=Image.new('RGB',(5*384+4*10,cols[0].height+20),'white'); dr=ImageDraw.Draw(A)
for i,c in enumerate(cols): A.paste(c,(i*394,20)); dr.text((i*394+4,4),'frame %d (%s) day / night, engine math, s18'%(i+1,esim.FR[i]),fill=(0,0,0))
A.save(R+'all_frames_day_night_after.jpg',quality=86)
import subprocess; import os; old=os.path.expanduser('~/work/s17re')
if os.path.isdir(old): subprocess.run(['python3','source/s18/sheet_statue.py','frames',R+'statue_s17_vs_s18.jpg',old],check=True)   # столбцы: день s17, день s18, ночь s17, ночь s18
L=['# s18 — статуя: цвет до/после (математика движка, маска статуи)','',
   'День: дневная обработка движка (зелень GREEN_*), ночь: NIGHT_DIM. hue_lab — оттенок по Lab (70–75 = золото/хаки, 85–100 = олива/патина), C — хрома.',
   'Цвета s18 подобраны вне полосы «зелени» движка (HSV 36–162°): блик — тёплый коричневый, патина — сине-зелёная; движок их не перекрашивает (настройка движка не нужна).','',
   '| кадр | день s17: L / hue / C / HSV-s | день s18 | ночь s17 | ночь s18 | статуя/небо ночью (итог движка) | k |','|---|---|---|---|---|---|---|']
f=lambda x:'%.1f / %.0f / %.1f / %.2f'%(x['L'],x['hue_lab'],x['chroma'],x['hsv_s'])
for n in esim.FR:
    s=S[n]; L.append('| %d | %s | %s | %s | %s | %.2f | %.2f |'%(esim.VIEW[n],f(s['statue_day']['before_engine']),f(s['statue_day']['after_engine']),f(s['statue_night']['before_engine_s17']),f(s['statue_night']['after_engine']),s['statue_night']['ratio_to_sky'],s['statue_night']['k']))
L+=['','Правило s17 «статуя ≥ 2× неба ночью» — цель 2,2 (кадры 1, 3, 4 — кольцо неба вокруг; 2 и 5 — небо кадра).','',
    '# Кадр 5 — мощение (только жёлтое и кремово-белое, маска report/s18/frame5_paving_mask.png)','',
    '| | L* | хрома C | C p90 | оттенок Lab |','|---|---|---|---|---|']
p=S['lenin_6']
for k in ('yellow','white'):
    for w,lab in (('paving_before','до'),('paving_after','после')):
        x=p[w][k]; L.append('| %s %s | %.1f | %.1f | %.1f | %.0f |'%(k,lab,x['L'],x['chroma'],x['chroma_p90'],x['hue']))
L+=['','Кадр 1 (мощение внизу, для сравнения): L 88,1, C 11,6, p90 21,4, оттенок 76. По числам жёлтое кадра 5 и раньше было не беднее кадра 1 —',
    '«бледность» давали светлота (L 91) и лимонный оттенок (движок тянет жёлто-зелёное к зелени). Теперь: темнее на 4–5 L*, хрома ×1,3, оттенок к кадру 1 (76–80), белое — кремовое.','',
    '# Ночь кадра 2 — светлая полоса','',
    'Светлая бумажная кайма у левого (и правого/нижнего) края ночной картинки от горизонта вниз (яркость ~170 при ночи ~60): заменена местным ночным тоном,',
    'штрих сохранён (paper_edge в run_s18.py). Пикселей исправлено: %d.'%S['lenin_2'].get('paper_edge_px',0)]
open(R+'colour.md','w').write('\n'.join(L)+'\n'); print('\n'.join(L[:14]))
