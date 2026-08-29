import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { IpcEvents } from '@shared/ipc'

/**
 * The native application menu.
 *
 * There was no menu at all before this, which is why so much of what people
 * expect from a desktop app was missing: no Cut/Copy/Paste or Select All in
 * fields, no Minimise/Zoom/Full Screen, no standard window management, no
 * Services or Hide on macOS, and none of the platform shortcuts that come
 * free with Electron's built-in roles.
 *
 * Roles do the work wherever one exists — Electron wires them to the right
 * platform behaviour and shortcut. Only genuinely app-specific items (open a
 * project, reveal the deck, run a task) are hand-written, and those send an
 * event the renderer already knows how to handle rather than reaching into
 * its state from here.
 */

/** Ask the focused window's renderer to run one of its own commands. */
function send(channel: string, ...args: unknown[]): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send(channel, ...args)
}

export function buildApplicationMenu(handlers: { openWorkspace: () => void }): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => send(IpcEvents.shellShortcut, 'app:settings')
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),

    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => send(IpcEvents.shellShortcut, 'mod+t')
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => send(IpcEvents.shellShortcut, 'app:new-window')
        },
        { type: 'separator' },
        {
          label: 'Open Project Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => handlers.openWorkspace()
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send(IpcEvents.shellShortcut, 'app:save')
        },
        {
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: () => send(IpcEvents.shellShortcut, 'app:print')
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => send(IpcEvents.shellShortcut, 'mod+w')
        },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },

    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
              { type: 'separator' as const },
              {
                label: 'Speech',
                submenu: [{ role: 'startSpeaking' as const }, { role: 'stopSpeaking' as const }]
              }
            ]
          : [{ role: 'delete' as const }, { role: 'selectAll' as const }]),
        { type: 'separator' },
        {
          label: 'Find in Page…',
          accelerator: 'CmdOrCtrl+F',
          click: () => send(IpcEvents.shellShortcut, 'app:find')
        }
      ]
    },

    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Page',
          accelerator: 'CmdOrCtrl+R',
          click: () => send(IpcEvents.shellShortcut, 'app:reload')
        },
        {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => send(IpcEvents.shellShortcut, 'app:force-reload')
        },
        { type: 'separator' },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => send(IpcEvents.shellShortcut, 'app:zoom-reset')
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => send(IpcEvents.shellShortcut, 'app:zoom-in')
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => send(IpcEvents.shellShortcut, 'app:zoom-out')
        },
        { type: 'separator' },
        {
          label: 'Toggle Dev Deck',
          accelerator: 'CmdOrCtrl+D',
          click: () => send(IpcEvents.shellShortcut, 'mod+d')
        },
        {
          label: 'Toggle Favourites Bar',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => send(IpcEvents.shellShortcut, 'app:utilities')
        },
        {
          label: 'Split View',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => send(IpcEvents.shellShortcut, 'app:split')
        },
        { type: 'separator' },
        {
          label: 'Toggle Light/Dark',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => send(IpcEvents.shellShortcut, 'mod+shift+l')
        },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Developer Tools (page)',
          accelerator: 'CmdOrCtrl+Alt+I',
          click: () => send(IpcEvents.shellShortcut, 'app:devtools')
        },
        // An explicit distinct accelerator: the toggleDevTools role defaults to
        // ⌥⌘I on macOS, which is the same combo the page item above claims —
        // two menu items on one accelerator is a duplicate Electron warns about
        // and only one would fire.
        {
          role: 'toggleDevTools',
          label: 'Developer Tools (shell)',
          accelerator: 'CmdOrCtrl+Alt+Shift+I'
        }
      ]
    },

    {
      label: 'History',
      submenu: [
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => send(IpcEvents.shellShortcut, 'app:back')
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => send(IpcEvents.shellShortcut, 'app:forward')
        },
        {
          label: 'Home',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => send(IpcEvents.shellShortcut, 'app:home')
        },
        { type: 'separator' },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => send(IpcEvents.shellShortcut, 'app:reopen-tab')
        }
      ]
    },

    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const }
            ]
          : [{ role: 'close' as const }])
      ]
    },

    {
      role: 'help',
      submenu: [
        {
          label: 'WebDeck on GitHub',
          click: () => void shell.openExternal('https://github.com/arcwel/AGWeb')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
