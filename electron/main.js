"use strict";

/* ----------------------------------------------------------------------------
 * OSINT-IG — warstwa Electron.
 *
 * Opakowuje istniejący serwer `api/server.js` (nie zmienia jego logiki):
 *   1. znajduje wolny port (preferowany 8000, w razie zajętości losowy),
 *   2. uruchamia serwer jako proces potomny używając runtime'u wbudowanego w
 *      Electron (ELECTRON_RUN_AS_NODE=1) — użytkownik NIE potrzebuje Node,
 *   3. czeka (polling HTTP), aż serwer odpowie, i dopiero wtedy ładuje stronę,
 *   4. przy zamknięciu okna/aplikacji ubija proces serwera (brak zombie).
 * -------------------------------------------------------------------------- */

const { app, BrowserWindow, shell } = require("electron");
const { fork } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");

const PREFERRED_PORT = Number(process.env.PORT) || 8000;
// Serwer jest forkowany w trybie ELECTRON_RUN_AS_NODE, który NIE czyta z
// app.asar. W spakowanej aplikacji (asar) api/** i pliki frontu są rozpakowane
// do app.asar.unpacked (patrz "asarUnpack" w package.json), więc kierujemy fork
// na tę ścieżkę. W trybie dev ścieżka nie zawiera "app.asar" — replace jest
// wtedy bez efektu.
const SERVER_ENTRY = path
  .join(__dirname, "..", "api", "server.js")
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const READY_TIMEOUT_MS = 30000; // maks. czas oczekiwania na gotowość serwera
const POLL_INTERVAL_MS = 250;

let mainWindow = null;
let serverProcess = null;
let serverPort = PREFERRED_PORT;
let shuttingDown = false;

/* ----------------------------- wolny port -------------------------------- */

// Zwraca `preferred`, jeśli wolny; w przeciwnym razie port przydzielony przez OS.
function findFreePort(preferred) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => {
      // Preferowany port zajęty — poproś OS o dowolny wolny (port 0).
      const fallback = net.createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const { port } = fallback.address();
        fallback.close(() => resolve(port));
      });
    });
    tester.listen(preferred, "127.0.0.1", () => {
      const { port } = tester.address();
      tester.close(() => resolve(port));
    });
  });
}

/* --------------------------- start serwera ------------------------------- */

function startServer(port) {
  // `fork` w Electronie używa process.execPath (binarki Electrona). Ustawienie
  // ELECTRON_RUN_AS_NODE=1 sprawia, że ten proces zachowuje się jak czysty Node
  // — dzięki temu serwer działa bez osobnej instalacji Node u użytkownika.
  serverProcess = fork(SERVER_ENTRY, [], {
    env: { ...process.env, PORT: String(port), ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });

  serverProcess.on("exit", (code, signal) => {
    serverProcess = null;
    // Jeśli serwer padł nie z naszej inicjatywy — zamykamy aplikację.
    if (!shuttingDown) {
      console.error(`Serwer zakończył się nieoczekiwanie (code=${code}, signal=${signal}).`);
      app.quit();
    }
  });

  serverProcess.on("error", (err) => {
    console.error("Nie udało się uruchomić serwera:", err);
  });
}

// Polling: czeka aż serwer zacznie odpowiadać na GET /.
function waitForServer(port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/", timeout: 2000 },
        (res) => {
          res.resume(); // odrzuć treść, liczy się sam fakt odpowiedzi
          resolve();
        }
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error("Serwer nie odpowiedział w wyznaczonym czasie."));
        return;
      }
      setTimeout(attempt, POLL_INTERVAL_MS);
    };
    attempt();
  });
}

/* ------------------------------- okno ------------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0b0f14",
    title: "OSINT-IG",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);

  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.on("did-finish-load", () => {
    console.log(`OSINT-IG: załadowano http://127.0.0.1:${serverPort}/`);
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`OSINT-IG: nie udało się załadować ${url} (${code} ${desc}).`);
  });

  // Linki otwierane w domyślnej przeglądarce, nie wewnątrz okna aplikacji.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/* ---------------------------- cykl życia --------------------------------- */

function stopServer() {
  shuttingDown = true;
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
}

app.whenReady().then(async () => {
  try {
    serverPort = await findFreePort(PREFERRED_PORT);
    startServer(serverPort);
    await waitForServer(serverPort);
  } catch (err) {
    console.error("Błąd startu OSINT-IG:", err);
    stopServer();
    app.quit();
    return;
  }

  createWindow();

  app.on("activate", () => {
    // macOS: odtworzenie okna po kliknięciu w ikonę w docku.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Zamknięcie ostatniego okna kończy aplikację także na macOS — serwer
  // potomny musi zostać ubity, więc nie trzymamy procesu w tle.
  app.quit();
});

app.on("before-quit", stopServer);
app.on("will-quit", stopServer);
// Dodatkowe zabezpieczenie na wypadek nagłego zakończenia procesu głównego
// (np. Ctrl+C w trybie dev albo zewnętrzny kill) — żeby nie zostawić zombie.
process.on("exit", stopServer);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    stopServer();
    process.exit(0);
  });
}
