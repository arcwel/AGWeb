import { BrowserWindow, dialog } from 'electron'
import { promises as fsp } from 'node:fs'
import type { Rect } from '@shared/ipc'

/**
 * Document Studio exports. HTML is written directly; PDF renders the given
 * standalone HTML in a hidden window and prints it; PNG captures the live
 * stage region of the requesting window (works for any styled view).
 */

async function pickSavePath(
  owner: BrowserWindow | null,
  suggestedName: string,
  extension: string
): Promise<string | null> {
  if (!owner) return null
  const { canceled, filePath } = await dialog.showSaveDialog(owner, {
    defaultPath: suggestedName,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
  })
  return canceled || !filePath ? null : filePath
}

export async function exportHtml(
  owner: BrowserWindow | null,
  html: string,
  suggestedName: string
): Promise<{ path?: string; error?: string }> {
  const path = await pickSavePath(owner, suggestedName, 'html')
  if (!path) return {}
  await fsp.writeFile(path, html, 'utf8')
  return { path }
}

export async function exportPdf(
  owner: BrowserWindow | null,
  html: string,
  suggestedName: string
): Promise<{ path?: string; error?: string }> {
  const path = await pickSavePath(owner, suggestedName, 'pdf')
  if (!path) return {}
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    // Give layout (and any webfonts) a beat to settle before printing.
    await new Promise((resolve) => setTimeout(resolve, 300))
    const pdf = await win.webContents.printToPDF({ printBackground: true })
    await fsp.writeFile(path, pdf)
    return { path }
  } catch (error) {
    return { error: String(error) }
  } finally {
    win.destroy()
  }
}

export async function exportCapture(
  owner: BrowserWindow | null,
  rect: Rect,
  suggestedName: string
): Promise<{ path?: string; error?: string }> {
  if (!owner) return { error: 'no window' }
  const path = await pickSavePath(owner, suggestedName, 'png')
  if (!path) return {}
  const image = await owner.webContents.capturePage({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  })
  await fsp.writeFile(path, image.toPNG())
  return { path }
}
