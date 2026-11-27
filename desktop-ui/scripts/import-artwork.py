"""Convert approved artwork PNGs to draft SVG assets. Requires Pillow, numpy, opencv-python.
Usage: python scripts/import-artwork.py /path/to/StitchStudio_Artwork
Run from desktop-ui. Review all results before production use.
"""
from pathlib import Path
import sys, re, json
import cv2
import numpy as np
from PIL import Image, ImageFilter

source = Path(sys.argv[1])
out = Path(__file__).resolve().parents[1] / "src/assets/curated"
out.mkdir(parents=True, exist_ok=True)
catalog = []
for file in sorted(source.glob("*.png")):
    im = Image.open(file).convert("RGB")
    im.thumbnail((480,480))
    im = im.filter(ImageFilter.MedianFilter(5))
    rgb = np.array(im)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    # Estimate background from the image perimeter, not a fixed white threshold.
    edge = np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])
    bg = np.median(edge,axis=0)
    mask = (np.linalg.norm(lab.astype(float)-bg,axis=2)>18).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    for i in range(1,n):
        if stats[i,cv2.CC_STAT_AREA]<18: mask[labels==i]=0
    if not mask.any(): continue
    pixels = rgb[mask>0].astype(np.float32)
    cv2.setRNGSeed(42)
    k=min(12,len(pixels))
    _, clusters, centers = cv2.kmeans(pixels,k,None,(cv2.TERM_CRITERIA_EPS+cv2.TERM_CRITERIA_MAX_ITER,30,.5),3,cv2.KMEANS_PP_CENTERS)
    indexed=np.full(mask.shape,-1,dtype=np.int32)
    indexed[mask>0]=clusters.ravel()
    h,w=mask.shape
    scale=94/max(w,h)
    paths=[]
    for i,color in enumerate(centers):
        region=(indexed==i).astype(np.uint8)
        contours,_=cv2.findContours(region,cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
        segments=[]
        for c in contours:
            if cv2.contourArea(c)<12: continue
            p=cv2.approxPolyDP(c,1.2,True).reshape(-1,2)
            if len(p)<3: continue
            segments.append("M"+" L".join(f"{x*scale+(100-w*scale)/2:.2f} {y*scale+(100-h*scale)/2:.2f}" for x,y in p)+" Z")
        if segments:
            hexcolor="#"+''.join(f"{int(v):02x}" for v in color)
            paths.append(f'<path fill="{hexcolor}" fill-rule="evenodd" d="{" ".join(segments)}"/>')
    if not paths: continue
    slug=re.sub(r'[^a-z0-9]+','-',file.stem.lower()).strip('-')
    (out/(slug+".svg")).write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'+''.join(paths)+'</svg>',encoding="utf-8")
    catalog.append({"id":"curated-"+slug,"name":file.stem,"category":"Curated drafts","asset":slug,"tags":["draft","review required"]})
(out/"catalog.json").write_text(json.dumps(catalog,indent=2),encoding="utf-8")
print(f"Generated {len(catalog)} draft assets. Inspect lettering, background, colors and stitch quality before approval.")
