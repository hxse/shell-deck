import { mount } from 'svelte'
import App from './App.svelte'
import { loadBrowserSettings } from './lib/browserSettings'
import { applyDocumentTheme } from './lib/theme'
import './app.css'

const loadedSettings = loadBrowserSettings()
applyDocumentTheme(loadedSettings.settings.theme)

const app = mount(App, {
  target: document.getElementById('app')!,
  props: { initialBrowserSettings: loadedSettings },
})

export default app
