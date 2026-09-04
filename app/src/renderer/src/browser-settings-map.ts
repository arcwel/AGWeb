/**
 * Chromium's settings, as chrome://settings lays them out.
 *
 * The sections, their order and their wording follow Chrome's own settings
 * page, because that is the map people already know. What differs is only
 * WHERE a control can live:
 *
 *  - `toggle`, `select` and `radio` rows are Chromium preferences the shell
 *    reads and writes directly over the allowlisted bridge — the same prefs
 *    chrome://settings writes, so the two never disagree.
 *  - `link` rows are the settings Chromium must own itself: passwords and
 *    payment methods read the profile's encrypted store, site permissions are
 *    a content-settings map, the search engine is a TemplateURLService. Chrome
 *    presents these as a row that opens a subpage, and so does this — the row
 *    opens Chromium's real page in a tab.
 *  - `custom` rows are the handful the shell already implements better in
 *    place (clearing browsing data, the default-browser check, its own theme).
 *
 * A row whose pref this build does not register is hidden, so the surface can
 * never show a control that does nothing.
 */

export interface SelectOption {
  value: boolean | number | string
  label: string
}

export type SettingRow =
  | {
      kind: 'toggle'
      pref: string
      label: string
      hint: string
      /** Chrome shows a "relaunch to apply" note on these. */
      restart?: boolean
    }
  | { kind: 'select'; pref: string; label: string; hint: string; options: SelectOption[] }
  | {
      /** Two booleans presented as one three-way choice, as Chrome does for
       *  Safe Browsing (Enhanced / Standard / No protection). */
      kind: 'safeBrowsing'
      label: string
      hint: string
    }
  | { kind: 'link'; label: string; hint: string; url: string }
  | { kind: 'text'; pref: string; label: string; hint: string; url?: string }
  | { kind: 'custom'; id: CustomRowId; label: string; hint: string }

export type CustomRowId =
  | 'clearBrowsingData'
  | 'defaultBrowser'
  | 'adblock'
  | 'theme'
  | 'shellSearchEngine'
  // These four already have their own Mojo calls, written before the generic
  // bridge existed and correct today. They stay custom rather than being
  // re-expressed as raw prefs, so each setting keeps exactly one writer.
  | 'thirdPartyCookies'
  | 'doNotTrack'
  | 'httpsOnly'
  | 'preloadPages'

export interface SettingSection {
  id: string
  title: string
  rows: SettingRow[]
}

/** Chrome's own "Memory Saver" / "Energy Saver" values. */
const MEMORY_SAVER: SelectOption[] = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'On — free memory from inactive tabs' }
]
const ENERGY_SAVER: SelectOption[] = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'On when the battery is low' },
  { value: 2, label: 'On whenever the computer is unplugged' }
]
const STARTUP: SelectOption[] = [
  { value: 5, label: 'Open the New Tab page' },
  { value: 1, label: 'Continue where you left off' },
  { value: 4, label: 'Open a specific set of pages' }
]
const FONT_SIZE: SelectOption[] = [
  { value: 9, label: 'Very small' },
  { value: 12, label: 'Small' },
  { value: 16, label: 'Medium (recommended)' },
  { value: 20, label: 'Large' },
  { value: 24, label: 'Very large' }
]
const SECURE_DNS: SelectOption[] = [
  { value: 'off', label: 'Off — use your current service provider' },
  { value: 'automatic', label: 'Automatic — upgrade when the provider supports it' },
  { value: 'secure', label: 'On — always use a secure provider' }
]

export const BROWSER_SETTINGS: SettingSection[] = [
  {
    id: 'people',
    title: 'You and Google',
    rows: [
      {
        kind: 'link',
        label: 'Sync and Google services',
        hint: 'Chromium’s sign-in and sync page. Browser sign-in needs Google’s own API keys, which are issued to official Chrome builds only, so Sync does not start on this build.',
        url: 'chrome://settings/syncSetup'
      },
      {
        kind: 'link',
        label: 'Manage your Google Account',
        hint: 'Opens your account on the web.',
        url: 'https://myaccount.google.com/'
      }
    ]
  },
  {
    id: 'autofill',
    title: 'Autofill and passwords',
    rows: [
      {
        kind: 'link',
        label: 'Password Manager',
        hint: 'Saved passwords, checkup, and the sites you told it to skip.',
        url: 'chrome://password-manager/passwords'
      },
      {
        kind: 'toggle',
        pref: 'credentials_enable_service',
        label: 'Offer to save passwords',
        hint: 'Ask to save a password after you sign in to a site.'
      },
      {
        kind: 'toggle',
        pref: 'credentials_enable_autosignin',
        label: 'Sign in automatically',
        hint: 'Use a saved credential without asking each time.'
      },
      {
        kind: 'link',
        label: 'Payment methods',
        hint: 'Saved cards and whether sites may check if you have one.',
        url: 'chrome://settings/payments'
      },
      {
        kind: 'toggle',
        pref: 'autofill.credit_card_enabled',
        label: 'Save and fill payment methods',
        hint: 'Offer to save cards and fill them into checkout forms.'
      },
      {
        kind: 'link',
        label: 'Addresses and more',
        hint: 'Saved addresses, names, phone numbers and emails.',
        url: 'chrome://settings/addresses'
      },
      {
        kind: 'toggle',
        pref: 'autofill.profile_enabled',
        label: 'Save and fill addresses',
        hint: 'Offer to save addresses and fill them into forms.'
      }
    ]
  },
  {
    id: 'privacy',
    title: 'Privacy and security',
    rows: [
      {
        kind: 'custom',
        id: 'clearBrowsingData',
        label: 'Clear browsing data',
        hint: 'History, cookies, cache and more.'
      },
      {
        kind: 'custom',
        id: 'thirdPartyCookies',
        label: 'Block third-party cookies',
        hint: 'Stop sites you do not visit directly from setting cookies.'
      },
      {
        kind: 'link',
        label: 'More cookie controls',
        hint: 'Chromium’s full cookie page, including per-site exceptions.',
        url: 'chrome://settings/cookies'
      },
      {
        kind: 'link',
        label: 'Site settings',
        hint: 'What sites may do: camera, microphone, location, notifications, pop-ups.',
        url: 'chrome://settings/content'
      },
      {
        kind: 'safeBrowsing',
        label: 'Safe Browsing',
        hint: 'Protection from dangerous sites, downloads and extensions.'
      },
      {
        kind: 'custom',
        id: 'httpsOnly',
        label: 'Always use secure connections',
        hint: 'Warn before loading a site that does not support HTTPS.'
      },
      {
        kind: 'custom',
        id: 'doNotTrack',
        label: 'Send a “Do Not Track” request',
        hint: 'Ask sites not to track you. Honouring it is up to them.'
      },
      {
        kind: 'toggle',
        pref: 'alternate_error_pages.enabled',
        label: 'Use a web service to help resolve navigation errors',
        hint: 'Suggest alternatives when a page fails to load.'
      },
      {
        kind: 'toggle',
        pref: 'search.suggest_enabled',
        label: 'Autocomplete searches and URLs',
        hint: 'Send what you type in the address bar to your search engine for suggestions.'
      },
      {
        kind: 'select',
        pref: 'dns_over_https.mode',
        label: 'Use secure DNS',
        hint: 'Look up addresses over an encrypted connection.',
        options: SECURE_DNS
      },
      {
        kind: 'toggle',
        pref: 'privacy_sandbox.m1.topics_enabled',
        label: 'Ad topics',
        hint: 'Let sites ask the browser what you seem interested in.'
      },
      {
        kind: 'toggle',
        pref: 'privacy_sandbox.m1.fledge_enabled',
        label: 'Site-suggested ads',
        hint: 'Let a site you visit suggest ads to show elsewhere.'
      },
      {
        kind: 'toggle',
        pref: 'privacy_sandbox.m1.ad_measurement_enabled',
        label: 'Ad measurement',
        hint: 'Let sites measure how their ads perform.'
      },
      {
        kind: 'custom',
        id: 'adblock',
        label: 'Block ads and trackers',
        hint: 'WebDeck’s own blocker, on top of Chromium’s protections.'
      }
    ]
  },
  {
    id: 'performance',
    title: 'Performance',
    rows: [
      {
        kind: 'select',
        pref: 'performance_tuning.high_efficiency_mode.state',
        label: 'Memory Saver',
        hint: 'Free memory from tabs you have not used in a while.',
        options: MEMORY_SAVER
      },
      {
        kind: 'select',
        pref: 'performance_tuning.battery_saver_mode.state',
        label: 'Energy Saver',
        hint: 'Limit background work and visual effects to save battery.',
        options: ENERGY_SAVER
      },
      {
        kind: 'custom',
        id: 'preloadPages',
        label: 'Preload pages',
        hint: 'Let Chromium prefetch pages it predicts you will open.'
      }
    ]
  },
  {
    id: 'appearance',
    title: 'Appearance',
    rows: [
      { kind: 'custom', id: 'theme', label: 'Theme', hint: 'Light, dark, or follow the system.' },
      {
        kind: 'toggle',
        pref: 'browser.show_home_button',
        label: 'Show home button',
        hint: 'A home button at the start of the toolbar.'
      },
      {
        kind: 'toggle',
        pref: 'bookmark_bar.show_on_all_tabs',
        label: 'Show bookmarks bar',
        hint: 'Keep the bookmarks bar visible on every tab.'
      },
      {
        kind: 'select',
        pref: 'webkit.webprefs.default_font_size',
        label: 'Font size',
        hint: 'The size pages use when they do not ask for one.',
        options: FONT_SIZE
      }
    ]
  },
  {
    id: 'search',
    title: 'Search engine',
    rows: [
      {
        kind: 'custom',
        id: 'shellSearchEngine',
        label: 'Search engine used in the address bar',
        hint: 'What WebDeck’s address bar searches with.'
      },
      {
        kind: 'link',
        label: 'Manage search engines and site search',
        hint: 'Chromium’s list of engines, keywords and site search shortcuts.',
        url: 'chrome://settings/searchEngines'
      }
    ]
  },
  {
    id: 'startup',
    title: 'On startup',
    rows: [
      {
        kind: 'select',
        pref: 'session.restore_on_startup',
        label: 'When WebDeck starts',
        hint: 'What opens when you launch the browser.',
        options: STARTUP
      },
      {
        kind: 'link',
        label: 'Set the pages to open',
        hint: 'The specific pages used by the option above.',
        url: 'chrome://settings/onStartup'
      }
    ]
  },
  {
    id: 'downloads',
    title: 'Downloads',
    rows: [
      {
        kind: 'text',
        pref: 'download.default_directory',
        label: 'Location',
        hint: 'Where files are saved.',
        url: 'chrome://settings/downloads'
      },
      {
        kind: 'toggle',
        pref: 'download.prompt_for_download',
        label: 'Ask where to save each file before downloading',
        hint: 'Choose a folder for every download instead of using the one above.'
      }
    ]
  },
  {
    id: 'languages',
    title: 'Languages',
    rows: [
      {
        kind: 'text',
        pref: 'intl.accept_languages',
        label: 'Preferred languages',
        hint: 'The languages pages are requested in, in order.',
        url: 'chrome://settings/languages'
      },
      {
        kind: 'toggle',
        pref: 'browser.enable_spellchecking',
        label: 'Spell check',
        hint: 'Underline misspellings as you type.'
      }
    ]
  },
  {
    id: 'accessibility',
    title: 'Accessibility',
    rows: [
      {
        kind: 'toggle',
        pref: 'settings.a11y.focus_highlight',
        label: 'Show a quick highlight on the focused object',
        hint: 'Flash a highlight when focus moves.'
      },
      {
        kind: 'toggle',
        pref: 'accessibility.captions.live_caption_enabled',
        label: 'Live Caption',
        hint: 'Caption audio and video as it plays. Downloads a speech model on first use.'
      },
      {
        kind: 'toggle',
        pref: 'settings.a11y.caretbrowsing.enabled',
        label: 'Navigate pages with a text cursor',
        hint: 'Move around a page with the arrow keys, as in a document.'
      }
    ]
  },
  {
    id: 'system',
    title: 'System',
    rows: [
      {
        kind: 'custom',
        id: 'defaultBrowser',
        label: 'Default browser',
        hint: 'Open links from other apps in WebDeck.'
      },
      {
        kind: 'toggle',
        pref: 'hardware_acceleration_mode.enabled',
        label: 'Use hardware acceleration when available',
        hint: 'Let the GPU composite pages.',
        restart: true
      },
      {
        kind: 'toggle',
        pref: 'background_mode.enabled',
        label: 'Continue running background apps when WebDeck is closed',
        hint: 'Keep extensions and background pages alive after the last window closes.'
      }
    ]
  },
  {
    id: 'reset',
    title: 'Reset settings',
    rows: [
      {
        kind: 'link',
        label: 'Restore settings to their original defaults',
        hint: 'Resets the startup page, new tab page, search engine and pinned tabs.',
        url: 'chrome://settings/reset'
      }
    ]
  }
]

/** Every pref name the surface reads, for one round trip on open. */
export function settingPrefNames(): string[] {
  const names = new Set<string>()
  for (const section of BROWSER_SETTINGS) {
    for (const row of section.rows) {
      if (row.kind === 'toggle' || row.kind === 'select' || row.kind === 'text') {
        names.add(row.pref)
      }
      if (row.kind === 'safeBrowsing') {
        names.add('safebrowsing.enabled')
        names.add('safebrowsing.enhanced')
      }
    }
  }
  return [...names]
}

/** Does a row match what was typed into the settings search box? */
export function rowMatches(row: SettingRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = `${row.label} ${row.hint} ${'pref' in row ? row.pref : ''}`.toLowerCase()
  return q.split(/\s+/).every((word) => haystack.includes(word))
}
