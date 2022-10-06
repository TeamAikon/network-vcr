import nock from 'nock'
import { promises as fs } from 'fs'

type CassetteFile = Record<string, nock.Definition[]>
type DefinitionProcessor = (defns: nock.Definition[]) => nock.Definition[]

interface VCROptions {
  processDefns: DefinitionProcessor
  CI: boolean
}

export async function startVCR(options?: Partial<VCROptions>): Promise<void> {
  const { processDefns, CI } = { processDefns: defns => defns, CI: process.env.CI, ...options } as VCROptions
  const defns = await currentCassettes()
  if (!defns.length) {
    if (CI) {
      throw new Error(`No cassettes found. They must be in place before running tests on CI ${cassettePath()}`)
    }
    // No cassettes found - recording responses
    nock.recorder.rec({ output_objects: true, dont_print: true })
  } else {
    // Cassettes found - using saved responses
    // set up the mocks
    nock.define(processDefns(defns))
    if (!nock.isActive()) nock.activate()
  }
}

export async function stopVCR() {
  const defns = nock.recorder.play() as nock.Definition[]

  nock.recorder.clear()
  if (defns.length) {
    await saveCassettes(defns)
  }
  nock.restore()
  nock.cleanAll()
}

function cassettePath(): string {
  const state: jest.MatcherState = expect.getState()
  const pathParts = state.testPath?.split('/') || []
  const fileName = pathParts?.pop() || ''
  pathParts.push('__cassettes__')
  pathParts.push(fileName.replace(/\..+/, '.cassette.json'))
  return pathParts.join('/')
}

async function writeCassetteFile(cassettes: CassetteFile): Promise<void> {
  const cassPath = cassettePath()
  const cassDir = cassPath.replace(/\/[^/]*$/, '')
  await fs.mkdir(cassDir, { recursive: true })
  await fs.writeFile(cassettePath(), JSON.stringify(cassettes, null, 2))
}

async function saveCassettes(defns: nock.Definition[]): Promise<void> {
  const cassettes: CassetteFile = await readCassetteFile()
  const testName = expect.getState().currentTestName
  if (testName) {
    cassettes[testName] = defns
    await writeCassetteFile(cassettes)
  }
}

async function readCassetteFile(): Promise<CassetteFile> {
  try {
    const buffer = await fs.readFile(cassettePath())
    return JSON.parse(buffer.toString()) as CassetteFile
  } catch {
    // no cassette file
    return {}
  }
}

async function currentCassettes(): Promise<nock.Definition[]> {
  const cassettes = await readCassetteFile()
  const testName = expect.getState().currentTestName
  return (testName && cassettes[testName]) || []
}
