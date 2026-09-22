import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import tailwindcss from '../../apps/web/node_modules/@tailwindcss/vite/dist/index.mjs'
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js'

const root = process.cwd()
const outputDir = process.env.TEST_ARTIFACT_DIR ? path.join(process.env.TEST_ARTIFACT_DIR, 'payment-history') : path.join(root, '.cache/payment-history')
await mkdir(outputDir, { recursive: true })
const fixture = path.join(root, 'apps/web/.cache/payment-history-fixture.tsx')
await mkdir(path.dirname(fixture), { recursive: true })
await writeFile(fixture, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import '/@fs/${root}/apps/web/src/theme.css';import{PaymentHistory}from'/@fs/${root}/apps/web/src/components/billing/PaymentHistory.tsx';const q=new QueryClient({defaultOptions:{queries:{retry:false}}});function Fixture(){const[mounted,setMounted]=useState(true);(window as any).fixtureIdentityChange=()=>{setMounted(false);q.clear();setTimeout(()=>setMounted(true),350)};return <QueryClientProvider client={q}><main style={{maxWidth:760,margin:'auto',padding:16}}>{mounted&&<PaymentHistory/>}</main></QueryClientProvider>}createRoot(document.getElementById('root')!).render(<Fixture/>);`)
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Payment history proof</title><div id="root"></div><script type="module" src="/@fs/${fixture}"></script>`
const server = await createServer({ root: path.join(root, 'apps/web'), configFile: false, appType: 'custom', define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:54321'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('fixture-key') }, server: { host: '127.0.0.1', port: 0, strictPort: true }, optimizeDeps: { entries: [fixture] }, resolve: { alias: { react: path.join(root, 'apps/web/node_modules/react'), 'react-dom': path.join(root, 'apps/web/node_modules/react-dom') } }, build: { target: 'es2022' }, plugins: [tailwindcss(), { name: 'fixture-html', configureServer(vite) { vite.middlewares.use((req,res,next) => { if (req.url !== '/') return next(); res.writeHead(200, {'content-type':'text/html'}); res.end(html) }) } }] })
const coverage = 'Shows the current billing account only. Payments on older replaced or deleted billing accounts may be missing.'
const item = (id:string,status:string, extra={}) => ({ id, type:'Support payment', createdAt:'2026-09-20T12:00:00.000Z', amountMinor:1234, currency:'USD', status, refundedMinor:0, disputed:false, ...extra })
let browser
try {
  await server.listen(); const address=server.httpServer?.address(); assert.ok(address&&typeof address!=='string'); const origin=`http://127.0.0.1:${address.port}`
  browser=await chromium.launch(); const results:Record<string,unknown>={}
  for (const [name,width,height] of [['desktop',1280,900],['mobile',390,844]] as const) {
    const page=await browser.newPage({viewport:{width,height}}); let external=0, supportFirst=0, nextAttempts=0, inFlightNext=0, maxNext=0; let accountPhase:'normal'|'hold-old'|'new'='normal'
    await page.route('**/*', async route => {
      const url=new URL(route.request().url()); if(url.origin!==origin){external++;await route.abort('blockedbyclient');return}
      if(url.pathname==='/fixture/prepare-identity'){accountPhase='hold-old';await route.fulfill({status:204});return}
      if(url.pathname==='/fixture/identity-change'){accountPhase='new';await route.fulfill({status:204});return}
      if(url.pathname==='/api/me/billing/history'){
        const kind=url.searchParams.get('kind'); const cursor=url.searchParams.get('cursor')
        if(kind==='credits'){await new Promise(r=>setTimeout(r,35));await route.fulfill({json:{kind:'credits',items:[],nextCursor:null,coverage,billingAccountPresent:false}});return}
        if(!cursor){
          supportFirst++
          if(accountPhase==='hold-old'){await new Promise(r=>setTimeout(r,260));await route.fulfill({json:{kind:'support',items:[item('ch_old','paid',{type:'Old account payment'})],nextCursor:null,coverage,billingAccountPresent:true}});return}
          if(accountPhase==='new'){await route.fulfill({json:{kind:'support',items:[item('ch_new','paid',{type:'New account payment'})],nextCursor:null,coverage,billingAccountPresent:true}});return}
          await new Promise(r=>setTimeout(r,80)); if(supportFirst<=2){await route.fulfill({status:502,json:{error:{message:'temporary'}}});return}
          await route.fulfill({json:{kind:'support',items:[item('ch_paid','paid',{receiptUrl:'https://pay.stripe.com/receipts/unique'}),item('ch_refund','paid',{refundedMinor:500,disputed:true}),item('ch_auth','authorized'),item('ch_failed','failed')],nextCursor:'signed-next',coverage,billingAccountPresent:true}});return
        }
        inFlightNext++;maxNext=Math.max(maxNext,inFlightNext);nextAttempts++;await new Promise(r=>setTimeout(r,80));inFlightNext--
        if(nextAttempts<=2){await route.fulfill({status:502,json:{error:{message:'temporary'}}});return}
        await route.fulfill({json:{kind:'support',items:[item('ch_more','pending')],nextCursor:null,coverage,billingAccountPresent:true}});return
      }
      await route.continue()
    })
    await page.goto(origin); await page.getByText('Loading payment history…').waitFor(); await page.getByText('Payment history could not be loaded.').waitFor(); await page.getByRole('button',{name:'Retry'}).click(); await page.getByText('Support payment').first().waitFor()
    assert.equal(await page.getByText('Authorized, not captured').count(),1);assert.equal(await page.getByText('Failed attempt').count(),1);assert.equal(await page.getByText('Refunded $5.00').count(),1);assert.equal(await page.getByText('Disputed').count(),1)
    const receipt=page.getByRole('link',{name:/View receipt for \$12\.34 on Sep 20, 2026/});assert.equal(await receipt.getAttribute('href'),'https://pay.stripe.com/receipts/unique')
    const support=page.getByRole('radio',{name:'Support'}), credits=page.getByRole('radio',{name:'AI credits'})
    await support.focus();await support.press('ArrowRight');assert.equal(await credits.getAttribute('aria-checked'),'true');assert.equal(await credits.evaluate(e=>e===document.activeElement),true)
    await credits.press('Home');assert.equal(await support.getAttribute('aria-checked'),'true');assert.equal(await support.evaluate(e=>e===document.activeElement),true);assert.equal(await support.getAttribute('tabindex'),'0');assert.equal(await credits.getAttribute('tabindex'),'-1')
    await page.evaluate(() => {const radios=[...document.querySelectorAll<HTMLElement>('[role=radio]')];radios.find(el=>el.textContent?.includes('AI credits'))!.click();radios.find(el=>el.textContent?.includes('Support'))!.click()})
    await page.getByText('Authorized, not captured').waitFor();assert.equal(await support.getAttribute('aria-checked'),'true')
    const load=page.getByRole('button',{name:'Load more'});await load.evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});const loadingMore=page.getByRole('button',{name:'Loading…'});await loadingMore.waitFor();assert.equal(await loadingMore.isDisabled(),true);await page.getByText(/More payments could not be loaded/).waitFor();assert.equal(maxNext,1);assert.equal(await page.getByText('Support payment').count(),4)
    await page.getByRole('button',{name:'Retry load more'}).click();await page.getByText('Pending attempt').waitFor();await credits.click();await page.getByText('No payments found for this billing account.').waitFor();await support.click();await page.getByText('Authorized, not captured').waitFor()
    await page.evaluate(() => fetch('/fixture/prepare-identity'));await credits.click();await page.getByText('No payments found for this billing account.').waitFor();await support.click();await page.getByText('Loading payment history…').waitFor()
    await page.evaluate(async () => {await fetch('/fixture/identity-change',{method:'POST'});(window as any).fixtureIdentityChange()});await page.getByText('New account payment').waitFor();await page.waitForTimeout(320);assert.equal(await page.getByText('Old account payment').count(),0)
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert.ok(overflow<=0,`${name} overflow ${overflow}`);const targets=await page.locator('button,a').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));assert.ok(targets.length>0&&targets.every(h=>h>=44));assert.equal(external,0)
    await page.screenshot({path:path.join(outputDir,`${name}.png`),fullPage:true})
    results[name]={viewport:{width,height},externalRequests:external,noHorizontalOverflow:overflow<=0,minTapTarget:Math.min(...targets),supportFirstRequests:supportFirst,maxConcurrentPagination:maxNext,initialFailureRetry:true,receiptAccessible:true,keyboardSelection:true,rapidSelectionLastWins:true,identityChangeExcludedOldRows:true,paymentStates:true,loadMoreFailureRetainedRows:true,rapidPaginationBounded:maxNext===1,emptyState:true};await page.close()
  }
  await writeFile(path.join(outputDir,'browser-proof.json'),JSON.stringify({status:'passed',generatedAt:new Date().toISOString(),results},null,2)+'\n');console.log('PASS payment history Chromium proof at 1280 and 390')
} finally {await browser?.close();await server.close()}
