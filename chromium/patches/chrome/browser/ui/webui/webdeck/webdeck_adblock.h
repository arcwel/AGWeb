// Copyright 2024 The Arcwel Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

#ifndef CHROME_BROWSER_UI_WEBUI_WEBDECK_WEBDECK_ADBLOCK_H_
#define CHROME_BROWSER_UI_WEBUI_WEBDECK_WEBDECK_ADBLOCK_H_

#include <cstdint>
#include <string_view>

#include "third_party/blink/public/common/loader/url_loader_throttle.h"

namespace network {
struct ResourceRequest;
}  // namespace network

namespace webdeck {

// Profile pref (bool): when true, WebDeck cancels requests to known ad and
// tracker hosts. Registered in browser_prefs.cc RegisterProfilePrefs and
// read/written over the Mojo Shell (Get/SetAdblockEnabled).
inline constexpr char kWebDeckAdblockEnabled[] = "webdeck.adblock.enabled";

// True if `host` sits on (or is a subdomain of a domain on) the bundled
// ad/tracker blocklist. Matching is on the registrable domain (eTLD+1), so
// `ads.doubleclick.net` matches the list entry `doubleclick.net`.
bool IsBlockedAdHost(std::string_view host);

// Process-global count of requests blocked this browser session. Read over the
// Mojo Shell (GetAdblockBlockedCount) to drive the settings badge.
uint64_t AdblockBlockedCount();
void ResetAdblockBlockedCountForTesting();

// Cancels requests whose host is on the ad/tracker blocklist. Added to the
// per-request throttle vector only while the pref is enabled, so a disabled
// blocker has zero per-request cost (no throttle is created at all).
class WebDeckAdblockThrottle : public blink::URLLoaderThrottle {
 public:
  WebDeckAdblockThrottle();
  WebDeckAdblockThrottle(const WebDeckAdblockThrottle&) = delete;
  WebDeckAdblockThrottle& operator=(const WebDeckAdblockThrottle&) = delete;
  ~WebDeckAdblockThrottle() override;

  // blink::URLLoaderThrottle:
  void DetachFromCurrentSequence() override;
  void WillStartRequest(network::ResourceRequest* request,
                        bool* defer) override;
};

}  // namespace webdeck

#endif  // CHROME_BROWSER_UI_WEBUI_WEBDECK_WEBDECK_ADBLOCK_H_
