// Copyright 2026 Arcwel. All rights reserved.

#ifndef CHROME_BROWSER_WEBDECK_WEBDECK_SHELL_HOST_H_
#define CHROME_BROWSER_WEBDECK_WEBDECK_SHELL_HOST_H_

#include "base/memory/raw_ptr.h"
#include "content/public/browser/web_contents_user_data.h"
#include "url/gurl.h"

class BrowserWindowInterface;

namespace content {
class WebContents;
}

namespace webdeck {

// Links the WebDeck shell's WebContents (chrome://webdeck, hosted in the
// window's shell_web_view_ — NOT a tab) back to the window that owns it.
//
// chrome::FindBrowserWithTab() only finds a WebContents that is a tab, so it
// cannot resolve the shell contents to its window. The owning window is stashed
// here when the shell view is created (ContentsContainerView) and read by
// WebDeckShell (the mojom::Shell impl) to reach the window's TabStripModel and
// its ContentsContainerView (for the stage rect).
// The URL the NEXT WebDeck window's shell page loads, when a shell asks for
// another window (mojom::Shell::OpenWindow). Browser creation params have no
// slot for it, so it is parked here between OpenWindow and the new window's
// ContentsContainerView constructor, which takes it. Empty means the default
// chrome://webdeck (main role).
void SetNextShellUrl(const GURL& url);
GURL TakeNextShellUrl();

class WebDeckShellHost : public content::WebContentsUserData<WebDeckShellHost> {
 public:
  ~WebDeckShellHost() override;

  BrowserWindowInterface* window() const { return window_; }

 private:
  friend class content::WebContentsUserData<WebDeckShellHost>;

  WebDeckShellHost(content::WebContents* web_contents,
                   BrowserWindowInterface* window);

  const raw_ptr<BrowserWindowInterface> window_;

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}  // namespace webdeck

#endif  // CHROME_BROWSER_WEBDECK_WEBDECK_SHELL_HOST_H_
