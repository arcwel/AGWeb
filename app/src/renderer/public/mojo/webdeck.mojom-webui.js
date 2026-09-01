// ../../../../../../../../../../Volumes/BG_Dev/webdeck-chromium/chromium/src/out/webdeck/gen/chrome/browser/ui/webui/webdeck/webdeck.mojom-webui.ts
import { mojo } from "//resources/mojo/mojo/public/js/bindings.js";
import {
  RectSpec as gfx_mojom_RectSpec
} from "//resources/mojo/ui/gfx/geometry/mojom/geometry.mojom-webui.js";
var AgentTabsPendingReceiver = class {
  handle;
  constructor(handle) {
    this.handle = mojo.internal.interfaceSupport.getEndpointForReceiver(handle);
  }
  bindInBrowser(scope = "context") {
    mojo.internal.interfaceSupport.bind(
      this.handle,
      "webdeck.mojom.AgentTabs",
      scope
    );
  }
};
var AgentTabsRemote = class {
  proxy;
  $;
  onConnectionError;
  constructor(handle) {
    this.proxy = new mojo.internal.interfaceSupport.InterfaceRemoteBase(
      AgentTabsPendingReceiver,
      handle
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceRemoteBaseWrapper(this.proxy);
    this.onConnectionError = this.proxy.getConnectionErrorEventRouter();
  }
  openTab(url) {
    return this.proxy.sendMessage(
      0,
      AgentTabs_OpenTab_ParamsSpec.$,
      AgentTabs_OpenTab_ResponseParamsSpec.$,
      [
        url
      ],
      false
    );
  }
  sendCommand(tabId, method, paramsJson) {
    return this.proxy.sendMessage(
      1,
      AgentTabs_SendCommand_ParamsSpec.$,
      AgentTabs_SendCommand_ResponseParamsSpec.$,
      [
        tabId,
        method,
        paramsJson
      ],
      false
    );
  }
  closeTab(tabId) {
    return this.proxy.sendMessage(
      2,
      AgentTabs_CloseTab_ParamsSpec.$,
      AgentTabs_CloseTab_ResponseParamsSpec.$,
      [
        tabId
      ],
      false
    );
  }
  setClient(client) {
    this.proxy.sendMessage(
      3,
      AgentTabs_SetClient_ParamsSpec.$,
      null,
      [
        client
      ],
      false
    );
  }
};
var AgentTabsReceiver = class {
  helper_internal_;
  $;
  onConnectionError;
  constructor(impl) {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      AgentTabsRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.helper_internal_.registerHandler(
      0,
      AgentTabs_OpenTab_ParamsSpec.$,
      AgentTabs_OpenTab_ResponseParamsSpec.$,
      impl.openTab.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1,
      AgentTabs_SendCommand_ParamsSpec.$,
      AgentTabs_SendCommand_ResponseParamsSpec.$,
      impl.sendCommand.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      2,
      AgentTabs_CloseTab_ParamsSpec.$,
      AgentTabs_CloseTab_ResponseParamsSpec.$,
      impl.closeTab.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      3,
      AgentTabs_SetClient_ParamsSpec.$,
      null,
      impl.setClient.bind(impl),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
};
var AgentTabs = class {
  static get $interfaceName() {
    return "webdeck.mojom.AgentTabs";
  }
  /**
   * Returns a remote for this interface which sends messages to the browser.
   * The browser must have an interface request binder registered for this
   * interface and accessible to the calling document's frame.
   */
  static getRemote() {
    let remote = new AgentTabsRemote();
    remote.$.bindNewPipeAndPassReceiver().bindInBrowser();
    return remote;
  }
};
var AgentTabsCallbackRouter = class {
  helper_internal_;
  $;
  router_;
  openTab;
  sendCommand;
  closeTab;
  setClient;
  onConnectionError;
  constructor() {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      AgentTabsRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.router_ = new mojo.internal.interfaceSupport.CallbackRouter();
    this.openTab = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      0,
      AgentTabs_OpenTab_ParamsSpec.$,
      AgentTabs_OpenTab_ResponseParamsSpec.$,
      this.openTab.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.sendCommand = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1,
      AgentTabs_SendCommand_ParamsSpec.$,
      AgentTabs_SendCommand_ResponseParamsSpec.$,
      this.sendCommand.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.closeTab = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      2,
      AgentTabs_CloseTab_ParamsSpec.$,
      AgentTabs_CloseTab_ResponseParamsSpec.$,
      this.closeTab.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setClient = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      3,
      AgentTabs_SetClient_ParamsSpec.$,
      null,
      this.setClient.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
  /**
   * @param id An ID returned by a prior call to addListener.
   * @return True iff the identified listener was found and removed.
   */
  removeListener(id) {
    return this.router_.removeListener(id);
  }
};
var AgentTabsClientPendingReceiver = class {
  handle;
  constructor(handle) {
    this.handle = mojo.internal.interfaceSupport.getEndpointForReceiver(handle);
  }
  bindInBrowser(scope = "context") {
    mojo.internal.interfaceSupport.bind(
      this.handle,
      "webdeck.mojom.AgentTabsClient",
      scope
    );
  }
};
var AgentTabsClientRemote = class {
  proxy;
  $;
  onConnectionError;
  constructor(handle) {
    this.proxy = new mojo.internal.interfaceSupport.InterfaceRemoteBase(
      AgentTabsClientPendingReceiver,
      handle
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceRemoteBaseWrapper(this.proxy);
    this.onConnectionError = this.proxy.getConnectionErrorEventRouter();
  }
  onEvent(tabId, method, paramsJson) {
    this.proxy.sendMessage(
      0,
      AgentTabsClient_OnEvent_ParamsSpec.$,
      null,
      [
        tabId,
        method,
        paramsJson
      ],
      false
    );
  }
  onDetached(tabId) {
    this.proxy.sendMessage(
      1,
      AgentTabsClient_OnDetached_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
};
var AgentTabsClientReceiver = class {
  helper_internal_;
  $;
  onConnectionError;
  constructor(impl) {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      AgentTabsClientRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.helper_internal_.registerHandler(
      0,
      AgentTabsClient_OnEvent_ParamsSpec.$,
      null,
      impl.onEvent.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1,
      AgentTabsClient_OnDetached_ParamsSpec.$,
      null,
      impl.onDetached.bind(impl),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
};
var AgentTabsClient = class {
  static get $interfaceName() {
    return "webdeck.mojom.AgentTabsClient";
  }
  /**
   * Returns a remote for this interface which sends messages to the browser.
   * The browser must have an interface request binder registered for this
   * interface and accessible to the calling document's frame.
   */
  static getRemote() {
    let remote = new AgentTabsClientRemote();
    remote.$.bindNewPipeAndPassReceiver().bindInBrowser();
    return remote;
  }
};
var AgentTabsClientCallbackRouter = class {
  helper_internal_;
  $;
  router_;
  onEvent;
  onDetached;
  onConnectionError;
  constructor() {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      AgentTabsClientRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.router_ = new mojo.internal.interfaceSupport.CallbackRouter();
    this.onEvent = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      0,
      AgentTabsClient_OnEvent_ParamsSpec.$,
      null,
      this.onEvent.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onDetached = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1,
      AgentTabsClient_OnDetached_ParamsSpec.$,
      null,
      this.onDetached.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
  /**
   * @param id An ID returned by a prior call to addListener.
   * @return True iff the identified listener was found and removed.
   */
  removeListener(id) {
    return this.router_.removeListener(id);
  }
};
var ShellPendingReceiver = class {
  handle;
  constructor(handle) {
    this.handle = mojo.internal.interfaceSupport.getEndpointForReceiver(handle);
  }
  bindInBrowser(scope = "context") {
    mojo.internal.interfaceSupport.bind(
      this.handle,
      "webdeck.mojom.Shell",
      scope
    );
  }
};
var ShellRemote = class {
  proxy;
  $;
  onConnectionError;
  constructor(handle) {
    this.proxy = new mojo.internal.interfaceSupport.InterfaceRemoteBase(
      ShellPendingReceiver,
      handle
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceRemoteBaseWrapper(this.proxy);
    this.onConnectionError = this.proxy.getConnectionErrorEventRouter();
  }
  setStageBounds(stage) {
    this.proxy.sendMessage(
      0,
      Shell_SetStageBounds_ParamsSpec.$,
      null,
      [
        stage
      ],
      false
    );
  }
  setSplit(enabled, primaryTabId, secondaryTabId) {
    this.proxy.sendMessage(
      1,
      Shell_SetSplit_ParamsSpec.$,
      null,
      [
        enabled,
        primaryTabId,
        secondaryTabId
      ],
      false
    );
  }
  setSecondaryStageBounds(stage) {
    this.proxy.sendMessage(
      2,
      Shell_SetSecondaryStageBounds_ParamsSpec.$,
      null,
      [
        stage
      ],
      false
    );
  }
  createTab(url) {
    return this.proxy.sendMessage(
      3,
      Shell_CreateTab_ParamsSpec.$,
      Shell_CreateTab_ResponseParamsSpec.$,
      [
        url
      ],
      false
    );
  }
  selectTab(tabId) {
    this.proxy.sendMessage(
      4,
      Shell_SelectTab_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  closeTab(tabId) {
    this.proxy.sendMessage(
      5,
      Shell_CloseTab_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  navigate(tabId, url) {
    this.proxy.sendMessage(
      6,
      Shell_Navigate_ParamsSpec.$,
      null,
      [
        tabId,
        url
      ],
      false
    );
  }
  reload(tabId) {
    this.proxy.sendMessage(
      7,
      Shell_Reload_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  goBack(tabId) {
    this.proxy.sendMessage(
      8,
      Shell_GoBack_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  goForward(tabId) {
    this.proxy.sendMessage(
      9,
      Shell_GoForward_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  stop(tabId) {
    this.proxy.sendMessage(
      10,
      Shell_Stop_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  setStageCornerRadius(radius) {
    this.proxy.sendMessage(
      11,
      Shell_SetStageCornerRadius_ParamsSpec.$,
      null,
      [
        radius
      ],
      false
    );
  }
  find(tabId, query, forward) {
    this.proxy.sendMessage(
      12,
      Shell_Find_ParamsSpec.$,
      null,
      [
        tabId,
        query,
        forward
      ],
      false
    );
  }
  stopFind(tabId) {
    this.proxy.sendMessage(
      13,
      Shell_StopFind_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  setZoom(tabId, level) {
    return this.proxy.sendMessage(
      14,
      Shell_SetZoom_ParamsSpec.$,
      Shell_SetZoom_ResponseParamsSpec.$,
      [
        tabId,
        level
      ],
      false
    );
  }
  print(tabId) {
    this.proxy.sendMessage(
      15,
      Shell_Print_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  openDevTools(tabId) {
    this.proxy.sendMessage(
      16,
      Shell_OpenDevTools_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  togglePictureInPicture(tabId) {
    this.proxy.sendMessage(
      17,
      Shell_TogglePictureInPicture_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  getPageText(tabId) {
    return this.proxy.sendMessage(
      18,
      Shell_GetPageText_ParamsSpec.$,
      Shell_GetPageText_ResponseParamsSpec.$,
      [
        tabId
      ],
      false
    );
  }
  getBlockThirdPartyCookies() {
    return this.proxy.sendMessage(
      19,
      Shell_GetBlockThirdPartyCookies_ParamsSpec.$,
      Shell_GetBlockThirdPartyCookies_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setBlockThirdPartyCookies(blocked) {
    this.proxy.sendMessage(
      20,
      Shell_SetBlockThirdPartyCookies_ParamsSpec.$,
      null,
      [
        blocked
      ],
      false
    );
  }
  getSendDoNotTrack() {
    return this.proxy.sendMessage(
      21,
      Shell_GetSendDoNotTrack_ParamsSpec.$,
      Shell_GetSendDoNotTrack_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setSendDoNotTrack(enabled) {
    this.proxy.sendMessage(
      22,
      Shell_SetSendDoNotTrack_ParamsSpec.$,
      null,
      [
        enabled
      ],
      false
    );
  }
  getHttpsOnlyMode() {
    return this.proxy.sendMessage(
      23,
      Shell_GetHttpsOnlyMode_ParamsSpec.$,
      Shell_GetHttpsOnlyMode_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setHttpsOnlyMode(enabled) {
    this.proxy.sendMessage(
      24,
      Shell_SetHttpsOnlyMode_ParamsSpec.$,
      null,
      [
        enabled
      ],
      false
    );
  }
  getPreloadPages() {
    return this.proxy.sendMessage(
      25,
      Shell_GetPreloadPages_ParamsSpec.$,
      Shell_GetPreloadPages_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setPreloadPages(enabled) {
    this.proxy.sendMessage(
      26,
      Shell_SetPreloadPages_ParamsSpec.$,
      null,
      [
        enabled
      ],
      false
    );
  }
  getAdblockEnabled() {
    return this.proxy.sendMessage(
      27,
      Shell_GetAdblockEnabled_ParamsSpec.$,
      Shell_GetAdblockEnabled_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setAdblockEnabled(enabled) {
    this.proxy.sendMessage(
      28,
      Shell_SetAdblockEnabled_ParamsSpec.$,
      null,
      [
        enabled
      ],
      false
    );
  }
  getAdblockBlockedCount() {
    return this.proxy.sendMessage(
      29,
      Shell_GetAdblockBlockedCount_ParamsSpec.$,
      Shell_GetAdblockBlockedCount_ResponseParamsSpec.$,
      [],
      false
    );
  }
  clearBrowsingData(cookies, cache, history, timeRange) {
    return this.proxy.sendMessage(
      30,
      Shell_ClearBrowsingData_ParamsSpec.$,
      Shell_ClearBrowsingData_ResponseParamsSpec.$,
      [
        cookies,
        cache,
        history,
        timeRange
      ],
      false
    );
  }
  getDefaultBrowserState() {
    return this.proxy.sendMessage(
      31,
      Shell_GetDefaultBrowserState_ParamsSpec.$,
      Shell_GetDefaultBrowserState_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setAsDefaultBrowser() {
    return this.proxy.sendMessage(
      32,
      Shell_SetAsDefaultBrowser_ParamsSpec.$,
      Shell_SetAsDefaultBrowser_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setClient(client) {
    this.proxy.sendMessage(
      33,
      Shell_SetClient_ParamsSpec.$,
      null,
      [
        client
      ],
      false
    );
  }
};
var ShellReceiver = class {
  helper_internal_;
  $;
  onConnectionError;
  constructor(impl) {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      ShellRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.helper_internal_.registerHandler(
      0,
      Shell_SetStageBounds_ParamsSpec.$,
      null,
      impl.setStageBounds.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1,
      Shell_SetSplit_ParamsSpec.$,
      null,
      impl.setSplit.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      2,
      Shell_SetSecondaryStageBounds_ParamsSpec.$,
      null,
      impl.setSecondaryStageBounds.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      3,
      Shell_CreateTab_ParamsSpec.$,
      Shell_CreateTab_ResponseParamsSpec.$,
      impl.createTab.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      4,
      Shell_SelectTab_ParamsSpec.$,
      null,
      impl.selectTab.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      5,
      Shell_CloseTab_ParamsSpec.$,
      null,
      impl.closeTab.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      6,
      Shell_Navigate_ParamsSpec.$,
      null,
      impl.navigate.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      7,
      Shell_Reload_ParamsSpec.$,
      null,
      impl.reload.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      8,
      Shell_GoBack_ParamsSpec.$,
      null,
      impl.goBack.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      9,
      Shell_GoForward_ParamsSpec.$,
      null,
      impl.goForward.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      10,
      Shell_Stop_ParamsSpec.$,
      null,
      impl.stop.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      11,
      Shell_SetStageCornerRadius_ParamsSpec.$,
      null,
      impl.setStageCornerRadius.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      12,
      Shell_Find_ParamsSpec.$,
      null,
      impl.find.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      13,
      Shell_StopFind_ParamsSpec.$,
      null,
      impl.stopFind.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      14,
      Shell_SetZoom_ParamsSpec.$,
      Shell_SetZoom_ResponseParamsSpec.$,
      impl.setZoom.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      15,
      Shell_Print_ParamsSpec.$,
      null,
      impl.print.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      16,
      Shell_OpenDevTools_ParamsSpec.$,
      null,
      impl.openDevTools.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      17,
      Shell_TogglePictureInPicture_ParamsSpec.$,
      null,
      impl.togglePictureInPicture.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      18,
      Shell_GetPageText_ParamsSpec.$,
      Shell_GetPageText_ResponseParamsSpec.$,
      impl.getPageText.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      19,
      Shell_GetBlockThirdPartyCookies_ParamsSpec.$,
      Shell_GetBlockThirdPartyCookies_ResponseParamsSpec.$,
      impl.getBlockThirdPartyCookies.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      20,
      Shell_SetBlockThirdPartyCookies_ParamsSpec.$,
      null,
      impl.setBlockThirdPartyCookies.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      21,
      Shell_GetSendDoNotTrack_ParamsSpec.$,
      Shell_GetSendDoNotTrack_ResponseParamsSpec.$,
      impl.getSendDoNotTrack.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      22,
      Shell_SetSendDoNotTrack_ParamsSpec.$,
      null,
      impl.setSendDoNotTrack.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      23,
      Shell_GetHttpsOnlyMode_ParamsSpec.$,
      Shell_GetHttpsOnlyMode_ResponseParamsSpec.$,
      impl.getHttpsOnlyMode.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      24,
      Shell_SetHttpsOnlyMode_ParamsSpec.$,
      null,
      impl.setHttpsOnlyMode.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      25,
      Shell_GetPreloadPages_ParamsSpec.$,
      Shell_GetPreloadPages_ResponseParamsSpec.$,
      impl.getPreloadPages.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      26,
      Shell_SetPreloadPages_ParamsSpec.$,
      null,
      impl.setPreloadPages.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      27,
      Shell_GetAdblockEnabled_ParamsSpec.$,
      Shell_GetAdblockEnabled_ResponseParamsSpec.$,
      impl.getAdblockEnabled.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      28,
      Shell_SetAdblockEnabled_ParamsSpec.$,
      null,
      impl.setAdblockEnabled.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      29,
      Shell_GetAdblockBlockedCount_ParamsSpec.$,
      Shell_GetAdblockBlockedCount_ResponseParamsSpec.$,
      impl.getAdblockBlockedCount.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      30,
      Shell_ClearBrowsingData_ParamsSpec.$,
      Shell_ClearBrowsingData_ResponseParamsSpec.$,
      impl.clearBrowsingData.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      31,
      Shell_GetDefaultBrowserState_ParamsSpec.$,
      Shell_GetDefaultBrowserState_ResponseParamsSpec.$,
      impl.getDefaultBrowserState.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      32,
      Shell_SetAsDefaultBrowser_ParamsSpec.$,
      Shell_SetAsDefaultBrowser_ResponseParamsSpec.$,
      impl.setAsDefaultBrowser.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      33,
      Shell_SetClient_ParamsSpec.$,
      null,
      impl.setClient.bind(impl),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
};
var Shell = class {
  static get $interfaceName() {
    return "webdeck.mojom.Shell";
  }
  /**
   * Returns a remote for this interface which sends messages to the browser.
   * The browser must have an interface request binder registered for this
   * interface and accessible to the calling document's frame.
   */
  static getRemote() {
    let remote = new ShellRemote();
    remote.$.bindNewPipeAndPassReceiver().bindInBrowser();
    return remote;
  }
};
var ShellCallbackRouter = class {
  helper_internal_;
  $;
  router_;
  setStageBounds;
  setSplit;
  setSecondaryStageBounds;
  createTab;
  selectTab;
  closeTab;
  navigate;
  reload;
  goBack;
  goForward;
  stop;
  setStageCornerRadius;
  find;
  stopFind;
  setZoom;
  print;
  openDevTools;
  togglePictureInPicture;
  getPageText;
  getBlockThirdPartyCookies;
  setBlockThirdPartyCookies;
  getSendDoNotTrack;
  setSendDoNotTrack;
  getHttpsOnlyMode;
  setHttpsOnlyMode;
  getPreloadPages;
  setPreloadPages;
  getAdblockEnabled;
  setAdblockEnabled;
  getAdblockBlockedCount;
  clearBrowsingData;
  getDefaultBrowserState;
  setAsDefaultBrowser;
  setClient;
  onConnectionError;
  constructor() {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      ShellRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.router_ = new mojo.internal.interfaceSupport.CallbackRouter();
    this.setStageBounds = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      0,
      Shell_SetStageBounds_ParamsSpec.$,
      null,
      this.setStageBounds.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.setSplit = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1,
      Shell_SetSplit_ParamsSpec.$,
      null,
      this.setSplit.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.setSecondaryStageBounds = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      2,
      Shell_SetSecondaryStageBounds_ParamsSpec.$,
      null,
      this.setSecondaryStageBounds.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.createTab = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      3,
      Shell_CreateTab_ParamsSpec.$,
      Shell_CreateTab_ResponseParamsSpec.$,
      this.createTab.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.selectTab = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      4,
      Shell_SelectTab_ParamsSpec.$,
      null,
      this.selectTab.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.closeTab = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      5,
      Shell_CloseTab_ParamsSpec.$,
      null,
      this.closeTab.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.navigate = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      6,
      Shell_Navigate_ParamsSpec.$,
      null,
      this.navigate.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.reload = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      7,
      Shell_Reload_ParamsSpec.$,
      null,
      this.reload.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.goBack = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      8,
      Shell_GoBack_ParamsSpec.$,
      null,
      this.goBack.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.goForward = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      9,
      Shell_GoForward_ParamsSpec.$,
      null,
      this.goForward.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.stop = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      10,
      Shell_Stop_ParamsSpec.$,
      null,
      this.stop.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.setStageCornerRadius = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      11,
      Shell_SetStageCornerRadius_ParamsSpec.$,
      null,
      this.setStageCornerRadius.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.find = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      12,
      Shell_Find_ParamsSpec.$,
      null,
      this.find.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.stopFind = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      13,
      Shell_StopFind_ParamsSpec.$,
      null,
      this.stopFind.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.setZoom = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      14,
      Shell_SetZoom_ParamsSpec.$,
      Shell_SetZoom_ResponseParamsSpec.$,
      this.setZoom.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.print = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      15,
      Shell_Print_ParamsSpec.$,
      null,
      this.print.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.openDevTools = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      16,
      Shell_OpenDevTools_ParamsSpec.$,
      null,
      this.openDevTools.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.togglePictureInPicture = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      17,
      Shell_TogglePictureInPicture_ParamsSpec.$,
      null,
      this.togglePictureInPicture.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.getPageText = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      18,
      Shell_GetPageText_ParamsSpec.$,
      Shell_GetPageText_ResponseParamsSpec.$,
      this.getPageText.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.getBlockThirdPartyCookies = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      19,
      Shell_GetBlockThirdPartyCookies_ParamsSpec.$,
      Shell_GetBlockThirdPartyCookies_ResponseParamsSpec.$,
      this.getBlockThirdPartyCookies.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setBlockThirdPartyCookies = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      20,
      Shell_SetBlockThirdPartyCookies_ParamsSpec.$,
      null,
      this.setBlockThirdPartyCookies.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.getSendDoNotTrack = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      21,
      Shell_GetSendDoNotTrack_ParamsSpec.$,
      Shell_GetSendDoNotTrack_ResponseParamsSpec.$,
      this.getSendDoNotTrack.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setSendDoNotTrack = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      22,
      Shell_SetSendDoNotTrack_ParamsSpec.$,
      null,
      this.setSendDoNotTrack.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.getHttpsOnlyMode = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      23,
      Shell_GetHttpsOnlyMode_ParamsSpec.$,
      Shell_GetHttpsOnlyMode_ResponseParamsSpec.$,
      this.getHttpsOnlyMode.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setHttpsOnlyMode = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      24,
      Shell_SetHttpsOnlyMode_ParamsSpec.$,
      null,
      this.setHttpsOnlyMode.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.getPreloadPages = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      25,
      Shell_GetPreloadPages_ParamsSpec.$,
      Shell_GetPreloadPages_ResponseParamsSpec.$,
      this.getPreloadPages.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setPreloadPages = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      26,
      Shell_SetPreloadPages_ParamsSpec.$,
      null,
      this.setPreloadPages.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.getAdblockEnabled = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      27,
      Shell_GetAdblockEnabled_ParamsSpec.$,
      Shell_GetAdblockEnabled_ResponseParamsSpec.$,
      this.getAdblockEnabled.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setAdblockEnabled = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      28,
      Shell_SetAdblockEnabled_ParamsSpec.$,
      null,
      this.setAdblockEnabled.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.getAdblockBlockedCount = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      29,
      Shell_GetAdblockBlockedCount_ParamsSpec.$,
      Shell_GetAdblockBlockedCount_ResponseParamsSpec.$,
      this.getAdblockBlockedCount.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.clearBrowsingData = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      30,
      Shell_ClearBrowsingData_ParamsSpec.$,
      Shell_ClearBrowsingData_ResponseParamsSpec.$,
      this.clearBrowsingData.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.getDefaultBrowserState = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      31,
      Shell_GetDefaultBrowserState_ParamsSpec.$,
      Shell_GetDefaultBrowserState_ResponseParamsSpec.$,
      this.getDefaultBrowserState.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setAsDefaultBrowser = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      32,
      Shell_SetAsDefaultBrowser_ParamsSpec.$,
      Shell_SetAsDefaultBrowser_ResponseParamsSpec.$,
      this.setAsDefaultBrowser.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setClient = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      33,
      Shell_SetClient_ParamsSpec.$,
      null,
      this.setClient.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
  /**
   * @param id An ID returned by a prior call to addListener.
   * @return True iff the identified listener was found and removed.
   */
  removeListener(id) {
    return this.router_.removeListener(id);
  }
};
var ShellClientPendingReceiver = class {
  handle;
  constructor(handle) {
    this.handle = mojo.internal.interfaceSupport.getEndpointForReceiver(handle);
  }
  bindInBrowser(scope = "context") {
    mojo.internal.interfaceSupport.bind(
      this.handle,
      "webdeck.mojom.ShellClient",
      scope
    );
  }
};
var ShellClientRemote = class {
  proxy;
  $;
  onConnectionError;
  constructor(handle) {
    this.proxy = new mojo.internal.interfaceSupport.InterfaceRemoteBase(
      ShellClientPendingReceiver,
      handle
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceRemoteBaseWrapper(this.proxy);
    this.onConnectionError = this.proxy.getConnectionErrorEventRouter();
  }
  onTabsChanged(tabs, activeTabId) {
    this.proxy.sendMessage(
      0,
      ShellClient_OnTabsChanged_ParamsSpec.$,
      null,
      [
        tabs,
        activeTabId
      ],
      false
    );
  }
  onTabNavigationStateChanged(info) {
    this.proxy.sendMessage(
      1,
      ShellClient_OnTabNavigationStateChanged_ParamsSpec.$,
      null,
      [
        info
      ],
      false
    );
  }
  onTabClosed(tabId) {
    this.proxy.sendMessage(
      2,
      ShellClient_OnTabClosed_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  onFindResult(tabId, activeMatch, totalMatches) {
    this.proxy.sendMessage(
      3,
      ShellClient_OnFindResult_ParamsSpec.$,
      null,
      [
        tabId,
        activeMatch,
        totalMatches
      ],
      false
    );
  }
};
var ShellClientReceiver = class {
  helper_internal_;
  $;
  onConnectionError;
  constructor(impl) {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      ShellClientRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.helper_internal_.registerHandler(
      0,
      ShellClient_OnTabsChanged_ParamsSpec.$,
      null,
      impl.onTabsChanged.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1,
      ShellClient_OnTabNavigationStateChanged_ParamsSpec.$,
      null,
      impl.onTabNavigationStateChanged.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      2,
      ShellClient_OnTabClosed_ParamsSpec.$,
      null,
      impl.onTabClosed.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      3,
      ShellClient_OnFindResult_ParamsSpec.$,
      null,
      impl.onFindResult.bind(impl),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
};
var ShellClient = class {
  static get $interfaceName() {
    return "webdeck.mojom.ShellClient";
  }
  /**
   * Returns a remote for this interface which sends messages to the browser.
   * The browser must have an interface request binder registered for this
   * interface and accessible to the calling document's frame.
   */
  static getRemote() {
    let remote = new ShellClientRemote();
    remote.$.bindNewPipeAndPassReceiver().bindInBrowser();
    return remote;
  }
};
var ShellClientCallbackRouter = class {
  helper_internal_;
  $;
  router_;
  onTabsChanged;
  onTabNavigationStateChanged;
  onTabClosed;
  onFindResult;
  onConnectionError;
  constructor() {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      ShellClientRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.router_ = new mojo.internal.interfaceSupport.CallbackRouter();
    this.onTabsChanged = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      0,
      ShellClient_OnTabsChanged_ParamsSpec.$,
      null,
      this.onTabsChanged.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onTabNavigationStateChanged = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1,
      ShellClient_OnTabNavigationStateChanged_ParamsSpec.$,
      null,
      this.onTabNavigationStateChanged.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onTabClosed = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      2,
      ShellClient_OnTabClosed_ParamsSpec.$,
      null,
      this.onTabClosed.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onFindResult = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      3,
      ShellClient_OnFindResult_ParamsSpec.$,
      null,
      this.onFindResult.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
  /**
   * @param id An ID returned by a prior call to addListener.
   * @return True iff the identified listener was found and removed.
   */
  removeListener(id) {
    return this.router_.removeListener(id);
  }
};
var TabInfoSpec = { $: {} };
var AgentTabs_OpenTab_ParamsSpec = { $: {} };
var AgentTabs_OpenTab_ResponseParamsSpec = { $: {} };
var AgentTabs_SendCommand_ParamsSpec = { $: {} };
var AgentTabs_SendCommand_ResponseParamsSpec = { $: {} };
var AgentTabs_CloseTab_ParamsSpec = { $: {} };
var AgentTabs_CloseTab_ResponseParamsSpec = { $: {} };
var AgentTabs_SetClient_ParamsSpec = { $: {} };
var AgentTabsClient_OnEvent_ParamsSpec = { $: {} };
var AgentTabsClient_OnDetached_ParamsSpec = { $: {} };
var Shell_SetStageBounds_ParamsSpec = { $: {} };
var Shell_SetSplit_ParamsSpec = { $: {} };
var Shell_SetSecondaryStageBounds_ParamsSpec = { $: {} };
var Shell_CreateTab_ParamsSpec = { $: {} };
var Shell_CreateTab_ResponseParamsSpec = { $: {} };
var Shell_SelectTab_ParamsSpec = { $: {} };
var Shell_CloseTab_ParamsSpec = { $: {} };
var Shell_Navigate_ParamsSpec = { $: {} };
var Shell_Reload_ParamsSpec = { $: {} };
var Shell_GoBack_ParamsSpec = { $: {} };
var Shell_GoForward_ParamsSpec = { $: {} };
var Shell_Stop_ParamsSpec = { $: {} };
var Shell_SetStageCornerRadius_ParamsSpec = { $: {} };
var Shell_Find_ParamsSpec = { $: {} };
var Shell_StopFind_ParamsSpec = { $: {} };
var Shell_SetZoom_ParamsSpec = { $: {} };
var Shell_SetZoom_ResponseParamsSpec = { $: {} };
var Shell_Print_ParamsSpec = { $: {} };
var Shell_OpenDevTools_ParamsSpec = { $: {} };
var Shell_TogglePictureInPicture_ParamsSpec = { $: {} };
var Shell_GetPageText_ParamsSpec = { $: {} };
var Shell_GetPageText_ResponseParamsSpec = { $: {} };
var Shell_GetBlockThirdPartyCookies_ParamsSpec = { $: {} };
var Shell_GetBlockThirdPartyCookies_ResponseParamsSpec = { $: {} };
var Shell_SetBlockThirdPartyCookies_ParamsSpec = { $: {} };
var Shell_GetSendDoNotTrack_ParamsSpec = { $: {} };
var Shell_GetSendDoNotTrack_ResponseParamsSpec = { $: {} };
var Shell_SetSendDoNotTrack_ParamsSpec = { $: {} };
var Shell_GetHttpsOnlyMode_ParamsSpec = { $: {} };
var Shell_GetHttpsOnlyMode_ResponseParamsSpec = { $: {} };
var Shell_SetHttpsOnlyMode_ParamsSpec = { $: {} };
var Shell_GetPreloadPages_ParamsSpec = { $: {} };
var Shell_GetPreloadPages_ResponseParamsSpec = { $: {} };
var Shell_SetPreloadPages_ParamsSpec = { $: {} };
var Shell_GetAdblockEnabled_ParamsSpec = { $: {} };
var Shell_GetAdblockEnabled_ResponseParamsSpec = { $: {} };
var Shell_SetAdblockEnabled_ParamsSpec = { $: {} };
var Shell_GetAdblockBlockedCount_ParamsSpec = { $: {} };
var Shell_GetAdblockBlockedCount_ResponseParamsSpec = { $: {} };
var Shell_ClearBrowsingData_ParamsSpec = { $: {} };
var Shell_ClearBrowsingData_ResponseParamsSpec = { $: {} };
var Shell_GetDefaultBrowserState_ParamsSpec = { $: {} };
var Shell_GetDefaultBrowserState_ResponseParamsSpec = { $: {} };
var Shell_SetAsDefaultBrowser_ParamsSpec = { $: {} };
var Shell_SetAsDefaultBrowser_ResponseParamsSpec = { $: {} };
var Shell_SetClient_ParamsSpec = { $: {} };
var ShellClient_OnTabsChanged_ParamsSpec = { $: {} };
var ShellClient_OnTabNavigationStateChanged_ParamsSpec = { $: {} };
var ShellClient_OnTabClosed_ParamsSpec = { $: {} };
var ShellClient_OnFindResult_ParamsSpec = { $: {} };
mojo.internal.Struct(
  TabInfoSpec.$,
  "TabInfo",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "url",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "title",
      16,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "canGoBack",
      4,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "canGoForward",
      4,
      1,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "isLoading",
      4,
      2,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 32]]
);
mojo.internal.Struct(
  AgentTabs_OpenTab_ParamsSpec.$,
  "AgentTabs_OpenTab_Params",
  [
    mojo.internal.StructField(
      "url",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  AgentTabs_OpenTab_ResponseParamsSpec.$,
  "AgentTabs_OpenTab_ResponseParams",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "error",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  AgentTabs_SendCommand_ParamsSpec.$,
  "AgentTabs_SendCommand_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "method",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "paramsJson",
      16,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 32]]
);
mojo.internal.Struct(
  AgentTabs_SendCommand_ResponseParamsSpec.$,
  "AgentTabs_SendCommand_ResponseParams",
  [
    mojo.internal.StructField(
      "resultJson",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "error",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  AgentTabs_CloseTab_ParamsSpec.$,
  "AgentTabs_CloseTab_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  AgentTabs_CloseTab_ResponseParamsSpec.$,
  "AgentTabs_CloseTab_ResponseParams",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  AgentTabs_SetClient_ParamsSpec.$,
  "AgentTabs_SetClient_Params",
  [
    mojo.internal.StructField(
      "client",
      0,
      0,
      mojo.internal.InterfaceProxy(AgentTabsClientRemote),
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  AgentTabsClient_OnEvent_ParamsSpec.$,
  "AgentTabsClient_OnEvent_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "method",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "paramsJson",
      16,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 32]]
);
mojo.internal.Struct(
  AgentTabsClient_OnDetached_ParamsSpec.$,
  "AgentTabsClient_OnDetached_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetStageBounds_ParamsSpec.$,
  "Shell_SetStageBounds_Params",
  [
    mojo.internal.StructField(
      "stage",
      0,
      0,
      gfx_mojom_RectSpec.$,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetSplit_ParamsSpec.$,
  "Shell_SetSplit_Params",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "primaryTabId",
      4,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "secondaryTabId",
      8,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  Shell_SetSecondaryStageBounds_ParamsSpec.$,
  "Shell_SetSecondaryStageBounds_Params",
  [
    mojo.internal.StructField(
      "stage",
      0,
      0,
      gfx_mojom_RectSpec.$,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_CreateTab_ParamsSpec.$,
  "Shell_CreateTab_Params",
  [
    mojo.internal.StructField(
      "url",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_CreateTab_ResponseParamsSpec.$,
  "Shell_CreateTab_ResponseParams",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SelectTab_ParamsSpec.$,
  "Shell_SelectTab_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_CloseTab_ParamsSpec.$,
  "Shell_CloseTab_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_Navigate_ParamsSpec.$,
  "Shell_Navigate_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "url",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  Shell_Reload_ParamsSpec.$,
  "Shell_Reload_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GoBack_ParamsSpec.$,
  "Shell_GoBack_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GoForward_ParamsSpec.$,
  "Shell_GoForward_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_Stop_ParamsSpec.$,
  "Shell_Stop_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetStageCornerRadius_ParamsSpec.$,
  "Shell_SetStageCornerRadius_Params",
  [
    mojo.internal.StructField(
      "radius",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_Find_ParamsSpec.$,
  "Shell_Find_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "query",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "forward",
      4,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  Shell_StopFind_ParamsSpec.$,
  "Shell_StopFind_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetZoom_ParamsSpec.$,
  "Shell_SetZoom_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "level",
      8,
      0,
      mojo.internal.Double,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  Shell_SetZoom_ResponseParamsSpec.$,
  "Shell_SetZoom_ResponseParams",
  [
    mojo.internal.StructField(
      "applied",
      0,
      0,
      mojo.internal.Double,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_Print_ParamsSpec.$,
  "Shell_Print_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_OpenDevTools_ParamsSpec.$,
  "Shell_OpenDevTools_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_TogglePictureInPicture_ParamsSpec.$,
  "Shell_TogglePictureInPicture_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetPageText_ParamsSpec.$,
  "Shell_GetPageText_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetPageText_ResponseParamsSpec.$,
  "Shell_GetPageText_ResponseParams",
  [
    mojo.internal.StructField(
      "text",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetBlockThirdPartyCookies_ParamsSpec.$,
  "Shell_GetBlockThirdPartyCookies_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetBlockThirdPartyCookies_ResponseParamsSpec.$,
  "Shell_GetBlockThirdPartyCookies_ResponseParams",
  [
    mojo.internal.StructField(
      "blocked",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetBlockThirdPartyCookies_ParamsSpec.$,
  "Shell_SetBlockThirdPartyCookies_Params",
  [
    mojo.internal.StructField(
      "blocked",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetSendDoNotTrack_ParamsSpec.$,
  "Shell_GetSendDoNotTrack_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetSendDoNotTrack_ResponseParamsSpec.$,
  "Shell_GetSendDoNotTrack_ResponseParams",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetSendDoNotTrack_ParamsSpec.$,
  "Shell_SetSendDoNotTrack_Params",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetHttpsOnlyMode_ParamsSpec.$,
  "Shell_GetHttpsOnlyMode_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetHttpsOnlyMode_ResponseParamsSpec.$,
  "Shell_GetHttpsOnlyMode_ResponseParams",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetHttpsOnlyMode_ParamsSpec.$,
  "Shell_SetHttpsOnlyMode_Params",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetPreloadPages_ParamsSpec.$,
  "Shell_GetPreloadPages_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetPreloadPages_ResponseParamsSpec.$,
  "Shell_GetPreloadPages_ResponseParams",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetPreloadPages_ParamsSpec.$,
  "Shell_SetPreloadPages_Params",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetAdblockEnabled_ParamsSpec.$,
  "Shell_GetAdblockEnabled_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetAdblockEnabled_ResponseParamsSpec.$,
  "Shell_GetAdblockEnabled_ResponseParams",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetAdblockEnabled_ParamsSpec.$,
  "Shell_SetAdblockEnabled_Params",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetAdblockBlockedCount_ParamsSpec.$,
  "Shell_GetAdblockBlockedCount_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetAdblockBlockedCount_ResponseParamsSpec.$,
  "Shell_GetAdblockBlockedCount_ResponseParams",
  [
    mojo.internal.StructField(
      "count",
      0,
      0,
      mojo.internal.Uint64,
      BigInt(0),
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_ClearBrowsingData_ParamsSpec.$,
  "Shell_ClearBrowsingData_Params",
  [
    mojo.internal.StructField(
      "cookies",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "cache",
      0,
      1,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "history",
      0,
      2,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "timeRange",
      4,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_ClearBrowsingData_ResponseParamsSpec.$,
  "Shell_ClearBrowsingData_ResponseParams",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetDefaultBrowserState_ParamsSpec.$,
  "Shell_GetDefaultBrowserState_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetDefaultBrowserState_ResponseParamsSpec.$,
  "Shell_GetDefaultBrowserState_ResponseParams",
  [
    mojo.internal.StructField(
      "state",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetAsDefaultBrowser_ParamsSpec.$,
  "Shell_SetAsDefaultBrowser_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_SetAsDefaultBrowser_ResponseParamsSpec.$,
  "Shell_SetAsDefaultBrowser_ResponseParams",
  [
    mojo.internal.StructField(
      "state",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetClient_ParamsSpec.$,
  "Shell_SetClient_Params",
  [
    mojo.internal.StructField(
      "client",
      0,
      0,
      mojo.internal.InterfaceProxy(ShellClientRemote),
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  ShellClient_OnTabsChanged_ParamsSpec.$,
  "ShellClient_OnTabsChanged_Params",
  [
    mojo.internal.StructField(
      "tabs",
      0,
      0,
      mojo.internal.Array(TabInfoSpec.$, false),
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "activeTabId",
      8,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  ShellClient_OnTabNavigationStateChanged_ParamsSpec.$,
  "ShellClient_OnTabNavigationStateChanged_Params",
  [
    mojo.internal.StructField(
      "info",
      0,
      0,
      TabInfoSpec.$,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  ShellClient_OnTabClosed_ParamsSpec.$,
  "ShellClient_OnTabClosed_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  ShellClient_OnFindResult_ParamsSpec.$,
  "ShellClient_OnFindResult_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "activeMatch",
      4,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "totalMatches",
      8,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
export {
  AgentTabs,
  AgentTabsCallbackRouter,
  AgentTabsClient,
  AgentTabsClientCallbackRouter,
  AgentTabsClientPendingReceiver,
  AgentTabsClientReceiver,
  AgentTabsClientRemote,
  AgentTabsClient_OnDetached_ParamsSpec,
  AgentTabsClient_OnEvent_ParamsSpec,
  AgentTabsPendingReceiver,
  AgentTabsReceiver,
  AgentTabsRemote,
  AgentTabs_CloseTab_ParamsSpec,
  AgentTabs_CloseTab_ResponseParamsSpec,
  AgentTabs_OpenTab_ParamsSpec,
  AgentTabs_OpenTab_ResponseParamsSpec,
  AgentTabs_SendCommand_ParamsSpec,
  AgentTabs_SendCommand_ResponseParamsSpec,
  AgentTabs_SetClient_ParamsSpec,
  Shell,
  ShellCallbackRouter,
  ShellClient,
  ShellClientCallbackRouter,
  ShellClientPendingReceiver,
  ShellClientReceiver,
  ShellClientRemote,
  ShellClient_OnFindResult_ParamsSpec,
  ShellClient_OnTabClosed_ParamsSpec,
  ShellClient_OnTabNavigationStateChanged_ParamsSpec,
  ShellClient_OnTabsChanged_ParamsSpec,
  ShellPendingReceiver,
  ShellReceiver,
  ShellRemote,
  Shell_ClearBrowsingData_ParamsSpec,
  Shell_ClearBrowsingData_ResponseParamsSpec,
  Shell_CloseTab_ParamsSpec,
  Shell_CreateTab_ParamsSpec,
  Shell_CreateTab_ResponseParamsSpec,
  Shell_Find_ParamsSpec,
  Shell_GetAdblockBlockedCount_ParamsSpec,
  Shell_GetAdblockBlockedCount_ResponseParamsSpec,
  Shell_GetAdblockEnabled_ParamsSpec,
  Shell_GetAdblockEnabled_ResponseParamsSpec,
  Shell_GetBlockThirdPartyCookies_ParamsSpec,
  Shell_GetBlockThirdPartyCookies_ResponseParamsSpec,
  Shell_GetDefaultBrowserState_ParamsSpec,
  Shell_GetDefaultBrowserState_ResponseParamsSpec,
  Shell_GetHttpsOnlyMode_ParamsSpec,
  Shell_GetHttpsOnlyMode_ResponseParamsSpec,
  Shell_GetPageText_ParamsSpec,
  Shell_GetPageText_ResponseParamsSpec,
  Shell_GetPreloadPages_ParamsSpec,
  Shell_GetPreloadPages_ResponseParamsSpec,
  Shell_GetSendDoNotTrack_ParamsSpec,
  Shell_GetSendDoNotTrack_ResponseParamsSpec,
  Shell_GoBack_ParamsSpec,
  Shell_GoForward_ParamsSpec,
  Shell_Navigate_ParamsSpec,
  Shell_OpenDevTools_ParamsSpec,
  Shell_Print_ParamsSpec,
  Shell_Reload_ParamsSpec,
  Shell_SelectTab_ParamsSpec,
  Shell_SetAdblockEnabled_ParamsSpec,
  Shell_SetAsDefaultBrowser_ParamsSpec,
  Shell_SetAsDefaultBrowser_ResponseParamsSpec,
  Shell_SetBlockThirdPartyCookies_ParamsSpec,
  Shell_SetClient_ParamsSpec,
  Shell_SetHttpsOnlyMode_ParamsSpec,
  Shell_SetPreloadPages_ParamsSpec,
  Shell_SetSecondaryStageBounds_ParamsSpec,
  Shell_SetSendDoNotTrack_ParamsSpec,
  Shell_SetSplit_ParamsSpec,
  Shell_SetStageBounds_ParamsSpec,
  Shell_SetStageCornerRadius_ParamsSpec,
  Shell_SetZoom_ParamsSpec,
  Shell_SetZoom_ResponseParamsSpec,
  Shell_StopFind_ParamsSpec,
  Shell_Stop_ParamsSpec,
  Shell_TogglePictureInPicture_ParamsSpec,
  TabInfoSpec
};
