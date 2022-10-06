# Network VCR

A simple tool for recording and replaying network requests in tests.

- Uses [nock](https://github.com/nock/nock)

## Usage

```
import { startVCR, stopVCR } from '@aikon/network-vcr'

test('it works', async () => {
  // best practice is to disable all external requests
  nock.disableNetConnect()

  await startVCR() // start before making network requests

  // make external requests in your test
  const result = await callAPI()

  await stopVCR() // be sure to call stop when you are done

  // When you run this test the first time, a __cassettes__ folder will be created with json files
  // that contain the responses of the requests that were made. Subsequent runs will use the canned
  // responses instead of making actual requests
})
```
