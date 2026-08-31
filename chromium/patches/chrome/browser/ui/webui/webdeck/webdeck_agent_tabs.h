// Copyright 2026 Arcwel. All rights reserved.
//
// Drives tabs in the user's own browsing session for chrome://webdeck, using
// the DevTools protocol in-process.
//
// In-process is the whole point. The other route to CDP against a real session
// is --remote-debugging-port, which is unauthenticated total control of the
// browser for any local process — upstream blocked it on the default profile
// after it was used for cookie theft. Here the protocol never leaves the
// browser process: no port, no socket, nothing else on the machine can reach it.

#ifndef CHROME_BROWSER_UI_WEBUI_WEBDECK_WEBDECK_AGENT_TABS_H_
#define CHROME_BROWSER_UI_WEBUI_WEBDECK_WEBDECK_AGENT_TABS_H_

#include <map>
#include <string>

#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "chrome/browser/ui/webui/webdeck/webdeck.mojom.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/devtools_agent_host_client.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"

class Profile;

namespace webdeck {

class WebDeckAgentTabs : public mojom::AgentTabs,
                         public content::DevToolsAgentHostClient {
 public:
  WebDeckAgentTabs(mojo::PendingReceiver<mojom::AgentTabs> receiver,
                   Profile* profile);
  WebDeckAgentTabs(const WebDeckAgentTabs&) = delete;
  WebDeckAgentTabs& operator=(const WebDeckAgentTabs&) = delete;
  ~WebDeckAgentTabs() override;

  // mojom::AgentTabs
  void OpenTab(const std::string& url, OpenTabCallback callback) override;
  void SendCommand(const std::string& tab_id,
                   const std::string& method,
                   const std::string& params_json,
                   SendCommandCallback callback) override;
  void CloseTab(const std::string& tab_id, CloseTabCallback callback) override;
  void SetClient(mojo::PendingRemote<mojom::AgentTabsClient> client) override;

  // content::DevToolsAgentHostClient
  void DispatchProtocolMessage(content::DevToolsAgentHost* agent_host,
                               base::span<const uint8_t> message) override;
  void AgentHostClosed(content::DevToolsAgentHost* agent_host) override;

 private:
  struct Tab {
    scoped_refptr<content::DevToolsAgentHost> host;
    // Protocol command ids we issued, mapped to the reply we owe the page.
    std::map<int, SendCommandCallback> pending;
    int next_command_id = 1;
  };

  // Our id for an attached host, or empty if it is not one of ours.
  std::string TabIdFor(content::DevToolsAgentHost* agent_host) const;
  void Detach(const std::string& tab_id);

  mojo::Receiver<mojom::AgentTabs> receiver_;
  mojo::Remote<mojom::AgentTabsClient> client_;
  raw_ptr<Profile> profile_;
  std::map<std::string, Tab> tabs_;
  int next_tab_id_ = 1;

  base::WeakPtrFactory<WebDeckAgentTabs> weak_factory_{this};
};

}  // namespace webdeck

#endif  // CHROME_BROWSER_UI_WEBUI_WEBDECK_WEBDECK_AGENT_TABS_H_
