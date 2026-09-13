import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { serve } from './support.mjs'

/** The real built worker controls this context. The page is deliberately minimal
 * so only the worker's network/cache contract is under test, with CSP enforcing
 * loopback-only requests even for fetches Playwright cannot intercept. */
export async function checkServiceWorkerPrivacy(browser, dist, mount, label) {
  fs.writeFileSync(path.join(dist,'privacy.html'), '<!doctype html><title>Worker privacy boundary</title><p>Worker test</p>')
  let actor='owner'
  const server=await serve(dist,mount,(rel,url)=>{
    if(rel.startsWith('/api/')) return {body:{actor,path:rel},headers:{'Cache-Control':url.searchParams.has('private')?'private, no-store':'public, max-age=60'}}
    return null
  },'privacy.html',{csp:"default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"})
  const context=await browser.newContext({serviceWorkers:'allow'})
  try{
    const page=await context.newPage()
    await page.goto(server.origin+mount+'/privacy.html')
    await page.evaluate(async mount=>{
      const old=await caches.open('deckpal-api-v2')
      await old.put(mount+'/api/admin/users',new Response(JSON.stringify({secret:'retired owner response'})))
      const registration=await navigator.serviceWorker.register(mount+'/sw.js')
      await navigator.serviceWorker.ready
      if(registration.waiting)registration.waiting.postMessage({type:'SKIP_WAITING'})
    },mount)
    await page.reload()
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller)
    assert.equal(await page.evaluate(async()=>(await caches.keys()).includes('deckpal-api-v2')),false,'Retired user-data cache must be deleted')
    const privatePaths=['/api/me','/api/me/credits','/api/me/credits/events','/api/admin/users','/api/admin/audit','/api/series?private=1','/api/series?authorized=1']
    await page.evaluate(async({mount,privatePaths})=>{
      for(const p of privatePaths)await fetch(mount+p,{headers:p.includes('authorized')?{Authorization:'Bearer fixture-owner'}:{}}).then(r=>r.json())
      await fetch(mount+'/api/series?anon=1').then(r=>r.json())
    },{mount,privatePaths})
    // Workbox commits runtime entries asynchronously; settle by observing the
    // expected anonymous entry, only in cloud (self-host proxy identity opaque).
    if(label==='cloud') await page.waitForFunction(async mount=>!!(await caches.match(mount+'/api/series?anon=1')),mount)
    const cached=await page.evaluate(async()=>{const paths=[];for(const name of await caches.keys()){const cache=await caches.open(name);paths.push(...(await cache.keys()).map(r=>new URL(r.url).pathname+new URL(r.url).search))}return paths})
    for(const p of privatePaths)assert.equal(cached.includes(mount+p),false,'Sensitive response cached: '+p)
    actor='another-user'
    assert.equal(await page.evaluate(async mount=>(await fetch(mount+'/api/me').then(r=>r.json())).actor,mount),'another-user')
    actor='signed-out'
    await context.setOffline(true)
    const offline=await page.evaluate(async({mount,privatePaths})=>{
      const result={}
      for(const p of privatePaths){try{result[p]=await fetch(mount+p).then(r=>r.json())}catch{result[p]=null}}
      try{result.public=await fetch(mount+'/api/series?anon=1').then(r=>r.json())}catch{result.public=null}
      return result
    },{mount,privatePaths})
    for(const p of privatePaths)assert.equal(offline[p],null,'Private data replayed offline after identity change: '+p)
    if(label==='cloud')assert.equal(offline.public.actor,'owner','Anonymous catalog cache remains available')
    assert.deepEqual(server.unexpected,[],'Worker fixture must use only served assets and loopback API')
    return {case:'real-service-worker-privacy',label,privatePaths:privatePaths.length,retiredCacheDeleted:true,offlinePrivateReplay:false,anonymousCatalogOffline:label==='cloud'}
  }finally{await context.close();await server.close()}
}
