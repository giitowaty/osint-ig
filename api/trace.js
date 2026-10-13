"use strict";

/* ----------------------------------------------------------------------------
 * Trace: zapis „co serwer właśnie robi” dla jednego zadania.
 *
 * Każdy krok (np. „zapytanie web_profile_info”, „normalizacja postów”) emituje
 * zdarzenia start → ok / warn / error z czasem trwania i szczegółami. Zdarzenia
 * trafiają do słuchacza (strumień SSE do UI) oraz do tablicy `events`
 * (dołączanej do zwykłej odpowiedzi JSON, gdy klient nie strumieniuje).
 * -------------------------------------------------------------------------- */

let seq = 0;

class Trace {
  /** @param {string} job  @param {(ev: object) => void} [listener] */
  constructor(job, listener) {
    this.job = job;
    this.id = `${Date.now().toString(36)}-${(++seq).toString(36)}`;
    this.started = Date.now();
    this.events = [];
    this.listener = listener || null;
    this.stepSeq = 0;
  }

  emit(ev) {
    const full = { t: Date.now() - this.started, at: new Date().toISOString(), ...ev };
    this.events.push(full);
    if (this.listener) {
      try { this.listener(full); } catch { /* zerwany strumień nie może wywrócić zadania */ }
    }
    return full;
  }

  log(level, message, data) {
    return this.emit({ type: "log", level, message, ...(data ? { data } : {}) });
  }

  /**
   * Wykonuje krok i raportuje jego przebieg. `fn` może zwrócić `{ value, detail }`
   * przez `step.detail(...)`, aby dołączyć opis wyniku.
   */
  async step(stage, label, fn) {
    const id = `s${++this.stepSeq}`;
    const t0 = Date.now();
    this.emit({ type: "step", id, stage, label, status: "start" });
    let detail = null;
    let level = "ok";
    const ctx = {
      detail: (d) => { detail = d; },
      warn: (d) => { detail = d; level = "warn"; },
      progress: (d) => this.emit({ type: "step", id, stage, label, status: "progress", detail: d, ms: Date.now() - t0 }),
    };
    try {
      const value = await fn(ctx);
      this.emit({ type: "step", id, stage, label, status: level, ms: Date.now() - t0, ...(detail ? { detail } : {}) });
      return value;
    } catch (e) {
      if (e && typeof e === "object" && !e.stage) e.stage = stage;
      this.emit({
        type: "step", id, stage, label, status: "error", ms: Date.now() - t0,
        detail: (e && e.message) || String(e),
      });
      throw e;
    }
  }
}

module.exports = { Trace };
