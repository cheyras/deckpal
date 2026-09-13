import assert from 'node:assert/strict'
import path from 'node:path'
import { contextFor } from './support.mjs'
import { appResponses, announcement } from './upcoming.mjs'

export const PERMISSIONS = ['admin.access','users.read','users.manage','roles.read','roles.manage','settings.read','settings.write','credits.read','credits.manage','audit.read','scanner.use','scanner.label','design.view','diagnostics.view','decke.use']
const OWNER = '10000000-0000-4000-8000-000000000001', USER = '10000000-0000-4000-8000-000000000002'
const now = '2026-09-12T18:00:00Z'
export function adminFixture(mount) {
  const state = {
    actor: 'owner', permissions: [...PERMISSIONS], conflicts: false, requests: [], signedOut: false,
    defaults: { settings: { skin: 'premium', topbar: 'flat' }, revision: 1, updatedAt: now },
    economics: { policy: { enabled: true, microUsdPerCredit: 10000, markupBps: 0, estimatedMicroUsd: { chatTurn: 143, analysis: 35600, planDeck: 750000 }, lowBalance: 100 }, revision: 1, updatedAt: now, estimateNotice: 'Review the historical chat estimate before commercial pricing.' },
    roles: [{ id: 'super-role', key: 'super_admin', name: 'Super administrator', description: 'Owner administration', permissions: [...PERMISSIONS], memberCount: 1, protected: true, revision: 1 }],
    users: [{ id: USER, username: 'Future Contributor', email: 'contributor-with-a-long-address@example.invalid', createdAt: now, lastSignInAt: null, suspended: false, roles: [], revision: 1 }],
    packs: [{ id: 'pack-1', name: 'Starter', credits: 500, priceCents: 500, currency: 'usd', active: true, revision: 1 }],
    balance: 0, purchasesEnabled: true, events: [], order: { id: 'order-1', status: 'pending', credits: 500, priceCents: 500, currency: 'usd' },
  }
  const allowMutation = (pathname, method) => {
    const rel = pathname.slice(mount.length)
    return ['POST','PUT','PATCH','DELETE'].includes(method) && (/^\/api\/admin\/(roles(?:\/[^/]+)?|settings|users\/[^/]+\/(roles|status|revoke-tokens)|credits\/(settings|packs(?:\/[^/]+)?|users\/[^/]+\/(adjustments|resolve-hold)))$/.test(rel) || rel === '/api/me/credits/checkout' || (method === 'POST' && rel === '/api/me/billing/visit'))
  }
  const response = (rel, url, req = { method: 'GET' }) => {
    const { method, body } = req
    if (rel.startsWith('/api/')) state.requests.push({ rel, method, body })
    const ok = value => ({ body: value, headers: { 'Cache-Control': 'no-store, private' } })
    if (rel === '/api/public-config') return { body: { defaults: state.defaults.settings, mode: mount ? 'self-host' : 'cloud' } }
    if (rel === '/api/me') return state.signedOut ? { status: 401, body: { error: { message: 'Signed out' } } } : ok({ id: state.actor === 'owner' ? OWNER : USER, username: state.actor, permissions: state.permissions, roles: state.actor === 'owner' ? [{ id: 'super-role', name: 'Super administrator' }] : [], adminReady: true, owner: state.actor === 'owner', decke: state.permissions.includes('decke.use') })
    if (rel === '/api/me/settings') return ok({ settings: { defaultGoal: 'complete', displayCurrency: 'USD', pricingEnabled: true, showCollectionValue: true, binderPocketSize: 9, binderStackVariants: true, binderAdditionalVariants: 'hide', deckeHidden: false, skin: null, topbar: null, seriesSortKey: 'recency', seriesSortDir: 'desc', seriesGroupOwned: false }, defaults: state.defaults.settings })
    if (rel === '/api/insights/overview') return ok({ trainer: { level: 1 }, collection: {}, pokedex: { captured: 0, total: 1 }, tcg: {}, completion: {}, value: {} })
    if (rel === '/api/avatar') return ok({ avatarUrl: null })
    if (rel === '/api/me/billing' || rel === '/api/me/billing/visit') return ok({ available: false, mode: 'unconfigured', prompt: { due: null } })
    if (rel === '/api/decke/history') return ok({ conversations: [] })
    if (rel === '/api/me/credits') return ok({ enabled: true, balance: state.balance, debt: 0, purchaseHold: false, lowAt: 100, prices: { chatTurn: 1, analysis: 4, planDeck: 75 }, packs: state.packs.filter(p => p.active), purchasesEnabled: state.purchasesEnabled, purchaseUnavailableReason: state.purchasesEnabled ? null : 'Required Stripe webhook events are missing.' })
    if (rel === '/api/me/credits/events') return ok({ events: state.events, total: state.events.length, limit: 25, offset: 0 })
    if (rel === '/api/me/credits/checkout') { assert.equal(method,'POST'); assert.equal(body.packId, 'pack-1'); assert.ok(body.idempotencyKey); assert.deepEqual(Object.keys(body).sort(), ['idempotencyKey','packId']); return ok({ url: 'https://checkout.stripe.com/c/pay/fixture-only', orderId: 'order-1' }) }
    if (rel === '/api/me/credits/orders/order-1') return ok(state.order)
    if (rel === '/api/admin/overview') return ok({ adminReady: true, counts: state.permissions.includes('users.read') ? { users: 2, suspended: 0, roles: state.roles.length, auditEvents: state.events.length } : {}, status: { bootstrap: 'ready', mode: mount ? 'self-host' : 'cloud' } })
    if (rel === '/api/admin/users') return ok({ users: state.users.filter(u => !url.searchParams.get('search') || JSON.stringify(u).includes(url.searchParams.get('search'))), total: 1, limit: 25, offset: 0 })
    if (rel === '/api/admin/users/' + USER) return ok({ user: state.users[0], permissions: state.users[0].roles.flatMap(r => state.roles.find(role => role.id === r.id)?.permissions ?? []), stats: { collectionItems: 3, decks: 1, connectors: 2 } })
    if (rel === '/api/admin/users/' + USER + '/roles') {
      assert.equal(body.expectedRevision, state.users[0].revision)
      assert.ok(body.reason.length >= 3)
      state.users[0].roles = state.roles.filter(r => body.roleIds.includes(r.id)).map(({id,name})=>({id,name})); state.users[0].revision++; return ok({ ok: true })
    }
    if (rel === '/api/admin/users/' + USER + '/status') { state.users[0].suspended = body.suspended; state.users[0].revision++; return ok({ ok: true }) }
    if (rel === '/api/admin/users/' + USER + '/revoke-tokens') return ok({ revoked: 2 })
    if (rel === '/api/admin/roles' && method === 'POST') { state.roles.push({ ...body, id: 'role-'+state.roles.length, key: 'custom', memberCount: 0, protected: false, revision: 1 }); return ok({ role: state.roles.at(-1) }) }
    if (rel === '/api/admin/roles') return ok({ roles: state.roles, permissions: PERMISSIONS.map(key => ({ key, group: key.split('.')[0], description: 'Controls ' + key })) })
    if (/^\/api\/admin\/roles\/role-\d+$/.test(rel)) {
      const role = state.roles.find(r => r.id === rel.split('/').at(-1))
      if (method === 'DELETE') state.roles = state.roles.filter(r => r !== role)
      else Object.assign(role, body, { revision: role.revision + 1 })
      return ok({ ok: true })
    }
    if (rel === '/api/admin/settings') {
      if (method === 'PUT') { state.defaults.settings = body.settings; state.defaults.revision++ }
      return ok(state.defaults)
    }
    if (rel === '/api/admin/credits/settings') {
      if (method === 'PUT') {
        if (state.conflicts) return { status: 409, body: { error: { message: 'Revision conflict' } } }
        assert.equal(body.expectedRevision, state.economics.revision); state.economics.policy = body.policy; state.economics.revision++
      }
      return ok(state.economics)
    }
    if (rel === '/api/admin/credits/packs' && method === 'POST') { state.packs.push({ ...body, id: 'pack-'+(state.packs.length+1), revision: 1 }); return ok({ pack: state.packs.at(-1) }) }
    if (rel === '/api/admin/credits/packs') return ok({ packs: state.packs })
    if (/^\/api\/admin\/credits\/packs\/pack-\d+$/.test(rel)) { Object.assign(state.packs.find(p => p.id === rel.split('/').at(-1)), body); return ok({ok:true}) }
    if (rel === '/api/admin/credits/users/' + USER) return ok({balance:state.balance,debt:0,purchaseHold:false,events:[]})
    if (rel === '/api/admin/credits/users/' + USER + '/adjustments') { assert.ok(body.reason); state.balance+=body.delta;return ok({balance:state.balance}) }
    if (rel === '/api/admin/credits/payment-status') return ok({ ready: false, reason: 'Required Stripe webhook events are missing.', requiredEvents: ['checkout.session.completed'], checkedAt: now })
    if (rel === '/api/admin/credits/summary') return ok({ days: Number(url.searchParams.get('days')),creditsSpent:0,creditsGranted:0,paidOrders:0,grossSalesCents:0,refundedCents:0,pendingOrders:1,heldWallets:0,debtWallets:0,totalDebt:0,estimatedProviderMicroUsd:0,unpricedSpends:0 })
    if (rel === '/api/admin/credits/orders') return ok({orders:[],total:0,offset:0,limit:25})
    if (rel === '/api/admin/audit') return ok({events:[],total:0,offset:0,limit:25})
    return appResponses('active', rel)
  }
  return {state,response,allowMutation}
}
async function signIn(context, id = OWNER) {
  await context.addInitScript(({ id }) => {
    const token = btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify({sub:id,exp:4102444800,role:'authenticated'}))+'.fixture'
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at:4102444800,user:{id,email:'fixture@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-09-12T18:00:00Z'} }))
    localStorage.setItem('deckpal.settings.pushed.v1','1')
  }, { id })
}
export async function checkAdmin(browser, server, mount, label, out, fixture) {
  const results = [], {state} = fixture
  for (const width of [1280,390]) {
    state.actor='owner';state.permissions=[...PERMISSIONS]
    const {context,page}=await contextFor(browser,server,width);await signIn(context)
    try {
      await page.goto(server.origin+mount+'/admin',{waitUntil:'networkidle'})
      await page.getByRole('heading',{name:'Administration',exact:true}).waitFor()
      if(width===390){await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('dialog',{name:'Navigation'}).getByRole('link',{name:'Administration',exact:true}).waitFor();await page.getByRole('button',{name:'Menu',exact:true}).click()}
      assert.equal(await page.locator('a[href$="/admin"][data-decke-clickable]').count(),0)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(out,label+'-admin-'+width+'.png'),fullPage:true})
      await page.getByRole('link',{name:'Roles',exact:true}).click()
      await page.getByRole('button',{name:'Create role',exact:true}).click()
      let dialog=page.getByRole('dialog',{name:'Create role',exact:true})
      await dialog.getByLabel('Role name',{exact:true}).fill('Scanner helper '+width)
      await dialog.getByLabel('Description',{exact:true}).fill('Can reach the training tools')
      await dialog.getByLabel('admin.access', {exact:false}).check()
      await dialog.getByLabel('scanner.label', {exact:false}).check()
      await page.screenshot({path:path.join(out,label+'-role-form-'+width+'.png'),fullPage:true})
      await dialog.getByRole('button',{name:'Create role',exact:true}).click()
      await dialog.waitFor({state:'hidden'})
      if(width===1280){
        await page.getByRole('button',{name:'Edit Scanner helper '+width,exact:true}).click()
        dialog=page.getByRole('dialog',{name:'Edit role',exact:true})
        await dialog.getByLabel('Description',{exact:true}).fill('Reviewed contributor role')
        await dialog.getByRole('button',{name:'Save role',exact:true}).click();await dialog.waitFor({state:'hidden'})
        await page.getByRole('button',{name:'Clone Scanner helper '+width,exact:true}).click()
        dialog=page.getByRole('dialog',{name:'Create role',exact:true})
        await dialog.getByLabel('Role name',{exact:true}).fill('Temporary reviewer')
        await dialog.getByRole('button',{name:'Create role',exact:true}).click();await dialog.waitFor({state:'hidden'})
        await page.getByRole('button',{name:'Delete Temporary reviewer',exact:true}).click()
        dialog=page.getByRole('dialog',{name:'Delete role',exact:true})
        await dialog.getByRole('button',{name:'Delete role',exact:true}).click();await dialog.waitFor({state:'hidden'})
        assert.equal(state.roles.some(r=>r.name==='Temporary reviewer'),false)
      }
      await page.getByRole('link',{name:'Users',exact:true}).click()
      await page.getByRole('link',{name:'Future Contributor',exact:true}).click()
      await page.getByRole('button',{name:'Assign roles',exact:true}).click()
      dialog=page.getByRole('dialog',{name:'Assign roles',exact:true})
      await dialog.getByLabel('Scanner helper '+width,{exact:false}).check()
      await dialog.getByLabel('Reason',{exact:true}).fill('Contributor onboarding')
      await dialog.getByRole('button',{name:'Save role assignments'}).click()
      await dialog.waitFor({state:'hidden'})
      await page.getByRole('button',{name:'Assign roles',exact:true}).waitFor()
      assert.ok(state.users[0].roles.some(r=>r.name==='Scanner helper '+width))
      await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(out,label+'-user-'+width+'.png'),fullPage:true})
      await page.getByRole('button',{name:'Assign roles',exact:true}).click()
      dialog=page.getByRole('dialog',{name:'Assign roles',exact:true})
      await dialog.getByLabel('Scanner helper '+width,{exact:false}).uncheck()
      await dialog.getByLabel('Reason',{exact:true}).fill('Revoke completed assignment')
      await dialog.getByRole('button',{name:'Save role assignments'}).click();await dialog.waitFor({state:'hidden'})
      assert.equal(state.users[0].roles.some(r=>r.name==='Scanner helper '+width),false)
      await page.getByRole('link',{name:'Settings',exact:true}).click()
      if(width===1280){
        await page.getByLabel('Visual style',{exact:true}).selectOption('classic')
        await page.getByRole('button',{name:'Save app defaults'}).click()
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
        await page.waitForFunction(()=>document.documentElement.dataset.skin==='classic')
        assert.equal(await page.evaluate(()=>localStorage.getItem('deckpal:skin')),null,'A system default became a personal override')
        await page.getByLabel('Visual style',{exact:true}).selectOption('premium')
        await page.getByRole('button',{name:'Save app defaults'}).click()
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
        await page.waitForFunction(()=>document.documentElement.dataset.skin==='premium')
      }
      await page.getByLabel('Provider-cost markup (%)',{exact:true}).fill('25')
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
      await page.waitForTimeout(200)
      assert.equal(await page.getByLabel('Provider-cost markup (%)',{exact:true}).inputValue(),'25','Focus lost the unsaved pricing draft')
      await page.getByLabel('Estimated provider cost: chat turn (USD)',{exact:true}).fill('0.01153')
      await page.getByRole('heading',{name:'Estimated usage preview'}).waitFor()
      await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(out,label+'-economy-'+width+'.png'),fullPage:true})
      if(width===1280){state.conflicts=true;await page.getByRole('button',{name:'Save credit economy'}).click();await page.getByText(/This record changed while you were editing/).waitFor();state.conflicts=false}
      await page.getByRole('button',{name:'Save credit economy'}).click()
      await page.getByText('Revision '+state.economics.revision+' ·',{exact:false}).last().waitFor()
      assert.equal(state.economics.policy.markupBps,2500);assert.equal(state.economics.policy.estimatedMicroUsd.chatTurn,11530)
      await page.getByRole('button',{name:'Create credit pack'}).click()
      dialog=page.getByRole('dialog',{name:'Create credit pack'})
      await dialog.getByLabel('Pack name').fill('Value '+width);await dialog.getByLabel('Credits in pack').fill('1200');await dialog.getByLabel('Sale price (USD)').fill('9.50');await dialog.getByLabel('Available for new purchases').check()
      await dialog.getByRole('button',{name:'Save credit pack'}).click();await dialog.waitFor({state:'hidden'})
      await page.goto(server.origin+mount+'/credits?order=order-1',{waitUntil:'networkidle'})
      await page.getByRole('heading',{name:'AI credits',exact:true}).waitFor()
      await page.getByText(/Waiting for payment confirmation/).waitFor()
      state.order.status='paid';state.balance=500
      await page.getByRole('button',{name:'Refresh purchase status'}).click()
      await page.getByText(/Payment verified/).waitFor()
      await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(out,label+'-wallet-'+width+'.png'),fullPage:true})
      state.order.status='pending'
      await page.getByRole('button',{name:'Buy Starter',exact:true}).click()
      let hostedUrl=''
      await page.route('https://checkout.stripe.com/**',route=>{hostedUrl=route.request().url();return route.fulfill({contentType:'text/html',body:'Fixture checkout boundary'})})
      await page.getByRole('button',{name:'Continue to checkout'}).click()
      await page.waitForURL('https://checkout.stripe.com/**')
      assert.match(hostedUrl,/fixture-only$/)
      results.push({case:'admin-role-economy-wallet-journey',label,width,hostedCheckoutAsserted:true})
    }catch(error){await page.screenshot({path:path.join(out,label+'-admin-failure.png'),fullPage:true});error.message+='\nPage: '+(await page.locator('body').innerText()).slice(0,1800)+'\nUnexpected: '+JSON.stringify(server.unexpected);throw error}finally{await context.close()}
  }
  for(const [actor,permissions] of [['readonly',['admin.access','users.read']],['labeler',['admin.access','scanner.label']],['ordinary',[]]]){
    state.actor=actor;state.permissions=permissions
    const {context,page}=await contextFor(browser,server,390);await signIn(context,USER)
    try{
      await page.goto(server.origin+mount+(actor==='ordinary'?'/admin/users':'/admin/tools'),{waitUntil:'networkidle'})
      if(actor==='ordinary'){assert.equal(await page.getByRole('heading',{name:'Users',exact:true}).count(),0)}
      else{
        await page.getByRole('heading',{name:'Tools',exact:true}).waitFor()
        assert.equal(await page.getByRole('link',{name:'Roles',exact:true}).count(),0)
        assert.equal(await page.getByRole('link',{name:'Settings',exact:true}).count(),0)
        if(actor==='labeler'){assert.equal(await page.getByRole('link',{name:/Quad labeler/}).count(),1);assert.equal(await page.getByRole('link',{name:/Card scanner/}).count(),0)}
        if(actor==='readonly'){await page.getByRole('link',{name:'Users',exact:true}).click();await page.getByRole('link',{name:'Future Contributor',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Assign roles',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Adjust credits',exact:true}).count(),0)}
        state.permissions=[];await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('Access unavailable',{exact:true}).waitFor()
        assert.equal(await page.getByText('contributor-with-a-long-address@example.invalid',{exact:true}).count(),0)
      }
      results.push({case:'admin-permission-and-revocation',label,actor})
    }finally{await context.close()}
  }
  if(label==='cloud'){
    state.actor='ordinary';state.permissions=[]
    const {context,page}=await contextFor(browser,server,390)
    try{await page.goto(server.origin+'/admin',{waitUntil:'networkidle'});assert.equal(await page.getByRole('heading',{name:'Administration',exact:true}).count(),0);results.push({case:'signed-out-admin-denied',label})}finally{await context.close()}
    state.actor='owner';state.permissions=[...PERMISSIONS];state.balance=0
    const host=await contextFor(browser,server,390);await signIn(host.context)
    try{
      await host.page.goto(server.origin+'/series/'+announcement.seriesSlug,{waitUntil:'networkidle'})
      await host.page.getByRole('button',{name:'Chat with Deck-E',exact:true}).click()
      await host.page.getByRole('button',{name:/Top up/i}).first().click()
      await host.page.getByRole('heading',{name:'AI credits',exact:true}).waitFor()
      state.purchasesEnabled=false;await host.page.evaluate(()=>window.dispatchEvent(new Event('focus')))
      await host.page.getByText('Required Stripe webhook events are missing.',{exact:true}).waitFor()
      assert.equal(await host.page.getByRole('button',{name:'Buy Starter',exact:true}).isDisabled(),true)
      results.push({case:'real-host-top-up-and-unavailable-payments',label})
    }finally{await host.context.close()}
  }
  if(label==='cloud'){
    state.actor='owner';state.permissions=[...PERMISSIONS];state.signedOut=false
    const switched=await contextFor(browser,server,390);await signIn(switched.context)
    try{
      await switched.page.goto(server.origin+'/admin/users/'+USER,{waitUntil:'networkidle'})
      await switched.page.getByText('contributor-with-a-long-address@example.invalid',{exact:true}).waitFor()
      state.actor='ordinary';state.permissions=[]
      await switched.page.evaluate(()=>{
        const session=JSON.parse(localStorage.getItem('sb-127-auth-token'))
        session.user.id='10000000-0000-4000-8000-000000000003'
        session.access_token=btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify({sub:session.user.id,exp:4102444800,role:'authenticated'}))+'.fixture'
        localStorage.setItem('sb-127-auth-token',JSON.stringify(session))
        const channel=new BroadcastChannel('sb-127-auth-token')
        channel.postMessage({event:'SIGNED_IN',session});channel.close()
      })
      await switched.page.getByText('Access unavailable',{exact:true}).waitFor()
      assert.equal(await switched.page.getByText('contributor-with-a-long-address@example.invalid',{exact:true}).count(),0)
      state.signedOut=true
      await switched.page.evaluate(()=>{
        localStorage.removeItem('sb-127-auth-token')
        const channel=new BroadcastChannel('sb-127-auth-token')
        channel.postMessage({event:'SIGNED_OUT',session:null});channel.close()
      })
      await switched.page.waitForURL(/\/(signed-out|auth)/)
      assert.equal(await switched.page.getByText('contributor-with-a-long-address@example.invalid',{exact:true}).count(),0)
      results.push({case:'live-account-switch-and-sign-out-clears-private-ui',label})
    }finally{state.signedOut=false;await switched.context.close()}
  }
  return results
}
