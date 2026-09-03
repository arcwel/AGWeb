// Copyright 2026 Arcwel. All rights reserved.

#ifndef CHROME_BROWSER_WEBDECK_WEBDECK_SHELL_HOST_H_
#define CHROME_BROWSER_WEBDECK_WEBDECK_SHELL_HOST_H_

#include "base/functional/callback.h"
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

// Browser commands (IDC_*) that a WebDeck window's shell owns. The shell
// registers a forwarder when its client binds (WebDeckShell::SetClient);
// BrowserCommandController asks ForwardCommand() FIRST for every command and
// runs Chromium's own handler only when it returns false. That is how ⌘T from
// a focused page opens WebDeck's new tab rather than chrome://newtab, and how
// ⌘D reaches the Deck instead of the bookmark star. A window with no shell (or
// no client yet) forwards nothing, so ordinary Chromium windows are untouched.
//
// The forwarder answers two questions: with `execute` false, "is this command
// yours?" (so the command controller reports it supported and enabled — a
// WebDeck window has no native location bar, so Chromium would otherwise
// disable ⌘L and the menu would refuse the key before any dispatch); with
// `execute` true, "take it" (send it to the shell).
using CommandForwarder =
    base::RepeatingCallback<bool(int command_id, bool execute)>;
void SetCommandForwarder(BrowserWindowInterface* window,
                         CommandForwarder forwarder);
void ClearCommandForwarder(BrowserWindowInterface* window);
// True if the window's shell owns `command_id` (nothing is sent).
bool OwnsCommand(BrowserWindowInterface* window, int command_id);
// Sends `command_id` to the shell if it owns it; true if it did.
bool ForwardCommand(BrowserWindowInterface* window, int command_id);

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
