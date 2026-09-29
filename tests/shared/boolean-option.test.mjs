// A yes/no row of /config: a JSON boolean since the rows became `boolean`, and the
// `on`/`off` strings they had before, still found in older settings.json.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseBooleanOption } from '../../shared/i18n/i18n.mjs'

describe('parseBooleanOption', () => {
  it('reads a JSON boolean as is', () => {
    assert.equal(parseBooleanOption(true), true)
    assert.equal(parseBooleanOption(false), false)
  })

  it('reads the strings of the hook environment and of the former rows', () => {
    for (const v of ['true', 'on', 'yes', '1', ' ON ']) assert.equal(parseBooleanOption(v), true, v)
    for (const v of ['false', 'off', 'no', '0', 'Off']) assert.equal(parseBooleanOption(v), false, v)
  })

  it('leaves anything else to the caller’s default', () => {
    for (const v of [null, undefined, '', 'maybe', 2]) assert.equal(parseBooleanOption(v), undefined, String(v))
  })
})
