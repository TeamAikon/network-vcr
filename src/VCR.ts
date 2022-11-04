import nock from 'nock'
import { promises as fs } from 'fs'

type CassetteFile = Record<string, nock.Definition[]>
type DefinitionProcessor = (defns: nock.Definition[]) => nock.Definition[]

interface VCROptions {
  processDefns: DefinitionProcessor
  CI: boolean
}

export async function startVCR(options?: Partial<VCROptions>): Promise<nock.Scope[]> {
  const { processDefns, CI } = { processDefns: defns => defns, CI: process.env.CI, ...options } as VCROptions
  const defns = await currentCassettes()

  if (CI && typeof defns === 'undefined') {
    throw new Error(`No cassettes found. They must be in place before running tests on CI ${cassettePath()}`)
  }

  if (defns && !!defns.length) {
    // Cassettes found - using saved responses
    // set up the mocks
    const scopes = nock.define(processDefns(defns.map(relaxDefinitionsForJsonRPC)))
    scopes.forEach(matchJsonRPCResponseToRequest)
    if (!nock.isActive()) nock.activate()
    return scopes
  }

  const shouldRecord = !CI && (typeof defns === 'undefined' || defns.length === 0)
  if (shouldRecord) {
    // No cassettes found - recording responses
    nock.recorder.rec({ output_objects: true, dont_print: true })
  }
  return []
}

export async function stopVCR() {
  const defns = nock.recorder.play() as nock.Definition[]
  nock.recorder.clear()
  // even when not has to call any external api we should save the cassettes (an empty array [])
  await saveCassettes(defns)
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
  if (!testName) return

  const hasCasset = cassettes[testName] && !!cassettes[testName].length
  if (!defns.length && hasCasset) return

  cassettes[testName] = defns
  await writeCassetteFile(cassettes)
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

async function currentCassettes(): Promise<nock.Definition[] | undefined> {
  const cassettes = await readCassetteFile()
  const testName = expect.getState().currentTestName
  return (testName && cassettes[testName]) || undefined
}

/**
 * Modify definitions to match on any id
 */
function relaxDefinitionsForJsonRPC(defn: nock.Definition) {
  if (defn.body?.hasOwnProperty('jsonrpc')) {
    return {
      ...defn,
      body: {
        ...(defn.body as object),
        id: /\d+/,
      },
    }
  }
  return defn
}

/**
 * When handling JsonRPC requests, respond with the same id that was requested
 */
function matchJsonRPCResponseToRequest(scope: nock.Scope) {
  scope.on('request', (req, interceptor, requestBodyString) => {
    // body can be empty string. In that case, we can't parse it
    if (!requestBodyString) return

    const requestBody = JSON.parse(requestBodyString)
    if (requestBody.hasOwnProperty('jsonrpc')) {
      const responseBody = JSON.parse(interceptor.body)
      responseBody.id = requestBody.id
      interceptor.body = JSON.stringify(responseBody)
    }
  })
}
