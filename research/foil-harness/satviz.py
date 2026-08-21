import cv2, numpy as np, glob, os
DIR="/tmp/claude-1000/-home-cheyras/b64a0301-b0e7-4e67-976e-46366638fbd3/scratchpad/foil"
W,H=480,660
def satmap(card, sid):
    cat=cv2.resize(cv2.imread(f"{DIR}/catalog/{card}.webp"),(W,H),interpolation=cv2.INTER_AREA)
    f=cat.astype(np.float32); mx,mn=f.max(2),f.min(2)
    sref=np.where(mx>0,(mx-mn)/np.maximum(mx,1e-6),0)
    ps=sorted(glob.glob(f"{DIR}/reg/{sid}__*.png"))
    acc=None; n=0
    for p in ps[:6]:
        img=cv2.imread(p).astype(np.float32); ok=img.sum(2)>0
        gains=[cat[:,:,c].astype(np.float32)[ok].mean()/max(img[:,:,c][ok].mean(),1e-6) for c in range(3)]
        wb=img*np.array(gains,np.float32)
        mx2,mn2=wb.max(2),wb.min(2)
        s=np.where(mx2>0,(mx2-mn2)/np.maximum(mx2,1e-6),0)
        d=np.where(ok,s-sref,0)
        acc=d if acc is None else acc+d; n+=1
    d=acc/max(n,1)
    v=np.clip((d+0.15)/0.30,0,1)                      # -0.15 red .. +0.15 blue
    m=cv2.applyColorMap((v*255).astype(np.uint8), cv2.COLORMAP_COOL)
    return m
out=[]
for card,pairs in [("Kakuna",["ove-kakuna-normal","ove-kakuna-reverse"]),
                   ("Weedle",["led-weedle-normal","led-weedle-reverse"])]:
    ids=[i.replace("ove-","led-") for i in pairs]
    row=[cv2.resize(cv2.imread(f"{DIR}/catalog/{card}.webp"),(200,275))]
    for sid in ids:
        try: row.append(cv2.resize(satmap(card,sid),(200,275)))
        except Exception as e: row.append(np.zeros((275,200,3),np.uint8))
    out.append(np.hstack(row))
cv2.imwrite(f"{DIR}/satviz.png", np.vstack(out))
print("rows: Kakuna, Weedle   cols: catalog | NORMAL shift | REVERSE shift")
print("magenta/pink = desaturated vs catalog (foil); cyan = more saturated")
