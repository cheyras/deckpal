import assert from 'node:assert/strict'
import path from 'node:path'
import { contextFor } from './support.mjs'
const USER = '10000000-0000-4000-8000-000000000002', OWNER = '10000000-0000-4000-8000-000000000001', now = '2026-09-12T18:00:00Z'
const tierFor = actor => ({owner:60,superadmin:50,admin:40,contributor:30,labeler:30,superuser:20,readonly:40,ordinary:10})[actor] ?? 10
const ref = (id,key,name,tier) => ({id,key,name,tier})
export function initFeedback(state, permissions) {
  state.accessRevision = 1; state.sharing = {enabled:false,revision:0,updatedAt:null}; state.override = {userId:USER,revision:0,unlimited:false,markupBps:null,effectiveMarkupBps:0,globalPolicyRevision:1,updatedAt:null,canEdit:true}
  state.featureCatalog = [{key:'scanner',label:'Card scanner',lifecycle:'experimental',revision:1},{key:'decke',label:'Deck-E',lifecycle:'experimental',revision:1}]; state.optins = {}; state.optinRevisions = {}; state.accountUnavailable = false; state.feedbackMatrix = false
  state.roles.push({id:'user-role',key:'user',name:'User',tier:10,description:'Baseline account access',permissions:[],memberCount:30,protected:true,revision:1})
  state.permissionsCatalog = permissions
  state.usage = Array.from({length:38},(_,i)=>({id:'30000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),userId:i%2?USER:OWNER,conversationId:'40000000-0000-4000-8000-'+String(Math.floor(i/3)+1).padStart(12,'0'),exchangeId:'50000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),seq:i%3,category:['response','research','planning'][i%3],status:i%4?'completed':'failed',startedAt:new Date(Date.parse(now)-i*60000).toISOString(),finishedAt:now,buildSha:i===0?null:'aa55ad6c39f30d2dafe12b871ebecf026dd9607d',buildPr:i===0?null:188,pricingRevision:1,overrideRevision:0,chargeMode:'paid',chargedCredits:1,operationCount:1,cost:{source:i%4?'provider_reported':'unknown',usd:i%4?'0.00000123':null,currency:'USD',coverage:i%4?'complete':'unknown'},inputTokens:12,outputTokens:34}))
  state.usage.at(-1).conversationId=null;state.usage.at(-1).seq=null
}
export function normalizeFeedback(state) {
  const tier=tierFor(state.actor)
  for(const role of state.roles){role.tier ??= role.key==='super_admin'?50:40;role.system=role.protected;role.protectedIdentity=role.protected;role.canEdit=tier>=50;role.canDelete=tier>=50&&!role.protected;role.editablePermissions=state.permissionsCatalog.filter(p=>!['scanner.use','decke.use'].includes(p))}
  for(const user of state.users){user.role=state.roles.find(r=>r.id===user.roles[0]?.id)??state.roles.find(r=>r.id==='user-role');user.roles=[ref(user.role.id,user.role.key,user.role.name,user.role.tier)];const can= state.permissions.includes('users.manage')&&(tier>=50?user.role.tier<60:tier>=40&&user.role.tier<=20);user.actions={canAssignRole:can,assignableRoleIds:can?state.roles.filter(r=>r.tier<60&&(tier>=50||r.tier<=20)).map(r=>r.id):[],canChangeStatus:can,canRevokeTokens:can,denialReasons:can?{}:{assignRole:'target_tier',changeStatus:'target_tier',revokeTokens:'target_tier'}}}
}
export function feedbackResponse(state, rel, url, {method,body}) {
  const ok=body=>({body,headers:{'Cache-Control':'no-store, private'}}), fail=(status,message)=>({status,body:{error:{message}}}),tier=tierFor(state.actor)
  const features=()=>state.featureCatalog.map(f=>{
    const optedIn=!!state.optins[state.actor+':'+f.key],active=!state.accountUnavailable
    const eligible=active&&(['released','beta'].includes(f.lifecycle)||f.lifecycle==='experimental'&&tier>=20)
    const enabled=eligible&&(f.lifecycle==='released'||f.lifecycle==='experimental'&&tier>=50||optedIn)
    return {...f,revision:Math.max(f.revision,state.optinRevisions[state.actor+':'+f.key]??0),optedIn,eligible,enabled,
      reason:!active?'account_unavailable':f.lifecycle==='disabled'?'disabled':f.lifecycle==='released'?'released':!eligible?'experimental_tier_required':f.lifecycle==='experimental'&&tier>=50?'automatic':enabled?'opted_in':'opt_in_required'}
  })
  const nextFeatureRevision=()=>Math.max(...state.featureCatalog.map(f=>f.revision),...Object.values(state.optinRevisions),0)+1
  const adminFeatures=()=>features().map(f=>({...f,revision:state.featureCatalog.find(c=>c.key===f.key).revision}))

  if(rel==='/api/chat'&&state.chatProbe){
    assert.equal(method,'POST');state.chatRequests.push(body)
    const leg=state.chatRequests.filter(r=>r.exchangeId===body.exchangeId).length
    const question=body.messages.findLast(m=>m.role==='user').parts.find(p=>p.type==='text').text
    const chunks=leg===1?[
      {type:'data-decke-tool',data:{id:'lookup-'+body.seq,name:'collection',title:'Checked collection',phase:'ok',summary:'Private prior lookup summary'}},
      {type:'tool-input-available',toolCallId:'fixture-scroll-'+body.seq,toolName:'scrollToMe',input:{}},
      {type:'finish',finishReason:'tool-calls'}
    ]:[{type:'text-delta',delta:'Verified reply to '+question},{type:'finish',finishReason:'stop'}]
    return {type:'text/event-stream',headers:{'Cache-Control':'no-store'},raw:chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n'}
  }
  if(rel==='/api/decke/history'&&method==='POST'&&state.chatProbe){state.historyRecords.push(body);return ok({ok:true,buildSha:null,buildPr:null})}

  if(rel==='/api/me') { if(state.signedOut)return fail(401,'Signed out');const fs=features();let permissions=state.permissions;if(state.feedbackMatrix)permissions=[...permissions.filter(p=>!['scanner.use','decke.use'].includes(p)),...fs.filter(f=>f.enabled).map(f=>f.key+'.use')];return ok({id:state.actor==='owner'?OWNER:USER,username:state.actor,permissions,roles:[],role:ref(state.actor+'-role',state.actor,state.actor==='owner'?'Owner':state.actor,tier),isOwner:state.actor==='owner',owner:state.actor==='owner',adminReady:true,accessRevision:String(state.accessRevision)+':'+state.actor+':'+JSON.stringify(fs),features:fs,actorCapabilities:{canEditRoles:tier>=50,canAssignRoles:tier>=40&&state.permissions.includes('users.manage'),canManageUserOverrides:tier===60,canReadSharedConversations:tier>=40,assignableRoleIds:state.roles.filter(r=>r.tier<=50).map(r=>r.id)},decke:permissions.includes('decke.use')}) }
  if(rel==='/api/me/features')return ok({features:features()})
  if(rel.startsWith('/api/me/features/')){const key=rel.split('/').at(-1),f=state.featureCatalog.find(f=>f.key===key);assert.equal(body.expectedRevision,features().find(v=>v.key===key).revision);assert.equal(typeof body.optedIn,'boolean');state.optins[state.actor+':'+key]=body.optedIn;state.optinRevisions[state.actor+':'+key]=nextFeatureRevision();state.accessRevision++;return ok({features:features()})}
  if(rel==='/api/admin/features'){assert.ok(tier>=50);return ok({features:adminFeatures()})}
  if(rel.startsWith('/api/admin/features/')){assert.ok(tier>=50);const f=state.featureCatalog.find(f=>f.key===rel.split('/').at(-1));assert.equal(body.expectedRevision,f.revision);assert.ok(body.reason.length>=3);f.lifecycle=body.lifecycle;f.revision=nextFeatureRevision();state.accessRevision++;return ok({features:adminFeatures()})}
  if(rel==='/api/me/decke-sharing'){if(method==='PUT'){if(state.sharingConflict)return fail(409,'Sharing revision changed');assert.equal(body.expectedRevision,state.sharing.revision);assert.equal(typeof body.enabled,'boolean');state.sharing={enabled:body.enabled,revision:state.sharing.revision+1,updatedAt:now};state.accessRevision++}return ok(state.sharing)}
  if(rel==='/api/admin/users/'+USER+'/ai-override'){if(method==='PUT'){assert.equal(tier,60,'Only Owner may write overrides');if(state.overrideConflict){state.override.revision++;return fail(409,'Override revision changed')};assert.equal(body.expectedRevision,state.override.revision);assert.ok(body.reason.length>=3);assert.ok(body.markupBps===null||Number.isInteger(body.markupBps)&&body.markupBps>=0);state.override={...state.override,...body,revision:state.override.revision+1,effectiveMarkupBps:body.markupBps??state.economics.policy.markupBps}}return ok({...state.override,canEdit:tier===60})}
  if(rel==='/api/admin/ai-usage/observations'){assert.ok(tier>=40);return ok({days:Number(url.searchParams.get('days')??30),buildSha:url.searchParams.get('buildSha'),groups:[{operation:'chatTurn',category:'response',modelIds:['fixture/model'],buildSha:'aa55ad6c39f30d2dafe12b871ebecf026dd9607d',sampleCount:12,completeCount:10,unknownCount:2,meanMicroUsd:246,p95MicroUsd:500,knownUsd:'0.00246'}],notice:'Incomplete samples are excluded from mean and p95. No automatic settlement.'})}
  const detail=row=>({request:row,operations:[{id:row.id+'-op',category:row.category,toolKey:null,modelId:'fixture/model',provider:'fixture',status:row.status,startedAt:row.startedAt,finishedAt:row.finishedAt,tokens:{inputTokens:12,outputTokens:34,cacheReadTokens:null,cacheWriteTokens:null,reasoningTokens:null},cost:row.cost}],content:state.sharing.enabled&&row.seq!==1?{asked:'Shared question <script>window.unsafeFeedback = true</script>',answered:'Shared answer for '+row.id}:null,contentStatus:state.sharing.enabled?(row.seq===1?'not_shared':'shared'):state.sharing.revision?'revoked':'not_shared'})
  if(rel==='/api/admin/ai-usage'){assert.ok(tier>=40);if(state.usageFailOnce){state.usageFailOnce=false;return fail(503,'Usage temporarily unavailable')};const items=state.usage.filter(row=>['userId','conversationId','category','status','buildSha','buildPr'].every(k=>!url.searchParams.get(k)||String(row[k])===url.searchParams.get(k))&&(!url.searchParams.get('costSource')||row.cost.source===url.searchParams.get('costSource')));const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??25);return ok({items:items.slice(offset,offset+limit),total:items.length,limit,offset,aggregate:{knownUsd:'0.00003444',knownCount:items.filter(r=>r.cost.usd!==null).length,unknownCount:items.filter(r=>r.cost.usd===null).length}})}
  if(rel.startsWith('/api/admin/ai-usage/requests/')){assert.ok(tier>=40);const response=ok(detail(state.usage.find(r=>r.id===rel.split('/').at(-1))));return state.delayUsageDetail?new Promise(resolve=>setTimeout(()=>resolve(response),400)):response}
  if(rel.startsWith('/api/admin/ai-usage/conversations/')){assert.ok(tier>=40);const items=state.usage.filter(r=>r.conversationId===rel.split('/').at(-1)).sort((a,b)=>a.seq-b.seq).map(detail);const offset=Number(url.searchParams.get('offset')??0);return ok({items:items.slice(offset,offset+25),total:items.length,limit:25,offset})}
  if(rel==='/api/me/showcase')return ok({showcase:[]})
  if(rel==='/api/tokens')return ok({tokens:[]})
  if(rel==='/api/insights/pokedex'){
    assert.equal(method,'GET');assert.equal(url.searchParams.get('own'),'captured','This fixture covers the profile captured-species preload')
    const page=Math.max(1,Math.min(100000,Number(url.searchParams.get('page')??1)))
    const pageSize=Math.max(1,Math.min(1025,Number(url.searchParams.get('pageSize')??200)))
    return ok({completion:{captured:0,total:1025},pagination:{page,pageSize,total:0,pageCount:0},species:[]})
  }
  return null
}

import { signIn, PERMISSIONS } from './admin.mjs'

export async function checkFeedback(browser, server, mount, label, out, fixture) {
  const {state} = fixture, results = []
  const go = (page, route) => page.goto(server.origin + mount + route, {waitUntil:'networkidle'})
  const focus = page => page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const range = (region, text) => region.getByRole('status').filter({hasText:text}).waitFor()
  const screenshot = async (page, name, width) => {
    // Reduced motion retains the scrim's short arrival fade. Capture the fully
    // rendered modal, including ancestor opacity, rather than a transition frame.
    await page.waitForFunction(() => [...document.querySelectorAll('.px-sheet-scrim')].every(node => Number(getComputedStyle(node).opacity) >= .99))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name+': no page overflow')
    await page.evaluate(()=>window.scrollTo(0,0))
    await page.screenshot({path:path.join(out,label+'-feedback-'+name+'-'+width+'.png'),fullPage:!name.startsWith('shared-conversation')})
  }
  // Complete built-in catalog for the new governance matrix; original table cases
  // above retain their independently populated pagination fixture.
  for (const [key,name,tier] of [['owner','Owner',60],['superuser','Superuser',20],['contributor','Contributor',30],['admin','Admin',40]]) {
    if (!state.roles.some(r => r.key===key)) state.roles.push({id:key+'-role',key,name,tier,description:name+' built-in role',permissions:tier===30?['devtools.access','design.view','diagnostics.view','scanner.label']:tier>=40?[...PERMISSIONS]:[],memberCount:1,protected:true,revision:1})
  }
  for (const width of [1280,390,428]) {
    state.actor='owner';state.permissions=[...PERMISSIONS];state.signedOut=false;state.feedbackMatrix=true;state.optins={};state.sharing={enabled:false,revision:0,updatedAt:null}
    state.users[0].roles=[{id:'user-role',name:'User'}];state.overrideConflict=false;state.sharingConflict=false
    for (const f of state.featureCatalog) f.lifecycle='experimental'
    const {context,page}=await contextFor(browser,server,width);await signIn(context)
    try {
      await go(page,'/admin/users/'+USER)
      await page.getByRole('heading',{name:'Owner controls: user AI override',exact:true}).waitFor()
      await page.getByRole('button',{name:'Assign role',exact:true}).click()
      let dialog=page.getByRole('dialog',{name:'Assign role',exact:true})
      assert.equal(await dialog.locator('select[multiple],input[type="checkbox"]').count(),0)
      assert.equal(await dialog.getByLabel('Assigned role',{exact:true}).inputValue(),'user-role')
      assert.equal(await dialog.getByLabel('Assigned role',{exact:true}).locator('option[value="owner-role"]').count(),0)
      await page.keyboard.press('Escape')
      const inherit=page.getByLabel('Inherit global markup',{exact:true})
      if(await inherit.isChecked()) await inherit.uncheck()
      await page.getByLabel('User provider-cost markup (%)',{exact:true}).fill('0')
      await page.getByLabel('Unlimited AI credits',{exact:true}).check()
      await page.getByLabel('Override reason',{exact:true}).fill('Owner reviewed zero markup')
      state.overrideConflict=true
      await page.getByRole('button',{name:'Save user AI override',exact:true}).click()
      await page.getByText(/This record changed while you were editing/).waitFor()
      state.overrideConflict=false
      await page.getByRole('button',{name:'Reload and discard override draft',exact:true}).click()
      await page.getByText('user override revision '+state.override.revision+'.',{exact:false}).waitFor()
      if(await inherit.isChecked())await inherit.uncheck()
      await page.getByLabel('User provider-cost markup (%)',{exact:true}).fill('0')
      await page.getByLabel('Unlimited AI credits',{exact:true}).check()
      await page.getByLabel('Override reason',{exact:true}).fill('Owner reviewed current revision')
      await page.getByRole('button',{name:'Save user AI override',exact:true}).click()
      await page.getByText('Current effective markup: 0%.',{exact:false}).waitFor()
      assert.equal(state.override.markupBps,0);assert.equal(state.override.unlimited,true)
      await inherit.check()
      await page.getByLabel('Override reason',{exact:true}).fill('Return to global markup')
      await page.getByRole('button',{name:'Save user AI override',exact:true}).click()
      await page.waitForFunction(()=>document.querySelector('input[type="checkbox"]')!==null)
      await page.getByText('user override revision '+state.override.revision+'.',{exact:false}).waitFor()
      assert.equal(state.override.markupBps,null)
      await screenshot(page,'owner-override',width)
      results.push({case:'feedback-owner-override-single-role-zero-null-conflict',label,width})

      await go(page,'/admin/roles')
      await page.getByLabel('Search roles',{exact:true}).fill('User')
      await page.getByRole('button',{name:'Edit User',exact:true}).click()
      dialog=page.getByRole('dialog',{name:'Edit role',exact:true})
      assert.equal(await dialog.getByLabel('Role tier',{exact:true}).count(),0)
      await dialog.getByLabel('Description',{exact:true}).fill('Baseline active account access')
      await dialog.getByRole('button',{name:'Save role',exact:true}).click()
      await dialog.waitFor({state:'hidden'})
      assert.equal(state.roles.find(r=>r.key==='user').description,'Baseline active account access')
      assert.equal(await page.getByRole('button',{name:'Delete User',exact:true}).count(),0)
      assert.equal(await page.getByLabel('Search roles',{exact:true}).inputValue(),'','A role definition refresh clears authorization-scoped state')
      assert.equal(await page.getByRole('button',{name:'Clear filters',exact:true}).isDisabled(),true)
      await page.getByLabel('Search roles',{exact:true}).fill('User')
      await range(page.getByRole('region',{name:'Administration roles',exact:true}),'1–2 of 2 results')
      await page.getByRole('button',{name:'Clear filters',exact:true}).click()
      const sort=page.getByRole('button',{name:'Members: sort ascending',exact:true})
      assert.equal(await sort.locator('svg[aria-hidden="true"]').count(),1)
      assert.doesNotMatch(await sort.innerText(),/[↑↓↕]/)
      await sort.focus();await page.keyboard.press('Enter')
      assert.equal(await page.getByRole('columnheader',{name:/Members/}).getAttribute('aria-sort'),'ascending')
      await page.keyboard.press('Space')
      assert.equal(await page.getByRole('columnheader',{name:/Members/}).getAttribute('aria-sort'),'descending')
      results.push({case:'feedback-builtin-edit-protected-identity-svg-keyboard-sort',label,width})

      await go(page,'/admin/settings')
      await page.getByRole('table',{name:'Observed operation costs',exact:true}).waitFor()
      await page.getByText('10 complete / 12 recorded; 2 unknown',{exact:true}).waitFor()
      const before=state.economics.revision
      await page.getByRole('button',{name:'Use mean in draft',exact:true}).click()
      assert.equal(await page.getByLabel('Estimated provider cost: chat turn (USD)',{exact:true}).inputValue(),'0.000246')
      assert.equal(state.economics.revision,before,'Using an observation must not silently save or settle credits')
      await page.getByRole('button',{name:'Save credit economy',exact:true}).click()
      await page.getByText('Revision '+(before+1)+' ·',{exact:false}).last().waitFor()
      assert.equal(state.economics.policy.estimatedMicroUsd.chatTurn,246)
      await screenshot(page,'observations',width)
      results.push({case:'feedback-observations-explicit-future-estimate-save',label,width})

      state.usageFailOnce=true
      await go(page,'/admin/usage')
      let usage=page.getByRole('region',{name:'AI usage requests',exact:true})
      await usage.getByRole('alert').filter({hasText:'Usage temporarily unavailable'}).waitFor()
      assert.equal(await usage.getByRole('table').getByRole('button',{name:/^Request /}).count(),0)
      await usage.getByRole('button',{name:'Retry',exact:true}).click()
      await range(usage,'1–25 of 38 results')
      await usage.getByRole('button',{name:'Next',exact:true}).click();await range(usage,'26–38 of 38 results')
      assert.equal(await usage.getByRole('button',{name:'Conversation not recorded',exact:true}).isDisabled(),true)
      await usage.getByLabel('Usage category',{exact:true}).selectOption('research')
      await usage.getByRole('button',{name:'Apply filters',exact:true}).click()
      await range(usage,'1–13 of 13 results')
      await usage.getByRole('button',{name:'Clear filters',exact:true}).click();await range(usage,'1–25 of 38 results')
      await screenshot(page,'usage',width)
      const row=state.usage[0]
      await page.getByRole('button',{name:'Request '+row.id,exact:true}).click()
      dialog=page.getByRole('dialog',{name:'Request usage',exact:true})
      await dialog.getByText('Not shared. Only usage metadata is available.',{exact:true}).waitFor()
      assert.ok(await dialog.getByText('Unknown cost',{exact:true}).count()>0)
      assert.equal(await dialog.getByRole('heading',{name:'User message',exact:true}).count(),0)
      await screenshot(page,'request-private',width)
      await page.keyboard.press('Escape')
      state.sharing={enabled:true,revision:1,updatedAt:now}
      await page.getByRole('button',{name:'Conversation '+row.conversationId,exact:true}).first().click()
      dialog=page.getByRole('dialog',{name:'Conversation usage',exact:true})
      const turns=dialog.getByRole('table',{name:'Conversation turns',exact:true})
      await range(dialog.getByRole('region',{name:'Conversation turns',exact:true}),'1–3 of 3 results')
      assert.deepEqual(await turns.locator('tbody tr td:nth-child(1)').allTextContents(),['1','2','3'])
      const pinned = async () => dialog.evaluate(node => {
        const body=node.querySelector('[data-sheet-content]'), title=node.querySelector('h2'), close=node.querySelector('button[aria-label="Close"]')
        const rect=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}}
        return {panel:rect(node),title:rect(title),close:rect(close),body:rect(body),bodyScroll:body.scrollTop,panelScroll:node.scrollTop,scrimScroll:node.parentElement.scrollTop,windowScroll:scrollY,bodyLocked:document.body.style.position==='fixed'}
      })
      await screenshot(page,'shared-conversation-turns',width)
      const beforeTurn=await pinned()
      await turns.getByRole('button',{name:'View turn 1',exact:true}).click()
      await dialog.getByText('Shared question <script>window.unsafeFeedback = true</script>',{exact:true}).waitFor()
      assert.equal(await page.evaluate(()=>window.unsafeFeedback),undefined)
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      const selectedTurn=await pinned()
      assert.ok(selectedTurn.bodyScroll>0,'Selecting a turn scrolls the dedicated sheet body')
      assert.equal(selectedTurn.panelScroll,0,'The overflow-hidden panel must never scroll')
      assert.equal(selectedTurn.scrimScroll,0,'The modal scrim must never scroll')
      assert.ok(Math.abs((selectedTurn.title.top-selectedTurn.panel.top)-(beforeTurn.title.top-beforeTurn.panel.top))<1,'The heading stays pinned within the growing panel')
      assert.ok(Math.abs((selectedTurn.close.top-selectedTurn.panel.top)-(beforeTurn.close.top-beforeTurn.panel.top))<1,'Close stays pinned within the growing panel')
      assert.ok(selectedTurn.title.top>=selectedTurn.panel.top&&selectedTurn.close.bottom<=selectedTurn.body.top)
      assert.equal(selectedTurn.windowScroll,beforeTurn.windowScroll);assert.ok(selectedTurn.bodyLocked)
      const selected=dialog.getByRole('region',{name:'Selected conversation turn',exact:true})
      const detailGeometry=await selected.evaluate(node=>({top:node.getBoundingClientRect().top,width:node.clientWidth,scrollWidth:node.scrollWidth}))
      assert.ok(detailGeometry.top>=selectedTurn.body.top&&detailGeometry.top<selectedTurn.body.bottom)
      assert.ok(detailGeometry.scrollWidth<=detailGeometry.width,'Selected details fit the internal body width')
      await dialog.getByRole('button',{name:'Back to turns',exact:true}).click()
      assert.equal(await dialog.locator('[data-sheet-content]').evaluate(node=>node.scrollTop),0)
      await turns.getByRole('button',{name:'View turn 1',exact:true}).click()
      await dialog.getByText('Shared question <script>window.unsafeFeedback = true</script>',{exact:true}).waitFor()
      await screenshot(page,'shared-conversation',width)
      state.sharing={enabled:false,revision:2,updatedAt:now}
      const refreshed=page.waitForResponse(response=>response.url().includes('/api/admin/ai-usage/conversations/'))
      await focus(page);await refreshed
      await dialog.getByText('Shared question <script>window.unsafeFeedback = true</script>',{exact:true}).waitFor({state:'hidden'})
      await dialog.getByText('Sharing withdrawn. Conversation content is hidden.',{exact:true}).waitFor()
      assert.equal(await dialog.getByText('Shared question <script>window.unsafeFeedback = true</script>',{exact:true}).count(),0)
      await dialog.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Enter')
      await dialog.waitFor({state:'hidden'})
      assert.equal(await page.evaluate(()=>document.body.style.position==='fixed'),false,'Keyboard Close releases the document scroll lock')
      results.push({case:'feedback-usage-page-filter-detail-safe-content-consent-refetch',label,width})

      await go(page,'/admin/features')
      await page.getByRole('button',{name:'Configure Card scanner',exact:true}).click()
      dialog=page.getByRole('dialog',{name:'Configure Card scanner',exact:true})
      await dialog.getByLabel('Feature release stage',{exact:true}).selectOption('disabled')
      await dialog.getByLabel('Reason',{exact:true}).fill('Stop new scanner use')
      await dialog.getByRole('button',{name:'Save feature lifecycle',exact:true}).click()
      await dialog.waitFor({state:'hidden'})
      assert.equal(state.featureCatalog[0].lifecycle,'disabled')
      await screenshot(page,'feature-lifecycle',width)
      state.actor='superadmin';state.accessRevision++
      await go(page,'/admin/users/'+USER)
      assert.equal(await page.getByRole('heading',{name:'Owner controls: user AI override',exact:true}).count(),0)
      assert.equal(await page.getByRole('button',{name:'Save user AI override',exact:true}).count(),0)
      state.users[0].roles=[{id:'owner-role',name:'Owner'}]
      await go(page,'/admin/users/'+USER)
      assert.equal(await page.getByRole('button',{name:'Assign role',exact:true}).count(),0)
      state.actor='admin';state.permissions=PERMISSIONS.filter(p=>!['roles.manage','settings.write'].includes(p));state.accessRevision++
      state.users[0].roles=[{id:'contributor-role',name:'Contributor'}]
      await go(page,'/admin/users/'+USER)
      assert.equal(await page.getByRole('button',{name:'Assign role',exact:true}).count(),0)
      state.users[0].roles=[{id:'user-role',name:'User'}]
      await go(page,'/admin/users/'+USER)
      await page.getByRole('button',{name:'Assign role',exact:true}).click()
      dialog=page.getByRole('dialog',{name:'Assign role',exact:true})
      assert.deepEqual(await dialog.getByLabel('Assigned role',{exact:true}).locator('option').allTextContents(),['User','Superuser'])
      await dialog.getByLabel('Assigned role',{exact:true}).selectOption('superuser-role')
      await dialog.getByLabel('Reason',{exact:true}).fill('Enable experimental eligibility')
      await dialog.getByRole('button',{name:'Save role assignment',exact:true}).click();await dialog.waitFor({state:'hidden'})
      assert.equal(state.users[0].roles[0].id,'superuser-role')
      results.push({case:'feedback-superadmin-owner-denial-admin-target-destination-matrix',label,width})

      // Let the prior administrator's assignment refresh settle before changing the fixture actor.
      await go(page,'/devtools')
      state.actor='contributor';state.permissions=['devtools.access','design.view','diagnostics.view','scanner.label'];state.accessRevision++
      const start=state.requests.length
      await go(page,'/devtools')
      await page.getByRole('heading',{name:'Dev tools',exact:true}).waitFor()
      const tools=page.getByRole('table',{name:'Development tools',exact:true})
      assert.equal(await tools.getByRole('link',{name:'Design system',exact:true}).count(),1)
      assert.equal(await tools.getByRole('link',{name:'Quad labeler',exact:true}).count(),1)
      assert.equal(await tools.getByRole('link',{name:'Card scanner',exact:true}).count(),0)
      assert.equal(await tools.getByRole('link',{name:'Deck-E',exact:true}).count(),0)
      if(width!==1280){await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('dialog',{name:'Navigation'}).getByRole('link',{name:'Dev tools',exact:true}).waitFor();await page.getByRole('button',{name:'Menu',exact:true}).click()}
      else assert.ok(await page.getByRole('link',{name:'Dev tools',exact:true}).count()>0)
      await screenshot(page,'contributor-devtools',width)
      await go(page,'/admin/users')
      assert.equal(await page.getByRole('heading',{name:'Users',exact:true}).count(),0)
      await go(page,'/profile')
      await page.getByRole('heading',{name:'Feature preferences',exact:true}).waitFor()
      await page.getByRole('button',{name:'Opt in to Deck-E',exact:true}).click()
      await page.getByRole('button',{name:'Opt out of Deck-E',exact:true}).waitFor()
      assert.ok(state.requests.slice(start).every(r=>!r.rel.startsWith('/api/admin/')),'Contributor emitted a forbidden administrative API request: '+JSON.stringify(state.requests.slice(start).filter(r=>r.rel.startsWith('/api/admin/'))))
      assert.ok(state.requests.slice(start).some(r=>r.rel==='/api/me/credits'),'Opted-in Deck-E retains ordinary self-service wallet access')
      const sharing=page.getByRole('button',{name:'Turn on conversation sharing',exact:true})
      await sharing.click()
      await page.getByRole('button',{name:'Turn off conversation sharing',exact:true}).waitFor()
      state.sharingConflict=true
      await page.getByRole('button',{name:'Turn off conversation sharing',exact:true}).click()
      await page.getByText('Sharing preference changed. Reload the current preference before trying again.',{exact:true}).waitFor()
      state.sharingConflict=false
      state.featureCatalog[1].lifecycle='disabled';state.accessRevision++
      await focus(page)
      await page.getByRole('button',{name:'Turn off conversation sharing',exact:true}).click()
      await page.getByRole('button',{name:'Turn on conversation sharing',exact:true}).waitFor()
      assert.equal(state.sharing.enabled,false)
      await screenshot(page,'profile-withdrawal',width)
      results.push({case:'feedback-contributor-devtools-no-admin-requests-selfservice-sharing-withdrawal',label,width})
    } catch(error) {
      await page.screenshot({path:path.join(out,label+'-feedback-failure-'+width+'.png'),fullPage:true})
      error.message+='\nFeedback viewport '+width+': '+(await page.locator('body').innerText()).slice(0,5500)
      console.error(error.message)
      throw error
    } finally {await context.close()}
  }
  // Every eligible middle tier can opt into every experimental catalog entry;
  // an added experiment proves this is not a hard-coded scanner/Deck-E allowlist.
  state.featureCatalog.push({key:'fixture-next',label:'Future experiment',lifecycle:'experimental',revision:1})
  for(const actor of ['ordinary','superuser','contributor','admin','superadmin','owner']){
    state.actor=actor;state.accessRevision++;state.permissions=tierFor(actor)>=40?[...PERMISSIONS]:actor==='contributor'?['devtools.access','design.view']:[]
    state.optins={};for(const f of state.featureCatalog) f.lifecycle='experimental'
    const {context,page}=await contextFor(browser,server,390);await signIn(context,USER)
    try{
      await go(page,'/profile')
      const table=page.getByRole('table',{name:'Product features',exact:true});await table.getByText('Future experiment',{exact:true}).waitFor()
      const tier=tierFor(actor)
      assert.equal(await table.getByRole('button',{name:/Opt in to/}).count(),tier>=20&&tier<50?3:0)
      if(tier>=20&&tier<50) {for(const name of ['Card scanner','Deck-E','Future experiment']){await table.getByRole('button',{name:'Opt in to '+name,exact:true}).click();await table.getByRole('button',{name:'Opt out of '+name,exact:true}).waitFor()}}
      if(actor==='superuser') {
        const experiment=table.getByRole('row').filter({hasText:'Future experiment'})
        await experiment.getByRole('button',{name:'Opt out of Future experiment',exact:true}).click()
        await experiment.getByRole('button',{name:'Opt in to Future experiment',exact:true}).waitFor()
        await experiment.getByText('Not enabled',{exact:true}).waitFor()
        assert.equal(state.optins[actor+':fixture-next'],false)
        await experiment.getByRole('button',{name:'Opt in to Future experiment',exact:true}).click()
        await experiment.getByRole('button',{name:'Opt out of Future experiment',exact:true}).waitFor()
      }
      if(tier<20) assert.equal(await table.getByText('Experimental opt-in requires Superuser or a higher role.',{exact:true}).count(),3)
      if(tier>=50) {
        assert.equal(await table.getByText('Automatic for your role',{exact:true}).count(),3)
        assert.equal(await table.getByText('Included automatically for your role.',{exact:true}).count(),3)
        state.optins[actor+':scanner']=true;state.accessRevision++;await focus(page)
        await table.getByText('Automatic for your role',{exact:true}).first().waitFor()
        assert.equal(await table.getByRole('button',{name:/Opt (in|out)/}).count(),0,'A stored preference cannot override automatic experimental access')
      }
      state.featureCatalog[0].lifecycle='beta';state.accessRevision++;state.optins[actor+':scanner']=false
      await focus(page)
      await table.getByRole('button',{name:'Opt in to Card scanner',exact:true}).waitFor()
      await table.getByRole('button',{name:'Opt in to Card scanner',exact:true}).click();await table.getByRole('button',{name:'Opt out of Card scanner',exact:true}).waitFor()
      state.featureCatalog[0].lifecycle='released';state.featureCatalog[1].lifecycle='disabled';state.accessRevision++
      await focus(page)
      await table.getByText('disabled',{exact:true}).waitFor()
      const decke=table.getByRole('row').filter({hasText:'Deck-E'})
      await decke.getByText('Not enabled',{exact:true}).waitFor()
      assert.equal(await decke.getByRole('button').count(),0)
      assert.equal(await page.getByRole('button',{name:'Chat with Deck-E',exact:true}).count(),0)
      const scanner=table.getByRole('row').filter({hasText:'Card scanner'})
      await scanner.getByText('Available to all active accounts.',{exact:true}).waitFor()
      assert.equal(await scanner.getByRole('button').count(),0)
      await decke.getByText('Unavailable while the team has this feature disabled.',{exact:true}).waitFor()
      state.accountUnavailable=true;state.accessRevision++;await focus(page)
      await table.getByText('Unavailable while your account is inactive or access is not ready.',{exact:true}).first().waitFor()
      assert.equal(await table.getByText('Unavailable while your account is inactive or access is not ready.',{exact:true}).count(),3)
      assert.equal(await table.getByRole('button').count(),0)
      state.accountUnavailable=false
      results.push({case:'feedback-full-lifecycle-product-eligibility',label,actor,width:390})
    }finally{await context.close()}
  }

  if(label==='cloud'){
    state.actor='owner';state.permissions=[...PERMISSIONS];state.accessRevision++;state.sharing={enabled:true,revision:7,updatedAt:now}
    const {context,page}=await contextFor(browser,server,390);await signIn(context)
    try{
      await go(page,'/admin/usage')
      await page.getByRole('button',{name:'Request '+state.usage[0].id,exact:true}).click()
      await page.getByText('Shared question <script>window.unsafeFeedback = true</script>',{exact:true}).waitFor()
      await page.keyboard.press('Escape')
      state.delayUsageDetail=true
      await page.getByRole('button',{name:'Request '+state.usage[0].id,exact:true}).click()
      await page.getByRole('dialog',{name:'Request usage',exact:true}).getByRole('status').filter({hasText:'Loading'}).waitFor()
      state.sharing={enabled:false,revision:8,updatedAt:now}
      await page.evaluate(()=>{
        const session=JSON.parse(localStorage.getItem('sb-127-auth-token'))
        session.user.id='10000000-0000-4000-8000-000000000003'
        session.access_token=btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify({sub:session.user.id,exp:4102444800,role:'authenticated'}))+'.fixture'
        localStorage.setItem('sb-127-auth-token',JSON.stringify(session))
        const channel=new BroadcastChannel('sb-127-auth-token');channel.postMessage({event:'SIGNED_IN',session});channel.close()
      })
      await page.getByRole('dialog',{name:'Request usage',exact:true}).waitFor({state:'hidden'})
      await page.waitForTimeout(500) // The old session response has now arrived and must stay discarded.
      state.delayUsageDetail=false
      assert.equal(await page.getByText('Shared question <script>window.unsafeFeedback = true</script>',{exact:true}).count(),0)
      await page.getByRole('button',{name:'Request '+state.usage[0].id,exact:true}).click()
      await page.getByText('Sharing withdrawn. Conversation content is hidden.',{exact:true}).waitFor()
      state.actor='contributor';state.permissions=['devtools.access','design.view'];state.accessRevision++
      await focus(page)
      await page.getByText('Access unavailable',{exact:true}).waitFor()
      assert.equal(await page.getByRole('dialog',{name:'Request usage',exact:true}).count(),0)
      results.push({case:'feedback-content-cache-account-switch-same-permissions-role-revocation',label,width:390})
    }finally{await context.close()}
    results.push(...await checkChatCorrelation(browser,server,mount,label,out,fixture))
  }

  results.push(...await checkPendingAdminSheets(browser,server,mount,label,out,fixture))

  state.featureCatalog=state.featureCatalog.filter(f=>f.key!=='fixture-next');state.feedbackMatrix=false;state.permissions=[...PERMISSIONS];state.actor='owner'
  return results
}

export async function checkChatCorrelation(browser,server,mount,label,out,fixture){
  const {state}=fixture,results=[]
  const go=(page,route)=>page.goto(server.origin+mount+route,{waitUntil:'networkidle'})
    state.actor='owner';state.permissions=[...PERMISSIONS];state.accessRevision++;state.chatProbe=true;state.chatRequests=[];state.historyRecords=[];state.balance=500
    for(const f of state.featureCatalog)f.lifecycle='released'
    const chat=await contextFor(browser,server,390);await signIn(chat.context)
    try{
      await go(chat.page,'/series')
      await chat.page.getByRole('button',{name:'Chat with Deck-E',exact:true}).click()
      const composer=chat.page.getByRole('textbox',{name:'Message Deck-E',exact:true})
      for(const question of ['Correlation first question','Correlation second question']){
        await chat.page.getByRole('button',{name:'Send',exact:true}).waitFor()
        await composer.fill(question);const recorded=chat.page.waitForResponse(response=>response.url().includes('/api/decke/history')&&response.request().method()==='POST').then(()=>null,error=>error);await composer.press('Enter')
        await chat.page.getByRole('dialog',{name:'Chat with Deck-E',exact:true}).getByText('Verified reply to '+question,{exact:true}).waitFor()
        const recordError=await recorded;if(recordError)throw recordError
      }
      assert.equal(state.chatRequests.length,4,'A browser tool must cause two HTTP legs per human message')
      assert.equal(state.historyRecords.length,2,'One owned history record per human message')
      for(const [index,history]of state.historyRecords.entries()){
        const legs=state.chatRequests.filter(r=>r.exchangeId===history.exchangeId)
        assert.equal(legs.length,2);assert.match(history.exchangeId,/^[0-9a-f-]{36}$/)
        assert.equal(history.seq,index)
        assert.equal(history.answered,'Verified reply to '+history.asked,'Fast replies must be recorded after text capture, not from stale React state')
        for(const leg of legs){
          assert.equal(leg.conversationId,history.conversationId);assert.equal(leg.seq,history.seq)
          const human=leg.messages.findLast(m=>m.role==='user')
          assert.deepEqual(human.parts,[{type:'text',text:history.asked}],'Only current human text may be shared as the current question')
        }
      }
      assert.notEqual(state.historyRecords[0].exchangeId,state.historyRecords[1].exchangeId)
      assert.equal(state.historyRecords[0].conversationId,state.historyRecords[1].conversationId)
      results.push({case:'feedback-real-chat-multileg-owned-exchange-correlation',label,width:390})
    }catch(error){await chat.page.screenshot({path:path.join(out,'cloud-feedback-chat-failure.png'),fullPage:true});console.error(await chat.page.locator('body').innerText());console.error(JSON.stringify({chat:state.chatRequests,history:state.historyRecords,requests:state.requests.slice(-12)}));throw error}finally{state.chatProbe=false;await chat.context.close()}
  return results
}


// Animated close refusal must preserve both the visible dialog and focus until
// the held mutation finishes. Each case uses its actual form and API endpoint.
export async function checkPendingAdminSheets(browser,server,mount,label,out,fixture) {
  const {state}=fixture,results=[]
  const cases=[
    {id:'role',route:'/admin/roles',open:'Edit User',title:'Edit role',save:'Save role',method:'PATCH',rel:'/api/admin/roles/user-role',field:'Description',value:'Pending role definition'},
    {id:'assignment',route:'/admin/users/'+USER,open:'Assign role',title:'Assign role',save:'Save role assignment',method:'PUT',rel:'/api/admin/users/'+USER+'/role',field:'Reason',value:'Reviewed role change'},
    {id:'adjustment',route:'/admin/users/'+USER,open:'Adjust credits',title:'Adjust AI credits',save:'Confirm credit adjustment',method:'POST',rel:'/api/admin/credits/users/'+USER+'/adjustments',field:'Reason',value:'Reviewed credit adjustment'},
    {id:'confirmation',route:'/admin/users/'+USER,open:'Suspend account',title:'Suspend account',save:'Suspend account',method:'PATCH',rel:'/api/admin/users/'+USER+'/status',field:'Reason',value:'Reviewed suspension'},
    {id:'feature',route:'/admin/features',open:'Configure Card scanner',title:'Configure Card scanner',save:'Save feature lifecycle',method:'PATCH',rel:'/api/admin/features/scanner',field:'Reason',value:'Reviewed release change'},
    {id:'pack',route:'/admin/settings',open:'Edit Starter',title:'Edit credit pack',save:'Save credit pack',method:'PATCH',rel:'/api/admin/credits/packs/pack-1',field:'Pack name',value:'Starter'},
  ]
  for(const test of cases) {
    state.actor='owner';state.permissions=[...PERMISSIONS];state.signedOut=false;state.accountUnavailable=false;state.accessRevision++
    state.users[0].roles=[{id:'user-role',name:'User'}];state.users[0].suspended=false
    const {context,page}=await contextFor(browser,server,390);await signIn(context);await page.emulateMedia({reducedMotion:'no-preference'})
    let held
    try {
      await page.goto(server.origin+mount+test.route,{waitUntil:'networkidle'})
      if(test.id==='role')await page.getByLabel('Search roles',{exact:true}).fill('User')
      if(test.id==='pack')await page.getByLabel('Search packs',{exact:true}).fill('Starter')
      await page.getByRole('button',{name:test.open,exact:true}).click()
      const dialog=page.getByRole('dialog',{name:test.title,exact:true})
      await dialog.getByLabel(test.field,{exact:true}).fill(test.value)
      if(test.id==='assignment')await dialog.getByLabel('Assigned role',{exact:true}).selectOption('superuser-role')
      if(test.id==='adjustment')await dialog.getByLabel('Credit adjustment',{exact:true}).fill('5')
      if(test.id==='feature')await dialog.getByLabel('Feature release stage',{exact:true}).selectOption('beta')
      let started
      const began=new Promise(resolve=>{started=resolve})
      held={rel:test.rel,method:test.method,onStart:started};state.heldMutation=held
      await dialog.getByRole('button',{name:test.save,exact:true}).click();await Promise.race([began,page.waitForTimeout(10000).then(()=>{throw new Error('Expected pending API mutation did not arrive: '+test.rel)})])
      const stillUsable=async () => {
        await page.waitForTimeout(250) // Close callback runs after the authored 220ms exit.
        await page.waitForFunction(() => {
          const node=document.querySelector('.px-sheet-panel')
          return node && !node.hasAttribute('data-closing') && !node.parentElement.hasAttribute('data-closing') && [node,node.parentElement].every(el=>el.getAnimations().every(animation=>animation.playState!=='running')) && Number(getComputedStyle(node.parentElement).opacity) >= .99
        },undefined,{timeout:2000})
        const actual=await dialog.evaluate(node=>({opacity:Number(getComputedStyle(node).opacity),closing:node.getAttribute('data-closing'),focusInside:node.contains(document.activeElement),top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom,height:node.getBoundingClientRect().height,viewport:innerHeight}))
        assert.ok(actual.opacity>0.95&&actual.height>100&&actual.top>=0&&actual.bottom<=actual.viewport+1,test.id+': pending close keeps the sheet visibly within the viewport '+JSON.stringify(actual))
        assert.equal(actual.closing,null,test.id+': refused close removes the animation attribute')
        assert.ok(actual.focusInside,test.id+': focus remains in the visible modal')
      }
      await dialog.getByLabel(test.field,{exact:true}).focus()
      await page.keyboard.press('Escape');await stillUsable()
      await dialog.getByRole('button',{name:'Close',exact:true}).click();await stillUsable()
      await dialog.getByLabel(test.field,{exact:true}).fill(test.value)
      if(test.id==='feature')await page.screenshot({path:path.join(out,label+'-feedback-pending-sheet-390.png'),fullPage:false})
      held.finish()
      await dialog.getByRole('alert').filter({hasText:'Fixture save failed after pending close'}).waitFor()
      await dialog.getByRole('button',{name:test.save,exact:true}).waitFor({state:'visible'})
      assert.equal(await dialog.getByRole('button',{name:test.save,exact:true}).isEnabled(),true)
      await dialog.getByLabel(test.field,{exact:true}).fill(test.value)
      await dialog.getByRole('button',{name:test.save,exact:true}).click()
      await dialog.waitFor({state:'hidden'})
      await page.waitForFunction(() => document.body.style.position !== 'fixed', undefined, {timeout:2000})
      assert.equal(await page.evaluate(()=>document.body.style.position==='fixed'),false)
      results.push({case:'feedback-pending-sheet-escape-close-error-retry',label,form:test.id,width:390})
    } catch(error) {
      await page.screenshot({path:path.join(out,label+'-feedback-pending-'+test.id+'-failure.png'),fullPage:true})
      error.message+='\nPending form '+test.id+': '+(await page.locator('body').innerText()).slice(0,5000)
      console.error(error.message)
      throw error
    } finally {held?.finish?.();state.heldMutation=null;await context.close()}
  }
  return results
}
