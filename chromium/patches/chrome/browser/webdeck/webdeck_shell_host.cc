// Copyright 2026 Arcwel. All rights reserved.

#include "chrome/browser/webdeck/webdeck_shell_host.h"

#include "base/no_destructor.h"
#include "content/public/browser/web_contents.h"

namespace webdeck {

namespace {
GURL& NextShellUrl() {
  static base::NoDestructor<GURL> url;
  return *url;
}
}  // namespace

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
