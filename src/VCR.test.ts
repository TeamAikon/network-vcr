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
    const cassettes = await getAllCassettes()
    expect(cassettes['VCR CI should accept empty a cassette']).toEqual([])
    await expect(
      startVCR({ CI: true }), // we to simulate a CI environment
    ).resolves.toBeTruthy()
    await stopVCR()
  })

  it('CI should throw an error if has no cassette', async () => {
    const cassettes = await getAllCassettes()
    expect(cassettes['VCR CI should throw an error if has no cassette']).toBeUndefined()

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
    let cassettes = await getAllCassettes()
    expect(cassettes['VCR CI should not update a empty cassette']).toEqual([])
    await expect(
      startVCR({ CI: true }), // we to simulate a CI environment
    ).resolves.toBeTruthy()
    await fetch('http://example.com')
    await stopVCR()
    cassettes = await getAllCassettes()
    expect(cassettes['VCR CI should not update a empty cassette']).toEqual([])
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
    let cassettes = await getAllCassettes()
    expect(cassettes['VCR Should create an empty cassette when no request was made']).toBeUndefined()

    await startVCR({ CI: false }) // we want make the real request, even on CI
    await stopVCR()

    // The empty cassette has been created
    cassettes = await getAllCassettes()
    expect(cassettes['VCR Should create an empty cassette when no request was made']).toEqual([])
  })

  it('Should not clear current cassette', async () => {
    let cassettes = await getAllCassettes()
    const before = cassettes['VCR Should not clear current cassette']
    expect(before).toHaveLength(1)

    await startVCR({ CI: false }) // we want make the real request, even on CI
    await fetch('http://example.com')
    await stopVCR()

    cassettes = await getAllCassettes()
    expect(before).toEqual(cassettes['VCR Should not clear current cassette'])
  })
})
