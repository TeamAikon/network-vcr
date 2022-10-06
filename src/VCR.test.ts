import { startVCR, stopVCR } from './VCR'
import fetch from 'node-fetch'
import nock from 'nock'
import { promises as fs } from 'fs'
import path from 'path'

describe('VCR', () => {
  it('creates cassette files', async () => {
    nock.disableNetConnect()
    const cassettePath = './src/__cassettes__'
    await fs.rmdir(cassettePath, { recursive: true })
    await startVCR({ CI: false }) // we want make the real request, even on CI
    const res = await fetch('http://example.com')
    await stopVCR()
    const cassetteDir = await fs.readdir(cassettePath)
    expect(cassetteDir).toEqual(['VCR.cassette.json'])
  })
})
