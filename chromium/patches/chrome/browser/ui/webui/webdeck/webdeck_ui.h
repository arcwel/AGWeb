// Copyright 2026 Arcwel. All rights reserved.
//
// chrome://webdeck — the Arcwel WebDeck surface.
//
// This is the fork's half of the WebDeck bridge. The IDE/agent logic does not
// live here: it runs in `webdeck-core`, a separate Node process the browser
// spawns, which serves every domain (files, editor config, terminal, LSP, DAP,
// git, tasks, search, agent, policy, sync) over a loopback WebSocket. This page
// hosts the WebDeck UI and connects to that socket; the port is handed to the
// page as `window.WEBDECK_CORE_PORT` because it is ephemeral by default.

#ifndef CHROME_BROWSER_UI_WEBUI_WEBDECK_WEBDECK_UI_H_
#define CHROME_BROWSER_UI_WEBUI_WEBDECK_WEBDECK_UI_H_

#include <memory>

#include "chrome/browser/ui/webui/webdeck/webdeck.mojom.h"
#include "chrome/common/webui_url_constants.h"
#include "content/public/browser/web_ui_controller.h"
#include "content/public/browser/webui_config.h"
#include "content/public/common/url_constants.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"

namespace webdeck {
class WebDeckAgentTabs;
}

class WebDeckUI;

class WebDeckUIConfig : public content::DefaultWebUIConfig<WebDeckUI> {
 public:
  WebDeckUIConfig();
  ~WebDeckUIConfig() override;
};

// Hosts the WebDeck application page.
class WebDeckUI : public content::WebUIController {
 public:
  explicit WebDeckUI(content::WebUI* web_ui);

  WebDeckUI(const WebDeckUI&) = delete;
  WebDeckUI& operator=(const WebDeckUI&) = delete;

  ~WebDeckUI() override;

  // Lets the page drive tabs in the user's own session on the agent's behalf.
  // Bound only for this WebUI, so the interface is unreachable from anywhere
  // else in the browser.
  void BindInterface(
      mojo::PendingReceiver<webdeck::mojom::AgentTabs> receiver);

 private:
  std::unique_ptr<webdeck::WebDeckAgentTabs> agent_tabs_;

  WEB_UI_CONTROLLER_TYPE_DECL();
};

#endif  // CHROME_BROWSER_UI_WEBUI_WEBDECK_WEBDECK_UI_H_
