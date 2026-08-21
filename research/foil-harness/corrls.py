import json, os, glob
import cv2, numpy as np
DIR="/tmp/claude-1000/-home-cheyras/b64a0301-b0e7-4e67-976e-46366638fbd3/scratchpad/foil"
spec=json.load(open(f"{DIR}/segments.json")); LABEL={}
for c in spec["clips"]:
    for s in c["segments"]: LABEL[s["id"]]={**s,"light":c["light"]}
rows=[]
for p in sorted(glob.glob(f"{DIR}/reg/*.png")):
    sid=os.path.basename(p).split("__")[0]; m=LABEL.get(sid)
    if not m: continue
    w=cv2.imread(p, cv2.IMREAD_COLOR).astype(np.float32)
    valid=w.sum(2)>0
    if valid.sum()<40000: continue
    L=(w*np.array([0.0722,0.7152,0.2126],np.float32)).sum(2)
    mx=w.max(2); mn=w.min(2)
    S=np.where(mx>0,(mx-mn)/np.maximum(mx,1e-6),0)
    rows.append({"id":sid,"card":m["card"],"light":m["light"],"variant":m["variant"],
                 "corrLS":float(np.corrcoef(L[valid],S[valid])[0,1])})
json.dump(rows,open(f"{DIR}/corrls.json","w"),indent=2)
print("measured",len(rows))
