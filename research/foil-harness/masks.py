import cv2, numpy as np
DIR="/tmp/claude-1000/-home-cheyras/b64a0301-b0e7-4e67-976e-46366638fbd3/scratchpad/foil"
W,H=480,660
# Modern (ME/SV) layout, fractions of card size. Art window sits under the name bar.
ART=(0.055,0.115,0.945,0.520)     # x0,y0,x1,y1
out=[]
for n in ("Weedle","Kakuna","Ninetales"):
    im=cv2.resize(cv2.imread(f"{DIR}/catalog/{n}.webp"),(W,H),interpolation=cv2.INTER_AREA)
    v=im.copy()
    x0,y0,x1,y1=[int(ART[0]*W),int(ART[1]*H),int(ART[2]*W),int(ART[3]*H)]
    cv2.rectangle(v,(x0,y0),(x1,y1),(0,255,0),3)
    # body = card minus art minus a border margin
    m=np.zeros((H,W),np.uint8); m[:]=255
    b=int(0.05*W)
    m[:b,:]=0; m[-b:,:]=0; m[:,:b]=0; m[:,-b:]=0
    m[y0:y1,x0:x1]=0
    v[m>0]=(0.6*v[m>0]+0.4*np.array([255,0,255])).astype(np.uint8)
    out.append(v)
cv2.imwrite(f"{DIR}/mask_check.png",np.hstack(out))
print("green = art window, magenta tint = body region")
