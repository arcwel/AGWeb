// Copyright 2026 Arcwel. All rights reserved.

#include "chrome/browser/webdeck/webdeck_shell_host.h"

#include "content/public/browser/web_contents.h"

namespace webdeck {

WebDeckShellHost::WebDeckShellHost(content::WebContents* web_contents,
                                   BrowserWindowInterface* window)
    : content::WebContentsUserData<WebDeckShellHost>(*web_contents),
      window_(window) {}

WebDeckShellHost::~WebDeckShellHost() = default;

WEB_CONTENTS_USER_DATA_KEY_IMPL(WebDeckShellHost);

}  // namespace webdeck
