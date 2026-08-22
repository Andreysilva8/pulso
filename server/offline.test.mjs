import assert from 'node:assert/strict'
import test from 'node:test'
import { isSiteOffline } from './offline.mjs'

test('keeps local environments online by default', () => {
  assert.equal(isSiteOffline({}), false)
})

test('takes Render deployments offline', () => {
  assert.equal(isSiteOffline({ RENDER: 'true' }), true)
})

test('supports an explicit maintenance switch', () => {
  assert.equal(isSiteOffline({ SITE_OFFLINE: 'true' }), true)
  assert.equal(isSiteOffline({ SITE_OFFLINE: 'false', RENDER: 'false' }), false)
})
