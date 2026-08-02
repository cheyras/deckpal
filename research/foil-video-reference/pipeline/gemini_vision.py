#!/usr/bin/env python3
"""Call an OpenRouter vision model with local image frames + a text prompt.

Usage: gemini_vision.py <job.json> [out_override]
job.json: {"model": "...", "images": ["/abs/path.jpg", ...], "prompt": "...",
           "out": "gemini-spec.md", "max_tokens": 4000}
`out` (or the CLI override) may be relative — resolved against the CWD, so a
Ringer worker running this from its task directory lands the output there.
Reads the OpenRouter key from OpenCode's auth store; never prints it.

Part of the foil-video-reference corpus (see ../README.md). Every model call
made with this script ran as a Ringer task so it is logged and check-verified.
"""
import base64, json, sys, os, urllib.request

job = json.load(open(sys.argv[1]))
out = sys.argv[2] if len(sys.argv) > 2 else job["out"]

auth_paths = [
    os.path.expanduser("~/.local/share/opencode/auth.json"),
    os.path.expanduser("~/.config/opencode/auth.json"),
]
key = None
for p in auth_paths:
    if os.path.exists(p):
        a = json.load(open(p))
        node = a.get("openrouter") or {}
        key = node.get("key") or node.get("apiKey")
        if key:
            break
if not key:
    sys.exit("no openrouter key found in opencode auth store")

content = []
for img in job["images"]:
    b64 = base64.b64encode(open(img, "rb").read()).decode()
    ext = "jpeg" if img.lower().endswith((".jpg", ".jpeg")) else "png"
    content.append({"type": "image_url",
                    "image_url": {"url": f"data:image/{ext};base64,{b64}"}})
content.append({"type": "text", "text": job["prompt"]})

payload = {
    "model": job["model"],
    "messages": [{"role": "user", "content": content}],
    # NB: for reasoning models, reasoning tokens count against max_tokens —
    # keep this budget well above the expected visible output.
    "max_tokens": job.get("max_tokens", 12000),
    "temperature": job.get("temperature", 0.3),
}
if job.get("reasoning_effort"):
    payload["reasoning"] = {"effort": job["reasoning_effort"]}
body = json.dumps(payload).encode()

req = urllib.request.Request(
    "https://openrouter.ai/api/v1/chat/completions", data=body,
    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=300) as r:
    resp = json.load(r)

if "error" in resp:
    sys.exit(f"api error: {resp['error']}")
msg = resp["choices"][0]["message"]["content"]
usage = resp.get("usage", {})
d = os.path.dirname(out)
if d:
    os.makedirs(d, exist_ok=True)
open(out, "w").write(msg)
print(f"wrote {out} ({len(msg)} chars); usage: {usage.get('prompt_tokens')}p/{usage.get('completion_tokens')}c")
