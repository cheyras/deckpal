/**
 * UXC-06 / SEC-05 — the rail's locked "Sign in" pill actually opens sign in,
 * and lands back on the page it gated, at both viewport widths.
 *
 * Every other check in this suite signs a browser context in with a
 * localStorage shortcut (`admin.mjs`'s `signIn()`) — right for testing what a
 * SIGNED-IN screen looks like, but unable to exercise this fix at all: the
 * redirect to `next` lives in `Auth.tsx`'s submit handler, which only runs
 * after a real `supabase.auth.signInWithPassword()` call resolves. So this
 * file adds one thing the rest of the suite doesn't need: a fake Supabase
 * Auth REST responder for `POST /auth/v1/token?grant_type=password`, built
 * from the installed @supabase/auth-js 2.116.0's own contract
 * (`GoTrueClient.signInWithPassword` / `hasSession` in `lib/fetch.js`) rather
 * than assumed — a flat `{access_token, refresh_token, expires_in, user}`
 * body is everything `_sessionResponsePassword` requires to treat the sign-in
 * as successful. No real account, no real network egress: the client is
 * built with `VITE_SUPABASE_URL` pointed at this same loopback fixture.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { buildWeb, serve, contextFor } from './support.mjs'
import { adminFixture } from './admin.mjs'

const FAKE_USER_ID = '10000000-0000-4000-8000-000000000002'

function authTokenResponse(req) {
  if (req.method !== 'POST') return null
  const now = Math.floor(Date.now() / 1000)
  // No credential check by design — this is a fixture authorization server,
  // not a real one. Whether the FORM validates empty/malformed input is
  // covered by lib/__tests__/authErrors coverage, not here; this responder's
  // only job is to make a submitted sign-in succeed so the REDIRECT logic
  // downstream of it can be exercised.
  return {
    body: {
      access_token: 'fixture-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: 'fixture-refresh-token',
      user: {
        id: FAKE_USER_ID, aud: 'authenticated', role: 'authenticated',
        email: req.body?.email ?? 'fixture@example.invalid',
        app_metadata: {}, user_metadata: {}, created_at: '2026-09-12T18:00:00Z',
      },
    },
  }
}

export async function checkAuthReturn(browser, dist, out) {
  const results = []
  // Cloud only — self-host has no Supabase auth, so /auth is unreachable
  // there and this fix does not apply.
  const admin = adminFixture('')
  admin.state.actor = 'ordinary'
  admin.state.permissions = [] // keep the rail to the rows every account sees
  let lists = []
  const respondApi = (rel, url, req) => {
    if (rel === '/auth/v1/token') return authTokenResponse(req)
    // Not part of admin.mjs's fixture surface (that module's checks never
    // visit My Lists) — a real GET, since ListsIndex's own heading is what
    // proves the redirect landed on the RIGHT page, not just "some page".
    if (rel === '/api/lists' && req.method === 'GET') return { body: { lists } }
    return admin.response(rel, url, req)
  }
  const allowMutation = (pathname, method) =>
    (pathname === '/auth/v1/token' && method === 'POST') || admin.allowMutation(pathname, method)
  const server = await serve(dist, '', respondApi, 'index.html', { allowMutation })
  try {
    buildWeb(dist, true, server.origin)
    for (const width of [1440, 390]) {
      const { context, page } = await contextFor(browser, server, width)
      try {
        // Start signed OUT on a public catalog page — no localStorage session
        // planted, unlike every other check in this suite.
        await page.goto(server.origin + '/series', { waitUntil: 'networkidle' })
        if (width === 390) {
          await page.getByRole('button', { name: 'Menu', exact: true }).click()
          await page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'My Lists' }).click()
        } else {
          await page.getByRole('link', { name: 'My Lists' }).click()
        }
        await page.waitForURL((u) => u.pathname === '/auth' && u.searchParams.get('next') === '/lists')
        // UXC-06: the badge on the locked row reads "Sign in", but the link it
        // sat on opened `?mode=signup` — assert the rendered TAB state, not
        // just the URL, so a regression that flips the search param but not
        // the visible tab still fails this.
        assert.equal(
          await page.getByRole('tab', { name: 'Sign in', selected: true }).count(), 1,
          width + 'px: the locked row must open the Sign In tab',
        )
        assert.equal(await page.getByRole('tab', { name: 'Sign up', selected: true }).count(), 0,
          width + 'px: must not land on Sign Up')
        // The heading names the actual gated destination once `next` is known.
        await page.getByRole('heading', { name: 'Sign in to see your lists', exact: true }).waitFor()

        await page.getByLabel('Email', { exact: true }).fill('fixture@example.invalid')
        await page.getByLabel('Password', { exact: true }).fill('fixture-password-not-real')
        await page.screenshot({ path: path.join(out, 'authreturn-' + width + '-signin-form.png'), fullPage: true })
        await page.getByRole('button', { name: 'Sign in', exact: true }).click()

        // A full navigation (Auth.tsx: `window.location.assign(next)`), not a
        // client-side route change — this is the SEC-05/UXC-06 payoff: the
        // visitor lands on the list they actually tried to open, not /series.
        await page.waitForURL(server.origin + '/lists')
        await page.getByRole('heading', { name: 'My Lists', exact: true }).waitFor()
        await page.screenshot({ path: path.join(out, 'authreturn-' + width + '-landed-on-lists.png'), fullPage: true })
        results.push({ case: 'pill-signin-returns-to-next', width, next: '/lists', landedOn: new URL(page.url()).pathname })
      } catch (error) {
        await page.screenshot({ path: path.join(out, 'authreturn-' + width + '-failure.png'), fullPage: true })
        error.message += '\nUnexpected: ' + JSON.stringify(server.unexpected)
        throw error
      } finally {
        await context.close()
      }
    }
    assert.deepEqual(server.unexpected, [], 'auth-return: unexpected network/error events')
  } finally {
    await server.close()
  }
  return results
}
