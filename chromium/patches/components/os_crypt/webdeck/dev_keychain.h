// Copyright 2026 Arcwel. All rights reserved.

#ifndef COMPONENTS_OS_CRYPT_WEBDECK_DEV_KEYCHAIN_H_
#define COMPONENTS_OS_CRYPT_WEBDECK_DEV_KEYCHAIN_H_

#include <string>

namespace base {
class FilePath;
}

namespace os_crypt::webdeck {

// The development keychain.
//
// OSCrypt on macOS derives the cookie/password encryption key from a random
// password it keeps in the login Keychain ("Chromium Safe Storage"). The
// Keychain grants that item to the *code signature* that created it, so every
// differently-signed copy of the app — and an ad-hoc signature is different on
// every build — makes macOS put up "Arcwel WebDeck wants to use your
// confidential information" and block the browser until the user types their
// login password. On a development machine that is a new prompt for every
// build, and a headless run never gets past it.
//
// `--use-mock-keychain` is not an answer for a real profile: its fake keychain
// lives in memory, so each launch would mint a new random password and orphan
// every cookie and saved login from the launch before.
//
// So, ONLY when the running bundle carries no Team Identifier (ad-hoc or
// unsigned, i.e. a build nobody could ship), the password comes from a file in
// the profile directory instead — random once, then stable. The cost is stated
// plainly: that file is the key, readable by anything running as the user,
// which is exactly the guarantee Chromium on Linux's basic backend gives. A
// Developer ID–signed build never takes this path, and
// WEBDECK_REAL_KEYCHAIN=1 in the environment forces the real Keychain on any
// build so the production path stays testable.

// True when this process should use the development keychain: no Team
// Identifier on the main bundle and WEBDECK_REAL_KEYCHAIN unset. Computed once.
bool ShouldUseDevKeychain();

// Where the secret lives. The browser process registers its user data
// directory here as soon as it knows it (ChromeBrowserMainParts); until then,
// and in any process that never does, DevKeychainPassword() returns empty and
// the caller falls through to the real Keychain.
void SetDevKeychainDir(const base::FilePath& user_data_dir);

// The stable per-profile password, creating it (0600) on first use. Empty on
// any failure, in which case the caller must use the real Keychain.
std::string DevKeychainPassword();

}  // namespace os_crypt::webdeck

#endif  // COMPONENTS_OS_CRYPT_WEBDECK_DEV_KEYCHAIN_H_
