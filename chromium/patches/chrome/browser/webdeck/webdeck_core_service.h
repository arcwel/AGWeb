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

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

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

  // Where the core keeps its per-user data — settings, secrets, staged file
  // drops. The browser resolves this rather than letting the core fall back to
  // its own default, because both processes need the SAME answer: a dropped
  // file is written by the core and then opened by the browser, and two
  // independent guesses at "the user data directory" is exactly how that drop
  // ended up pointing at a file that was never there. Honours
  // $WEBDECK_USER_DATA, else ~/.webdeck — the core's own default, so nothing
  // moves for an existing install.
  static base::FilePath UserDataDir();

  // The key the browser signs file grants with, shared only with the core.
  //
  // The shell may name any path it likes to the core; the core opens one only
  // when the browser has vouched for it, because the user picked it in the
  // browser's own panel or dropped it on the window. That signature is what
  // separates "the user chose this file" from "the page asked for this file",
  // and it works only as long as the page never holds the key — so this is
  // passed to the core in its environment and never reaches a renderer.
  const std::vector<uint8_t>& grant_key() const;

  // Sign one absolute path for the core to accept, base64. Empty if the core
  // is not up, which is also the only state in which nothing can be granted.
  std::string SignFileGrant(const base::FilePath& path) const;

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
  std::vector<uint8_t> grant_key_;
  // Holds the port file; removed on shutdown.
  base::FilePath runtime_dir_;
  int port_ = 0;
  SEQUENCE_CHECKER(sequence_checker_);
};

}  // namespace webdeck

#endif  // CHROME_BROWSER_WEBDECK_WEBDECK_CORE_SERVICE_H_
