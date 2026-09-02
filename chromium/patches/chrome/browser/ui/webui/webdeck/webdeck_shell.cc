// Copyright 2026 Arcwel. All rights reserved.

#include "chrome/browser/ui/webui/webdeck/webdeck_shell.h"

#include "chrome/browser/ui/webui/webdeck/webdeck_adblock.h"

#include <utility>

#include <vector>

#include "base/functional/bind.h"
#include "base/memory/scoped_refptr.h"
#include "base/notimplemented.h"
#include "base/strings/utf_string_conversions.h"
#include "base/time/time.h"
#include "base/values.h"
#include "chrome/browser/browsing_data/chrome_browsing_data_remover_constants.h"
#include "chrome/browser/devtools/devtools_contents_resizing_strategy.h"
#include "chrome/browser/devtools/devtools_dock_side.h"
#include "chrome/browser/devtools/devtools_toggle_action.h"
#include "chrome/browser/devtools/devtools_window.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/preloading/preloading_prefs.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/shell_integration.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/browser_tabstrip.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/views/frame/contents_container_view.h"
#include "chrome/browser/webdeck/webdeck_shell_host.h"
#include "chrome/common/chrome_isolated_world_ids.h"
#include "chrome/common/pref_names.h"
#include "chrome/common/webui_url_constants.h"
#include "components/sessions/core/session_id.h"
#include "ui/base/base_window.h"
#include "components/content_settings/core/browser/cookie_settings.h"
#include "components/content_settings/core/common/pref_names.h"
#include "components/find_in_page/find_notification_details.h"
#include "components/find_in_page/find_tab_helper.h"
#include "components/find_in_page/find_types.h"
#include "components/prefs/pref_service.h"
#include "components/tabs/public/tab_interface.h"
#include "components/zoom/zoom_controller.h"
#include "content/public/browser/browsing_data_remover.h"
#include "content/public/browser/media_session.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/reload_type.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/url_constants.h"
#include "mojo/public/cpp/bindings/callback_helpers.h"
#include "services/media_session/public/mojom/media_session.mojom.h"
#include "ui/base/page_transition_types.h"
#include "url/gurl.h"
#include "url/url_constants.h"

namespace webdeck {

namespace {

// The schemes the shell may point the window's real tab at. Deliberately the
// same conservative bar as AgentTabs (webdeck_agent_tabs.cc IsAllowedScheme):
// http/https only, so a compromised chrome://webdeck renderer cannot silently
// drive the user's visible tab to file:// (local file disclosure), chrome:// /
// chrome-untrusted:// / devtools:// (privileged surfaces), or
// javascript:/blob:/filesystem: — and a WebDeck window has no native omnibox to
// warn the user. The two explicit internal exceptions are about:blank (the
// blank staged / new tab) and chrome://webdeck itself. Reaching other internal
// pages needs a policy-gated trust path (see SHELL_ARCHITECTURE.md); it is
// intentionally not this interface.
bool IsAllowedShellUrl(const GURL& url) {
  if (url.SchemeIs(url::kHttpScheme) || url.SchemeIs(url::kHttpsScheme)) {
    return true;
  }
  if (url.IsAboutBlank()) {
    return true;
  }
  if (!url.SchemeIs(content::kChromeUIScheme)) {
    return false;
  }
  // chrome://webdeck itself, plus the pages a person reaches from a browser's
  // own menus — profiles and sign-in live at chrome://settings/people, and
  // Chromium owns extensions, history, downloads and bookmarks on this build.
  // Still no chrome://flags, chrome://policy or other privileged surfaces.
  static constexpr const char* kAllowedHosts[] = {
      chrome::kChromeUIWebDeckHost, "settings",  "extensions", "history",
      "downloads",                   "bookmarks", "newtab",     "version"};
  for (const char* host : kAllowedHosts) {
    if (url.host() == host) {
      return true;
    }
  }
  return false;
}

// Collapse the four-way DefaultWebClientState into the shell's 3-state code:
// 0 = not default, 1 = default, 2 = unknown/error. OTHER_MODE_IS_DEFAULT means
// another install mode of this brand is default, i.e. THIS one is not — report
// "not default" so the "Make default" button stays actionable.
int32_t DefaultBrowserStateCode(shell_integration::DefaultWebClientState state) {
  switch (state) {
    case shell_integration::IS_DEFAULT:
      return 1;
    case shell_integration::NOT_DEFAULT:
    case shell_integration::OTHER_MODE_IS_DEFAULT:
      return 0;
    case shell_integration::UNKNOWN_DEFAULT:
    case shell_integration::NUM_DEFAULT_STATES:
      return 2;
  }
  return 2;
}

// Cap the returned page text so a huge page can neither blow up the Mojo
// message nor swamp the assistant's context. The head is kept — a page's title,
// headings and lead paragraphs are at the top, which is what a summary/Q&A
// grounds on.
constexpr size_t kMaxPageTextChars = 100000;

// Turn the isolated-world eval result (a base::Value) into the capped string the
// GetPageText reply carries. innerText yields a JS string; anything else (the
// frame refused, returned undefined) collapses to empty.
void OnPageTextExtracted(mojom::Shell::GetPageTextCallback callback,
                         base::Value value) {
  std::string text = value.is_string() ? value.GetString() : std::string();
  if (text.size() > kMaxPageTextChars) {
    text.resize(kMaxPageTextChars);
  }
  std::move(callback).Run(text);
}

}  // namespace

WebDeckShell::WebDeckShell(content::WebContents* shell_contents,
                           mojo::PendingReceiver<mojom::Shell> receiver)
    : shell_contents_(shell_contents),
      receiver_(this, std::move(receiver)) {}

WebDeckShell::~WebDeckShell() {
  if (observed_model_) {
    observed_model_->RemoveObserver(this);
  }
  if (observed_find_helper_) {
    observed_find_helper_->RemoveObserver(this);
    observed_find_helper_ = nullptr;
  }
}

BrowserWindowInterface* WebDeckShell::GetWindow() {
  WebDeckShellHost* host = WebDeckShellHost::FromWebContents(shell_contents_);
  return host ? host->window() : nullptr;
}

ContentsContainerView* WebDeckShell::GetContentsContainerView() {
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return nullptr;
  }
  BrowserView* view = BrowserView::GetBrowserViewForBrowser(window);
  return view ? view->GetActiveContentsContainerView() : nullptr;
}

content::WebContents* WebDeckShell::GetTabById(int32_t tab_id) {
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return nullptr;
  }
  // tab_id 0 addresses the active tab. The shell owns tab identity as its own
  // string ids and drives the single staged (active) tab, so the renderer maps
  // its per-id operations onto the active tab; a real handle still addresses a
  // specific tab (multi-tab switching, later).
  if (tab_id == 0) {
    return window->GetTabStripModel()->GetActiveWebContents();
  }
  tabs::TabInterface* tab = tabs::TabHandle(tab_id).Get();
  if (!tab) {
    return nullptr;
  }
  content::WebContents* contents = tab->GetContents();
  if (!contents ||
      window->GetTabStripModel()->GetIndexOfWebContents(contents) < 0) {
    // The tab is gone or belongs to another window — do not act on it.
    return nullptr;
  }
  return contents;
}

Profile* WebDeckShell::GetProfile() {
  return Profile::FromBrowserContext(shell_contents_->GetBrowserContext());
}

void WebDeckShell::SetStageBounds(const gfx::Rect& stage) {
  // The DevTools resizing strategy: the "devtools" view (here, the shell) gets
  // the whole container, the "contents" view (the active tab) gets `stage`.
  // kNone means no min-size clamping — honor the shell's rect exactly.
  if (ContentsContainerView* container = GetContentsContainerView()) {
    container->SetContentsResizingStrategy(
        DevToolsContentsResizingStrategy(devtools::DockSide::kNone, stage));
  }
}

void WebDeckShell::SetSplit(bool enabled,
                            int32_t primary_tab_id,
                            int32_t secondary_tab_id) {
  if (!enabled) {
    // Tear the split down. `primary_tab_id`/`secondary_tab_id` are not addressed
    // on disable, so no tab lookup is done here. Forget the tracked secondary
    // tab and drop it from the container.
    secondary_tab_id_ = 0;
    if (ContentsContainerView* container = GetContentsContainerView()) {
      container->SetSecondaryStagedContents(nullptr);
    }
    return;
  }

  // Validate the addressed tabs before acting: GetTabById maps 0 -> active tab
  // and rejects a handle that is gone or belongs to another window, so a
  // compromised chrome://webdeck cannot name a tab it does not own here (same
  // ownership gate the other tab ops use). BOTH stages must resolve to real
  // tabs in this window; otherwise refuse.
  content::WebContents* primary = GetTabById(primary_tab_id);
  content::WebContents* secondary = GetTabById(secondary_tab_id);
  if (!primary || !secondary) {
    return;
  }
  // Refuse a degenerate split (the same tab in both stages): one WebContents
  // cannot render into two ContentsWebViews at once, and the shell has nothing
  // to gain from it. Fall through to teardown semantics is wrong here — just
  // reject so the shell keeps its current (single) staging.
  if (primary == secondary) {
    return;
  }

  // Make `primary_tab_id` the primary (active) stage so the mojom contract holds
  // — the primary stage always renders the window's active tab (positioned by
  // SetStageBounds). Mirrors SelectTab's activate path; a no-op when `primary`
  // is already the active tab.
  if (BrowserWindowInterface* window = GetWindow()) {
    TabStripModel* model = window->GetTabStripModel();
    const int index = model->GetIndexOfWebContents(primary);
    if (index >= 0) {
      model->ActivateTabAt(index);
    }
  }

  // Per SPLIT_VIEW_PLAN.md (Approach A — two stages on one shell backdrop), the
  // primary ContentsContainerView owns a second staged ContentsWebView; point
  // it at the secondary tab's WebContents. The primary stage keeps flowing
  // through SetStageBounds unchanged.
  if (ContentsContainerView* container = GetContentsContainerView()) {
    container->SetSecondaryStagedContents(secondary);
  }

  // Track the secondary tab so its later removal can defensively tear the split
  // down (see OnTabStripModelChanged kRemoved) even if the renderer never calls
  // SetSplit(false).
  secondary_tab_id_ = 0;
  if (tabs::TabInterface* tab = tabs::TabInterface::GetFromContents(secondary)) {
    secondary_tab_id_ = tab->GetHandle().raw_value();
  }
}

void WebDeckShell::SetSecondaryStageBounds(const gfx::Rect& stage) {
  // Mirror SetStageBounds for the secondary staged view: kNone means no
  // min-size clamping, so the secondary tab gets exactly `stage`. No-op unless
  // split staging is enabled (the container ignores the strategy while the
  // secondary view is hidden / has no bound contents).
  if (ContentsContainerView* container = GetContentsContainerView()) {
    container->SetSecondaryContentsResizingStrategy(
        DevToolsContentsResizingStrategy(devtools::DockSide::kNone, stage));
  }
}

void WebDeckShell::CreateTab(const std::string& url,
                             CreateTabCallback callback) {
  BrowserWindowInterface* window = GetWindow();
  const GURL target(url);
  if (!window || !IsAllowedShellUrl(target)) {
    // Refuse privileged/local schemes — see IsAllowedShellUrl.
    std::move(callback).Run(0);
    return;
  }
  content::WebContents* contents = chrome::AddAndReturnTabAt(
      window, target, /*index=*/-1, /*foreground=*/true);
  int32_t tab_id = 0;
  if (contents) {
    if (tabs::TabInterface* tab = tabs::TabInterface::GetFromContents(contents)) {
      tab_id = tab->GetHandle().raw_value();
    }
  }
  std::move(callback).Run(tab_id);
}

void WebDeckShell::SelectTab(int32_t tab_id) {
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return;
  }
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  TabStripModel* model = window->GetTabStripModel();
  const int index = model->GetIndexOfWebContents(contents);
  if (index >= 0) {
    model->ActivateTabAt(index);
  }
}

void WebDeckShell::CloseTab(int32_t tab_id) {
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return;
  }
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  TabStripModel* model = window->GetTabStripModel();
  const int index = model->GetIndexOfWebContents(contents);
  if (index >= 0) {
    model->CloseWebContentsAt(index, TabCloseTypes::CLOSE_USER_GESTURE);
  }
}

void WebDeckShell::Navigate(int32_t tab_id, const std::string& url) {
  const GURL target(url);
  if (!IsAllowedShellUrl(target)) {
    // Refuse privileged/local schemes — see IsAllowedShellUrl. This is the main
    // vector: a compromised shell driving the staged tab to file:// / chrome://.
    return;
  }
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  contents->GetController().LoadURL(target, content::Referrer(),
                                    ui::PAGE_TRANSITION_TYPED, std::string());
}

void WebDeckShell::Reload(int32_t tab_id) {
  if (content::WebContents* contents = GetTabById(tab_id)) {
    contents->GetController().Reload(content::ReloadType::NORMAL,
                                     /*check_for_repost=*/false);
  }
}

void WebDeckShell::GoBack(int32_t tab_id) {
  content::WebContents* contents = GetTabById(tab_id);
  if (contents && contents->GetController().CanGoBack()) {
    contents->GetController().GoBack();
  }
}

void WebDeckShell::GoForward(int32_t tab_id) {
  content::WebContents* contents = GetTabById(tab_id);
  if (contents && contents->GetController().CanGoForward()) {
    contents->GetController().GoForward();
  }
}

void WebDeckShell::Stop(int32_t tab_id) {
  if (content::WebContents* contents = GetTabById(tab_id)) {
    contents->Stop();
  }
}

void WebDeckShell::SetStageCornerRadius(int32_t radius) {
  if (ContentsContainerView* container = GetContentsContainerView()) {
    container->SetStageCornerRadius(radius);
  }
}

void WebDeckShell::Find(int32_t tab_id,
                        const std::string& query,
                        bool forward) {
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  // Idempotent: creates the per-tab helper if this is the first find on the tab.
  find_in_page::FindTabHelper::CreateForWebContents(contents);
  find_in_page::FindTabHelper::FromWebContents(contents)->StartFinding(
      base::UTF8ToUTF16(query), forward, /*case_sensitive=*/false,
      /*find_match=*/true);
}

void WebDeckShell::StopFind(int32_t tab_id) {
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  if (auto* helper = find_in_page::FindTabHelper::FromWebContents(contents)) {
    helper->StopFinding(find_in_page::SelectionAction::kClear);
  }
}

void WebDeckShell::SetZoom(int32_t tab_id,
                           double level,
                           SetZoomCallback callback) {
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    std::move(callback).Run(0);
    return;
  }
  zoom::ZoomController* controller =
      zoom::ZoomController::FromWebContents(contents);
  if (!controller) {
    std::move(callback).Run(0);
    return;
  }
  controller->SetZoomLevel(level);
  std::move(callback).Run(controller->GetZoomLevel());
}

void WebDeckShell::Print(int32_t tab_id) {
  // chrome::Print prints the window's active tab; the shell only prints the
  // staged (active) tab, so `tab_id` is not addressed individually here.
  if (BrowserWindowInterface* window = GetWindow()) {
    chrome::Print(window);
  }
}

void WebDeckShell::OpenDevTools(int32_t tab_id) {
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  // TODO(webdeck): Force the DevTools window undocked. A WebDeck window's stage
  // owns the docked contents-resizing strategy, so DevTools must not dock into
  // it. The public DevToolsWindow::OpenDevToolsWindow() API exposes no
  // force-undock parameter for a tab target; the frontend derives its dock
  // state from DevtoolsUIController::CanDockDevtools() (true for TYPE_NORMAL
  // windows, which a WebDeck window currently is) and the saved dock-state
  // pref. Undocking should be guaranteed by making the WebDeck window report
  // CanDockDevtools()==false (or by routing a currentDockState=undocked
  // settings blob through a Create/ToggleDevToolsWindow path).
  DevToolsWindow::OpenDevToolsWindow(contents, DevToolsToggleAction::Show(),
                                     DevToolsOpenedByAction::kUnknown);
}

void WebDeckShell::TogglePictureInPicture(int32_t tab_id) {
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  // Exit path (unambiguous): if a PiP window opened by THIS tab is showing,
  // close it. PictureInPictureWindowManager tracks a single global PiP window
  // and reports its opener via GetWebContents(); ExitPictureInPicture() closes
  // any open video/document PiP window. Scoping the toggle to this tab keeps a
  // per-tab button honest when another tab owns the current PiP window.
  PictureInPictureWindowManager* manager =
      PictureInPictureWindowManager::GetInstance();
  if (manager && manager->GetWebContents() == contents) {
    manager->ExitPictureInPicture();
    return;
  }
  // Enter path: video PiP is renderer-initiated by design (the mode is entered
  // through WebContentsDelegate::EnterPictureInPicture, see
  // PictureInPictureWindowManager::EnterVideoPictureInPicture docs), so the
  // browser cannot synthesize a video controller here. The supported
  // browser-side request is to dispatch the media-session PiP action — the same
  // mechanism global media controls and media keys use — which the page's
  // MediaSession turns into an enterpictureinpicture event for the active
  // video. It is a no-op if the tab has no media session / registered handler
  // (nothing is playing), which is the correct behavior for a stateless toggle.
  if (content::MediaSession* session =
          content::MediaSession::GetIfExists(contents)) {
    session->DidReceiveAction(
        media_session::mojom::MediaSessionAction::kEnterPictureInPicture);
  }
}

void WebDeckShell::GetPageText(int32_t tab_id, GetPageTextCallback callback) {
  content::WebContents* contents = GetTabById(tab_id);
  content::RenderFrameHost* frame =
      contents ? contents->GetPrimaryMainFrame() : nullptr;
  if (!frame) {
    // The tab is gone or belongs to another window (GetTabById's ownership
    // gate) — reply with empty rather than reading something we do not own.
    std::move(callback).Run(std::string());
    return;
  }
  // Read the RENDERED visible text of the main frame. Two deliberate choices:
  //  * ExecuteJavaScriptInIsolatedWorld, not ExecuteJavaScript — the latter is
  //    restricted to chrome:// / devtools:// pages, and this reads arbitrary web
  //    pages. The isolated world shares the DOM but is invisible to page script,
  //    so a hostile page can neither observe nor tamper with the read.
  //  * innerText, not textContent — it is the visible, rendered text (skips
  //    hidden nodes / script / style), which is what the assistant should see.
  // The reply is wrapped so a frame that is destroyed before the eval returns
  // still sends an (empty) reply instead of hanging the renderer's promise.
  frame->ExecuteJavaScriptInIsolatedWorld(
      u"(document.body && document.body.innerText) || ''",
      base::BindOnce(&OnPageTextExtracted,
                     mojo::WrapCallbackWithDefaultInvokeIfNotRun(
                         std::move(callback), std::string())),
      ISOLATED_WORLD_ID_CHROME_INTERNAL);
}

void WebDeckShell::GetBlockThirdPartyCookies(
    GetBlockThirdPartyCookiesCallback callback) {
  Profile* profile = GetProfile();
  const bool blocked =
      profile &&
      profile->GetPrefs()->GetInteger(prefs::kCookieControlsMode) ==
          static_cast<int>(
              content_settings::CookieControlsMode::kBlockThirdParty);
  std::move(callback).Run(blocked);
}

void WebDeckShell::SetBlockThirdPartyCookies(bool blocked) {
  // The pref IS the source of truth chrome://settings writes; CookieSettings /
  // HostContentSettingsMap observe it. kBlockThirdParty blocks 3P cookies in
  // every context; kOff is the permissive default.
  if (Profile* profile = GetProfile()) {
    profile->GetPrefs()->SetInteger(
        prefs::kCookieControlsMode,
        static_cast<int>(
            blocked ? content_settings::CookieControlsMode::kBlockThirdParty
                    : content_settings::CookieControlsMode::kOff));
  }
}

void WebDeckShell::GetSendDoNotTrack(GetSendDoNotTrackCallback callback) {
  Profile* profile = GetProfile();
  std::move(callback).Run(
      profile && profile->GetPrefs()->GetBoolean(prefs::kEnableDoNotTrack));
}

void WebDeckShell::SetSendDoNotTrack(bool enabled) {
  if (Profile* profile = GetProfile()) {
    profile->GetPrefs()->SetBoolean(prefs::kEnableDoNotTrack, enabled);
  }
}

void WebDeckShell::GetHttpsOnlyMode(GetHttpsOnlyModeCallback callback) {
  Profile* profile = GetProfile();
  std::move(callback).Run(
      profile && profile->GetPrefs()->GetBoolean(prefs::kHttpsOnlyModeEnabled));
}

void WebDeckShell::SetHttpsOnlyMode(bool enabled) {
  if (Profile* profile = GetProfile()) {
    profile->GetPrefs()->SetBoolean(prefs::kHttpsOnlyModeEnabled, enabled);
  }
}

void WebDeckShell::GetPreloadPages(GetPreloadPagesCallback callback) {
  Profile* profile = GetProfile();
  const bool enabled =
      profile && prefetch::GetPreloadPagesState(*profile->GetPrefs()) !=
                     prefetch::PreloadPagesState::kNoPreloading;
  std::move(callback).Run(enabled);
}

void WebDeckShell::SetPreloadPages(bool enabled) {
  // The typed helper is the sanitized front to the NetworkPredictionOptions
  // pref (which carries a deprecated value); use it rather than writing the raw
  // enum. Standard preloading maps to the settings "Standard" opt-in.
  if (Profile* profile = GetProfile()) {
    prefetch::SetPreloadPagesState(
        profile->GetPrefs(),
        enabled ? prefetch::PreloadPagesState::kStandardPreloading
                : prefetch::PreloadPagesState::kNoPreloading);
  }
}

void WebDeckShell::GetAdblockEnabled(GetAdblockEnabledCallback callback) {
  Profile* profile = GetProfile();
  std::move(callback).Run(
      profile && profile->GetPrefs()->GetBoolean(kWebDeckAdblockEnabled));
}

void WebDeckShell::SetAdblockEnabled(bool enabled) {
  // The pref is the source of truth. CreateURLLoaderThrottles reads it per
  // request on the UI thread and only installs the blocking throttle while it
  // is true, so toggling here takes effect on the next request with no restart.
  if (Profile* profile = GetProfile()) {
    profile->GetPrefs()->SetBoolean(kWebDeckAdblockEnabled, enabled);
  }
}

void WebDeckShell::GetAdblockBlockedCount(
    GetAdblockBlockedCountCallback callback) {
  std::move(callback).Run(AdblockBlockedCount());
}

void WebDeckShell::ClearBrowsingData(bool cookies,
                                     bool cache,
                                     bool history,
                                     int32_t time_range,
                                     ClearBrowsingDataCallback callback) {
  Profile* profile = GetProfile();
  if (!profile) {
    std::move(callback).Run();
    return;
  }
  uint64_t remove_mask = 0;
  if (cookies) {
    remove_mask |= content::BrowsingDataRemover::DATA_TYPE_COOKIES;
  }
  if (cache) {
    remove_mask |= content::BrowsingDataRemover::DATA_TYPE_CACHE;
  }
  if (history) {
    // History is an embedder (chrome) datatype, not a content datatype.
    remove_mask |= chrome_browsing_data_remover::DATA_TYPE_HISTORY;
  }
  if (remove_mask == 0) {
    std::move(callback).Run();
    return;
  }

  const base::Time now = base::Time::Now();
  base::Time begin;
  switch (time_range) {
    case 0:
      begin = now - base::Hours(1);
      break;
    case 1:
      begin = now - base::Days(1);
      break;
    case 2:
      begin = now - base::Days(7);
      break;
    case 3:
      begin = now - base::Days(28);
      break;
    default:
      begin = base::Time();  // The epoch — "all time".
      break;
  }

  // Fire-and-forget: BrowsingDataRemover runs the deletion on its own tasks. We
  // ack as soon as it is scheduled rather than plumb an Observer through, which
  // keeps this method (and the WebDeckShell lifetime) simple; the panel does not
  // need per-datatype completion, only that the clear was accepted.
  profile->GetBrowsingDataRemover()->Remove(
      begin, base::Time::Max(), remove_mask,
      content::BrowsingDataRemover::ORIGIN_TYPE_UNPROTECTED_WEB |
          content::BrowsingDataRemover::ORIGIN_TYPE_PROTECTED_WEB);
  std::move(callback).Run();
}

void WebDeckShell::GetDefaultBrowserState(
    GetDefaultBrowserStateCallback callback) {
  // The worker checks the OS on a blocking sequence and calls back on the UI
  // thread; it self-retains for the duration (StartCheckIsDefault binds `this`,
  // a RefCountedThreadSafe receiver, so Bind holds a scoped_refptr).
  scoped_refptr<shell_integration::DefaultBrowserWorker> worker =
      base::MakeRefCounted<shell_integration::DefaultBrowserWorker>();
  worker->StartCheckIsDefault(base::BindOnce(
      [](GetDefaultBrowserStateCallback cb,
         shell_integration::DefaultWebClientState state) {
        std::move(cb).Run(DefaultBrowserStateCode(state));
      },
      std::move(callback)));
}

void WebDeckShell::SetAsDefaultBrowser(SetAsDefaultBrowserCallback callback) {
  scoped_refptr<shell_integration::DefaultBrowserWorker> worker =
      base::MakeRefCounted<shell_integration::DefaultBrowserWorker>();
  // Allow the interactive OS flow (macOS/Linux present a system prompt); without
  // it the set silently fails on those platforms.
  worker->set_interactive_permitted(true);
  worker->StartSetAsDefault(base::BindOnce(
      [](SetAsDefaultBrowserCallback cb,
         shell_integration::DefaultWebClientState state) {
        std::move(cb).Run(DefaultBrowserStateCode(state));
      },
      std::move(callback)));
}

void WebDeckShell::SetClient(mojo::PendingRemote<mojom::ShellClient> client) {
  client_.reset();
  client_.Bind(std::move(client));
  // Now that the shell can receive state, observe the window's tabs and push the
  // active tab's current navigation state (url/title/back-forward/loading).
  StartObserving();
}

void WebDeckShell::OnTabStripModelChanged(
    TabStripModel* tab_strip_model,
    const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  if (selection.active_tab_changed()) {
    ObserveActiveTab();
  }
  // A removed tab must be reported individually so the shell can drop it (this
  // is how closed/crashed tabs disappear from the shell's tab strip).
  if (change.type() == TabStripModelChange::kRemoved) {
    for (const auto& removed : change.GetRemove()->contents) {
      int32_t tab_id = 0;
      if (removed.tab) {
        tab_id = removed.tab->GetHandle().raw_value();
      } else if (removed.contents) {
        if (tabs::TabInterface* tab =
                tabs::TabInterface::GetFromContents(removed.contents)) {
          tab_id = tab->GetHandle().raw_value();
        }
      }
      // Defensive split teardown: if the tab that just vanished is the one
      // staged in the secondary split pane, drop it from the container so a
      // blank pane is never left visible. The renderer may not proactively call
      // SetSplit(false) when its own tab dies. Guarded on a non-zero tracked id
      // so an unresolved (0) tab_id can never match.
      if (secondary_tab_id_ != 0 && tab_id == secondary_tab_id_) {
        if (ContentsContainerView* container = GetContentsContainerView()) {
          container->SetSecondaryStagedContents(nullptr);
        }
        secondary_tab_id_ = 0;
      }
      if (client_) {
        client_->OnTabClosed(tab_id);
      }
    }
  }
  // Any change to the tab set / active tab re-pushes the full list so the shell
  // learns about tabs opened elsewhere (e.g. links that open a new window).
  PushTabList();
  PushActiveTabState();
}

void WebDeckShell::DidFinishNavigation(
    content::NavigationHandle* navigation_handle) {
  if (navigation_handle && navigation_handle->IsInPrimaryMainFrame() &&
      navigation_handle->HasCommitted()) {
    PushActiveTabState();
  }
}

void WebDeckShell::DidStartLoading() {
  PushActiveTabState();
}

void WebDeckShell::DidStopLoading() {
  PushActiveTabState();
}

void WebDeckShell::TitleWasSet(content::NavigationEntry* entry) {
  PushActiveTabState();
}

void WebDeckShell::StartObserving() {
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return;
  }
  TabStripModel* model = window->GetTabStripModel();
  if (observed_model_ != model) {
    if (observed_model_) {
      observed_model_->RemoveObserver(this);
    }
    observed_model_ = model;
    model->AddObserver(this);
  }
  ObserveActiveTab();
  PushTabList();
  PushActiveTabState();
}

void WebDeckShell::ObserveActiveTab() {
  BrowserWindowInterface* window = GetWindow();
  content::WebContents* active =
      window ? window->GetTabStripModel()->GetActiveWebContents() : nullptr;
  // WebContentsObserver::Observe re-points at the new contents (or detaches on
  // null), so a single observer always tracks whatever tab is staged.
  Observe(active);

  // Re-point the find-result observer at the newly staged tab: drop the old
  // registration first, then register on the new tab's FindTabHelper so
  // OnFindResultAvailable fires for the staged tab.
  if (observed_find_helper_) {
    observed_find_helper_->RemoveObserver(this);
    observed_find_helper_ = nullptr;
  }
  if (active) {
    find_in_page::FindTabHelper::CreateForWebContents(active);
    observed_find_helper_ = find_in_page::FindTabHelper::FromWebContents(active);
    if (observed_find_helper_) {
      observed_find_helper_->AddObserver(this);
    }
  }
}

void WebDeckShell::PushActiveTabState() {
  if (!client_) {
    return;
  }
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return;
  }
  content::WebContents* contents =
      window->GetTabStripModel()->GetActiveWebContents();
  if (!contents) {
    return;
  }
  mojom::TabInfoPtr info = mojom::TabInfo::New();
  info->tab_id = 0;
  if (tabs::TabInterface* tab = tabs::TabInterface::GetFromContents(contents)) {
    info->tab_id = tab->GetHandle().raw_value();
  }
  info->url = contents->GetLastCommittedURL().spec();
  info->title = base::UTF16ToUTF8(contents->GetTitle());
  info->can_go_back = contents->GetController().CanGoBack();
  info->can_go_forward = contents->GetController().CanGoForward();
  info->is_loading = contents->IsLoading();
  client_->OnTabNavigationStateChanged(std::move(info));
}

void WebDeckShell::PushTabList() {
  if (!client_) {
    return;
  }
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return;
  }
  TabStripModel* model = window->GetTabStripModel();
  std::vector<mojom::TabInfoPtr> list;
  for (int i = 0; i < model->count(); ++i) {
    content::WebContents* contents = model->GetWebContentsAt(i);
    if (!contents) {
      continue;
    }
    mojom::TabInfoPtr info = mojom::TabInfo::New();
    info->tab_id = 0;
    if (tabs::TabInterface* tab =
            tabs::TabInterface::GetFromContents(contents)) {
      info->tab_id = tab->GetHandle().raw_value();
    }
    info->url = contents->GetLastCommittedURL().spec();
    info->title = base::UTF16ToUTF8(contents->GetTitle());
    info->can_go_back = contents->GetController().CanGoBack();
    info->can_go_forward = contents->GetController().CanGoForward();
    info->is_loading = contents->IsLoading();
    list.push_back(std::move(info));
  }

  int32_t active_tab_id = 0;
  if (content::WebContents* active = model->GetActiveWebContents()) {
    if (tabs::TabInterface* tab =
            tabs::TabInterface::GetFromContents(active)) {
      active_tab_id = tab->GetHandle().raw_value();
    }
  }
  client_->OnTabsChanged(std::move(list), active_tab_id);
}

void WebDeckShell::OnFindResultAvailable(content::WebContents* web_contents) {
  if (!client_ || !web_contents) {
    return;
  }
  find_in_page::FindTabHelper* helper =
      find_in_page::FindTabHelper::FromWebContents(web_contents);
  if (!helper) {
    return;
  }
  int32_t tab_id = 0;
  if (tabs::TabInterface* tab =
          tabs::TabInterface::GetFromContents(web_contents)) {
    tab_id = tab->GetHandle().raw_value();
  }
  const find_in_page::FindNotificationDetails& details = helper->find_result();
  client_->OnFindResult(tab_id, details.active_match_ordinal(),
                        details.number_of_matches());
}

void WebDeckShell::OnFindTabHelperDestroyed(
    find_in_page::FindTabHelper* helper) {
  // The helper we observe is going away; drop the dangling registration.
  if (observed_find_helper_ == helper) {
    observed_find_helper_ = nullptr;
  }
}

// The shell hides the staged tab while one of its own overlays is open: the
// native tab is composited above the page, so a menu or the palette would
// otherwise be painted over. Both stages go together — a split secondary
// left visible would still cover the overlay.
void WebDeckShell::SetStageVisible(bool visible) {
  ContentsContainerView* container = GetContentsContainerView();
  if (!container) {
    return;
  }
  if (views::View* contents = container->contents_view()) {
    contents->SetVisible(visible);
  }
  container->SetSecondaryStageVisible(visible);
}

// Another WebDeck window whose shell page carries a role in its fragment
// (chrome://webdeck#deck, #float:<group>). Only chrome://webdeck may be a
// shell page; anything else is refused with id 0. The URL is handed to the
// next ContentsContainerView through the shell host rather than through
// browser creation params, which have no slot for it.
void WebDeckShell::OpenWindow(const std::string& url,
                              OpenWindowCallback callback) {
  const GURL target(url);
  Profile* profile = GetProfile();
  if (!profile || !target.SchemeIs(content::kChromeUIScheme) ||
      target.host() != chrome::kChromeUIWebDeckHost) {
    std::move(callback).Run(0);
    return;
  }
  webdeck::SetNextShellUrl(target);
  BrowserWindowInterface* window =
      chrome::OpenEmptyWindow(profile, /*should_trigger_session_restore=*/false);
  // Whether or not a window came up, the pending URL must not leak into the
  // next unrelated window.
  webdeck::TakeNextShellUrl();
  std::move(callback).Run(window ? window->GetSessionID().id() : 0);
}

namespace {
BrowserWindowInterface* FindBrowserById(int32_t window_id) {
  for (BrowserWindowInterface* browser : GetAllBrowserWindowInterfaces()) {
    if (browser->GetSessionID().id() == window_id) {
      return browser;
    }
  }
  return nullptr;
}
}  // namespace

void WebDeckShell::FocusWindow(int32_t window_id) {
  if (BrowserWindowInterface* browser = FindBrowserById(window_id)) {
    browser->GetWindow()->Activate();
  }
}

void WebDeckShell::CloseWindow(int32_t window_id) {
  if (BrowserWindowInterface* browser = FindBrowserById(window_id)) {
    browser->GetWindow()->Close();
  }
}

}  // namespace webdeck
