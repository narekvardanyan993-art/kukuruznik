#!/bin/bash
FFMPEG=$(node -e "console.log(require('ffmpeg-static'))")

for mode in day sunset night; do
  for res in 1x 2x; do
    echo "Encoding $mode $res..."
    $FFMPEG -y -framerate 30 -i kukuruznik/turntable/$res/$mode/%03d.webp \
      -c:v libx264 -preset fast -crf 18 -g 1 -pix_fmt yuv420p -movflags +faststart \
      kukuruznik/turntable/$res/${mode}.mp4
  done
done
echo "Encoding done."
