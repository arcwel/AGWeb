// Copyright 2024 The Arcwel Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

#include "chrome/browser/ui/webui/webdeck/webdeck_adblock.h"

#include <atomic>
#include <string>

#include "base/containers/fixed_flat_set.h"
#include "base/no_destructor.h"
#include "net/base/net_errors.h"
#include "net/base/registry_controlled_domains/registry_controlled_domain.h"
#include "services/network/public/cpp/resource_request.h"
#include "url/gurl.h"

namespace webdeck {

namespace {

// Process-global count of blocked requests. The throttle runs on whichever
// sequence the URL loader lives on, so this must be atomic.
std::atomic<uint64_t>& BlockedCounter() {
  static std::atomic<uint64_t> counter{0};
  return counter;
}

// Curated ad/tracker registrable domains (eTLD+1). This is a pragmatic v1
// hostlist covering the major ad exchanges, analytics and tracking networks —
// the 80/20 of what a request-level blocker stops. The upgrade path is loading
// a full EasyList-derived hostlist from a bundled resource; the matching logic
// here does not change.
//
// Kept sorted for readability; base::MakeFixedFlatSet sorts at compile time.
constexpr auto kBlockedDomains = base::MakeFixedFlatSet<std::string_view>({
    "2mdn.net",
    "3lift.com",
    "adcolony.com",
    "addthis.com",
    "adform.net",
    "adnxs.com",
    "adroll.com",
    "ads-twitter.com",
    "adsafeprotected.com",
    "adservice.google.com",
    "adsrvr.org",
    "adsymptotic.com",
    "advertising.com",
    "amazon-adsystem.com",
    "amplitude.com",
    "analytics.yahoo.com",
    "app-measurement.com",
    "appsflyer.com",
    "bidswitch.net",
    "bluekai.com",
    "branch.io",
    "casalemedia.com",
    "chartbeat.com",
    "clarity.ms",
    "cloudflareinsights.com",
    "contextweb.com",
    "conviva.com",
    "createjs.com",
    "criteo.com",
    "criteo.net",
    "crwdcntrl.net",
    "demdex.net",
    "doubleclick.net",
    "doubleverify.com",
    "everesttech.net",
    "exoclick.com",
    "eyeota.net",
    "facebook.net",
    "fullstory.com",
    "google-analytics.com",
    "googleadservices.com",
    "googlesyndication.com",
    "googletagmanager.com",
    "googletagservices.com",
    "gstatic-analytics.com",
    "heapanalytics.com",
    "hotjar.com",
    "hotjar.io",
    "ib-ibi.com",
    "improvedigital.com",
    "indexww.com",
    "innovid.com",
    "krxd.net",
    "liadm.com",
    "lijit.com",
    "media.net",
    "mixpanel.com",
    "mktoresp.com",
    "moatads.com",
    "mookie1.com",
    "nr-data.net",
    "omtrdc.net",
    "onaudience.com",
    "onetrust.com",
    "openx.net",
    "outbrain.com",
    "pardot.com",
    "pinterest-cdn.com",
    "pippio.com",
    "pubmatic.com",
    "quantcount.com",
    "quantserve.com",
    "quora.com",
    "rfihub.com",
    "rlcdn.com",
    "rubiconproject.com",
    "scorecardresearch.com",
    "segment.com",
    "segment.io",
    "sharethis.com",
    "sitescout.com",
    "smartadserver.com",
    "snowplowanalytics.com",
    "spotxchange.com",
    "taboola.com",
    "tapad.com",
    "teads.tv",
    "themoneytizer.com",
    "tiktok.com",
    "tremorhub.com",
    "turn.com",
    "twitter.com",
    "yieldmo.com",
    "zemanta.com",
    "zopim.com",
});

}  // namespace

bool IsBlockedAdHost(std::string_view host) {
  if (host.empty()) {
    return false;
  }
  // Match on the registrable domain so any subdomain of a blocked domain (e.g.
  // stats.g.doubleclick.net) is covered by a single list entry. Private
  // registries are included so hosts under them resolve to a real eTLD+1.
  std::string domain =
      net::registry_controlled_domains::GetDomainAndRegistry(
          host, net::registry_controlled_domains::INCLUDE_PRIVATE_REGISTRIES);
  if (!domain.empty() && kBlockedDomains.contains(domain)) {
    return true;
  }
  // Fall back to an exact host match for anything with no registrable domain
  // (shouldn't hit for normal web hosts, but keeps the check total).
  return kBlockedDomains.contains(host);
}

uint64_t AdblockBlockedCount() {
  return BlockedCounter().load(std::memory_order_relaxed);
}

void ResetAdblockBlockedCountForTesting() {
  BlockedCounter().store(0, std::memory_order_relaxed);
}

WebDeckAdblockThrottle::WebDeckAdblockThrottle() = default;
WebDeckAdblockThrottle::~WebDeckAdblockThrottle() = default;

void WebDeckAdblockThrottle::DetachFromCurrentSequence() {
  // No per-sequence state: the blocklist is immutable and the counter is
  // atomic, so the loader is free to move this throttle to another sequence.
}

void WebDeckAdblockThrottle::WillStartRequest(
    network::ResourceRequest* request,
    bool* defer) {
  if (!request || !request->url.is_valid() || !request->url.has_host()) {
    return;
  }
  if (!IsBlockedAdHost(request->url.host())) {
    return;
  }
  BlockedCounter().fetch_add(1, std::memory_order_relaxed);
  // Cancel synchronously — do not defer. This tears down the loader for this
  // request; the page sees a blocked resource, exactly like a network filter.
  if (delegate_) {
    delegate_->CancelWithError(net::ERR_BLOCKED_BY_CLIENT, "WebDeckAdblock");
  }
}

}  // namespace webdeck
