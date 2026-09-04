// Copyright 2026 Arcwel. All rights reserved.

#include "chrome/browser/webdeck/webdeck_core_service.h"

#include <optional>
#include <string>
#include <string_view>

#include "base/base64.h"
#include "base/command_line.h"
#include "base/containers/span.h"
#include "base/rand_util.h"
#include "base/environment.h"
#include "base/files/file_util.h"
#include "base/json/json_reader.h"
#include "base/logging.h"
#include "base/strings/string_util.h"
#include "base/path_service.h"
#include "base/process/launch.h"
#include "base/threading/platform_thread.h"
#include "base/threading/scoped_blocking_call.h"
#include "base/time/time.h"
#include "base/values.h"
#include "components/version_info/version_info.h"
#include "crypto/hmac.h"
#include "build/build_config.h"

namespace webdeck {
namespace {

// The bundled service, shipped beside the browser binary.
#if BUILDFLAG(IS_WIN)
constexpr base::FilePath::CharType kCoreBinary[] =
    FILE_PATH_LITERAL("webdeck-core.exe");
#else
constexpr base::FilePath::CharType kCoreBinary[] =
    FILE_PATH_LITERAL("webdeck-core");
#endif

// How long to wait for the core to publish its port, and how often to look.
constexpr base::TimeDelta kStartupTimeout = base::Seconds(15);
constexpr base::TimeDelta kPollInterval = base::Milliseconds(50);

// The port file holds one small JSON object; anything larger is not ours.
constexpr size_t kMaxPortFileBytes = 1024;

// The core's per-user data directory, and the environment variable that moves
// it. Both must match the core's own defaults (see node-env.ts).
constexpr char kUserDataEnvVar[] = "WEBDECK_USER_DATA";

// The signing key, handed to the core in its environment rather than on its
// command line: a command line is readable by every process on the machine
// (ps), and a key everyone can read signs nothing.
constexpr char kGrantKeyEnvVar[] = "WEBDECK_GRANT_KEY";
constexpr size_t kGrantKeyBytes = 32;

// What gets signed, so a signature for one purpose cannot be replayed as
// another. The path follows on the next line.
constexpr char kGrantContext[] = "webdeck-open-file\n";
constexpr base::FilePath::CharType kUserDataDirName[] =
    FILE_PATH_LITERAL(".webdeck");

}  // namespace

// static
WebDeckCoreService* WebDeckCoreService::GetInstance() {
  static base::NoDestructor<WebDeckCoreService> instance;
  return instance.get();
}

WebDeckCoreService::WebDeckCoreService() = default;

WebDeckCoreService::~WebDeckCoreService() = default;

base::FilePath WebDeckCoreService::ResolveCorePath() const {
  // The core sits next to the MAIN EXECUTABLE (Contents/MacOS on mac), which is
  // where the packaging step installs it. FILE_EXE is that binary's real path,
  // so its directory is Contents/MacOS regardless of bundle layout.
  //
  // NOT DIR_MODULE. In a component build the browser's code lives in the main
  // executable, so DIR_MODULE happened to be Contents/MacOS and this worked; in
  // a release (non-component) build the code is in the Framework, so DIR_MODULE
  // is the framework's Versions directory and the core was never found — the
  // browser launched and chrome://webdeck came up empty, because the whole
  // product hangs off a service that never started.
  base::FilePath exe;
  if (!base::PathService::Get(base::FILE_EXE, &exe)) {
    return base::FilePath();
  }
  return exe.DirName().Append(kCoreBinary);
}

const std::vector<uint8_t>& WebDeckCoreService::grant_key() const {
  return grant_key_;
}

std::string WebDeckCoreService::SignFileGrant(const base::FilePath& path) const {
  if (grant_key_.empty() || path.empty() || !path.IsAbsolute()) {
    return std::string();
  }
  const std::string message = kGrantContext + path.AsUTF8Unsafe();
  const std::array<uint8_t, crypto::hash::kSha256Size> signature =
      crypto::hmac::SignSha256(grant_key_, base::as_byte_span(message));
  return base::Base64Encode(signature);
}

// static
base::FilePath WebDeckCoreService::UserDataDir() {
  std::unique_ptr<base::Environment> env = base::Environment::Create();
  if (std::optional<std::string> override = env->GetVar(kUserDataEnvVar);
      override && !override->empty()) {
    return base::FilePath::FromUTF8Unsafe(*override);
  }
  base::FilePath home;
  if (!base::PathService::Get(base::DIR_HOME, &home)) {
    return base::FilePath();
  }
  return home.Append(kUserDataDirName);
}

// static
std::optional<WebDeckCoreService::Handoff> WebDeckCoreService::ParsePortFile(
    std::string_view contents) {
  if (contents.empty() || contents.size() > kMaxPortFileBytes) {
    return std::nullopt;
  }
  std::optional<base::Value> parsed =
      base::JSONReader::Read(contents, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_dict()) {
    return std::nullopt;
  }
  const base::DictValue& dict = parsed->GetDict();

  const int port = dict.FindInt("port").value_or(0);
  // A port outside the unprivileged range is not something we should dial.
  if (port <= 0 || port > 65535) {
    return std::nullopt;
  }

  const std::string* token = dict.FindString("token");
  // Defence in depth on a file we then paste into a script: the core mints
  // base64url, so anything else means a corrupt or hostile handoff.
  if (!token || token->size() < 16 ||
      token->find_first_not_of(
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_") !=
          std::string::npos) {
    return std::nullopt;
  }

  Handoff handoff;
  handoff.port = port;
  handoff.token = *token;
  return handoff;
}

void WebDeckCoreService::EnsureStarted() {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  if (process_.IsValid() && port_ != 0 && !token_.empty()) {
    return;
  }

  const base::FilePath core = ResolveCorePath();
  if (core.empty() || !base::PathExists(core)) {
    LOG(ERROR) << "webdeck-core not found at " << core;
    return;
  }

  // Waiting for the child to publish its port blocks briefly.
  //
  // This function must therefore run on a MayBlock sequence, never the UI
  // thread — see the core-port.js handler in webdeck_ui.cc, which is the only
  // caller and posts here for exactly that reason. Calling it from the UI
  // thread crashes the browser on a DCHECK ("Function marked as blocking was
  // called from a scope that disallows blocking"), which is what happened when
  // the WebUI constructor called it directly. Note that ScopedBlockingCall
  // alone does not save you: it annotates blocking work, it does not lift the
  // UI thread's ban, and ScopedAllowBlocking is friend-gated precisely so that
  // the answer has to be "do it off the UI thread" instead.
  base::ScopedBlockingCall scoped_blocking_call(FROM_HERE,
                                                base::BlockingType::MAY_BLOCK);

  // The core writes its chosen port here once it is listening. A file rather
  // than a stdout pipe: it is the same on every platform, and the core already
  // supports it.
  if (!base::CreateNewTempDirectory(FILE_PATH_LITERAL("webdeck"), &runtime_dir_)) {
    LOG(ERROR) << "could not create a runtime directory for webdeck-core";
    return;
  }
  const base::FilePath port_file = runtime_dir_.AppendASCII("core-port.json");

  base::CommandLine command_line(core);
  // Port 0: let the OS choose. A fixed port would collide across profiles and
  // with anything else on the machine.
  command_line.AppendSwitchASCII("port", "0");
  command_line.AppendSwitchPath("port-file", port_file);
  // Say the data directory out loud instead of letting the core default to it,
  // so the browser and the core cannot disagree about where a staged file
  // drop lives. UserDataDir() returns the core's own default, so this changes
  // nothing for an existing profile.
  if (const base::FilePath user_data = UserDataDir(); !user_data.empty()) {
    command_line.AppendSwitchPath("user-data", user_data);
  }

  // One key per core process: it dies with the child, so a signature cannot
  // outlive the browser that made it.
  grant_key_ = base::RandBytesAsVector(kGrantKeyBytes);

  base::LaunchOptions options;
  options.current_directory = core.DirName();
  options.environment[kGrantKeyEnvVar] = base::Base64Encode(grant_key_);
  // Tell the core which browser it belongs to. Without this the app reports an
  // empty Chrome version, and a tester filing a bug has no way to say which
  // build they were on — which is most of what a bug report is worth. Merged
  // into the child's environment, not replacing it.
  options.environment["WEBDECK_CHROME_VERSION"] =
      std::string(version_info::GetVersionNumber());

  // Tell the core where its runtime payload lives.
  //
  // The core executable sits in Contents/MacOS, but its runtime — node-pty's
  // native addon, the js-debug adapter, reveal.js data — is a tree of mixed
  // resources, and codesign rejects any non-executable under Contents/MacOS
  // (that directory is for code only). So the payload ships in
  // Contents/Resources instead, and the core cannot find it by looking beside
  // itself. This hands it the path. `core` is Contents/MacOS/webdeck-core, so
  // its grandparent is Contents.
  const base::FilePath runtime_payload = core.DirName()
                                             .DirName()
                                             .Append(FILE_PATH_LITERAL("Resources"))
                                             .Append(FILE_PATH_LITERAL("webdeck-core-runtime"));
  if (base::PathExists(runtime_payload)) {
    options.environment["WEBDECK_CORE_RUNTIME"] = runtime_payload.value();
  }

  process_ = base::LaunchProcess(command_line, options);
  if (!process_.IsValid()) {
    LOG(ERROR) << "failed to launch webdeck-core";
    return;
  }

  const base::TimeTicks deadline = base::TimeTicks::Now() + kStartupTimeout;
  while (base::TimeTicks::Now() < deadline) {
    std::string contents;
    if (base::ReadFileToStringWithMaxSize(port_file, &contents,
                                          kMaxPortFileBytes)) {
      // Only once BOTH are readable: the core writes the file atomically, but
      // returning on a partial parse would hand the page a port with no
      // credential, which it cannot use.
      if (std::optional<Handoff> handoff = ParsePortFile(contents)) {
        port_ = handoff->port;
        token_ = handoff->token;
        return;
      }
    }
    // The child may have died rather than come up; do not spin until timeout.
    // WaitForExitWithTimeout with a zero timeout is the portable liveness check
    // (Process::IsRunning is Windows-only).
    int exit_code = 0;
    if (process_.WaitForExitWithTimeout(base::TimeDelta(), &exit_code)) {
      LOG(ERROR) << "webdeck-core exited (" << exit_code
                 << ") before publishing a port";
      return;
    }
    base::PlatformThread::Sleep(kPollInterval);
  }
  LOG(ERROR) << "webdeck-core did not publish a port within "
             << kStartupTimeout.InSeconds() << "s";
}

int WebDeckCoreService::port() const {
  return port_;
}

const std::string& WebDeckCoreService::token() const {
  return token_;
}

void WebDeckCoreService::Shutdown() {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  if (process_.IsValid()) {
    process_.Terminate(/*exit_code=*/0, /*wait=*/false);
    process_.Close();
  }
  if (!runtime_dir_.empty()) {
    base::DeletePathRecursively(runtime_dir_);
    runtime_dir_.clear();
  }
  port_ = 0;
  token_.clear();
}

}  // namespace webdeck
