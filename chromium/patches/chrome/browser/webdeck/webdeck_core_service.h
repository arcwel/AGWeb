// Copyright 2026 Arcwel. All rights reserved.
//
// Owns the `webdeck-core` child process — the IDE/agent service the WebDeck UI
// talks to. The browser spawns it once, waits for it to publish the loopback
// port it chose, and hands that port to chrome://webdeck. Keeping the logic in
// a separate process (rather than in the browser process) is deliberate: it is
// the same service the Electron build runs today, it can be restarted without
// taking the browser with it, and it keeps Node out of the browser process.

#ifndef CHROME_BROWSER_WEBDECK_WEBDECK_CORE_SERVICE_H_
#define CHROME_BROWSER_WEBDECK_WEBDECK_CORE_SERVICE_H_

#include <optional>
#include <string>
#include <string_view>

#include "base/files/file_path.h"
#include "base/no_destructor.h"
#include "base/process/process.h"
#include "base/sequence_checker.h"

namespace webdeck {

class WebDeckCoreService {
 public:
  static WebDeckCoreService* GetInstance();

  WebDeckCoreService(const WebDeckCoreService&) = delete;
  WebDeckCoreService& operator=(const WebDeckCoreService&) = delete;

  // Spawns the core if it is not already running, and blocks briefly until it
  // publishes its port. Safe to call repeatedly.
  void EnsureStarted();

  // The loopback port the core is serving on, or 0 if it is not up.
  int port() const;

  // The per-boot credential the core requires from every client. A loopback
  // port is reachable by every process running as this user, and the core
  // serves their files, terminals and API keys — so the port alone is not a
  // boundary. Empty until the core has published one.
  const std::string& token() const;

  // Terminates the child and removes its runtime directory.
  void Shutdown();

  // What the core publishes for the browser to connect with.
  struct Handoff {
    int port = 0;
    std::string token;
  };

  // Reads `{"port":N,"token":"..."}` as written by the core. Returns nullopt
  // unless BOTH are present and well-formed: a handoff missing its token would
  // mean a core whose socket accepts anyone, and connecting to it anyway would
  // hide exactly the failure worth noticing. Exposed for testing.
  static std::optional<Handoff> ParsePortFile(std::string_view contents);

 private:
  friend class base::NoDestructor<WebDeckCoreService>;

  WebDeckCoreService();
  ~WebDeckCoreService();

  // Resolves the bundled `webdeck-core` executable next to the browser binary.
  base::FilePath ResolveCorePath() const;

  base::Process process_;
  std::string token_;
  // Holds the port file; removed on shutdown.
  base::FilePath runtime_dir_;
  int port_ = 0;
  SEQUENCE_CHECKER(sequence_checker_);
};

}  // namespace webdeck

#endif  // CHROME_BROWSER_WEBDECK_WEBDECK_CORE_SERVICE_H_
