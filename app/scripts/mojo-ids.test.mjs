import { describe, expect, it } from 'vitest'
import { compareMessageIds, messageIdsFromBindings, messageIdsFromHeader } from './mojo-ids.mjs'

const header = `
namespace webdeck::mojom {
namespace messages {
enum class AgentTabs : uint32_t {
  kOpenTab = 102408508,
  kSetClient = 777262655,
};
enum class Shell : uint32_t {
// The 1150953122 value is based on sha256(salt + "Shell34").
  kSetAsDefaultBrowser = 1142821493,
  kSetClient = 1150953122,
};
}
}
`

const js = `
var AgentTabsRemote = class {
  openTab(url) {
    return this.proxy.sendMessage(
      102408508,
      AgentTabs_OpenTab_ParamsSpec.$,
      null, [url], false);
  }
  setClient(client) {
    this.proxy.sendMessage(
      777262655,
      AgentTabs_SetClient_ParamsSpec.$,
      null, [client], false);
  }
};
var ShellRemote = class {
  setAsDefaultBrowser() {
    return this.proxy.sendMessage(
      32,
      Shell_SetAsDefaultBrowser_ParamsSpec.$,
      Shell_SetAsDefaultBrowser_ResponseParamsSpec.$, [], false);
  }
  setClient(client) {
    this.proxy.sendMessage(
      33,
      Shell_SetClient_ParamsSpec.$,
      null, [client], false);
  }
};
`

describe('messageIdsFromHeader', () => {
  it('reads every interface and method id, comments included', () => {
    const ids = messageIdsFromHeader(header)
    expect(ids.get('AgentTabs.openTab')).toBe(102408508)
    expect(ids.get('Shell.setClient')).toBe(1150953122)
    expect(ids.size).toBe(4)
  })
})

describe('messageIdsFromBindings', () => {
  it('attributes each sent id to its interface', () => {
    const ids = messageIdsFromBindings(js)
    expect(ids.get('AgentTabs.setClient')).toBe(777262655)
    expect(ids.get('Shell.setClient')).toBe(33)
    expect(ids.size).toBe(4)
  })
})

describe('compareMessageIds', () => {
  it('flags a page built against sequential ids talking to a scrambled build', () => {
    const result = compareMessageIds(messageIdsFromBindings(js), messageIdsFromHeader(header))
    expect(result.ok).toBe(false)
    expect(result.mismatches).toEqual([
      { key: 'Shell.setAsDefaultBrowser', page: 32, browser: 1142821493 },
      { key: 'Shell.setClient', page: 33, browser: 1150953122 }
    ])
  })

  it('passes when every id agrees, and reports a method the browser lacks', () => {
    const page = new Map([
      ['Shell.setClient', 1150953122],
      ['Shell.newMethod', 5]
    ])
    const result = compareMessageIds(page, messageIdsFromHeader(header))
    expect(result.mismatches).toEqual([])
    expect(result.missing).toEqual(['Shell.newMethod'])
    expect(result.ok).toBe(false)
  })
})
