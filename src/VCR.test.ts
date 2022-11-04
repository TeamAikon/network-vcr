import { startVCR, stopVCR } from './VCR'
import fetch from 'node-fetch'
import nock from 'nock'
import { promises as fs } from 'fs'
import { PluginChainFactory, Models } from '@open-rights-exchange/chain-js'
import { Plugin as EthereumPlugin } from '@open-rights-exchange/chain-js-plugin-ethereum'

interface ChainConfig {
  chainType: Models.ChainType
  endpoints: [Models.ChainEndpoint]
  chainSettings: {
    chainForkType: {
      chainName: string
      hardFork: string
    }
    defaultTransactionSettings: {
      maxFeeIncreasePercentage: number
      executionPriority: Models.TxExecutionPriority
    }
  }
}

const getChainConfig = () => {
  const chainConfig: ChainConfig = {
    chainType: Models.ChainType.EthereumV1,
    endpoints: [{ url: 'https://goerli.infura.io/v3/b1664813d49f45c7a5bb42a395447977' }],
    chainSettings: {
      chainForkType: {
        chainName: 'goerli',
        hardFork: 'istanbul',
      },
      defaultTransactionSettings: {
        maxFeeIncreasePercentage: 20,
        executionPriority: Models.TxExecutionPriority.Fast,
      },
    },
  }
  return chainConfig
}

const cassettePath = './src/__cassettes__'

const getAllCassettes = async () => {
  let cassetteBuffer: Buffer
  try {
    cassetteBuffer = await fs.readFile(__dirname + '/__cassettes__/VCR.cassette.json')
  } catch (err) {
    return {}
  }
  return JSON.parse(cassetteBuffer.toString())
}

const getCassetteToCurrentTest = async () => {
  const testName = expect.getState().currentTestName
  if (!testName) throw new Error('No test name found')
  const allCassettes = await getAllCassettes()
  return allCassettes[testName]
}

/**
 * Scramble the ids so we know they don't matter
 * Update the second chainId response body to '0x6' so we can tell if this mock is used
 */
async function manipulateCassettesForTesting() {
  const allCassettes = await getAllCassettes()
  const cassettes = allCassettes['VCR works with json rpc']
  if (!cassettes) return false

  cassettes.forEach((mock: any) => {
    mock.body.id = Math.round(Math.random() * 100)
  })
  cassettes[5].response.result = '0x6'
  await fs.writeFile(__dirname + '/__cassettes__/VCR.cassette.json', JSON.stringify(allCassettes, null, 2))
  return true
}

// our cassettes will be manipulated by tests but we don't want tests to affect each other
beforeEach(async () => {
  nock.enableNetConnect()
  // backup cassettes
  try {
    await fs.cp(cassettePath, cassettePath + 'BAK', { recursive: true })
  } catch (err) {}
})

afterEach(async () => {
  // restore cassette backup
  try {
    await fs.rm(cassettePath, { force: true, recursive: true })
    await fs.rename(cassettePath + 'BAK', cassettePath)
  } catch (err) {
    console.error(err)
  }
})

describe('VCR', () => {
  it('creates cassette files', async () => {
    nock.disableNetConnect()

    await fs.rmdir(cassettePath, { recursive: true })
    await startVCR({ CI: false }) // we want make the real request, even on CI
    await fetch('http://example.com')
    await stopVCR()
    const cassetteDir = await fs.readdir(cassettePath)
    expect(cassetteDir).toEqual(['VCR.cassette.json'])
  })

  it('CI should accept empty a cassette', async () => {
    const cassette = await getCassetteToCurrentTest()
    expect(cassette).toEqual([])
    await expect(
      startVCR({ CI: true }), // we to simulate a CI environment
    ).resolves.toBeTruthy()
    await stopVCR()
  })

  it('CI should throw an error if has no cassette', async () => {
    const cassette = await getCassetteToCurrentTest()
    expect(cassette).toBeUndefined()

    expect(
      startVCR({ CI: true }), // we to simulate a CI environment
    ).rejects.toEqual(
      new Error(
        `No cassettes found. They must be in place before running tests on CI ${
          __dirname + '/__cassettes__/VCR.cassette.json'
        }`,
      ),
    )
  })

  it('CI should not update a empty cassette', async () => {
    let cassette = await getCassetteToCurrentTest()
    expect(cassette).toEqual([])
    await expect(
      startVCR({ CI: true }), // we to simulate a CI environment
    ).resolves.toBeTruthy()
    await fetch('http://example.com')
    await stopVCR()
    cassette = await getCassetteToCurrentTest()
    expect(cassette).toEqual([])
  })

  it('works with json rpc', async () => {
    nock.disableNetConnect()
    const chainConfig = getChainConfig()

    await manipulateCassettesForTesting()
    await startVCR()
    const chain = PluginChainFactory(
      [EthereumPlugin],
      chainConfig.chainType,
      chainConfig.endpoints,
      chainConfig.chainSettings,
    )
    await chain.connect()
    expect(chain.chainId).toEqual('5')
    await chain.connect()
    expect(chain.chainId).toEqual('6')
    await stopVCR()
  })

  it('Should create an empty cassette when no request was made', async () => {
    let cassette = await getCassetteToCurrentTest()
    expect(cassette).toBeUndefined()

    await startVCR({ CI: false }) // we want make the real request, even on CI
    await stopVCR()

    // The empty cassette has been created
    cassette = await getCassetteToCurrentTest()
    expect(cassette).toEqual([])
  })

  it('Should not clear current cassette', async () => {
    let cassette = await getCassetteToCurrentTest()
    const before = cassette
    expect(before).toHaveLength(1)

    await startVCR({ CI: false }) // we want make the real request, even on CI
    await fetch('http://example.com')
    await stopVCR()

    cassette = await getCassetteToCurrentTest()
    expect(before).toEqual(cassette)
  })

  it('Should not update an existing cassette', async () => {
    let cassette = await getCassetteToCurrentTest()
    const before = cassette
    expect(before).toHaveLength(1)

    await startVCR({ CI: false }) // we want make the real request, even on CI
    await fetch('http://example.com')
    await expect(fetch('http://example.com')).rejects.toThrow()
    await stopVCR()

    cassette = await getCassetteToCurrentTest()
    expect(before).toEqual(cassette)
  })

  it('Should not cahnge a current cassette if the requests change', async () => {
    let cassette = await getCassetteToCurrentTest()
    const before: any[] = cassette

    expect(before).toHaveLength(1)
    // Make shure, that we have no records for "example2.com"
    before.forEach(({ scope }) => {
      expect(scope).not.toEqual('http://example2.com:80')
    })

    await startVCR({ CI: false }) // we want make the real request, even on CI
    await fetch('http://example2.com')
    await stopVCR()

    cassette = await getCassetteToCurrentTest()
    expect(before).toEqual(cassette)

    // check this also works if connection is disabled
    nock.disableNetConnect()
    await startVCR({ CI: false }) // we want make the real request, even on CI
    await expect(fetch('http://example2.com')).rejects.toThrow()
    await stopVCR()

    cassette = await getCassetteToCurrentTest()
    expect(before).toEqual(cassette)
  })
})
