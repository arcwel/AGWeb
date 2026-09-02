// Copyright 2026 Arcwel. All rights reserved.

#include "chrome/browser/ui/webui/webdeck/webdeck_agent_tabs.h"

#include <algorithm>
#include <array>
#include <ranges>
#include <string_view>
#include <utility>

#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/values.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/profile_browser_collection.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/page_transition_types.h"
#include "url/gurl.h"

namespace webdeck {
namespace {

// Schemes the agent may open. The core enforces the same allowlist before it
// ever gets here; this is the second half of that check, on the side of the
// boundary that actually performs the navigation. A page that talked to this
// interface directly must not get a wider reach than the agent has.
//
// file: is deliberately NOT here. With it, OpenTab("file:///etc/passwd")
// followed by a read is arbitrary local file disclosure — a second way around
// the workspace pin that the agent's own read_file enforces. The agent has
// tools for reading files; this interface is for the web.
bool IsAllowedScheme(const GURL& url) {
  return url.SchemeIs(url::kHttpScheme) || url.SchemeIs(url::kHttpsScheme);
}

// Protocol methods this interface will carry.
//
// A METHOD allowlist, not a domain one, and that distinction is load-bearing
// twice over:
//
//  - Target.* and Browser.* walk straight out of the tab they were given.
//    Target.getTargets enumerates every tab the user has open,
//    Target.createTarget opens one at any URL at all — around the scheme check
//    above — and Target.attachToTarget plus sendMessageToTarget reads the DOM
//    of a tab this interface never opened. The ownership check on tab_id is
//    worth nothing while a caller can simply ask for a different target.
//  - Allowing a whole domain is not enough either. Network.enable is what
//    Agent Vision needs; Network.getAllCookies, in the same domain, hands over
//    every cookie in the profile. Domain granularity would have shipped that.
//
// This is exactly what the agent's browser port calls, and nothing else. A
// method added by a future Chromium is denied until somebody decides it should
// not be — which is the right default for an interface that drives the user's
// own logged-in session.
bool IsAllowedMethod(std::string_view method) {
  static constexpr auto kAllowed = std::to_array<std::string_view>({
      "Page.enable",
      "Page.navigate",
      "Page.stopLoading",
      "Page.captureScreenshot",
      "Runtime.enable",
      "Runtime.evaluate",
      "Log.enable",
      "Network.enable",
      "Emulation.setDeviceMetricsOverride",
  });
  return std::ranges::find(kAllowed, method) != kAllowed.end();
}

}  // namespace

WebDeckAgentTabs::WebDeckAgentTabs(
    mojo::PendingReceiver<mojom::AgentTabs> receiver,
    Profile* profile)
    : receiver_(this, std::move(receiver)), profile_(profile) {}

WebDeckAgentTabs::~WebDeckAgentTabs() {
  // Detach from every host we attached to. Without this the browser keeps a
  // protocol session open against a client that no longer exists, and the tab
  // shows "being debugged" forever.
  for (auto& [tab_id, tab] : tabs_) {
    if (tab.host) {
      tab.host->DetachClient(this);
    }
  }
  tabs_.clear();
}

void WebDeckAgentTabs::OpenTab(const std::string& url,
                               OpenTabCallback callback) {
  const GURL target(url);
  if (!target.is_valid() || !IsAllowedScheme(target)) {
    std::move(callback).Run("", base::StrCat({"unsupported URL: ", url}));
    return;
  }

  // The window the user is actually in. We do NOT create one if there is none:
  // the agent opening a browser window out of nowhere is startling, and this
  // feature exists to work alongside the user, in the session they are already
  // using.
  BrowserWindowInterface* browser =
      ProfileBrowserCollection::GetForProfile(profile_)->FindTabbedBrowser();
  if (!browser) {
    std::move(callback).Run("", "no browser window is open");
    return;
  }

  // A foreground tab in the user's own window, so they watch the agent work
  // rather than wondering what it is doing.
  NavigateParams params(browser, target, ui::PAGE_TRANSITION_AUTO_TOPLEVEL);
  params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
  Navigate(&params);

  content::WebContents* contents = params.navigated_or_inserted_contents;
  if (!contents) {
    std::move(callback).Run("", "the browser did not open a tab");
    return;
  }

  scoped_refptr<content::DevToolsAgentHost> host =
      content::DevToolsAgentHost::GetOrCreateFor(contents);
  if (!host) {
    std::move(callback).Run("", "could not attach to the new tab");
    return;
  }

  const std::string tab_id = base::StrCat({"tab-", base::NumberToString(next_tab_id_++)});
  Tab tab;
  tab.host = host;
  tabs_[tab_id] = std::move(tab);

  // AttachClient rather than ForceAttachClient: if something else is already
  // debugging this tab we would rather fail loudly than silently displace it.
  if (!host->AttachClient(this)) {
    tabs_.erase(tab_id);
    std::move(callback).Run("", "the tab is already being debugged");
    return;
  }

  std::move(callback).Run(tab_id, "");
}

void WebDeckAgentTabs::SendCommand(const std::string& tab_id,
                                   const std::string& method,
                                   const std::string& params_json,
                                   SendCommandCallback callback) {
  auto it = tabs_.find(tab_id);
  if (it == tabs_.end()) {
    std::move(callback).Run("", base::StrCat({"no agent tab ", tab_id}));
    return;
  }

  if (!IsAllowedMethod(method)) {
    std::move(callback).Run(
        "", base::StrCat({"protocol method not permitted: ", method}));
    return;
  }

  std::optional<base::Value> params;
  if (!params_json.empty()) {
    params = base::JSONReader::Read(params_json, base::JSON_PARSE_RFC);
    if (!params || !params->is_dict()) {
      std::move(callback).Run("", "params must be a JSON object");
      return;
    }
  }

  // Page.navigate carries its destination in params.url, which never went
  // through OpenTab's IsAllowedScheme gate. Without this check the method
  // allowlist happily forwards Page.navigate to file:///…, turning the agent's
  // read-back tools into arbitrary local-file disclosure against the user's own
  // logged-in session. Gate it with the same http/https allowlist OpenTab uses.
  if (method == "Page.navigate") {
    const std::string* url =
        params && params->is_dict() ? params->GetDict().FindString("url")
                                    : nullptr;
    if (!url || !IsAllowedScheme(GURL(*url))) {
      std::move(callback).Run("", "navigation URL scheme not permitted");
      return;
    }
  }

  const int command_id = it->second.next_command_id++;
  base::DictValue message;
  message.Set("id", command_id);
  message.Set("method", method);
  message.Set("params", params ? std::move(*params) : base::Value(base::DictValue()));

  std::optional<std::string> serialized = base::WriteJson(message);
  if (!serialized) {
    std::move(callback).Run("", "could not encode the command");
    return;
  }

  it->second.pending[command_id] = std::move(callback);
  it->second.host->DispatchProtocolMessage(
      this, base::as_byte_span(std::string_view(*serialized)));
}

void WebDeckAgentTabs::CloseTab(const std::string& tab_id,
                                CloseTabCallback callback) {
  auto it = tabs_.find(tab_id);
  if (it != tabs_.end()) {
    content::WebContents* contents = it->second.host->GetWebContents();
    Detach(tab_id);
    // Close only the tab the agent opened. The user's own tabs are not ours.
    if (contents) {
      contents->ClosePage();
    }
  }
  std::move(callback).Run();
}

void WebDeckAgentTabs::SetClient(
    mojo::PendingRemote<mojom::AgentTabsClient> client) {
  client_.reset();
  client_.Bind(std::move(client));
}

void WebDeckAgentTabs::DispatchProtocolMessage(
    content::DevToolsAgentHost* agent_host,
    base::span<const uint8_t> message) {
  const std::string tab_id = TabIdFor(agent_host);
  if (tab_id.empty()) {
    return;
  }

  const std::string_view text(reinterpret_cast<const char*>(message.data()),
                              message.size());
  std::optional<base::Value> parsed =
      base::JSONReader::Read(text, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_dict()) {
    return;
  }
  const base::DictValue& dict = parsed->GetDict();

  // A reply to a command we issued.
  if (std::optional<int> id = dict.FindInt("id")) {
    auto tab = tabs_.find(tab_id);
    if (tab == tabs_.end()) {
      return;
    }
    auto pending = tab->second.pending.find(*id);
    if (pending == tab->second.pending.end()) {
      return;
    }
    SendCommandCallback callback = std::move(pending->second);
    tab->second.pending.erase(pending);

    if (const base::DictValue* error = dict.FindDict("error")) {
      const std::string* error_message = error->FindString("message");
      std::move(callback).Run(
          "", error_message ? *error_message : "protocol error");
      return;
    }
    // DictValue is move-only, so no ternary over a temporary here.
    const base::DictValue* result = dict.FindDict("result");
    std::optional<std::string> encoded =
        result ? base::WriteJson(*result) : std::optional<std::string>("{}");
    std::move(callback).Run(encoded.value_or("{}"), "");
    return;
  }

  // Otherwise it is an event; the page wants those for Agent Vision.
  const std::string* method = dict.FindString("method");
  if (!method || !client_) {
    return;
  }
  const base::DictValue* params = dict.FindDict("params");
  std::optional<std::string> encoded =
      params ? base::WriteJson(*params) : std::optional<std::string>("{}");
  client_->OnEvent(tab_id, *method, encoded.value_or("{}"));
}

void WebDeckAgentTabs::AgentHostClosed(
    content::DevToolsAgentHost* agent_host) {
  // The tab went away — the user closed it, or it crashed. Tell the page, or
  // the agent waits on a tab that no longer exists.
  const std::string tab_id = TabIdFor(agent_host);
  if (tab_id.empty()) {
    return;
  }
  if (client_) {
    client_->OnDetached(tab_id);
  }
  // Fail anything still in flight rather than leaving the page's promises
  // unresolved forever.
  auto it = tabs_.find(tab_id);
  if (it != tabs_.end()) {
    for (auto& [id, callback] : it->second.pending) {
      std::move(callback).Run("", "the tab closed before answering");
    }
    it->second.pending.clear();
    tabs_.erase(it);
  }
}

std::string WebDeckAgentTabs::TabIdFor(
    content::DevToolsAgentHost* agent_host) const {
  for (const auto& [tab_id, tab] : tabs_) {
    if (tab.host.get() == agent_host) {
      return tab_id;
    }
  }
  return std::string();
}

void WebDeckAgentTabs::Detach(const std::string& tab_id) {
  auto it = tabs_.find(tab_id);
  if (it == tabs_.end()) {
    return;
  }
  for (auto& [id, callback] : it->second.pending) {
    std::move(callback).Run("", "the tab was closed");
  }
  if (it->second.host) {
    it->second.host->DetachClient(this);
  }
  tabs_.erase(it);
}

}  // namespace webdeck
