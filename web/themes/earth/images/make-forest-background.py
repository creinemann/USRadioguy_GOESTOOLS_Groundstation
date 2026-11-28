# Draws forest.jpg, the Living Earth theme background (an original image, no photos used).
# Run from this folder: python3 make-forest-background.py   (needs numpy and opencv-python)
import numpy as np, cv2
W,H=2400,1350
rng=np.random.default_rng(11)
y,x=np.mgrid[0:H,0:W].astype(np.float32)
def noise(scale, seed):
    r=np.random.default_rng(seed).random((max(2,int(H/scale)),max(2,int(W/scale)))).astype(np.float32)
    return cv2.resize(r,(W,H),interpolation=cv2.INTER_CUBIC)
def fbm(seed, scales=(256,128,64,32,16,8,4)):
    out=np.zeros((H,W),np.float32); amp=1; tot=0
    for i,s in enumerate(scales): out+=noise(s,seed+i)*amp; tot+=amp; amp*=0.6
    return out/tot
# soft forest backdrop: dark greens with a large warm glow upper left
glow=np.exp(-(((x-W*0.30)/(W*0.42))**2+((y-H*0.10)/(H*0.55))**2))
back=fbm(1,(400,200,100))
img=np.stack([14+10*back+22*glow, 34+30*back+95*glow, 22+16*back+70*glow],-1)
# blurred trunks
for i in range(11):
    cx=rng.uniform(-50,W+50); w=rng.uniform(40,160); d=rng.uniform(.25,.5)
    img*=(1-d*np.exp(-((x-cx)/w)**2)*np.clip(1-glow*0.8,0,1))[...,None]
# bokeh
bok=np.zeros((H,W,3),np.float32)
for i in range(180):
    cx=rng.normal(W*0.33,W*0.26); cy=rng.normal(H*0.30,H*0.20)
    if not (0<cx<W and 0<cy<H*0.78): continue
    r=rng.uniform(10,55); a=rng.uniform(.12,.45)
    col=np.array([rng.uniform(60,120),rng.uniform(170,235),rng.uniform(140,215)])
    cv2.circle(bok,(int(cx),int(cy)),int(r),(col*a).tolist(),-1,cv2.LINE_AA)
img+=cv2.GaussianBlur(bok,(0,0),7)*0.6
# a few broad, soft light shafts
ang=np.arctan2(y+H*0.25,x-W*0.12)
shaft=np.zeros_like(x)
for a0,wid,st in [(0.55,0.035,1.0),(0.78,0.05,.7),(1.0,0.03,.8),(1.22,0.06,.5)]:
    shaft+=st*np.exp(-((ang-a0)/wid)**2)
shaft*=np.clip(1-np.hypot(x-W*0.12,y+H*0.25)/(W*1.0),0,1)
img+=cv2.GaussianBlur(shaft.astype(np.float32),(0,0),25)[...,None]*np.array([55,120,125],np.float32)*0.45
# moss: fine multi-octave texture, soft out-of-focus top edge
tex=fbm(20,(32,16,8,4,2))
clump=fbm(40,(180,90,45))
edge=H*0.79+55*(clump-0.5)*2+18*np.sin(x/90)
m=np.clip((y-edge)/45,0,1)
light=np.clip(1.15-(y-H*0.78)/(H*0.45),0.45,1.15)
moss=np.stack([18+40*tex*clump, 62+150*tex*(0.55+0.45*clump), 34+95*tex*clump],-1)*light[...,None]
# top of the moss band slightly blurred (shallow depth of field)
moss_bl=cv2.GaussianBlur(moss,(0,0),3)
near=np.clip((y-edge)/140,0,1)[...,None]
moss=moss_bl*(1-near)+moss*near
img=img*(1-m[...,None])+moss*m[...,None]
# subdued overall + vignette
vig=np.clip(1.2-np.hypot((x-W*0.45)/W,(y-H*0.45)/H)*1.15,0.45,1)
img=img*vig[...,None]*0.78
cv2.imwrite('forest.jpg',np.clip(img,0,255).astype(np.uint8),[cv2.IMWRITE_JPEG_QUALITY,82,cv2.IMWRITE_JPEG_PROGRESSIVE,1])
