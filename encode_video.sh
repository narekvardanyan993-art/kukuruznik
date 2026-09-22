#!/bin/bash
FFMPEG=$(node -e "console.log(require('ffmpeg-static'))")

for mode in day sunset night; do
  for res in 1x 2x; do
    echo "Encoding $mode $res..."
    if [ "$res" = "2x" ]; then
      CRF=30
    else
      CRF=23
    fi
    $FFMPEG -y -framerate 30 -i kukuruznik/turntable/$res/$mode/%03d.webp \
      -vf "select='not(eq(mod(n\,3)\,2))',setpts=N/FRAME_RATE/TB" \
      -c:v libx264 -preset veryslow -crf $CRF -g 1 -pix_fmt yuv420p -movflags +faststart \
      kukuruznik/turntable/$res/${mode}.mp4
  done
done
echo "Encoding done."
