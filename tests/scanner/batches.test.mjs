// How many agents a scan launches: every agent pays the same fixed context, so a small scope
// gets few investigation batches and the triage packs its findings.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { batchCount, triageChunks } from '../../scanner-plugin/scripts/lib.mjs'

describe('batchCount', () => {
  it('gives a small scope one batch instead of the configured four', () => {
    assert.equal(batchCount(44_000), 1)
    assert.equal(batchCount(170_000), 3)
  })

  it('never goes beyond `batches`, doubled by --deep', () => {
    assert.equal(batchCount(5_000_000), 4)
    assert.equal(batchCount(5_000_000, { batches: 6 }), 6)
    assert.equal(batchCount(5_000_000, { deep: true }), 8)
  })

  it('halves the target size with --deep', () => {
    assert.equal(batchCount(44_000, { deep: true }), 2)
  })

  it('keeps one batch per engine so that --via still deals batches out', () => {
    assert.equal(batchCount(10_000, { engines: 2 }), 2)
    assert.equal(batchCount(10_000, { batches: 1, engines: 2 }), 1)
  })

  it('follows batchBytes, and survives an empty scope', () => {
    assert.equal(batchCount(44_000, { batchBytes: 11_000 }), 4)
    assert.equal(batchCount(0), 1)
  })
})

describe('triageChunks', () => {
  const findings = (n) => Array.from({ length: n }, (_, i) => ({ id: `F${i + 1}` }))

  it('packs up to `size` findings in one batch', () => {
    assert.deepEqual(triageChunks(findings(15)).map((c) => c.length), [15])
  })

  it('balances the batches instead of leaving a small last one', () => {
    assert.deepEqual(triageChunks(findings(15), 10).map((c) => c.length), [8, 7])
    assert.deepEqual(triageChunks(findings(41)).map((c) => c.length), [14, 14, 13])
  })

  it('keeps every finding, in order', () => {
    assert.deepEqual(triageChunks(findings(23), 10).flat().map((f) => f.id), findings(23).map((f) => f.id))
    assert.deepEqual(triageChunks([]), [])
  })
})
