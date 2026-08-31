// ../../../../../../../../../../Volumes/BG_Dev/webdeck-chromium/chromium/src/out/webdeck/gen/chrome/browser/ui/webui/webdeck/webdeck.mojom-webui.ts
import { mojo } from "//resources/mojo/mojo/public/js/bindings.js";
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
var AgentTabs_OpenTab_ParamsSpec = { $: {} };
var AgentTabs_OpenTab_ResponseParamsSpec = { $: {} };
var AgentTabs_SendCommand_ParamsSpec = { $: {} };
var AgentTabs_SendCommand_ResponseParamsSpec = { $: {} };
var AgentTabs_CloseTab_ParamsSpec = { $: {} };
var AgentTabs_CloseTab_ResponseParamsSpec = { $: {} };
var AgentTabs_SetClient_ParamsSpec = { $: {} };
var AgentTabsClient_OnEvent_ParamsSpec = { $: {} };
var AgentTabsClient_OnDetached_ParamsSpec = { $: {} };
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
  AgentTabs_SetClient_ParamsSpec
};
