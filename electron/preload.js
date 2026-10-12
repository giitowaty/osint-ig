"use strict";

/* ----------------------------------------------------------------------------
 * Preload OSINT-IG.
 *
 * Front jest zwykłą stroną serwowaną z lokalnego serwera i korzysta wyłącznie
 * z `fetch` do własnego API (ten sam origin), więc nie wymaga mostka do Node.
 * Działamy z contextIsolation + sandbox, bez nodeIntegration — udostępniamy
 * tylko minimalne, bezpieczne metadane aplikacji.
 * -------------------------------------------------------------------------- */

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("osintIG", {
  desktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
