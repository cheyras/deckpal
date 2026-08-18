import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const MODELS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/models/decke')
const REF = JSON.parse(readFileSync('browref.json','utf8'))
const MK = Object.fromEntries(JSON.parse(readFileSync(
  resolve(MODELS, 'markers.json'),'utf8'))
  .markers.filter(m=>m.facing===1).map(m=>[m.state,m.frame]))
const b = await chromium.launch({ channel:'chrome', args:['--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport:{width:400,height:400} })
await p.goto('http://localhost:5199/deckpal/dev/decke?parity=1',{waitUntil:'networkidle'})
await p.waitForTimeout(7500)
const rows=[]
for (const r of REF) {
  const got = await p.evaluate(({state,F,M})=>{
    const d=window.deckE, S=d.stage.scene
    d.setState(state,{blendMs:0}); d.elapsed=(F-1)/30; d.stateStart=d.elapsed-(F-M)/30
    d.stop(); d.update(0)
    const lid=S.getObjectByName('DeckBox_Lid_anim'); lid.updateWorldMatrix(true,true)
    const inv=lid.matrixWorld.clone().invert()
    const g=n=>{const o=S.getObjectByName(n); o.updateWorldMatrix(true,false)
      const v=new (lid.position.constructor)().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv)
      return [+v.x.toFixed(5),+v.y.toFixed(5),+v.z.toFixed(5)]}
    return { L:g('Brow_L_anim'), R:g('Brow_R_anim') }
  },{state:r.s,F:r.f,M:MK[r.s]})
  rows.push({s:r.s, ref:r, got})
}
await b.close()
// blender (x,y,z) -> three (x, z, -y)
const conv=v=>[v[0],v[2],-v[1]]
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])
const bad=[]
console.log('state'.padEnd(16)+'  dL      dR     worst-axis')
for (const {s,ref,got} of rows) {
  const eL=conv(ref.L), eR=conv(ref.R)
  const dL=dist(eL,got.L), dR=dist(eR,got.R)
  const ax=['x','y','z']
  const wi=[0,1,2].reduce((m,i)=>Math.abs(eL[i]-got.L[i])>Math.abs(eL[m]-got.L[m])?i:m,0)
  console.log(s.padEnd(16)+dL.toFixed(4).padStart(7)+dR.toFixed(4).padStart(8)+
    `   ${ax[wi]}: blender ${eL[wi].toFixed(4)} port ${got.L[wi].toFixed(4)}`)
  if (Math.max(dL,dR)>0.02) bad.push([Math.max(dL,dR),s])
}
bad.sort((a,b)=>b[0]-a[0])
console.log('\n--- worst (>0.02 BU) ---')
for (const [d,s] of bad) console.log(d.toFixed(4), s)
