// Copyright 2026 Arcwel. All rights reserved.

#include "chrome/browser/webdeck/webdeck_shell_host.h"

#include <map>

#include <fcntl.h>
#include <unistd.h>

#include <cstdlib>

#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
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

// Keyed by the window, like the command forwarder: Chromium's file drop is a
// window-level event, and the shell that answers it is the window's own.
std::map<BrowserWindowInterface*, FilesDropForwarder>& DropForwarders() {
  static base::NoDestructor<std::map<BrowserWindowInterface*, FilesDropForwarder>>
      forwarders;
  return *forwarders;
}
}  // namespace

void SetFilesDropForwarder(BrowserWindowInterface* window,
                           FilesDropForwarder forwarder) {
  DropForwarders()[window] = std::move(forwarder);
}

void ClearFilesDropForwarder(BrowserWindowInterface* window) {
  DropForwarders().erase(window);
}

void RecordDropNote(const std::string& line) {
  // Plain POSIX on purpose. This runs on the UI thread mid-drag, and each
  // layer that could refuse it — a blocking-call assertion, a log level the
  // shipped build filters, a path service that answers differently in a
  // packaged app — is a way for the only record of what happened to vanish
  // without saying so. Appending one line to a file under $HOME has none of
  // those failure modes.
  LOG(INFO) << "webdeck: " << line;
  const char* home = getenv("HOME");
  if (!home) {
    return;
  }
  const std::string path = std::string(home) + "/.webdeck/drops.log";
  const int fd = open(path.c_str(), O_WRONLY | O_APPEND | O_CREAT, 0644);
  if (fd < 0) {
    return;
  }
  const std::string text = line + "\n";
  ssize_t written = write(fd, text.data(), text.size());
  (void)written;
  close(fd);
}

std::vector<base::FilePath> ForwardDroppedFiles(
    BrowserWindowInterface* window,
    const std::vector<base::FilePath>& paths) {
  auto it = DropForwarders().find(window);
  const bool has_shell = it != DropForwarders().end();
  RecordDropNote(base::StrCat({base::NumberToString(paths.size()),
                           " file(s) dropped on a window, shell ",
                           has_shell ? "listening" : "NOT listening"}));
  if (paths.empty() || !has_shell) {
    return paths;
  }
  std::vector<base::FilePath> unclaimed = it->second.Run(paths);
  RecordDropNote(base::StrCat({"shell took ",
                           base::NumberToString(paths.size() - unclaimed.size()),
                           " of ", base::NumberToString(paths.size())}));
  return unclaimed;
}

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
