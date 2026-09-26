import { initFeedback, normalizeFeedback, feedbackResponse } from './feedback.mjs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { contextFor } from './support.mjs'
import { appResponses, announcement } from './upcoming.mjs'

export const PERMISSIONS = ['devtools.access','admin.access','users.read','users.manage','roles.read','roles.manage','settings.read','settings.write','credits.read','credits.manage','audit.read','scanner.use','scanner.label','design.view','diagnostics.view','decke.use']
const OWNER = '10000000-0000-4000-8000-000000000001', USER = '10000000-0000-4000-8000-000000000002'
const now = '2026-09-12T18:00:00Z'
export function adminFixture(mount) {
  const state = {
    actor: 'owner', permissions: [...PERMISSIONS], conflicts: false, requests: [], signedOut: false, usersFailOnce: false, rolesFail: false, delayedSearch: '',
    defaults: { settings: { skin: 'premium', topbar: 'flat' }, revision: 1, updatedAt: now },
    economics: { policy: { enabled: true, microUsdPerCredit: 10000, markupBps: 0, estimatedMicroUsd: { chatTurn: 143, analysis: 35600, planDeck: 750000 }, lowBalance: 100 }, revision: 1, updatedAt: now, estimateNotice: 'Review the historical chat estimate before commercial pricing.' },
    roles: [{ id: 'super-role', key: 'super_admin', name: 'Super administrator', description: 'Owner administration', permissions: [...PERMISSIONS], memberCount: 1, protected: true, revision: 1 }],
    users: [{ id: USER, username: 'Future Contributor', email: 'contributor-with-a-long-address@example.invalid', createdAt: now, lastSignInAt: null, suspended: false, roles: [], revision: 1 }],
    packs: [{ id: 'pack-1', name: 'Starter', credits: 500, priceCents: 500, currency: 'usd', active: true, revision: 1 }],
    balance: 0, purchasesEnabled: true, events: [], order: { id: 'order-1', status: 'pending', credits: 500, priceCents: 500, currency: 'usd' },
  }
  // Complete fictional collections exercise real pagination; API responses slice after filtering.
  const helperRole = { id: '20000000-0000-4000-8000-000000000001', key: 'support', name: 'Support reader', description: 'Read-only account support', permissions: ['admin.access', 'users.read'], memberCount: 30, protected: false, revision: 1 }
  state.roles.push(helperRole, ...Array.from({ length: 28 }, (_, i) => ({ id: 'role-fixture-' + i, key: 'team_' + i, name: 'Team ' + String(i + 1).padStart(2, '0'), description: 'Contributor group ' + (i + 1), permissions: ['admin.access'], memberCount: i, protected: false, revision: 1 })), { id: 'role-zulu', key: 'zulu', name: 'Zulu support', description: 'Largest team beyond the first name-sorted page', permissions: ['admin.access', 'users.read', 'audit.read'], memberCount: 100, protected: false, revision: 1 })
  state.users.push(...Array.from({ length: 59 }, (_, i) => ({ id: '10000000-0000-4000-8000-' + String(i + 100).padStart(12, '0'), username: 'Member ' + String(i + 1).padStart(3, '0'), email: i === 5 ? null : 'member-' + (i + 1) + '@example.invalid', createdAt: now, lastSignInAt: null, suspended: i % 3 === 0, roles: i % 2 === 0 ? [{ id: helperRole.id, name: helperRole.name }] : [], revision: 1 })))
  state.packs.push(...Array.from({ length: 27 }, (_, i) => ({ id: 'pack-' + (i + 2), name: 'Test pack ' + String(i + 1).padStart(2, '0'), credits: 100 + i, priceCents: 100 + i, currency: 'usd', active: false, revision: 1 })))
  state.audit = Array.from({ length: 36 }, (_, i) => ({ id: 'audit-' + i, actorId: i % 2 ? USER : OWNER, actorName: i % 2 ? 'Future Contributor' : 'Owner', action: i % 3 ? 'role.update' : 'user.suspend', targetType: 'user', targetId: i % 2 ? USER : OWNER, before: { suspended: false }, after: { suspended: true, note: '<script>window.fixtureUnsafe = true</script>' }, reason: 'Reviewed change ' + i, createdAt: new Date(Date.parse(now) - i * 60000).toISOString() }))
  state.orders = Array.from({ length: 38 }, (_, i) => ({ id: 'credit-order-' + i, userId: i % 2 ? USER : OWNER, username: i % 2 ? 'Future Contributor' : 'Owner', packName: 'Starter', credits: 500, priceCents: 500, currency: 'usd', status: i % 3 === 0 ? 'refunded' : 'paid', refundedCents: i % 3 === 0 ? 100 : 0, reversedCredits: i % 3 === 0 ? 100 : 0, disputeStatus: i === 0 ? 'closed' : null, createdAt: now, paidAt: now }))
  state.ledger = Array.from({ length: 32 }, (_, i) => ({ id: 'ledger-' + i, delta: i % 2 ? -5 : 20, debtDelta: i === 0 ? -10 : 0, kind: i % 2 ? 'usage' : 'adjustment', reason: 'Ledger review ' + i, createdAt: now, pricingRevision: 1 }))
  initFeedback(state, PERMISSIONS)
  const allowMutation = (pathname, method) => {
    const rel = pathname.slice(mount.length)
    return ['POST','PUT','PATCH','DELETE'].includes(method) && ((state.chatProbe && ['/api/chat','/api/decke/history'].includes(rel)) || /^\/api\/(?:me\/(?:features\/[^/]+|decke-sharing)|admin\/(?:features\/[^/]+|users\/[^/]+\/(?:role|ai-override)))$/.test(rel) || /^\/api\/admin\/(roles(?:\/[^/]+)?|settings|users\/[^/]+\/(roles|status|revoke-tokens)|credits\/(settings|packs(?:\/[^/]+)?|users\/[^/]+\/(adjustments|resolve-hold)))$/.test(rel) || rel === '/api/me/credits/checkout' || (method === 'POST' && rel === '/api/me/billing/visit'))
  }
  const response = (rel, url, req = { method: 'GET' }) => {
    const { method, body } = req
    normalizeFeedback(state)
    if (rel.startsWith('/api/')) state.requests.push({ rel, method, body, query: url.search })
    // Hold only the requested fictional mutation so animated close refusal and
    // failure recovery can be exercised against a real pending HTTP response.
    if (state.heldMutation?.rel === rel && state.heldMutation.method === method) {
      const held = state.heldMutation; state.heldMutation = null
      return new Promise(resolve => {
        held.finish = () => resolve({ status: 503, body: { error: { message: 'Fixture save failed after pending close' } } })
        held.onStart()
      })
    }
    const feedback = feedbackResponse(state, rel, url, req)
    if (feedback) return feedback
    const ok = value => ({ body: value, headers: { 'Cache-Control': 'no-store, private' } })
    // The shared catalog also mounts existing card/set examples. Keep their exact
    // fictional requests local without allowing arbitrary assets or API routes.
    if (/^\/(?:storage\/v1\/object\/public\/card-art|(?:deckpal\/)?images)\/sets\/(?:swsh1\/(?:symbol|logo)|swshp\/symbol|sv1\/logo|xy1\/logo)\.webp$/.test(rel)) return { raw: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="#64748b"/></svg>', type: 'image/svg+xml' }
    if (/^\/api\/cards\/base1-[1-5]$/.test(rel)) return { status: 404, body: { error: { message: 'Fictional gallery card has no live detail.' } } }
    if (rel === '/api/public-config') return { body: { defaults: state.defaults.settings, mode: mount ? 'self-host' : 'cloud' } }
    if (rel === '/api/me') return state.signedOut ? { status: 401, body: { error: { message: 'Signed out' } } } : ok({ id: state.actor === 'owner' ? OWNER : USER, username: state.actor, permissions: state.permissions, roles: state.actor === 'owner' ? [{ id: 'super-role', name: 'Super administrator' }] : [], adminReady: true, owner: state.actor === 'owner', decke: state.permissions.includes('decke.use') })
    if (rel === '/api/me/settings') return ok({ settings: { defaultGoal: 'complete', displayCurrency: 'USD', pricingEnabled: true, showCollectionValue: true, binderPocketSize: 9, binderStackVariants: true, binderAdditionalVariants: 'hide', deckeHidden: false, skin: null, topbar: null, seriesSortKey: 'recency', seriesSortDir: 'desc', seriesGroupOwned: false }, defaults: state.defaults.settings })
    if (rel === '/api/insights/overview') return ok({ trainer: { level: 1, totalCards: 0, uniqueCards: 0 }, collectionValue: [], collection: {}, pokedex: { captured: 0, total: 1 }, tcg: {}, completion: {}, value: {} })
    if (rel === '/api/avatar') return ok({ avatarUrl: null })
    if (rel === '/api/me/billing' || rel === '/api/me/billing/visit') return ok({ available: false, mode: 'unconfigured', prompt: { due: null } })
    if (rel === '/api/me/billing/history') {
      if (state.signedOut) return { status: 401, body: { error: { message: 'Signed out' } } }
      const kind = url.searchParams.get('kind')
      if (kind !== 'support' && kind !== 'credits') return { status: 400, body: { error: { message: 'Invalid billing history kind' } } }
      return ok({ kind, items: [], nextCursor: null, coverage: 'Shows the current billing account only. Payments on older replaced or deleted billing accounts may be missing.', billingAccountPresent: false })
    }
    if (rel === '/api/decke/history') return ok({ conversations: [] })
    // A11Y check (tests/browser/a11y.mjs): empty collections so /lists and
    // /decks render their real empty state — the "New List"/"New Deck" forms
    // this pass fixed (A11Y-08) — rather than tripping the "unexpected API"
    // guard in support.mjs's serve().
    if (rel === '/api/lists' && method === 'GET') return ok({ lists: [] })
    if (rel === '/api/decks' && method === 'GET') return ok({ decks: [] })
    if (rel === '/api/me/credits') return ok({ enabled: true, balance: state.balance, debt: 0, purchaseHold: false, lowAt: 100, prices: { chatTurn: 1, analysis: 4, planDeck: 75 }, packs: state.packs.filter(p => p.active), purchasesEnabled: state.purchasesEnabled, purchaseUnavailableReason: state.purchasesEnabled ? null : 'Required Stripe webhook events are missing.' })
    if (rel === '/api/me/credits/events') return ok({ events: state.events, total: state.events.length, limit: 25, offset: 0 })
    if (rel === '/api/me/credits/checkout') { assert.equal(method,'POST'); assert.equal(body.packId, 'pack-1'); assert.ok(body.idempotencyKey); assert.deepEqual(Object.keys(body).sort(), ['idempotencyKey','packId']); return ok({ url: 'https://checkout.stripe.com/c/pay/fixture-only', orderId: 'order-1' }) }
    if (rel === '/api/me/credits/orders/order-1') return ok(state.order)
    if (rel === '/api/admin/overview') return ok({ adminReady: true, counts: state.permissions.includes('users.read') ? { users: 2, suspended: 0, roles: state.roles.length, auditEvents: state.events.length } : {}, status: { bootstrap: 'ready', mode: mount ? 'self-host' : 'cloud' } })
    if (rel === '/api/admin/users') {
      if (state.usersFailOnce) { state.usersFailOnce = false; return { status: 503, body: { error: { message: 'Fixture directory temporarily unavailable' } } } }
      const status = url.searchParams.get('status') ?? 'all'
      if (!['all', 'active', 'suspended'].includes(status)) return { status: 400, body: { error: { code: 'invalid_input', message: 'Invalid status filter' } } }
      const search = url.searchParams.get('search'), role = url.searchParams.get('role')
      const users = state.users.filter(u => (!search || u.id === search || u.username.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())) && (status === 'all' || u.suspended === (status === 'suspended')) && (!role || u.roles.some(r => r.id === role)))
      const limit = Number(url.searchParams.get('limit') ?? 25), offset = Number(url.searchParams.get('offset') ?? 0)
      const result = ok({ users: users.slice(offset, offset + limit), total: users.length, limit, offset })
      return state.delayedSearch && search === state.delayedSearch ? new Promise(resolve => setTimeout(() => resolve(result), 400)) : result
    }
    if (rel === '/api/admin/users/' + USER) return ok({ user: state.users[0], permissions: state.users[0].roles.flatMap(r => state.roles.find(role => role.id === r.id)?.permissions ?? []), stats: { collectionItems: 3, decks: 1, connectors: 2 } })
    if (rel === '/api/admin/users/' + USER + '/role') {
      assert.equal(body.expectedRevision, state.users[0].revision)
      assert.ok(body.reason.length >= 3)
      assert.equal(body.expectedRoleRevision, state.roles.find(r=>r.id===body.roleId).revision); assert.deepEqual(Object.keys(body).sort(), ['expectedRevision','expectedRoleRevision','reason','roleId']); state.users[0].roles = state.roles.filter(r => body.roleId===r.id).map(({id,name})=>({id,name})); state.users[0].revision++; return ok({ ok: true })
    }
    if (rel === '/api/admin/users/' + USER + '/status') { state.users[0].suspended = body.suspended; state.users[0].revision++; return ok({ ok: true }) }
    if (rel === '/api/admin/users/' + USER + '/revoke-tokens') return ok({ revoked: 2 })
    if (rel === '/api/admin/roles' && method === 'POST') { state.roles.push({ ...body, id: 'role-'+state.roles.length, key: 'custom', memberCount: 0, protected: false, revision: 1 }); return ok({ role: state.roles.at(-1) }) }
    if (rel === '/api/admin/roles' && state.rolesFail) return { status: 503, body: { error: { message: 'Fixture roles temporarily unavailable' } } }
    if (rel === '/api/admin/roles') return ok({ roles: state.roles, permissions: PERMISSIONS.map(key => ({ key, group: key.split('.')[0], description: 'Controls ' + key })), permissionCeilings: {'10':[], '20':[], '30':['devtools.access','design.view','diagnostics.view','scanner.label'], '40':PERMISSIONS.filter(p=>!['decke.use','scanner.use'].includes(p))} })
    if (rel.startsWith('/api/admin/roles/') && state.roles.some(r => r.id === rel.split('/').at(-1))) {
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
    if (rel === '/api/admin/credits/users/' + USER) { const offset = Number(url.searchParams.get('offset') ?? 0); return ok({balance:state.balance,debt:0,purchaseHold:false,events:state.ledger.slice(offset,offset+25),total:state.ledger.length,offset,limit:25}) }
    if (rel === '/api/admin/credits/users/' + USER + '/adjustments') { assert.ok(body.reason); state.balance+=body.delta;return ok({balance:state.balance}) }
    if (rel === '/api/admin/credits/payment-status') return ok({ ready: false, reason: 'Required Stripe webhook events are missing.', requiredEvents: ['checkout.session.completed'], checkedAt: now })
    if (rel === '/api/admin/credits/summary') return ok({ days: Number(url.searchParams.get('days')),creditsSpent:0,creditsGranted:0,paidOrders:0,grossSalesCents:0,refundedCents:0,pendingOrders:1,heldWallets:0,debtWallets:0,totalDebt:0,estimatedProviderMicroUsd:0,unpricedSpends:0 })
    if (rel === '/api/admin/credits/orders') {
      const user = url.searchParams.get('user'), status = url.searchParams.get('status'), limit = Number(url.searchParams.get('limit') ?? 25), offset = Number(url.searchParams.get('offset') ?? 0)
      const orders = state.orders.filter(order => (!user || order.userId === user) && (!status || order.status === status))
      return ok({orders:orders.slice(offset,offset+limit),total:orders.length,offset,limit})
    }
    if (rel === '/api/admin/audit') {
      const actor = url.searchParams.get('actor'), action = url.searchParams.get('action'), target = url.searchParams.get('target'), limit = Number(url.searchParams.get('limit') ?? 25), offset = Number(url.searchParams.get('offset') ?? 0)
      const events = state.audit.filter(event => (!actor || event.actorId === actor) && (!action || event.action === action) && (!target || event.targetId === target))
      return ok({events:events.slice(offset,offset+limit),total:events.length,offset,limit})
    }
    return appResponses('active', rel)
  }
  return {state,response,allowMutation}
}
export async function signIn(context, id = OWNER) {
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
      await dialog.getByLabel('Role tier',{exact:true}).selectOption('40')
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
        await page.getByLabel('Search roles',{exact:true}).fill('Temporary reviewer')
        await page.getByRole('button',{name:'Delete Temporary reviewer',exact:true}).click()
        dialog=page.getByRole('dialog',{name:'Delete role',exact:true})
        await dialog.getByRole('button',{name:'Delete role',exact:true}).click();await dialog.waitFor({state:'hidden'})
        assert.equal(state.roles.some(r=>r.name==='Temporary reviewer'),false)
        await page.getByRole('button',{name:'Clear filters',exact:true}).click()
      }
      await page.getByRole('link',{name:'Users',exact:true}).click()
      await page.getByRole('link',{name:'Future Contributor',exact:true}).waitFor()
      assert.equal(await page.getByLabel('Status', {exact:true}).inputValue(), 'all')
      await page.getByLabel('Status', {exact:true}).selectOption('suspended')
      await page.getByRole('table', {name:'Matching user accounts'}).getByText('Suspended', {exact:true}).first().waitFor()
      assert.equal(await page.getByRole('link',{name:'Future Contributor',exact:true}).count(),0)
      await page.getByLabel('Status', {exact:true}).selectOption('active')
      await page.getByRole('link',{name:'Future Contributor',exact:true}).waitFor()
      await page.getByLabel('Status', {exact:true}).selectOption('all')
      await page.getByRole('link',{name:'Future Contributor',exact:true}).waitFor()
      assert.ok(state.requests.filter(r => r.rel === '/api/admin/users').every(r => ['all','active','suspended'].includes(new URLSearchParams(r.query).get('status') ?? 'all')), 'UI must send a valid SQL status filter')
      await page.getByRole('link',{name:'Future Contributor',exact:true}).click()
      await page.getByRole('button',{name:'Assign role',exact:true}).click()
      dialog=page.getByRole('dialog',{name:'Assign role',exact:true})
      await dialog.getByLabel('Assigned role',{exact:true}).selectOption({label:'Scanner helper '+width})
      await dialog.getByLabel('Reason',{exact:true}).fill('Contributor onboarding')
      await dialog.getByRole('button',{name:'Save role assignment'}).click()
      await dialog.waitFor({state:'hidden'})
      await page.getByRole('button',{name:'Assign role',exact:true}).waitFor()
      assert.ok(state.users[0].roles.some(r=>r.name==='Scanner helper '+width))
      await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(out,label+'-user-'+width+'.png'),fullPage:true})
      await page.getByRole('button',{name:'Assign role',exact:true}).click()
      dialog=page.getByRole('dialog',{name:'Assign role',exact:true})
      await dialog.getByLabel('Assigned role',{exact:true}).selectOption('user-role')
      await dialog.getByLabel('Reason',{exact:true}).fill('Revoke completed assignment')
      await dialog.getByRole('button',{name:'Save role assignment'}).click();await dialog.waitFor({state:'hidden'})
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
  results.push(...await checkAdminTables(browser,server,mount,label,out,fixture))
  for(const [actor,permissions] of [['readonly',['admin.access','users.read','devtools.access','design.view']],['labeler',['devtools.access','scanner.label']],['ordinary',[]]]){
    state.actor=actor;state.permissions=permissions
    const {context,page}=await contextFor(browser,server,390);await signIn(context,USER)
    try{
      await page.goto(server.origin+mount+(actor==='ordinary'?'/admin/users':'/admin/tools'),{waitUntil:'networkidle'})
      if(actor==='ordinary'){assert.equal(await page.getByRole('heading',{name:'Users',exact:true}).count(),0)}
      else{
        await page.getByRole('heading',{name:'Dev tools',exact:true}).waitFor()
        assert.equal(await page.getByRole('link',{name:'Roles',exact:true}).count(),0)
        assert.equal(await page.getByRole('link',{name:'Settings',exact:true}).count(),0)
        if(actor==='labeler'){assert.equal(await page.getByRole('link',{name:/Quad labeler/}).count(),1);assert.equal(await page.getByRole('link',{name:/Card scanner/}).count(),0)}
        if(actor==='readonly'){const beforeRoles = state.requests.filter(r=>r.rel==='/api/admin/roles').length;await page.goto(server.origin+mount+'/admin/users',{waitUntil:'networkidle'});await page.getByText('Role filtering requires permission to view roles.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Role',{exact:true}).isDisabled(),true);assert.equal(state.requests.filter(r=>r.rel==='/api/admin/roles').length,beforeRoles);await page.getByRole('link',{name:'Future Contributor',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Assign role',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Adjust credits',exact:true}).count(),0)}
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
async function checkAdminTables(browser, server, mount, label, out, fixture) {
  const results = [], {state} = fixture
  const go = (page, route) => page.goto(server.origin + mount + route, {waitUntil:'networkidle'})
  const waitRange = (surface, text) => surface.getByRole('status').filter({hasText:text}).waitFor()
  const assertLayout = async (page, name, width, snapshot) => {
    const table=page.getByRole('table',{name,exact:true})
    assert.equal(await table.count(),1,'One semantic table must serve every viewport')
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Table overflow escaped to the page')
    assert.equal(await table.locator('thead th[scope="col"]').count()>0,true)
    if(name==='Administration roles'){
      const actions=await table.locator('tbody > tr').first().locator('td').nth(4).evaluate(cell=>({clientWidth:cell.clientWidth,scrollWidth:cell.scrollWidth,tops:[...cell.querySelectorAll('button')].map(button=>button.getBoundingClientRect().top)}))
      assert.equal(actions.tops.length,3,'Role keeps all three actions')
      assert.ok(Math.max(...actions.tops)-Math.min(...actions.tops)<=1,'Compact role actions must fit one line at every viewport width')
      assert.ok(actions.scrollWidth<=actions.clientWidth,'Actions must fit their structured cell')
    }
    const region=page.getByRole('region',{name:name+' table',exact:true})
    if(await region.evaluate(node=>node.scrollWidth>node.clientWidth)){
      await page.keyboard.press('Tab');await region.focus()
      assert.equal(await region.evaluate(node=>node===document.activeElement),true,'Horizontal table region must be keyboard reachable')
      assert.equal(await region.evaluate(node=>{const style=getComputedStyle(node);return (style.outlineStyle!=='none' && parseFloat(style.outlineWidth)>0)||style.boxShadow!=='none'}),true,'Keyboard focus must have a visible outline or ring')
      await region.evaluate(node=>{node.scrollLeft=0})
      const before=await region.evaluate(node=>node.scrollLeft)
      await page.keyboard.press('ArrowRight');await page.waitForTimeout(120)
      assert.equal(await region.evaluate(node=>node.scrollLeft)>before,true,'ArrowRight must actually scroll overflowing columns')
    }
    if(width===390)assert.equal(await region.evaluate(node=>node.scrollWidth>node.clientWidth),true,'Phone retains columns in an overflowing table')
    await region.evaluate(node=>{node.scrollLeft=0})
    await page.evaluate(()=>window.scrollTo(0,0))
    await page.screenshot({path:path.join(out,label+'-'+snapshot+'-'+width+'.png'),fullPage:true})
    await region.evaluate(node=>window.scrollTo(0,window.scrollY+node.getBoundingClientRect().top-180))
    await page.screenshot({path:path.join(out,label+'-'+snapshot+'-'+width+'-viewport.jpg'),type:'jpeg',quality:75,fullPage:false})
  }
  for(const width of [1280,390]){
    state.actor='owner';state.permissions=[...PERMISSIONS];state.rolesFail=false
    const {context,page}=await contextFor(browser,server,width);await signIn(context)
    try{
      await go(page,'/admin/users')
      const users=page.getByRole('region',{name:'Matching user accounts',exact:true}), userTable=users.getByRole('table')
      await waitRange(users,'1–25 of 60 results')
      assert.equal(await userTable.locator('tbody > tr').count(),25)
      assert.equal(await userTable.getByRole('button',{name:/sort/}).count(),0,'Server-fixed ordering must not expose client-page sorts')
      assert.equal(await users.getByRole('button',{name:'Previous',exact:true}).isDisabled(),true)
      await assertLayout(page,'Matching user accounts',width,'users-table')
      await users.getByRole('button',{name:'Next',exact:true}).click();await waitRange(users,'26–50 of 60 results')
      assert.equal(await userTable.getByRole('link',{name:'Future Contributor',exact:true}).count(),0)
      await users.getByLabel('Rows per page').selectOption('50');await waitRange(users,'1–50 of 60 results')
      assert.equal(await userTable.locator('tbody > tr').count(),50)
      await users.getByRole('button',{name:'Next',exact:true}).click();await waitRange(users,'51–60 of 60 results')
      assert.equal(await users.getByRole('button',{name:'Next',exact:true}).isDisabled(),true)
      await users.getByLabel('Search users',{exact:true}).fill('Member 059');await users.getByRole('button',{name:'Search',exact:true}).click();await waitRange(users,'1–1 of 1 results')
      await userTable.getByRole('link',{name:'Member 059',exact:true}).waitFor()
      assert.equal(await users.getByRole('button',{name:'Previous',exact:true}).isDisabled(),true,'Applying search resets a later page')
      await users.getByRole('button',{name:'Clear filters',exact:true}).click();await waitRange(users,'1–50 of 60 results')
      await users.getByLabel('Rows per page').selectOption('25');await waitRange(users,'1–25 of 60 results')
      await users.getByLabel('Role',{exact:true}).selectOption('20000000-0000-4000-8000-000000000001')
      await users.getByLabel('Status',{exact:true}).selectOption('suspended');await waitRange(users,'1–10 of 10 results')
      assert.equal(await userTable.getByText('Suspended',{exact:true}).count(),10)
      assert.equal(await userTable.getByText('Support reader',{exact:true}).count(),10)
      await users.getByLabel('Search users',{exact:true}).fill('not-a-person');await users.getByRole('button',{name:'Search',exact:true}).click()
      await users.getByText('No matching users',{exact:true}).waitFor();await waitRange(users,'0–0 of 0 results')
      assert.equal(await users.getByRole('button',{name:'Next',exact:true}).isDisabled(),true)
      await users.getByRole('button',{name:'Clear filters',exact:true}).click();await waitRange(users,'1–25 of 60 results')
      assert.equal(await users.getByLabel('Status',{exact:true}).inputValue(),'all');assert.equal(await users.getByLabel('Role',{exact:true}).inputValue(),'')
      state.delayedSearch='Member 059'
      await users.getByLabel('Search users',{exact:true}).fill('Member 059');await users.getByRole('button',{name:'Search',exact:true}).click()
      await users.getByRole('status').filter({hasText:'Loading results'}).waitFor()
      assert.equal(await userTable.getByRole('link').count(),0,'New request hides the previous-filter accounts')
      await users.getByLabel('Search users',{exact:true}).fill('Member 058');await users.getByRole('button',{name:'Search',exact:true}).click()
      await userTable.getByRole('link',{name:'Member 058',exact:true}).waitFor();await page.waitForTimeout(500)
      assert.equal(await userTable.getByRole('link',{name:'Member 059',exact:true}).count(),0,'Late cancelled response must not replace newer results')
      state.delayedSearch='';state.usersFailOnce=true
      await users.getByLabel('Search users',{exact:true}).fill('Member 057');await users.getByRole('button',{name:'Search',exact:true}).click()
      await users.getByRole('alert').filter({hasText:'Fixture directory temporarily unavailable'}).waitFor()
      assert.equal(await userTable.getByRole('link').count(),0,'Error hides stale private rows')
      await users.getByRole('button',{name:'Retry',exact:true}).click();await userTable.getByRole('link',{name:'Member 057',exact:true}).waitFor()
      results.push({case:'admin-user-table-server-paging-filters-stale-error',label,width,total:60})

      await go(page,'/admin/roles')
      const roles=page.getByRole('region',{name:'Administration roles',exact:true}), roleTable=roles.getByRole('table')
      await roles.getByRole('status').filter({hasText:'1–25 of'}).waitFor()
      assert.equal(await roleTable.locator('tbody > tr').count(),25)
      assert.equal(await roles.getByRole('button',{name:'Edit Super administrator',exact:true}).count(),1)
      assert.equal(await roles.getByRole('button',{name:'Delete Super administrator',exact:true}).count(),0)
      assert.equal(await roles.getByRole('button',{name:'Delete Support reader',exact:true}).isDisabled(),true)
      await roles.getByRole('button',{name:'Members: sort ascending',exact:true}).click()
      await roles.getByRole('button',{name:'Members: sort descending',exact:true}).click()
      assert.match(await roleTable.locator('tbody > tr').first().innerText(),/Zulu support/,'Sort must include role originally beyond page one')
      assert.equal(await roleTable.getByRole('columnheader',{name:/Members/}).getAttribute('aria-sort'),'descending')
      await roles.getByLabel('Search roles',{exact:true}).fill('team_27');await waitRange(roles,'1–1 of 1 results');await roleTable.getByText('Team 28',{exact:true}).waitFor()
      await roles.getByRole('button',{name:'Clear filters',exact:true}).click()
      await roles.getByLabel('Role type',{exact:true}).selectOption('protected');await waitRange(roles,'1–2 of 2 results')
      const disclosure=roles.getByRole('button',{name:'Details for Super administrator',exact:true});await disclosure.focus();await page.keyboard.press('Enter')
      assert.equal(await disclosure.getAttribute('aria-expanded'),'true')
      await roles.getByRole('region',{name:'Details for Super administrator',exact:true}).getByText('credits.manage',{exact:true}).waitFor()
      await disclosure.press('Enter');assert.equal(await disclosure.getAttribute('aria-expanded'),'false')
      await roles.getByLabel('Role type',{exact:true}).selectOption('custom')
      await roles.getByRole('status').filter({hasText:'1–25 of'}).waitFor()
      assert.equal(await roleTable.getByText('Super administrator',{exact:true}).count(),0)
      await assertLayout(page,'Administration roles',width,'roles-table')
      results.push({case:'admin-role-table-complete-sort-details-protected-actions',label,width})

      await go(page,'/admin/audit')
      const audit=page.getByRole('region',{name:'Administrative audit events',exact:true}), auditTable=audit.getByRole('table')
      await waitRange(audit,'1–25 of 36 results');assert.equal(await auditTable.locator('tbody > tr').count(),25)
      await audit.getByRole('button',{name:'Next',exact:true}).click();await waitRange(audit,'26–36 of 36 results')
      await audit.getByLabel('Actor ID',{exact:true}).fill(OWNER);await audit.getByLabel('Exact action',{exact:true}).fill('user.suspend');await audit.getByLabel('Target ID',{exact:true}).fill(OWNER)
      await audit.getByRole('button',{name:'Filter audit log',exact:true}).click();await waitRange(audit,'1–6 of 6 results')
      assert.equal(await auditTable.getByText('user.suspend',{exact:true}).count(),6)
      const change=audit.getByRole('button',{name:/Details for user.suspend/}).first();await change.focus();await page.keyboard.press('Space')
      assert.equal(await change.getAttribute('aria-expanded'),'true')
      const details=audit.getByRole('region',{name:/Details for user.suspend/})
      await details.getByRole('heading',{name:'Before',exact:true}).waitFor();await details.getByRole('heading',{name:'After',exact:true}).waitFor()
      assert.match(await details.innerText(),/<script>window.fixtureUnsafe = true<\/script>/)
      assert.equal(await page.evaluate(()=>window.fixtureUnsafe),undefined,'Audit JSON must stay text')
      await assertLayout(page,'Administrative audit events',width,'audit-table')
      await audit.getByLabel('Exact action',{exact:true}).fill('user');await audit.getByRole('button',{name:'Filter audit log',exact:true}).click();await waitRange(audit,'0–0 of 0 results')
      await audit.getByRole('button',{name:'Clear filters',exact:true}).click();await waitRange(audit,'1–25 of 36 results')
      await audit.getByLabel('Rows per page').selectOption('50');await waitRange(audit,'1–36 of 36 results')
      assert.equal(await auditTable.locator('tbody > tr').count(),36)
      results.push({case:'admin-audit-table-exact-filters-safe-keyboard-details',label,width})

      await go(page,'/admin/settings')
      const packs=page.getByRole('region',{name:'Credit packs',exact:true}), packTable=packs.getByRole('table')
      await packs.getByRole('status').filter({hasText:'1–25 of'}).waitFor();assert.equal(await packTable.locator('tbody > tr').count(),25)
      await packs.getByLabel('Search packs',{exact:true}).fill('Starter');await waitRange(packs,'1–1 of 1 results')
      await packs.getByLabel('Pack status',{exact:true}).selectOption('inactive');await waitRange(packs,'0–0 of 0 results')
      await packs.getByRole('button',{name:'Clear filters',exact:true}).click()
      await packs.getByRole('button',{name:'Credits: sort ascending',exact:true}).click();await packs.getByRole('button',{name:'Credits: sort descending',exact:true}).click()
      assert.match(await packTable.locator('tbody > tr').first().innerText(),/1,200/)
      await packs.getByLabel('Search packs',{exact:true}).fill('Starter');await packs.getByRole('button',{name:'Edit Starter',exact:true}).click()
      const packDialog=page.getByRole('dialog',{name:'Edit credit pack',exact:true});await packDialog.getByText('Changes affect new checkouts.',{exact:false}).waitFor()
      await page.keyboard.press('Escape');await packDialog.waitFor({state:'hidden'})
      await packs.getByRole('button',{name:'Clear filters',exact:true}).click()
      await assertLayout(page,'Credit packs',width,'packs-table')
      results.push({case:'admin-pack-table-full-set-sort-filter-edit-safety',label,width})

      await go(page,'/admin/users/'+USER)
      const ledger=page.getByRole('region',{name:'User credit ledger',exact:true})
      await waitRange(ledger,'1–25 of 32 results');assert.equal(await ledger.getByLabel('Rows per page').count(),0,'Fixed-size ledger API must not expose unsupported sizes')
      await ledger.getByRole('button',{name:'Next',exact:true}).click();await waitRange(ledger,'26–32 of 32 results')
      assert.equal(await ledger.getByRole('table').locator('tbody > tr').count(),7)
      await ledger.getByRole('button',{name:'Previous',exact:true}).click();await waitRange(ledger,'1–25 of 32 results')
      await ledger.getByRole('table').getByText('-10',{exact:true}).waitFor()
      results.push({case:'admin-ledger-table-fixed-pagination-debt',label,width})

      await go(page,'/admin')
      const orders=page.getByRole('region',{name:'Credit orders',exact:true}), orderTable=orders.getByRole('table')
      await waitRange(orders,'1–25 of 38 results');assert.equal(await orderTable.locator('tbody > tr').count(),25)
      await orders.getByRole('button',{name:'Next',exact:true}).click();await waitRange(orders,'26–38 of 38 results')
      await orders.getByLabel('User ID',{exact:true}).fill(USER);await orders.getByRole('button',{name:'Filter orders',exact:true}).click();await waitRange(orders,'1–19 of 19 results')
      await orders.getByLabel('Order status',{exact:true}).selectOption('refunded');await waitRange(orders,'1–6 of 6 results')
      assert.equal(await orderTable.getByText('refunded',{exact:true}).count(),6)
      await orders.getByRole('button',{name:'Clear filters',exact:true}).click();await waitRange(orders,'1–25 of 38 results')
      await orders.getByLabel('Rows per page').selectOption('50');await waitRange(orders,'1–38 of 38 results')
      await orderTable.getByText('Dispute: closed',{exact:true}).waitFor()
      await assertLayout(page,'Credit orders',width,'orders-table')
      results.push({case:'admin-orders-table-server-filters-paging-refunds',label,width})

      if(label==='cloud'){
        await go(page,'/design');await page.getByRole('heading',{name:'Design System',exact:true}).waitFor()
        await page.getByRole('button',{name:'Components',exact:true}).click()
        await page.getByRole('heading',{name:'DataTable',exact:true}).waitFor()
        const example=page.getByRole('region',{name:'Example members',exact:true}).first()
        await waitRange(example,'1–25 of 63 results')
        await example.getByRole('button',{name:'Next',exact:true}).click();await waitRange(example,'26–50 of 63 results')
        await example.getByLabel('Member name or email',{exact:true}).fill('collector.40');await waitRange(example,'1–1 of 1 results')
        await example.getByText('collector.40@example.test',{exact:true}).waitFor()
        await example.screenshot({path:path.join(out,'cloud-datatable-gallery-'+width+'.png')})
        await example.evaluate(node=>window.scrollTo(0,window.scrollY+node.getBoundingClientRect().top-120))
        await page.screenshot({path:path.join(out,'cloud-datatable-gallery-'+width+'-viewport.jpg'),type:'jpeg',quality:75,fullPage:false})
        const gallery=page.getByRole('heading',{name:'DataTable',exact:true}).locator('xpath=../../..')
        await gallery.getByRole('button',{name:'Knobs',exact:true}).click()
        const mode=gallery.locator('select:has(option[value="error"])')
        const interactive=gallery.getByRole('region',{name:'Example members',exact:true}).last()
        await mode.selectOption('error');await interactive.getByRole('alert').waitFor()
        await interactive.getByRole('button',{name:'Retry',exact:true}).click();await waitRange(interactive,'1–25 of 63 results')
        await mode.selectOption('ready');await mode.selectOption('error')
        await interactive.getByRole('alert').waitFor();await interactive.getByRole('button',{name:'Retry',exact:true}).click();await waitRange(interactive,'1–25 of 63 results')
        results.push({case:'design-catalog-discovers-interactive-data-table',label,width,errorModeResetsAfterRetry:true})
      }

      state.rolesFail=true;await go(page,'/admin/users')
      await page.getByText('Role filters unavailable.',{exact:false}).waitFor();assert.equal(await page.getByLabel('Role',{exact:true}).isDisabled(),true)
      await page.getByRole('link',{name:'Future Contributor',exact:true}).waitFor()
      state.rolesFail=false;await page.getByRole('button',{name:'Retry role filters',exact:true}).click()
      await page.waitForFunction(()=>!document.querySelector('select[aria-label="Role"]').disabled)
      results.push({case:'admin-role-filter-failure-remains-honest',label,width})
    }catch(error){await page.screenshot({path:path.join(out,label+'-table-failure-'+width+'.png'),fullPage:true});error.message+='\nPage: '+(await page.locator('body').innerText()).slice(0,3000);throw error}
    finally{state.rolesFail=false;state.delayedSearch='';await context.close()}
  }
  return results
}
