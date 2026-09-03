// Copyright 2026 Arcwel. All rights reserved.

#include "chrome/browser/webdeck/webdeck_shell_host.h"

#include <map>

#include "base/no_destructor.h"
#include "content/public/browser/web_contents.h"

namespace webdeck {

namespace {
GURL& NextShellUrl() {
  static base::NoDestructor<GURL> url;
  return *url;
}

// Keyed by the window pointer; entries are cleared by the shell's destructor
// (before the window can go away, since the shell WebContents lives in it).
std::map<BrowserWindowInterface*, CommandForwarder>& Forwarders() {
  static base::NoDestructor<std::map<BrowserWindowInterface*, CommandForwarder>>
      map;
  return *map;
}
}  // namespace

void SetCommandForwarder(BrowserWindowInterface* window,
                         CommandForwarder forwarder) {
  Forwarders()[window] = std::move(forwarder);
}

void ClearCommandForwarder(BrowserWindowInterface* window) {
  Forwarders().erase(window);
}

bool OwnsCommand(BrowserWindowInterface* window, int command_id) {
  auto it = Forwarders().find(window);
  return it != Forwarders().end() && it->second.Run(command_id, false);
}

bool ForwardCommand(BrowserWindowInterface* window, int command_id) {
  auto it = Forwarders().find(window);
  return it != Forwarders().end() && it->second.Run(command_id, true);
}

void SetNextShellUrl(const GURL& url) {
  NextShellUrl() = url;
}

GURL TakeNextShellUrl() {
  GURL url = NextShellUrl();
  NextShellUrl() = GURL();
  return url.is_valid() ? url : GURL("chrome://webdeck/");
}

WebDeckShellHost::WebDeckShellHost(content::WebContents* web_contents,
                                   BrowserWindowInterface* window)
    : content::WebContentsUserData<WebDeckShellHost>(*web_contents),
      window_(window) {}

WebDeckShellHost::~WebDeckShellHost() = default;

WEB_CONTENTS_USER_DATA_KEY_IMPL(WebDeckShellHost);

}  // namespace webdeck
