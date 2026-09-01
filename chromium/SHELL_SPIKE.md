# WebDeck window — shell spike (M153 patch-surface design)

> Read-only research spike against `chromium/src` at 153.0.8010.12. Every claim
> below is grounded in a file read in this tree; paths are relative to
> `chromium/src`. Where a claim is inference rather than something I read, it is
> marked **(assumption — verify: <file>)**.
>
> Companion to `SHELL_ARCHITECTURE.md`. Goal recap: a browser window whose whole
> content area is `chrome://webdeck` (the React shell), **no native tab strip or
> toolbar**, with the active tab's **real `WebContents`** overlaid on top of the
> shell, sized/clipped to a "stage" rect the shell computes in JS and streams to
> C++. This is the docked-DevTools model, generalized.

The headline finding: **M153 already contains a bounds-driven "one view fills the
container, a second view is positioned to a JS-supplied sub-rect, drawn above it"
layout — and it is the code that lays out docked DevTools.** WebDeck is a second
consumer of the exact same machinery (`DevToolsContentsResizingStrategy` +
`ContentsContainerView`), with the roles of the two child views swapped. We do not
need to invent the overlay/clip mechanism; we need to (a) suppress native
top-chrome, (b) add a shell `views::WebView` beside the existing contents view,
and (c) feed the resizing strategy from a Mojo `SetStageBounds` instead of from
DevTools' `setInspectedPageBounds`.

---

## 1. DevTools prior art (the mechanism we reuse)

### 1a. The resizing strategy — `DevToolsContentsResizingStrategy`

Defined in `chrome/browser/devtools/devtools_contents_resizing_strategy.h`:

```cpp
class DevToolsContentsResizingStrategy {
 public:
  DevToolsContentsResizingStrategy();
  DevToolsContentsResizingStrategy(devtools::DockSide dock_side,
                                   const gfx::Rect& bounds);
  const gfx::Rect& bounds() const { return bounds_; }
  bool hide_inspected_contents() const { return hide_inspected_contents_; }
  devtools::DockSide dock_side() const { return dock_side_; }
  ...
};

void ApplyDevToolsContentsResizingStrategy(
    const DevToolsContentsResizingStrategy& strategy,
    const gfx::Rect& container_bounds,
    gfx::Rect* new_devtools_bounds,
    gfx::Rect* new_contents_bounds);
```

The free function (in the `.cc`) is the whole trick. It **always gives the
"devtools" view the full container**, and gives the "contents" view the strategy's
sub-rect:

```cpp
void ApplyDevToolsContentsResizingStrategy(... ) {
  new_devtools_bounds->SetRect(container_bounds.x(), container_bounds.y(),
                               container_bounds.width(), container_bounds.height());
  const gfx::Rect& bounds = strategy.bounds();
  if (bounds.size().IsEmpty() && !strategy.hide_inspected_contents()) {
    new_contents_bounds->SetRect(... full container ...);   // no split
    return;
  }
  ... clamp bounds to container, enforce kMinDevToolsWidth/Height per dock_side ...
  new_contents_bounds->SetRect(left + container_bounds.x(),
                               top + container_bounds.y(), width, height);
}
```

The header comment states the z-model we want verbatim: *"page contents view is
placed atop of devtools inside a common parent view"*. For DevTools the two rects
tile (no visual overlap); for WebDeck we simply supply a sub-rect that sits inside
the shell, so the tab visually overlays the shell at the stage.

Note the `dock_side`-based minimum-size clamps (`kMinDevToolsWidth = 250`,
`kMinDevToolsHeight = 72`). WebDeck should pass **`devtools::DockSide::kNone`** so
`ApplyDevToolsContentsResizingStrategy` does no clamping and honors our stage rect
exactly (the `switch` only clamps for `kRight`/`kBottom`).

### 1b. JS → C++ bounds path — `setInspectedPageBounds`

The front-end WebUI calls `setInspectedPageBounds({x,y,width,height})`. It is
registered as an embedder command in
`chrome/browser/devtools/devtools_embedder_message_dispatcher.cc:350`:

```cpp
d->RegisterHandler("setInspectedPageBounds",
                   &Delegate::SetInspectedPageBounds, delegate);
```

which lands in `DevToolsWindow::SetInspectedPageBounds`
(`chrome/browser/devtools/devtools_window.cc:1749`):

```cpp
void DevToolsWindow::SetInspectedPageBounds(const gfx::Rect& rect) {
  devtools::DockSide dock_side = devtools::DockSide::kNone;
  if (is_docked_)
    dock_side = DevToolsSettings::GetDockSide(profile_);
  DevToolsContentsResizingStrategy strategy(dock_side, rect);
  if (contents_resizing_strategy_.Equals(strategy)) return;
  contents_resizing_strategy_.CopyFrom(strategy);
  UpdateBrowserWindow();     // triggers a relayout of the container
}
```

The strategy is later handed to the view layer through
`DevToolsWindow::GetInTabWebContents(inspected, &out_strategy)`
(`devtools_window.cc:600`), which copies `contents_resizing_strategy_` out.

**WebDeck replaces this whole path with a Mojo call.** `webdeck.mojom`'s
`SetStageBounds(gfx.mojom.Rect)` (§4) plays the role of `setInspectedPageBounds`;
the browser-side impl stores a `DevToolsContentsResizingStrategy(DockSide::kNone,
rect)` and invalidates the container layout — no DevTools front-end channel, no
`DevToolsWindow` involved.

### 1c. The container view + the layout call site

`ContentsContainerView`
(`chrome/browser/ui/views/frame/contents_container_view.{h,cc}`) is the common
parent of the two views. It holds both a `devtools_web_view_` (`views::WebView`)
and a `contents_view_` (`ContentsWebView`), plus the strategy:

```cpp
// contents_container_view.h
void SetContentsResizingStrategy(const DevToolsContentsResizingStrategy& strategy);
DevToolsContentsResizingStrategy& contents_resizing_strategy() { return strategy_; }
...
raw_ptr<views::WebView> devtools_web_view_ = nullptr;   // added first  (below)
raw_ptr<ContentsWebView> contents_view_ = nullptr;      // added later  (above)
DevToolsContentsResizingStrategy strategy_;
```

Child add-order in the ctor establishes z-order (devtools added first =
underneath; contents added after = on top), matching the header's "contents atop
devtools" note.

The bounds are applied every layout pass in
`ContentsContainerView::CalculateProposedLayout` (it is a
`views::LayoutDelegate` driven by a `DelegatingLayoutManager`):

```cpp
// contents_container_view.cc:481
gfx::Rect full_contents_bounds = GetContentsBounds();
gfx::Rect devtools_bounds, non_devtools_contents_bounds;
ApplyDevToolsContentsResizingStrategy(strategy_, full_contents_bounds,
                                      &devtools_bounds,
                                      &non_devtools_contents_bounds);
...
layouts.child_layouts.emplace_back(devtools_web_view_.get(),
    devtools_web_view_->GetVisible(), GetMirroredRect(devtools_bounds), ...);
...
layouts.child_layouts.emplace_back(contents_view_.get(),
    contents_view_->GetVisible(), GetMirroredRect(contents_view_bounds));
```

`SetContentsResizingStrategy` just stores + `InvalidateLayout()`
(`contents_container_view.cc:348`), so the next layout pass re-runs the apply.

### 1d. The wiring controller — how the strategy reaches the container

`DevtoolsUIController::DevtoolsWebViewController::UpdateDevtools`
(`chrome/browser/devtools/devtools_ui_controller.cc:116`) is the glue. It:

1. pulls the strategy: `DevToolsWindow::GetInTabWebContents(web_contents, &strategy)`;
2. puts the front-end WebContents in the view:
   `devtools_web_view->SetWebContents(devtools)`;
3. pushes the strategy to the container:
   `contents_container_view_->SetContentsResizingStrategy(strategy)`;
4. fixes z-order when the page must be hidden behind the front-end:
   ```cpp
   size_t devtools_index = ...GetIndexOf(devtools_web_view).value();
   size_t contents_index = ...GetIndexOf(contents_view).value();
   bool devtools_is_on_top = devtools_index > contents_index;
   if (strategy.hide_inspected_contents() != devtools_is_on_top)
     contents_container_view_->ReorderChildView(contents_view, devtools_index);
   ```

**How WebDeck reuses this (1-paragraph statement).** We keep
`ContentsContainerView`, `DevToolsContentsResizingStrategy`, and
`ApplyDevToolsContentsResizingStrategy` untouched. We add a **third** child view to
`ContentsContainerView` — a `shell_web_view_` (`views::WebView`) hosting the
`chrome://webdeck` WebContents — inserted **before** `contents_view_` so it is
drawn beneath it, and we make it fill the whole container (in
`CalculateProposedLayout`, give it `full_contents_bounds` just like
`devtools_web_view_`). The active tab's real `WebContents` already lives in
`contents_view_` (the browser sets it there on tab switch — see §5). We drive
`SetContentsResizingStrategy(DevToolsContentsResizingStrategy(DockSide::kNone,
stage_rect))` from our Mojo `SetStageBounds` instead of from DevTools. The result:
`contents_view_` is positioned to `stage_rect` and drawn above the shell, exactly
the geometry DevTools produces for the inspected page — only now the "front-end"
underneath is our React shell and the sub-rect is the stage.

---

## 2. Hosting the WebUI as window contents, native top-chrome hidden

### The predicates that decide top-chrome

Both live in `chrome/browser/ui/views/frame/browser_view.cc` and both defer to
`WindowFeatureController`:

- `BrowserView::ShouldDrawTabStrip()` (line 1384):
  ```cpp
  if (!WindowFeatureController::From(browser_)->SupportsWindowFeature(
          WindowFeatureController::WindowFeature::kFeatureTabStrip))
    return false;
  ```
- `BrowserView::IsToolbarVisible()` (line 3027):
  ```cpp
  return (WindowFeatureController::From(browser_)->SupportsWindowFeature(kFeatureToolbar) ||
          WindowFeatureController::From(browser_)->SupportsWindowFeature(kFeatureLocationBar))
         && toolbar_;
  ```

The Mac frame path inherits this — `browser_native_widget_mac.mm:264` gates on
`browser_view_->ShouldDrawTabStrip()`, so no separate Mac predicate patch is
needed.

### The decision hub

`WindowFeatureController::SupportsWindowFeatureImpl`
(`chrome/browser/ui/window_feature_controller/window_feature_controller.cc:166`)
switches on `browser_type_`:

```cpp
switch (browser_type_) {
  case TYPE_NORMAL:  return NormalBrowserSupportsWindowFeature(...);   // tabstrip+toolbar = true
  case TYPE_POPUP:   return PopupBrowserSupportsWindowFeature(...);    // both false
  case TYPE_APP:     return app_controller_ ? AppBrowserSupportsWindowFeature(...)
                                            : AppPopupBrowserSupportsWindowFeature(...);
  case TYPE_DEVTOOLS:
  case TYPE_APP_POPUP: return AppPopupBrowserSupportsWindowFeature(...);
  case TYPE_PICTURE_IN_PICTURE: ...
}
```

Constructed at
`chrome/browser/ui/browser_window/internal/browser_window_features.cc:315`, taking
`browser->GetType()` and `create_params().is_trusted_source`.

### Evaluating the options

- **App / PWA window (`TYPE_APP` + `AppBrowserController`)** — *rejected.*
  `AppBrowserSupportsWindowFeature` (window_feature_controller.cc:121) returns
  **`true` for `kFeatureToolbar`** (the app custom-tab-bar / origin chip) and
  `has_tab_strip()`-gated tabstrip. So an app window is *not* chrome-free, and
  pointing an `AppBrowserController` at a `chrome://` URL is off its intended path.
- **`TYPE_APP_POPUP` / `TYPE_POPUP`** — hides tabstrip + toolbar (both predicates
  return false), *but* these types deliberately shed normal-browser behavior we
  want to keep, and `DevtoolsUIController` only enables docking for `TYPE_NORMAL`
  (`devtools_ui_controller.cc:22`). Choosing a popup type would fight the tab
  backend we are trying to preserve.
- **New dedicated `Browser::Type`** — heaviest: every `switch (type)` across the
  browser (there are many) must grow a case; high churn, high rebase cost.

### Recommended approach (minimal hook)

**Keep `browser_type_ == TYPE_NORMAL`** (so `TabStripModel`, navigation, sessions,
DevTools-dockability, extensions all stay wired) and add a **single boolean flag**
that short-circuits the three top-chrome features:

1. Add `bool is_webdeck_window = false;` to `BrowserWindowCreateParams`
   (`chrome/browser/ui/browser_window/public/create_browser_window.h`, beside
   `is_trusted_source` at line 100).
2. Plumb it into the `WindowFeatureController` ctor at
   `browser_window_features.cc:317` (read it off
   `BrowserInitState::From(browser)->browser_window_create_params()`, exactly as
   `is_trusted_source` is read there today), and store `bool is_webdeck_window_;`
   on the controller.
3. Short-circuit at the top of `SupportsWindowFeatureImpl`:
   ```cpp
   if (is_webdeck_window_) {
     switch (feature) {
       case WindowFeature::kFeatureTabStrip:
       case WindowFeature::kFeatureToolbar:
       case WindowFeature::kFeatureLocationBar:
       case WindowFeature::kFeatureBookmarkBar:
         return false;
       default: break;   // title bar etc. fall through to normal behavior
     }
   }
   ```

That is the whole top-chrome suppression: `ShouldDrawTabStrip()` and
`IsToolbarVisible()` both fall to `false`, `BrowserViewLayout` then allots zero
height to those regions, and the contents container fills the window. Files
touched: `create_browser_window.h`, `window_feature_controller.{h,cc}`,
`browser_window_features.cc` — three upstream files, one predicate each.

**(assumption — verify: `chrome/browser/ui/views/frame/layout/browser_view_tabbed_layout_impl.cc`)** that the tabbed layout allocates the top-container regions purely from these predicates (it references both `ShouldDrawTabStrip` and `IsToolbarVisible`); confirm no separate min-height is forced when both are false.

---

## 3. Overlaying the tab WebContents, positioned by the WebUI

### Where the views live today

`BrowserView` owns a `MultiContentsView* multi_contents_view_`
(`browser_view.h:1205`), which owns a vector of `ContentsContainerView`
(`multi_contents_view.h:297`, `contents_container_views_`). Each
`ContentsContainerView` owns the single active-tab `ContentsWebView`
(`contents_view_`) plus the docked `devtools_web_view_` and a stack of overlays.
`BrowserView::GetActiveContentsContainerView()` (`browser_view.h:219`) returns the
active one. On tab switch, `BrowserView::OnActiveTabChanged`
(`browser_view.cc:1945`) calls `active_contents_view->SetWebContents(new_contents)`
— so **only the active tab's WebContents is ever in `contents_view_`**, which is
exactly the "only the active tab's view is visible" invariant we want, for free.

### The recommended structure

Reuse `ContentsContainerView` as the container. Add one sibling:

```
ContentsContainerView  (fills the window's contents region)
├── shell_web_view_   (views::WebView)  → chrome://webdeck   [added FIRST → beneath]
│      laid out to full_contents_bounds  (like devtools_web_view_ today)
├── devtools_web_view_ (unchanged; still available for docked DevTools on a tab)
└── contents_view_    (ContentsWebView) → active tab WebContents  [above]
       laid out to the stage sub-rect via the resizing strategy
```

Two concrete implementation options, in preference order:

**Option A (preferred): extend `ContentsContainerView` with a shell slot.**
Add `raw_ptr<views::WebView> shell_web_view_` constructed **before**
`contents_view_` in the ctor (so it is beneath in z-order), and in
`CalculateProposedLayout` emit `shell_web_view_` at `full_contents_bounds`
(copy the two lines that place `devtools_web_view_`). Gate all of this behind the
`is_webdeck_window` flag / a `SetWebDeckMode(true)` setter so stock windows are
byte-for-byte unchanged. The stage rect flows in through the **existing**
`SetContentsResizingStrategy(strategy_)`; `contents_view_` then lands on the stage
sub-rect automatically at `contents_container_view.cc:526-528`. This is the
smallest diff and rides the existing clip logic (`UpdateContentsClip()` at
`contents_container_view.cc:451` already calls
`contents_view_->holder()->SetNativeViewClipRect(...)`).

**Option B: a `WebDeckContentsContainerView : public ContentsContainerView`
subclass** that adds the shell view and overrides `CalculateProposedLayout`.
Cleaner isolation, but `CalculateProposedLayout` is large and not virtual-friendly
(it hard-codes the child list), so the override would duplicate ~200 lines and
rot against upstream. Prefer A.

### How the shell WebContents gets into `shell_web_view_`

Same pattern DevTools uses for its front-end: create a `content::WebContents` for
`chrome://webdeck` (its own `SiteInstance`, not a tab-strip entry) and call
`shell_web_view_->SetWebContents(shell_contents)` — mirroring
`devtools_web_view->SetWebContents(devtools)` at `devtools_ui_controller.cc:142`.
The `WebDeckUI` `WebUIController` is instantiated for that WebContents, and its
`BindInterface` (today `webdeck_ui.cc:170`) is where the shell's `Shell` receiver
(§4) is bound. Ownership of `shell_contents` should sit on a per-window
`WebDeckWindowController` (new; see §7), analogous to how `DevToolsWindow` owns
`main_web_contents_`.

**(assumption — verify: `chrome/browser/ui/views/frame/contents_web_view.cc`)**
that a plain `views::WebView` (not `ContentsWebView`) is an adequate host for the
shell — DevTools uses a bare `views::WebView` for `devtools_web_view_`, so this is
consistent, but confirm no `ContentsWebView`-specific behavior (background,
rounded-corner sync) is required for a WebUI host.

### Where bounds get applied each frame

`ContentsContainerView::CalculateProposedLayout` (driven by
`DelegatingLayoutManager`, invoked on every `InvalidateLayout`/resize). The stage
rect enters via `strategy_`; `SetStageBounds` → `SetContentsResizingStrategy` →
`InvalidateLayout` → next `CalculateProposedLayout` places `contents_view_` at the
stage and clips it. No per-frame Mojo chatter is required beyond the shell pushing
a new rect when its `ResizeObserver` fires.

---

## 4. The Mojo bridge (`webdeck.mojom` additions)

Grow the existing file
`chrome/browser/ui/webui/webdeck/webdeck.mojom` (which already declares
`AgentTabs`/`AgentTabsClient`). Add a new `Shell` + `ShellClient` pair — keep
`AgentTabs` as-is (it is the agent CDP surface and is orthogonal). Wiring mirrors
`AgentTabs`: a `BindInterface(mojo::PendingReceiver<mojom::Shell>)` on `WebDeckUI`,
a `std::unique_ptr<WebDeckShell>` member, and a `WEB_UI_CONTROLLER_TYPE` entry — the
same three-line pattern already in `webdeck_ui.{h,cc}` for `AgentTabs`.

```cpp
// Append to chrome/browser/ui/webui/webdeck/webdeck.mojom

// Drives the WebDeck window: the React shell is the window's contents, and the
// browser positions the active tab's real WebContents to the stage rect the
// shell streams here. Renderer(shell) -> Browser. Bound only for chrome://webdeck.
interface Shell {
  // --- tab lifecycle (shell -> browser) ---
  // Opens a real tab in THIS window's TabStripModel; returns its stable id.
  CreateTab(string url) => (int32 tab_id);
  SelectTab(int32 tab_id);
  CloseTab(int32 tab_id);
  Navigate(int32 tab_id, string url);
  Reload(int32 tab_id);
  GoBack(int32 tab_id);
  GoForward(int32 tab_id);

  // --- the stage (shell -> browser); the setInspectedPageBounds analogue ---
  // Rect is in the shell's CSS px, top-left origin, relative to the window's
  // contents region. device_scale_factor lets the browser convert to DIP if the
  // shell reports physical px; send 1.0 when already in DIP.
  SetStageBounds(gfx.mojom.RectF stage, float device_scale_factor);

  // Registers the observer channel for state pushed back to the shell.
  SetClient(pending_remote<ShellClient> client);
};

// Browser -> renderer(shell): navigation/tab state so the React tab strip and
// toolbar can render without owning the tabs.
interface ShellClient {
  // Full snapshot on attach and on tab-set changes.
  OnTabsChanged(array<TabInfo> tabs, int32 active_tab_id);
  // Per-tab navigation state (fires on each WebContents state change).
  OnTabNavigationStateChanged(int32 tab_id, TabInfo info);
  // A tab went away (closed/crashed).
  OnTabClosed(int32 tab_id);
};

struct TabInfo {
  int32 tab_id;
  string url;
  string title;
  bool can_go_back;
  bool can_go_forward;
  bool is_loading;
  string favicon_url;   // or send raw bytes later; URL keeps v1 simple
};
```

Add `import "ui/gfx/geometry/mojom/geometry.mojom";` at the top for
`gfx.mojom.RectF`. In the `mojom("mojo_bindings")` target
(`chrome/browser/ui/webui/webdeck/BUILD.gn`) add
`public_deps = [ "//ui/gfx/geometry/mojom" ]`.

**Direction summary**

| Call | Direction | Notes |
|---|---|---|
| `CreateTab/SelectTab/CloseTab/Navigate/Reload/GoBack/GoForward` | shell → browser | act on `TabStripModel` (§5) |
| `SetStageBounds` | shell → browser | → `DevToolsContentsResizingStrategy` (§1) |
| `SetClient` | shell → browser | hands over the observer remote |
| `OnTabsChanged / OnTabNavigationStateChanged / OnTabClosed` | browser → shell | pushed from `TabStripModelObserver` + `WebContentsObserver` |

The existing `AgentTabs::SetClient(pending_remote<AgentTabsClient>)` is the exact
precedent for the observer-remote handoff, and `WebDeckUI::BindInterface`
(`webdeck_ui.cc:170`) is the exact precedent for the receiver factory.

---

## 5. Tab backend — keep `TabStripModel`

Confirmed feasible; the fork already does the create-tab half of this in
`webdeck_agent_tabs.cc`. For the shell:

- **Create / navigate.** Use `NavigateParams` + `Navigate(&params)` exactly as
  `WebDeckAgentTabs::OpenTab` does (`webdeck_agent_tabs.cc:116`):
  ```cpp
  NavigateParams params(browser, GURL(url), ui::PAGE_TRANSITION_AUTO_TOPLEVEL);
  params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
  Navigate(&params);
  content::WebContents* wc = params.navigated_or_inserted_contents;
  ```
  For per-index inserts, `chrome::AddTabAt(browser, url, index, foreground)` is the
  simpler wrapper. **(assumption — verify: `chrome/browser/ui/browser_tabstrip.h`)**
  that `chrome::AddTabAt` exists with that signature in this tree.
- **Select / close.** `browser->GetTabStripModel()->ActivateTabAt(index)` and
  `CloseWebContentsAt(index, flags)`. The `Browser`/`TabStripModel` handle from the
  WebDeck window is reachable the same way `AgentTabs` reaches the user's window
  (`ProfileBrowserCollection::GetForProfile(profile_)->FindTabbedBrowser()`), but
  the shell must target **its own** window, so the `WebDeckShell` impl should be
  constructed with the owning `BrowserWindowInterface*`/`Browser*` (available from
  the WebUI's WebContents → hosting window) rather than searching for any window.
- **Back / forward / reload.** On the tab's `content::WebContents`:
  `wc->GetController().GoBack()/GoForward()/Reload(...)`.
- **Push state back.** The `WebDeckShell` implements both
  `TabStripModelObserver` (tab set / active index changes → `OnTabsChanged`) and,
  per tab, `content::WebContentsObserver` (`DidStartLoading`,
  `DidStopLoading`, `NavigationEntryCommitted`, `TitleWasSet`,
  `DidUpdateFaviconURL`) → `OnTabNavigationStateChanged`. `can_go_back/forward`
  come from `wc->GetController().CanGoBack()/CanGoForward()`.
- **Mapping ids.** Keep a `std::map<int32 tab_id, ...>` in `WebDeckShell`. Prefer a
  stable id keyed on the tab's `SessionID`/`tabs::TabHandle` rather than the live
  strip index (indices shift on insert/close). **(assumption — verify:
  `components/tabs/public/tab_interface.h`)** for the stable-handle type in M153.
- **Threading / lifetime.** All of this is **UI-thread** (`TabStripModel`,
  `WebContents`, views). `WebDeckShell` lifetime is bound to the shell WebUI page
  (rebinding drops the old one, as the `AgentTabs` comment at `webdeck_ui.cc:172`
  notes). It must outlive nothing it observes: deregister observers in the dtor,
  and null-check the `Browser*` (window can close under it). No cross-thread hops
  are needed, unlike the core-service path (which is `MayBlock` off-thread).

---

## 6. Input, focus, z-order — the real risks (and DevTools' answers)

- **Event routing to the overlaid tab vs. shell beneath.** Because `contents_view_`
  is a real native view placed above the shell at the stage rect, OS hit-testing
  routes events over the stage to the tab and everything else to the shell — this
  is precisely how a docked inspected page and the front-end coexist, so it works
  out of the box for non-overlapping rects. **Risk:** if the shell ever draws
  interactive chrome *over* the stage rect (e.g. a floating control), those pixels
  are occluded by the native tab view and become dead to input. DevTools sidesteps
  this by never overlapping. Mitigation options seen in-tree: glic sets
  `SetCanProcessEventsWithinSubtree(false)` on its border overlay
  (`contents_container_view.cc:158`) to make a sibling event-transparent — use the
  same for any shell decoration that must sit visually above the stage.
- **Focus traversal.** DevTools installs a `views::ExternalFocusTracker`
  (`devtools_ui_controller.cc:133`) so focus restores correctly when the front-end
  view appears/disappears. WebDeck needs the analogous tracker between
  `shell_web_view_` and `contents_view_`, and should add both to the accessible
  pane order (see `ContentsContainerView::GetAccessiblePanes`,
  `contents_container_view.cc:185`, which already lists contents + devtools).
- **Occlusion / background tabs painting.** Handled by the tab model already: only
  the active tab's WebContents is in `contents_view_` (`OnActiveTabChanged` →
  `SetWebContents`), inactive tabs' WebContents are hidden by the strip machinery.
  No background tab paints because it is not in any visible view. **Risk:** if we
  ever hold >1 tab view for cross-fade, we must call `SetWebContents(nullptr)` on
  the outgoing one (the pattern at `browser_view.cc:1957-1958`).
- **Fullscreen HTML.** A page entering fullscreen wants the whole window, which
  breaks the stage framing. DevTools' `SetInspectedPageBounds`/`UpdateBrowserWindow`
  re-lays-out on state change; WebDeck must, on `WebContentsObserver`
  fullscreen-enter, either push a full-window stage rect (shell animates out of the
  way) or temporarily bypass the strategy. **Flag for design:** decide whether HTML
  fullscreen suspends the shell overlay entirely. **(assumption — verify:
  `content/public/browser/web_contents_delegate.h` `EnterFullscreenModeForTab`.)**
- **Rounded corners / clip.** `ContentsContainerView` already clips the native view
  (`UpdateContentsClip`, `contents_container_view.cc:451`) and syncs corner radii
  (`SetBorderRoundedCornersFrom`). The stage can therefore be a rounded, inset
  rect without extra plumbing.

---

## 7. Minimal patch list — milestone "one tab, positioned to the stage"

Smallest end-to-end proof: a `is_webdeck_window` browser shows `chrome://webdeck`
full-bleed with no tab strip/toolbar; the shell calls `CreateTab(url)` once and
streams a `SetStageBounds` rect; one real `WebContents` renders clipped to that
rect over the shell. Ordered so each step is independently checkable.

### New files (fork-owned)

1. `chrome/browser/ui/webui/webdeck/webdeck.mojom` — **edit** (grow with `Shell` /
   `ShellClient` / `TabInfo`; §4).
2. `chrome/browser/ui/webui/webdeck/webdeck_shell.{h,cc}` — **new.** Implements
   `mojom::Shell`, `TabStripModelObserver`, and owns per-tab
   `WebContentsObserver`s. Constructed with the owning window + `Profile`. Mirrors
   `webdeck_agent_tabs.{h,cc}` in shape.
3. `chrome/browser/webdeck/webdeck_window_controller.{h,cc}` — **new.** Per-window
   object that creates/owns the `chrome://webdeck` shell `WebContents`, installs it
   into `shell_web_view_`, and bridges `SetStageBounds` →
   `ContentsContainerView::SetContentsResizingStrategy`. Analogous to
   `DevToolsWindow` owning `main_web_contents_` + `contents_resizing_strategy_`.
4. `chrome/browser/ui/webui/webdeck/BUILD.gn` — **edit** (add `webdeck_shell.*` to
   `:impl`, add `//ui/gfx/geometry/mojom` dep to `:mojo_bindings`, add
   `//chrome/browser/ui/tabs`/`//content/public/browser` deps).
5. `webdeck_ui.{h,cc}` — **edit.** Add `BindInterface(PendingReceiver<mojom::Shell>)`
   + a `std::unique_ptr<WebDeckShell> shell_` member, mirroring the existing
   `AgentTabs` binding at `webdeck_ui.cc:170`.

### Upstream files to patch (name the exact hook)

6. `chrome/browser/ui/browser_window/public/create_browser_window.h` — add
   `bool is_webdeck_window = false;` to `BrowserWindowCreateParams` (beside
   `is_trusted_source`, line 100).
7. `chrome/browser/ui/window_feature_controller/window_feature_controller.h/.cc` —
   add `is_webdeck_window_` member; in **`SupportsWindowFeatureImpl`** (line 166)
   short-circuit `kFeatureTabStrip/kFeatureToolbar/kFeatureLocationBar/
   kFeatureBookmarkBar` → `false` when the flag is set (§2).
8. `chrome/browser/ui/browser_window/internal/browser_window_features.cc` — at the
   `CreateInstance<WindowFeatureController>(...)` call (line 315) pass the new flag
   from `browser_window_create_params().is_webdeck_window`.
9. `chrome/browser/ui/views/frame/contents_container_view.h/.cc` — add
   `raw_ptr<views::WebView> shell_web_view_` (constructed before `contents_view_`
   in the ctor, ~line 84, so it is beneath), a `SetShellWebContents(WebContents*)`
   setter, and in **`CalculateProposedLayout`** (line 481) emit `shell_web_view_`
   at `full_contents_bounds` when present (copy the two `devtools_web_view_`
   `emplace_back` lines). Guard behind the WebDeck flag so stock windows are
   unchanged.
10. **Window creation entry point** — wherever the WebDeck window is spawned, set
    `create_params.type = TYPE_NORMAL; create_params.is_webdeck_window = true;` and,
    after `BrowserView` init, hand the active `ContentsContainerView`
    (`BrowserView::GetActiveContentsContainerView()`, `browser_view.h:219`) to the
    new `WebDeckWindowController` so it can install the shell view. **(assumption —
    verify: the fork's existing app-launch/omaha path for where to trigger this;
    candidate is a new `chrome://` app entry or a command-line flag.)**

### Deliberately NOT in the first milestone

- DevTools-on-a-WebDeck-tab z-order interplay (both `devtools_web_view_` and the
  stage want the sub-rect) — defer; the two can't both be active in v1.
- Favicon bytes, tab reordering/drag, multi-window, Stage reveal animation,
  presets. All ride on top of the same `SetStageBounds` + `TabStripModel` spine.

---

## Open questions to resolve next (named files to read)

- `chrome/browser/ui/views/frame/layout/browser_view_tabbed_layout_impl.cc` — confirm
  the contents region truly fills the window when both top-chrome predicates are
  false (no forced min top-container height).
- `chrome/browser/ui/browser_tabstrip.h` / `chrome/browser/ui/browser_commands.h` —
  confirm `chrome::AddTabAt` / activate / close signatures in M153.
- `components/tabs/public/tab_interface.h` — the stable tab-handle type for id
  mapping (indices are unstable).
- `chrome/browser/ui/views/frame/contents_web_view.cc` — whether a bare
  `views::WebView` suffices for the shell host or a `ContentsWebView` is needed for
  background/corner behavior.
- The fork's window-spawn path (app launcher / flag) — the concrete site to set
  `is_webdeck_window` and construct the `WebDeckWindowController`.

---

## Verification (M153)

> Read-only pass against the real tree at `/Volumes/BG_Dev/webdeck-chromium/chromium/src`
> (VERSION = 153.0.8010.12). Every line number below was read from the tree on
> this pass. Verdicts: **CONFIRMED** = doc's claim holds as written;
> **CORRECTED** = claim was wrong or imprecise, real code given.

### 1. Top-chrome suppression fills the window — **CONFIRMED**

`BrowserViewTabbedLayoutImpl::CalculateTopContainerLayout`
(`layout/browser_view_tabbed_layout_impl.cc:1249`) allocates the top container
purely from the visibility predicates, with **no forced minimum height**:

```cpp
// :1272  toolbar only advances the top when visible
const bool toolbar_visible = delegate().IsToolbarVisible();
if (IsParentedTo(views().toolbar, views().top_container)) {
  gfx::Rect toolbar_bounds;
  if (toolbar_visible) { ... params.SetTop(toolbar_bounds.bottom()); needs_exclusion = false; }
  layout.AddChild(views().toolbar, toolbar_bounds, toolbar_visible);   // empty rect + invisible when false
}
// :1290  bookmark bar has 0 height when not visible
const bool bookmarks_visible = delegate().IsBookmarkBarVisible();
... bookmarks_visible ? bookmark_bar->GetPreferredSize().height() : 0 ...
// :1315  returned top-container height == how far the top advanced
return gfx::Rect(params.visual_client_area.x(), original_top,
                 params.visual_client_area.width(),
                 params.visual_client_area.y() - original_top);
```

`GetTabStripType()` (`:570`) returns `TabStripType::kNone` when
`ShouldDrawTabStrip()` is false, and `GetMinimumTabStripSize` returns empty for
`kNone` (`:304`). With tabstrip=none + toolbar invisible + bookmarks invisible,
the returned rect height is **0**; back in `CalculateProposedLayout` the top
container's early-layout branch (`:882`) sets `params.SetTop(bounds.bottom())`
to the unchanged top, and `multi_contents_view` is then given the full
`params.visual_client_area` height (`:1106-1110`). Contents fills the window.

Caveat that validates the doc's own §2 short-circuit: `NormalBrowserSupportsWindowFeature`
returns `true` **unconditionally** for `kFeatureBookmarkBar`
(`window_feature_controller.cc:81-82`), so the WebDeck short-circuit **must**
include `kFeatureBookmarkBar` (the doc's list does — good) or the bookmark bar
would still take height.

### 2. WindowFeatureController hook — **CONFIRMED** (with a ctor-signature note)

- `SupportsWindowFeatureImpl` at `window_feature_controller.cc:166` switches on
  `browser_type_` (`:169-186`), dispatching to `NormalBrowserSupportsWindowFeature`
  etc. Doc's line 166 is exact.
- Construction: `browser_window_features.cc:316`
  `GetUserDataFactory().CreateInstance<WindowFeatureController>(...)`, reading
  `BrowserInitState::From(browser)->browser_window_create_params().is_trusted_source`
  at `:319-321`. (Doc said "near line 315" — actual 316-322.) CONFIRMED.
- `BrowserWindowCreateParams::is_trusted_source` is at
  `create_browser_window.h:100` **exactly**. CONFIRMED.
- Enum `WindowFeatureController::WindowFeature` is in
  `window_feature_controller.h:27-34`: `kFeatureNone, kFeatureTitleBar,
  kFeatureTabStrip, kFeatureToolbar, kFeatureLocationBar, kFeatureBookmarkBar`.
  All four names the doc relies on exist, exact spelling. CONFIRMED.
- **Note for the implementer:** `is_trusted_source` is a **constructor parameter**
  (`.h:36-41`, `.cc:15-25`), not read off create-params inside the controller.
  Adding `is_webdeck_window` therefore means (a) a new ctor param + `const bool
  is_webdeck_window_;` member, AND (b) passing it at the `CreateInstance<>` call
  in `browser_window_features.cc:316`. The doc's §7 item 7 says "add member" but
  omits the ctor-signature + call-site change — see patch-list corrections below.

### 3. ContentsContainerView shape — **CONFIRMED** (line numbers corrected)

- Holds `devtools_web_view_` (bare `views::WebView`, ctor `:73-77`) and
  `contents_view_` (`ContentsWebView`, ctor `:84-86`). `contents_view_` is added
  after devtools ⇒ drawn above. z-order matches the doc.
- `CalculateProposedLayout` starts at `:465` (doc said 481; 481 is the
  `GetContentsBounds()` line inside it). `ApplyDevToolsContentsResizingStrategy`
  is called at **`:487-489`**; `devtools_web_view_` is emplaced at **`:494-497`**;
  `contents_view_` is emplaced at **`:527-528`** (rect built at `:526`). Doc's
  481/526 were close but the apply/emplace lines are 487/494/527.
- `SetContentsResizingStrategy` = store + `InvalidateLayout()` at **`:348-356`**.
  CONFIRMED (doc's 348).
- `UpdateContentsClip()` → `contents_view_->holder()->SetNativeViewClipRect(...)`
  at **`:451`**. CONFIRMED.
- Adding a third `views::WebView` shell child is **compatible**, with two
  must-dos: (1) construct it **before** `contents_view_` — insert right after
  `toast_anchor_view_` (`:82`) so it lands beneath contents (and above the
  bottom-most `devtools_web_view_`); (2) it **must** be added to
  `layouts.child_layouts` in `CalculateProposedLayout` (copy the devtools
  `emplace_back` at `:494-497` with `full_contents_bounds`) — children absent
  from the proposed layout are not repositioned. The `GetChildrenInZOrder()`
  DCHECK (`:328-337`) only requires `capture_contents_border_view_` to stay
  `back()`, which an earlier insert does not disturb.

### 4. DevToolsContentsResizingStrategy API — **CONFIRMED**

- Ctor `DevToolsContentsResizingStrategy(devtools::DockSide, const gfx::Rect&)`
  at `devtools_contents_resizing_strategy.h:18`.
- Free function `ApplyDevToolsContentsResizingStrategy(...)` at the `.cc:37`;
  always gives devtools the full container (`:42-44`), contents the sub-rect.
- `DockSide::kNone` hits `case DockSide::kLeft: case DockSide::kNone: break;`
  (`.cc:79-81`) ⇒ **no min-size clamp**. CONFIRMED.
- `devtools::DockSide` is `enum class DockSide { kNone, kLeft, kRight, kBottom };`
  in **`chrome/browser/devtools/devtools_dock_side.h:10`**.
- **Watch-out (new):** the ctor computes
  `hide_inspected_contents_ = bounds_.IsEmpty() && !bounds_.x() && !bounds_.y()`
  (`.cc:21-22`). A **non-empty** stage rect gives the intended behavior; passing
  an empty rect at the origin sets `hide_inspected_contents_` and the apply path
  clamps contents to a 0-size rect. WebDeck always sends a real stage rect, so
  this is a non-issue — just never send an empty one.

### 5. Tab backend signatures — **CORRECTED** (AddTabAt) + rest CONFIRMED

- **CORRECTED:** `chrome::AddTabAt` exists but its first arg is
  **`BrowserWindowInterface*`, not `Browser*`** (`browser_tabstrip.h:44`):
  ```cpp
  void AddTabAt(BrowserWindowInterface* browser, const GURL& url, int index,
                bool foreground, std::optional<tab_groups::TabGroupId> group = std::nullopt,
                bool pinned = false);
  ```
  There is also `chrome::AddAndReturnTabAt(BrowserWindowInterface*, const GURL&,
  int index, bool foreground, ...)` (`:35`) which returns the new
  `content::WebContents*` — prefer this when you need the contents.
- `TabStripModel` (`chrome/browser/ui/tabs/tab_strip_model.h`), all CONFIRMED,
  with two signature notes:
  - `int count() const;` (`:231`)
  - `content::WebContents* GetActiveWebContents() const;` (`:434`)
  - `content::WebContents* GetWebContentsAt(int index) const;` (`:445`)
  - `void ActivateTabAt(int index, TabStripUserGestureDetails gesture_detail = ...)`
    (`:378`) — takes gesture details, not a bool.
  - `void CloseWebContentsAt(int index, uint32_t close_types)` (`:330`) — takes a
    `uint32_t` close-type mask (e.g. `TabCloseTypes::CLOSE_NONE`).
  - Free function to close by contents:
    `chrome::CloseWebContents(BrowserWindowInterface*, content::WebContents*, bool add_to_history)`.
- `NavigateParams` + `Navigate(&params)` CONFIRMED verbatim at
  `webdeck_agent_tabs.cc:116-120`:
  ```cpp
  NavigateParams params(browser, target, ui::PAGE_TRANSITION_AUTO_TOPLEVEL);
  params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
  Navigate(&params);
  content::WebContents* contents = params.navigated_or_inserted_contents;
  ```
  (Here `browser` is a `BrowserWindowInterface*` from
  `ProfileBrowserCollection::GetForProfile(profile_)->FindTabbedBrowser()`; the
  shell must instead target its **own** window.)

### 6. Stable tab id — **CONFIRMED**, with a simpler recommendation

- The stable per-tab handle is **`tabs::TabHandle` = `TabInterface::Handle`**
  (`components/tabs/public/tab_interface.h:360`; `class TabInterface : public
  SupportsTabHandles`, `:80`). It is backed by a **32-bit signed int**:
  `Handle::raw_value()` / `handle_value()` return `int32_t`
  (`components/tabs/public/supports_handles.h:204,227-228`).
- WebContents → id: `tabs::TabInterface::GetFromContents(web_contents)`
  (`tab_interface.h:92`) → `->GetHandle().raw_value()`.
- id → WebContents: `tabs::TabHandle(id).Get()` → `TabInterface*` (nullptr if the
  tab is gone) → `->GetContents()`.
- **Recommendation:** key the mojom `int32 tab_id` **directly on
  `TabHandle::raw_value()`** — do not maintain a separate `std::map<int32,...>`
  as the doc's §5 suggests; the handle *is* the stable int32, survives
  insert/close reordering, and self-invalidates via `.Get() == nullptr`. (Handles
  don't persist across process restart, but neither does the window, so that's
  irrelevant here.)

### 7. Shell host view type — **CONFIRMED**: a bare `views::WebView` suffices

DevTools hosts its front-end in a **bare `views::WebView`** (`devtools_web_view_`,
ctor `contents_container_view.cc:73-77`), not a `ContentsWebView`.
`ContentsWebView` (`contents_web_view.h`) adds only tab-contents concerns —
status bubble, `SetBackgroundVisible`/`SetBackgroundRadii`, holder clip &
rounded-corner sync, modal-blocked state, layer cloning for the close-handler —
none of which a `chrome://webdeck` WebUI front-end needs. Use a bare
`views::WebView` for `shell_web_view_` and `SetWebContents(shell_contents)`, the
same way DevTools does. (If you later want the shell to honor window rounded
corners, mirror the one `devtools_web_view_->holder()->SetNativeViewCornerRadii`
call in `SetBorderRoundedCornersFrom` — optional, not needed for milestone 1.)

### 8. Window-spawn entry point — **RESOLVED** (and a doc open-question CORRECTED)

- **CORRECTED / important:** there is **no separate `Browser::CreateParams`** in
  M153. `Browser::Create(BrowserWindowCreateParams params)` and
  `explicit Browser(BrowserWindowCreateParams params)` take
  `BrowserWindowCreateParams` **directly** (`chrome/browser/ui/browser.h:207,216`;
  no `CreateParams` struct or alias exists in `browser.h`). So `Browser::CreateParams`
  and `BrowserWindowCreateParams` are effectively **one struct** now — adding
  `is_webdeck_window` to `BrowserWindowCreateParams` threads it to **both** the
  `Browser` and (via `BrowserInitState`) the `WindowFeatureController`. This
  answers the doc's §8 open question directly.
- **Fork startup is NOT customized.** `patches/branding.diff` only renames the
  product; `patches/upstream-edits.diff` only wires the WebUI
  (registers `WebDeckUIConfig`, the `AgentTabs` mojo binder in
  `chrome_browser_interface_binders_webui.cc`, BUILD.gn deps, resources, and the
  `kChromeUIWebDeckHost`/`kChromeUIWebDeckUntrustedURL` constants). **No window
  spawn exists today — `chrome://webdeck` is only a registered URL.**
- **Concrete recommendation (least-invasive first milestone):** gate a new
  `--webdeck` switch in **`StartupBrowserCreatorImpl::OpenTabsInBrowser`,
  `chrome/browser/ui/startup/startup_browser_creator_impl.cc:337`**, where the
  initial `TYPE_NORMAL` window is built:
  ```cpp
  // startup_browser_creator_impl.cc ~:337
  BrowserWindowCreateParams params(profile_, false);
  params.creation_source = BrowserWindowCreateParams::CreationSource::kStartupCreator;
  if (command_line_->HasSwitch(switches::kWebDeck))   // NEW switch
    params.is_webdeck_window = true;                  // NEW field (item 6 in §7)
  ...
  CreateBrowserWindow(std::move(params));             // :350
  ```
  Then force the startup tab set to `{chrome://webdeck}` when the switch is
  present (steer `DetermineStartupTabs` / `StartupTabProvider::GetCommandLineTabs`,
  or override the `tabs` list feeding `OpenTabsInBrowser`). Register
  `switches::kWebDeck` in `chrome/common/chrome_switches.{h,cc}`.
  For milestone 1 this alone gives a full-bleed `chrome://webdeck` window with no
  tabstrip/toolbar/bookmarks; wiring the shell into `shell_web_view_` + the
  `WebDeckWindowController` (the overlay/stage machinery) is the next milestone.
- Target **`chrome://webdeck`** (what `webdeck_ui.cc:96-98` actually registers via
  `kChromeUIScheme` + `kChromeUIWebDeckHost`). Note the fork *also* declares a
  `chrome-untrusted://webdeck/` constant (`kChromeUIWebDeckUntrustedURL`) that is
  not currently the registered controller — don't point the window at it by
  mistake.

### Go / No-go + corrections to the patch list (§7)

**GO.** Every load-bearing mechanism the design depends on is confirmed present:
the resizing strategy + `ContentsContainerView` overlay, the `WindowFeatureController`
predicate hub, the `TabStripModel`/`NavigateParams` backend, the stable
`TabHandle` int32, and a clean startup hook. No assumption turned out to *block*
the approach.

Assumptions/claims that were **FALSE or imprecise** and must change in §7:

1. **`Browser::CreateParams` does not exist** (item 10 / §8 open question). Use
   `BrowserWindowCreateParams` — it is the single params struct in M153.
2. **`chrome::AddTabAt` takes `BrowserWindowInterface*`, not `Browser*`** (item in
   §5). Also prefer `AddAndReturnTabAt` for the returned `WebContents*`.
3. **`WindowFeatureController` ctor signature must change** (item 7). The doc says
   "add `is_webdeck_window_` member" but the flag is a **constructor parameter**
   (like `is_trusted_source`), so the ctor in `window_feature_controller.{h,cc}`
   AND the `CreateInstance<WindowFeatureController>` call at
   `browser_window_features.cc:316` (not 315) both change.
4. **Line-number drift in item 9:** `CalculateProposedLayout` is at
   `contents_container_view.cc:465`; the devtools emplace to copy is `:494-497`;
   contents emplace is `:527`. Insert `shell_web_view_` in the ctor right after
   `toast_anchor_view_` (`:82`), before `contents_view_` (`:84`).

**Missing from the patch list** (add these):

5. **New command-line switch:** `chrome/common/chrome_switches.{h,cc}` — declare
   `switches::kWebDeck` ("webdeck"). Not listed in §7.
6. **Startup tab steering:** item 10 sets the flag but never says how
   `chrome://webdeck` gets loaded. Add the step that forces the startup tab list
   to `{chrome://webdeck}` under `--webdeck` (in `startup_browser_creator_impl.cc`
   / `startup_tab_provider.cc`).
7. **Mojo binder registration for `Shell`:** the interface is reachable only if
   registered in `chrome/browser/chrome_browser_interface_binders_webui.cc`
   alongside the existing
   `RegisterWebUIControllerInterfaceBinder<webdeck::mojom::AgentTabs, WebDeckUI>`
   (added by `upstream-edits.diff`). §4/§7 mention the `WebDeckUI::BindInterface`
   overload but omit this binder line, without which `SetStageBounds`/`CreateTab`
   are unreachable from the page.
