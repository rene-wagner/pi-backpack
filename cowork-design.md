# Cowork Design

## Ziel

`cowork` soll wiederkehrende, definierte Agent-Aufgaben ausführen: ein Nutzer legt Jobs mit Prompt, Arbeitsverzeichnis, Intervall, Modell und erlaubten Tools an; Cowork startet diese Jobs regelmäßig isoliert über Pi und speichert Ergebnisse nachvollziehbar ab.

Das Feature wird als Teil des `pi-backpack`-Packages umgesetzt. Die Implementierung trennt bewusst Scheduling-Engine und Pi-Extension, damit zuerst ein Foreground-MVP in einer laufenden Pi-Session möglich ist und danach ein Headless-Daemon ergänzt werden kann.

## Nicht-Ziele für den MVP

- Keine komplexe Cron-Syntax; einfache Intervalle reichen (`5m`, `1h`, `24h`).
- Keine Web-UI.
- Keine automatische Code-Änderung als Default.
- Keine verteilte Ausführung über mehrere Maschinen.
- Kein dauerhaft laufender Hintergrunddienst im ersten Schritt; der Daemon kommt danach.

## Nutzerfluss

Beispiele:

```text
/cowork add
/cowork list
/cowork show daily-review
/cowork edit daily-review model=sonnet:high every=1h
/cowork run daily-review
/cowork runs daily-review
/cowork last daily-review
/cowork start
/cowork stop
/cowork status
```

Ein typischer Job:

```json
{
  "id": "daily-review",
  "enabled": true,
  "cwd": "/path/to/project",
  "every": "24h",
  "prompt": "Review local changes and summarize risks.",
  "model": "anthropic/claude-sonnet-4-5",
  "tools": ["read", "grep", "find", "bash"],
  "concurrency": "skip",
  "timeoutMs": 1800000,
  "runOnStart": false
}
```

## Architektur

```text
extensions/cowork/
  index.ts       # Extension entrypoint
  command.ts     # /cowork command parsing and handlers
  types.ts       # Job, state, run result schemas/types
  store.ts       # load/save jobs, state, run logs
  scheduler.ts   # interval parsing, due detection, timers
  runner.ts      # starts isolated pi processes and captures results
```

### Core Engine

Die Core Engine enthält keine TUI-Abhängigkeit. Sie kann sowohl von der Pi-Extension als auch später vom Daemon verwendet werden.

Verantwortlichkeiten:

- Jobs laden und validieren
- Status laden/speichern
- Intervall berechnen
- fällige Jobs erkennen
- laufende Jobs tracken
- Runner starten
- Ergebnis- und Fehlerstatus persistieren

### Pi-Extension

Die Extension stellt die Control Plane bereit:

- Slash Command `/cowork`
- Foreground-Scheduler via `/cowork start`
- Statusanzeigen via `ctx.ui.notify()` / optional später Widget
- manuelle Runs via `/cowork run <id>`

Der Scheduler läuft im MVP nur solange die Pi-Session offen ist.

### Runner

Der Runner startet Pi isoliert ähnlich wie die bestehende `subagent`-Extension:

```bash
pi --mode json -p --no-session --tools read,grep,find,bash "<prompt>"
```

Eigenschaften:

- JSON-Eventstream lesen
- finale Assistant-Antwort extrahieren
- stderr/stdout begrenzen
- Timeout unterstützen
- AbortSignal unterstützen
- Exit-Code, Dauer, Modell, Tools und Antwort speichern

## Speicherorte

Für den ersten Schritt user-lokal:

```text
~/.pi/agent/cowork/jobs.json
~/.pi/agent/cowork/state.json
~/.pi/agent/cowork/runs/<job-id>/<timestamp>.json
~/.pi/agent/cowork/runs/<job-id>/<timestamp>.summary.md
```

Projektlokale Jobs in `.pi/cowork/jobs.json` sind ein späterer Ausbau und müssen an Pi Project Trust gekoppelt werden.

## Datenmodell

### Job

```ts
interface CoworkJob {
  id: string;
  enabled: boolean;
  cwd: string;
  every: string;
  prompt: string;
  model?: string;
  tools?: string[];
  timeoutMs?: number;
  runOnStart?: boolean;
  concurrency?: "skip" | "queue" | "parallel";
  createdAt: string;
  updatedAt: string;
}
```

MVP-Default:

```ts
concurrency = "skip"
tools = ["read", "grep", "find", "ls"]
timeoutMs = 30 * 60 * 1000
runOnStart = false
```

### State

```ts
interface CoworkState {
  jobs: Record<string, CoworkJobState>;
}

interface CoworkJobState {
  lastRunAt?: string;
  nextRunAt?: string;
  lastExitCode?: number;
  lastError?: string;
  consecutiveFailures: number;
  running?: boolean;
}
```

### Run Result

```ts
interface CoworkRunResult {
  jobId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  output: string;
  stderr: string;
  cwd: string;
  model?: string;
  tools: string[];
}
```

## Commands

### `/cowork list`

Zeigt alle Jobs mit Status:

- ID
- enabled/disabled
- Intervall
- letzter Lauf
- nächster Lauf
- letzter Exit-Code

### `/cowork show <id>`

Zeigt die vollständige Job-Konfiguration, den Prompt und den letzten bekannten Status.

### `/cowork add`

MVP: zunächst argumentbasiert oder interaktiv minimal.

Mögliche einfache Syntax:

```text
/cowork add daily-review every=24h cwd=. tools=read,grep,find,bash prompt="Review local changes"
```

Wenn keine Argumente angegeben sind, kann später ein UI-Wizard folgen.

### `/cowork edit <id> key=value...`

Aktualisiert einzelne Job-Felder, z. B.:

```text
/cowork edit daily-review model=sonnet:high every=1h
/cowork edit daily-review tools=read,grep,find,bash
/cowork edit daily-review prompt="New prompt"
```

### `/cowork run <id>`

Startet einen Job sofort, unabhängig vom Intervall.

### `/cowork enable <id>` / `/cowork disable <id>`

Aktiviert oder deaktiviert einen Job.

### `/cowork remove <id>`

Entfernt einen Job. Optional später mit Confirm-Dialog.

### `/cowork start`

Startet den Foreground-Scheduler in der aktuellen Pi-Session.

### `/cowork stop`

Stoppt den Foreground-Scheduler. Bereits laufende Runs werden im MVP nicht hart abgebrochen, außer wir geben explizit ein AbortSignal weiter.

### `/cowork runs <id>` / `/cowork last <id>`

Listet die letzten Runs bzw. zeigt die letzte Run-Summary mit Output und stderr.

### `/cowork status`

Zeigt Scheduler-Status:

- läuft / läuft nicht
- Anzahl Jobs
- aktive Runs
- nächste fällige Jobs

## Scheduling-Regeln

- `every` wird als Dauer geparst: `s`, `m`, `h`, `d`.
- `nextRunAt = lastRunAt + every`.
- Wenn ein Job noch nie lief:
  - `runOnStart = true`: sofort fällig
  - sonst: `createdAt + every`
- Scheduler tickt z. B. alle 30 Sekunden.
- Bei `concurrency: "skip"` wird ein fälliger Job übersprungen, wenn er bereits läuft.

## Sicherheit

Da Cowork unbeaufsichtigt laufen kann, gelten defensive Defaults:

- Default-Tools sind read-only: `read`, `grep`, `find`, `ls`.
- `bash`, `edit`, `write` nur, wenn explizit konfiguriert.
- Kein `ask_user` in Headless-Runs.
- `--no-session` für isolierte Einmalruns.
- Timeout pro Job.
- Logs mit stderr und Exit-Code.
- Keine Projektjobs ohne Project Trust.

## MVP Definition of Done

- `extensions/cowork` existiert und ist im Package geladen.
- `/cowork list`, `/cowork add`, `/cowork run`, `/cowork start`, `/cowork stop`, `/cowork status` funktionieren.
- Jobs werden in `~/.pi/agent/cowork/jobs.json` gespeichert.
- Runs werden als JSON und Markdown-Summary gespeichert.
- Ein Job mit kurzem Intervall läuft automatisch im Foreground-Scheduler.
- Doppelstarts werden bei `concurrency: "skip"` verhindert.
- Typecheck und Tests laufen grün.

## Testplan

Unit Tests:

- Intervallparser akzeptiert `30s`, `5m`, `1h`, `2d`.
- Intervallparser lehnt ungültige Werte ab.
- Due-Berechnung für neue und bereits gelaufene Jobs.
- `concurrency: "skip"` verhindert Doppelstart.
- Store kann Jobs und State roundtrip speichern/laden.

Integration/Semi-Integration:

- Runner kann mit gemocktem Pi-Prozess ein JSON-Eventstream-Ergebnis extrahieren.
- `/cowork run <id>` schreibt ein Run-Ergebnis.

## Ausbau nach MVP: Headless Daemon

Nach dem Foreground-MVP wird eine CLI ergänzt:

```text
bin/pi-cowork.mjs
```

Kommandos:

```bash
pi-cowork daemon
pi-cowork list
pi-cowork run <id>
pi-cowork enable <id>
pi-cowork disable <id>
```

Optional danach:

```bash
pi-cowork install-systemd
```

Damit kann Cowork unabhängig von einer offenen Pi-Session laufen.
