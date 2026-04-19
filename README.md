# Local Smart Photo Indexer

**AI-powered photo organization that runs 100% on your machine**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Ollama](https://img.shields.io/badge/Ollama-Supported-blue)](https://ollama.com)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev)
[![Backend](https://img.shields.io/badge/Backend-Hono%20%2B%20SQLite-orange)](https://hono.dev)

*Index and organize your photos using local AI vision models. Your data never leaves your computer.*

[Features](#-features) | [Installation](#-installation) | [Quick Start](#-quick-start) | [Architecture](#-architecture) | [How It Works](#-how-it-works) | [Model Selection](#-model-selection) | [Cloud Alternatives](#-cloud-alternatives) | [Troubleshooting](#-troubleshooting)

---

## ✨ Features

- **100% Private** — All processing happens locally, no data sent to external servers (with Ollama)
- **AI-Powered Tagging** — Automatic semantic tags using vision language models
- **Smart Categories** — People, Animals, Scenes, Locations, Weather, Activities, Objects
- **Manual Editing** — Add, remove, and customize tags per photo
- **Folder Import** — Import entire folders with automatic RAW/HEIC file filtering
- **Persistent Storage** — Tags saved in SQLite, survives server restarts
- **Preview After Reload** — Photos preview instantly via the backend, no folder re-selection needed
- **EXIF Metadata Write** — AI-generated tags written back to photo files (XPKeywords / Keywords)
- **Crash-safe Indexing** — Interrupted indexing resumes automatically; worker isolation prevents server crashes
- **Skip Already-Tagged** — Photos with valid tags are marked done without calling the AI (rapid re-indexing)
- **Export/Import** — Backup to JSON or CSV (Excel-compatible)
- **Cloud Options** — Optional OpenRouter/Gemini API for users without GPU

---

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [Ollama](https://ollama.com/download) installed and running (with a vision model)
- 8 GB+ VRAM recommended for local AI models

---

## 🔧 Installation

### 1. Clone & Install

```bash
git clone https://github.com/OnoSendai13/LocalSmartPhotoIndexer.git
cd LocalSmartPhotoIndexer
npm install
cd server && npm install && cd ..
```

### 2. Install Ollama + Vision Model

```bash
# Install Ollama (from https://ollama.com)

# Pull a vision model (any of these work):
ollama pull minicpm-v        # Recommended, fast, accurate
ollama pull qwen2.5vl:7b    # Good alternative
ollama pull hf.co/Jobaar/CapRL-InternVL3.5-8B-GGUF:Q4_K_M  # CapRL variant
```

### 3. Start Ollama

```bash
# Linux/macOS
OLLAMA_ORIGINS="*" ollama serve

# Windows (set env var first, then:)
ollama serve
```

### 4. Start the App

**Development mode (frontend + backend on separate ports):**
```bash
npm run dev:all
# Frontend: http://localhost:5173
# Backend:  http://localhost:6800
```

**Production mode (single port, recommended):**
```bash
npm run start
# Both frontend + backend on http://localhost:6800
```

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/OnoSendai13/LocalSmartPhotoIndexer.git
cd LocalSmartPhotoIndexer

# 2. Install
npm install && cd server && npm install && cd ..

# 3. Ollama with vision model
ollama pull minicpm-v
OLLAMA_ORIGINS="*" ollama serve

# 4. Launch (single command, production)
npm run start
```

Open **http://localhost:6800** in your browser.

---

## 🏗️ Architecture

### Single-Port Deployment (`npm run start`)

```
┌─────────────────────────────────────────────────────────────┐
│  http://localhost:6800                                     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Frontend  (React SPA, served by backend)            │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                │
│  ┌────────────────────────▼────────────────────────────┐   │
│  │  Backend  (Hono + sql.js)                           │   │
│  │  • Folder registration & validation                 │   │
│  │  • Photo scanning & DB persistence                  │   │
│  │  • AI processing (Ollama proxy)                     │   │
│  │  • Preview serving (absolute paths)                │   │
│  │  • EXIF/XMP metadata writing (exiftool-vendored)   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Two-Port Development Mode (`npm run dev:all`)

```
┌──────────────────────┐         ┌──────────────────────────┐
│  Frontend            │         │  Backend                 │
│  http://localhost:5173│◄──────►│  http://localhost:6800   │
│  (Vite dev server)   │  proxy  │  (Hono + sql.js)        │
└──────────────────────┘         └──────────────────────────┘
```

### Key Design — Absolute Paths

All file paths stored in the database are **absolute paths on the server**. This enables:

| Feature | Requirement |
|---------|-------------|
| Preview serving | Backend reads files from disk by absolute path |
| EXIF tag writing | exiftool-vendored needs full disk path |
| Crash recovery | Pending photos restored from DB by disk path |
| Duplicate detection | Compare absolute paths, not relative names |

---

## 🔄 How It Works

### Adding a Folder

1. Click **"Add Folder"** → select via browser file picker
2. Enter the **absolute path** of that folder on the server when prompted
3. Backend scans and registers all photos (RAW/HEIC automatically skipped)
4. Click **▶ Start** to begin AI indexing

### Indexing Flow

```
For each pending photo:
  1. Skip if photo already has valid tags → mark done immediately (no AI call)
  2. Generate thumbnail (sharp, max 480px)
  3. Send to Ollama vision model
  4. Parse JSON tags, validate against allowed list
  5. Save tags to DB + write EXIF metadata to file
  6. Update progress counter
```

### Crash Recovery

If the server stops mid-indexing:
- Photos in `processing` state are **automatically reset to `pending`** on next startup
- Already-done photos are **never re-processed** (skipped by tag check)
- Workers are **isolated** — a crash in AI processing doesn't kill the server

---

## 🤖 Model Selection

The app detects **your installed models automatically** and shows them first in the dropdown.

| Model | VRAM | Speed | Quality | Notes |
|-------|------|-------|---------|-------|
| **CapRL-InternVL3.5-8B** | ~8 GB | Fast | ⭐⭐⭐ | Best quality, recommended |
| **minicpm-v** | ~8 GB | Fast | ⭐⭐ | Excellent, proven stable |
| **qwen2.5vl:7b** | ~8 GB | Fast | ⭐⭐ | Good alternative |
| **qwen3-vl:8b** | ~12 GB | Medium | ⭐ | Has thinking mode issues — avoid |

Settings → Vision Model → select from **Installed Models** list.

> **qwen3-vl warning**: The model's built-in "thinking mode" causes inconsistent JSON output. Use qwen2.5vl or minicpm-v instead.

### Hardware Recommendations

| Setup | Model |
|-------|-------|
| 8 GB+ VRAM | minicpm-v, CapRL-InternVL, qwen2.5vl |
| 12 GB+ VRAM | Any of the above |
| No GPU | Use Cloud API (OpenRouter / Gemini) |

---

## ☁️ Cloud Alternatives

### OpenRouter (supports free models)

1. Get API key from [openrouter.ai/keys](https://openrouter.ai/keys)
2. Settings → Select "OpenRouter" → Enter API key
3. Choose model (free options available)

**Free vision models:**
- `qwen/qwen2.5-vl-7b-instruct:free`
- `meta-llama/llama-3.2-11b-vision-instruct:free`

### Google Gemini (1500 requests/day free)

1. Get API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Settings → Select "Gemini" → Enter API key

---

## 📦 Data Storage

### Database Location

```
server/data/photo-index.db   ← SQLite (sql.js WebAssembly)
```

To fully reset:
```bash
rm server/data/photo-index.db
npm run start   # DB recreated empty
```

### Schema

```sql
folders (id, path, name, registered_at, last_scanned_at)
photos  (id, name, path, folder_path, size, last_modified, mime_type,
         tags, status, thumbnail, indexed_at, error_message,
         created_at, updated_at)
settings (key, value, updated_at)
processing_state (key, value, updated_at)
```

---

## 📂 Supported File Formats

**Analyzed:** JPEG, PNG, WebP, GIF, BMP

**Automatically skipped:**
- RAW: CR2, CR3, DNG, NEF, ARW, ORF, RW2, RAF, PEF, SRW, X3F, 3FR…
- HEIC/HEIF (sharp unstable on Windows)
- TIFF, PSD, PSB (large/unsupported formats)

**Optimization:** Images resized to max 512 px before AI analysis (smaller payloads, faster processing).

---

## 🛠️ Commands

| Command | Description |
|---------|-------------|
| `npm run start` | Build frontend + start server (production, single port 6800) |
| `npm run dev:all` | Start frontend (5173) + backend (6800) in dev mode |
| `npm run dev` | Frontend only (5173) |
| `npm run build` | Build frontend to `dist/` |
| `npm run migrate` | Import v1 IndexedDB backup |

### Running Individual Components

```bash
cd server
npm run dev        # Backend with hot-reload (port 6800)
npm run start      # Backend production (port 6800)
```

---

## 🔧 Troubleshooting

### "ERR_CONNECTION_REFUSED" on startup

The backend crashed or didn't start. Run from the `server` folder to see errors:

```powershell
cd server
npm run start
```

### Ollama Disconnected

```bash
# Restart Ollama with CORS
OLLAMA_ORIGINS="*" ollama serve
```

### Photos not loading after reload

Backend must be running. The frontend fetches previews via `GET /api/photos/:id/preview` using absolute paths stored in the DB.

### Indexing hangs at 0 progress

1. Check Ollama is running: `curl http://localhost:11434/api/tags`
2. Check the selected model is installed: Settings → Installed Models list
3. Check backend logs for errors

### Server crashes during indexing

Worker isolation (v3+) ensures a crashing AI process doesn't kill the server. Photos in `processing` state are reset to `pending` on restart and reprocessed.

### EXIF tags not written

- Backend logs may show `[EXIF] File not found`
- Server must have read/write access to photo files
- RAW/HEIC files are skipped (no EXIF writing)

### Slow processing

- Vision models need a GPU for acceptable speed
- Without GPU: use a cloud API (OpenRouter/Gemini free tiers)
- Or use `moondream` (2 GB VRAM, faster but basic quality)

---

## 🔀 Migrating from v1 (IndexedDB → SQLite)

**Step 1** — Export from old app:
1. Open app in Chrome
2. Database icon → Export Backup → save as `backup.json`

**Step 2** — Run migration:
```bash
npm run start       # Terminal 1: start backend
npm run migrate     # Terminal 2: import backup
```

**Step 3** — Start normally:
```bash
npm run start
```

Migration is idempotent — running multiple times is safe.

---

## 🙏 Acknowledgments

- [Ollama](https://ollama.com/) — Local LLM runtime
- [OpenBMB](https://github.com/OpenBMB) — MiniCPM-V
- [Qwen Team](https://github.com/QwenLM) — Qwen vision models
- [Hono](https://hono.dev/) — Lightweight web framework
- [exiftool-vendored](https://github.com/photostructure/exiftool-vendored.js) — EXIF metadata writing
- [OpenRouter](https://openrouter.ai/) — Multi-model API gateway

---

<div align="center">

**Made with care for privacy-conscious photographers**

[Report Bug](https://github.com/OnoSendai13/LocalSmartPhotoIndexer/issues) | [Request Feature](https://github.com/OnoSendai13/LocalSmartPhotoIndexer/issues)

</div>

## History

### Recent Changes

#### SQLite WAL Optimizations (2026-04-19)
- **Performance**: Implemented Write-Ahead Logging (WAL) mode for significantly faster photo indexing
- **Incremental Backups**: Replaced full database exports (400MB+) with incremental WAL file backups
- **Checkpointing**: Added automatic `PRAGMA wal_checkpoint(TRUNCATE)` after writes to release WAL files
- **Crash Recovery**: Database state is now persisted across restarts; interrupted indexing resumes automatically
- **Auto-restart**: Processing engine automatically resumes from pending photos after server restart or crash
- **Progress Tracking**: Real-time progress monitoring via `monitor.sh` showing processed/total photo counts
- **Reduced I/O**: Optimized `synchronous = NORMAL` and increased `cache_size` for better Windows NAS performance
- **State Management**: Processing state (done/total/current photo) saved to database for recovery
- **Worker Isolation**: Each photo processed independently; crashes in AI processing don't kill the server

### Migration from v1 (IndexedDB → SQLite)
- See [Migrating from v1](...) for steps to import existing data from IndexedDB backup

### Known Issues / Resolved
- Server must be restarted after code updates to activate WAL mode changes
- Monitor script requires 2+ seconds between checks to detect progress updates
- EXIF writing on Windows: Fixed Unicode path handling for files with special characters (French accents, etc.) via:
  - Using `fs.existsSync()` to skip missing files before EXIF write
  - Proper path resolution and error handling
  - Works with exiftool-vendored standard `write()` API
