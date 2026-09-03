// Copyright 2026 Arcwel. All rights reserved.

#include "components/os_crypt/webdeck/dev_keychain.h"

#import <Security/Security.h>

#include <string>

#include "base/apple/foundation_util.h"
#include "base/apple/scoped_cftyperef.h"
#include "base/base64.h"
#include "base/environment.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/rand_util.h"
#include "base/strings/string_util.h"
#include "base/synchronization/lock.h"
#include "build/buildflag.h"
#include "components/os_crypt/webdeck/buildflags.h"

namespace os_crypt::webdeck {

namespace {

constexpr base::FilePath::CharType kSecretFileName[] =
    FILE_PATH_LITERAL("WebDeck Dev Keychain");
// 128 bits, the same entropy the real Keychain item carries.
constexpr size_t kSecretBytes = 128 / 8;

// Everything from here to the matching #endif exists only to decide whether to
// take over from the Keychain, which a shipping build never does. Guarding it
// keeps -Wunused-const-variable/-Wunused-function (fatal under -Werror) quiet
// in the default configuration, and keeps the signature check out of a binary
// that would never call it.
#if BUILDFLAG(WEBDECK_DEV_KEYCHAIN)

constexpr char kEnvForceRealKeychain[] = "WEBDECK_REAL_KEYCHAIN";

// A bundle signed with an Apple-issued identity (Developer ID, App Store)
// carries a Team Identifier; an ad-hoc signature or no signature carries none.
// Any failure to read the signature is treated as "no identity": the point is
// to never block a build that could not have been shipped anyway.
bool MainBundleHasTeamIdentifier() {
  base::apple::ScopedCFTypeRef<SecCodeRef> self_code;
  if (SecCodeCopySelf(kSecCSDefaultFlags, self_code.InitializeInto()) !=
      errSecSuccess) {
    return false;
  }
  base::apple::ScopedCFTypeRef<SecStaticCodeRef> static_code;
  if (SecCodeCopyStaticCode(self_code.get(), kSecCSDefaultFlags,
                            static_code.InitializeInto()) != errSecSuccess) {
    return false;
  }
  base::apple::ScopedCFTypeRef<CFDictionaryRef> info;
  if (SecCodeCopySigningInformation(static_code.get(), kSecCSSigningInformation,
                                    info.InitializeInto()) != errSecSuccess) {
    return false;
  }
  CFStringRef team = base::apple::GetValueFromDictionary<CFStringRef>(
      info.get(), kSecCodeInfoTeamIdentifier);
  return team && CFStringGetLength(team) > 0;
}

#endif  // BUILDFLAG(WEBDECK_DEV_KEYCHAIN)

bool ComputeShouldUseDevKeychain() {
#if !BUILDFLAG(WEBDECK_DEV_KEYCHAIN)
  // Compiled out (gn arg webdeck_dev_keychain = false, the default): the real
  // Keychain, always, whatever the signature.
  return false;
#else
  if (base::Environment::Create()->HasVar(kEnvForceRealKeychain)) {
    return false;
  }
  return !MainBundleHasTeamIdentifier();
#endif
}

struct State {
  base::Lock lock;
  base::FilePath dir;
  std::string password;
};

State& GetState() {
  static base::NoDestructor<State> state;
  return *state;
}

}  // namespace

bool ShouldUseDevKeychain() {
  static const bool use = ComputeShouldUseDevKeychain();
  return use;
}

void SetDevKeychainDir(const base::FilePath& user_data_dir) {
  State& state = GetState();
  base::AutoLock hold(state.lock);
  state.dir = user_data_dir;
}

std::string DevKeychainPassword() {
  State& state = GetState();
  base::AutoLock hold(state.lock);
  if (!state.password.empty()) {
    return state.password;
  }
  if (state.dir.empty()) {
    return std::string();
  }

  const base::FilePath path = state.dir.Append(kSecretFileName);
  std::string stored;
  if (base::ReadFileToStringWithMaxSize(path, &stored, 1024)) {
    std::string trimmed(base::TrimWhitespaceASCII(stored, base::TRIM_ALL));
    if (!trimmed.empty()) {
      state.password = std::move(trimmed);
      return state.password;
    }
  }

  const std::string fresh =
      base::Base64Encode(base::RandBytesAsVector(kSecretBytes));
  if (!base::CreateDirectory(state.dir) ||
      !base::WriteFile(path, fresh + "\n") ||
      !base::SetPosixFilePermissions(path, 0600)) {
    LOG(ERROR) << "WebDeck dev keychain: could not write " << path.value()
               << "; falling back to the real Keychain";
    return std::string();
  }
  LOG(WARNING) << "WebDeck dev keychain: this build has no Team Identifier, so "
                  "the OSCrypt password is kept in "
               << path.value()
               << " instead of the login Keychain. Sign with a Developer ID to "
                  "use the real Keychain, or set WEBDECK_REAL_KEYCHAIN=1.";
  state.password = fresh;
  return state.password;
}

}  // namespace os_crypt::webdeck
