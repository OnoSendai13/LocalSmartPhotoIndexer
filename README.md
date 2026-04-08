<div align="center">

# Local Smart Photo Indexer

**AI-powered photo organization that runs 100% on your machine**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Ollama](https://img.shields.io/badge/Ollama-Supported-blue)](https://ollama.com)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev)
[![Backend](https://img.shields.io/badge/Backend-Hono%20%2B%20SQLite-orange)](https://hono.dev)

*Index and organize your photos using local AI vision models. Your data never leaves your computer.*

[Features](#-features) | [Quick Start](#-quick-start) | [Architecture](#-architecture) | [How It Works](#-how-it-works) | [Model Selection](#-recommended-models) | [Cloud Alternatives](#-cloud-alternatives-api) | [Troubleshooting](#-troubleshooting)

</div>

---

## ✨ Features

- **100% Private** — All processing happens locally, no data sent to external servers (with Ollama)
- **AI-Powered Tagging** — Automatic semantic tags using vision language models
- **Smart Categories** — People, Animals, Scenes, Locations, Weather, Activities, Objects
- **Manual Editing** — Add, remove, and customize tags per photo
- **Folder Import** — Import entire folders with automatic RAW file filtering
- **Persistent Storage** — Tags saved in SQLite (server-side) with auto-save during indexing
- **Preview After Reload** — Photos preview instantly after page reload via the backend, no need to re-select the folder
- **EXIF Metadata Write** — AI-generated tags are written back to the photo files (XPKeywords / Keywords)
- **Crash-safe Indexing** — Interrupted indexing resumes automatically from where it stopped on next server start
- **Export/Import** — Backup your index to JSON or CSV (Excel-compatible)
- **Cloud Options** — Optional OpenRouter/Gemini/OpenAI API for users without GPU

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or higher
- [Ollama](https://ollama.com/download) installed and running (or a cloud API key)

### 5-Minute Setup

```bash
# 1. Clone the repository
git clone https://github.com/OnoSendai13/LocalSmartPhotoIndexer.git
cd LocalSmartPhotoIndexer

# 2. Install all dependencies (frontend + backend)
npm install
cd server && npm install && cd ..

# 3. Pull the recommended vision model
ollama pull minicpm-v

# 4. Start Ollama with CORS enabled (REQUIRED for browser access)
OLLAMA_ORIGINS="*" ollama serve

# 5. Start both frontend and backend
npm run dev:all
```

Open **http://localhost:5173** in your browser — the backend API runs on **:6800**.

---

## 🏗️ Architecture

The app runs as **two separate processes**:

```
┌─────────────────────────────────────────────────────────┐
│  Frontend  (Vite dev server · port 5173)                │
│  React app — handles UI, file picker, AI tagging queue  │
│  talks to backend via /api/* proxy                       │
└──────────────────────┬──────────────────────────────────┘
                       │ proxy /api/* → localhost:6800
┌──────────────────────▼──────────────────────────────────┐
│  Backend  (Hono + sql.js · port 6800)                   │
│  • Folder registration & validation                      │
│  • Photo scanning & DB persistence                       │
│  • Preview serving (reads files from absolute paths)     │
│  • EXIF/XMP metadata writing (exiftool-vendored)         │
│  Data: server/data/photo-index.db                        │
└─────────────────────────────────────────────────────────┘
```

### Key Design Principle — Absolute Paths

All file paths stored in the database are **absolute paths on the server** (e.g. `/home/alice/Photos/vacation/IMG_001.jpg`). This is what makes previews, EXIF writes, and crash recovery work reliably:

| What needs it | Why |
|---|---|
| `/api/photos/:id/preview` | Reads the file from disk to serve it to the browser |
| EXIF tag writing | `exiftool-vendored` needs the full disk path |
| Duplicate detection | Compare identical absolute paths, not relative names |
| Crash recovery | Server re-reads pending photos from DB by their disk path |

When you click **"Add Folder"**, the app asks for the **absolute path of the folder on the server** (e.g. `/home/alice/Photos`). The browser's file picker only provides relative paths (`webkitRelativePath`), so the prompt is necessary.

---

## 🔄 How It Works

### Indexing a folder

```
1. User selects folder via browser file picker
2. App prompts for the absolute server path of that folder
3. Folder is registered with backend (POST /api/folders)
   → Backend validates the path exists on disk
   → Backend scans and inserts photo records with absolute paths
4. Frontend builds absolute paths per photo:
   absoluteFilePath = absoluteFolderPath + '/' + relativePathInFolder
5. For each photo in queue:
   a. AI model analyzes the image (Ollama/OpenRouter/Gemini)
   b. Tags are merged and saved to backend (PUT /api/photos/:id)
   c. Backend writes tags to EXIF/XMP metadata on disk
6. On next page load: photos reload from DB with backend previews
```

### Photo previews after reload

Photos loaded from the database have no browser `File` object (those are not persistent). The `LazyImage` component automatically falls back to:

```
GET /api/photos/:id/preview
```

The backend reads the file from its **absolute path** on disk and streams it back. No need to re-select the folder.

### Crash / interruption recovery

If the server stops while photos are being analyzed (status = `processing`), on the **next server start**:

1. All `processing` photos are reset to `pending` automatically
2. The frontend calls `POST /api/photos/queue/reset-processing` on load
3. These photos will be picked up again next time you start indexing

---

## 📦 Data Storage

### Database Schema

```sql
-- Registered folders (absolute paths)
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,   -- absolute path, e.g. /home/user/Photos
  name TEXT NOT NULL,
  registered_at INTEGER,
  last_scanned_at INTEGER
);

-- Indexed photos (absolute paths)
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,          -- absolute file path
  folder_path TEXT NOT NULL,   -- absolute folder path
  size INTEGER,
  last_modified INTEGER,
  mime_type TEXT,
  tags TEXT DEFAULT '[]',      -- JSON array of tag strings
  status TEXT DEFAULT 'pending', -- pending | processing | done | error
  indexed_at INTEGER,
  error_message TEXT
);
```

### Data Location

- **Database**: `server/data/photo-index.db`
- Auto-created on first start, survives restarts

To fully reset (start from scratch):
```bash
rm server/data/photo-index.db
# Restart — DB is recreated empty
```

---

## 🛠️ Running Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:all` | Start frontend (5173) + backend (6800) |
| `npm run dev` | Frontend only |
| `npm run server` | Backend only |
| `npm run migrate` | Import old IndexedDB backup (v1 → v2) |

---

## 🤖 Recommended Models

### Best Choice: `minicpm-v`

```bash
ollama pull minicpm-v
```

**Why minicpm-v?**
- Excellent accuracy for everyday photos (people, landscapes, events)
- ~8 GB VRAM required
- Specifically optimized for visual understanding

### Model Comparison

| Model | VRAM | Speed | Accuracy | Notes |
|-------|------|-------|----------|-------|
| **minicpm-v** | ~8 GB | Fast | ⭐ Excellent | **Recommended** |
| qwen2.5vl:7b | ~8 GB | Fast | Good | Good alternative |
| llama3.2-vision | ~12 GB | Medium | Good | Meta's option |
| llava:7b | ~6 GB | Very Fast | Average | Lightweight |
| moondream | ~2 GB | Very Fast | Basic | Limited hardware |

> **Note**: `qwen3-vl` models have a built-in "thinking mode" that causes inconsistent tag output — avoid for indexing.

### Hardware Recommendations

| Setup | Model |
|-------|-------|
| No GPU / <8 GB RAM | Use Cloud API (OpenRouter / Gemini) |
| 8 GB+ VRAM | `minicpm-v` |
| 12 GB+ VRAM | `minicpm-v` or `qwen2.5vl:7b` |

---

## ☁️ Cloud Alternatives (API)

### OpenRouter (Recommended Cloud Option)

[OpenRouter](https://openrouter.ai/) provides access to multiple vision models via a single API.

**Free Models:**
| Model | ID | Cost |
|-------|-----|------|
| Qwen2.5-VL 7B | `qwen/qwen2.5-vl-7b-instruct:free` | Free |
| Llama 3.2 Vision | `meta-llama/llama-3.2-11b-vision-instruct:free` | Free |

**Paid Models (better quality):**
| Model | ID | Approx. cost/image |
|-------|-----|------------|
| GPT-4o | `openai/gpt-4o` | ~$0.005 |
| Claude 3.5 Sonnet | `anthropic/claude-3.5-sonnet` | ~$0.005 |
| Gemini 1.5 Flash | `google/gemini-flash-1.5` | ~$0.0001 |

**Setup:** Settings → Select "OpenRouter" → Enter API key → Choose model.

### Google Gemini (Free Tier)

1. Get free API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Settings → Select "Gemini" → Enter API key
3. Free tier: 1500 requests/day

---

## 📂 Supported File Formats

**Indexed and analyzed:**
- JPEG (`.jpg`, `.jpeg`)
- PNG (`.png`)
- WebP (`.webp`)
- GIF (`.gif`)
- BMP (`.bmp`)

**Automatically skipped:**
- RAW: CR2, CR3, DNG, NEF, ARW, ORF, RW2, RAF, PEF, SRW, X3F, 3FR…
- Large format: TIFF, PSD, PSB

**Automatic optimization:** Large images are resized to max 1024 px before being sent to the AI model, preventing memory issues without affecting tag quality.

---

## 🖥️ Installation Details

### Step 1 — Install Ollama

<details>
<summary><b>Linux</b></summary>

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

</details>

<details>
<summary><b>macOS</b></summary>

```bash
brew install ollama
# Or download from https://ollama.com/download
```

</details>

<details>
<summary><b>Windows / WSL</b></summary>

1. Download from [ollama.com/download](https://ollama.com/download)
2. Run the installer
3. Set CORS in PowerShell (run as Administrator):

```powershell
[System.Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', '*', 'User')
```

</details>

<details>
<summary><b>Docker (with GPU)</b></summary>

```bash
docker run -d --gpus=all -v ollama:/root/.ollama -p 11434:11434 \
  -e OLLAMA_ORIGINS="*" --name ollama ollama/ollama

docker exec ollama ollama pull minicpm-v
```

</details>

### Step 2 — Start Ollama with CORS

**Required for browser ↔ Ollama communication.**

```bash
# Linux / macOS
OLLAMA_ORIGINS="*" ollama serve

# Windows (after setting the env variable above)
ollama serve
```

### Step 3 — Install & Run the App

```bash
git clone https://github.com/OnoSendai13/LocalSmartPhotoIndexer.git
cd LocalSmartPhotoIndexer

npm install
cd server && npm install && cd ..

npm run dev:all
```

Open **http://localhost:5173**.

---

## 📖 Usage Guide

### Adding Your First Folder

1. Click **"Add Folder"** (top-right button, or sidebar)
2. Select the folder in the browser's file picker
3. A prompt will ask for the **absolute path** of that folder on the server:
   - Example: `/home/alice/Photos/Holidays2024`
   - On Windows (WSL): `/mnt/c/Users/Alice/Pictures/Holidays2024`
   - This is needed so the backend can serve previews and write EXIF tags
4. The app counts new photos and begins AI analysis

> 💡 **Why the prompt?** Browsers only expose relative paths (`webkitRelativePath`). The absolute path is required for the backend to read files from disk (previews, EXIF writes).

### Browsing Photos After Reload

When you reopen the app, indexed photos load instantly from the database. **Previews are served directly by the backend** — no need to re-select the folder.

```
Sidebar shows:          Grid shows:
┌─────────────────┐    ┌─────────────────────────────┐
│ ✓ 📁 Photos     │    │ [img] [img] [img] [img] ...  │
│                 │    │  ●  done  ●  done  ●  done  │
│ SMART CATEGORIES│    └─────────────────────────────┘
│ 🏷️ Portrait (12)│       ↑ served by /api/photos/:id/preview
│ 🏷️ Beach (8)    │
└─────────────────┘
```

### Crash / Interruption Recovery

If indexing stops (server killed, network cut, etc.):

1. **Restart the server** (`npm run dev:all`)
2. **Select the same folder again** in the browser
3. Already-indexed photos are **automatically skipped** (detected by absolute path)
4. Photos that were mid-processing (status `processing`) are **automatically reset to `pending`** and will be retried

### Clearing All Data

Click the **database icon (⊞)** → **"Clear All Data"**.

This deletes both the `photos` and `folders` tables, so re-adding the same folder starts completely fresh.

> **Previously broken**: only `photos` was cleared, causing re-added folders to skip all their photos. Now fixed.

### Data Export / Import

| Action | How |
|--------|-----|
| Export for Excel | Database icon → Export CSV |
| Full backup | Database icon → Export JSON |
| Restore backup | Database icon → Import JSON |
| Retry failed photos | Database icon → Retry Uncategorized |

---

## 🔧 Troubleshooting

### "Ollama Disconnected" / CORS Error

```bash
# Restart Ollama with CORS enabled
OLLAMA_ORIGINS="*" ollama serve
```

Docker:
```bash
docker run -e OLLAMA_ORIGINS="*" ...
```

### Previews not loading after page reload

Ensure the backend is running (`npm run server` or `npm run dev:all`). The frontend calls `GET /api/photos/:id/preview` which reads files from disk using the stored absolute path. If the backend is not running, or if the file was moved/deleted, previews won't load.

### Photos show "pending" after restart and won't process

This may be a `processing` → `pending` reset issue. The fix is automatic since v2.1 — any photos stuck in `processing` are reset on server start. If you are on an older version, update and restart.

### Re-adding a folder re-indexes everything (or skips everything)

- **Skips everything** after a Clear → **Fixed in v2.1** (`DELETE /api/photos/all` now also clears `folders`)
- **Re-indexes everything** → Normal if you cleared the DB; photos are detected by absolute path

### EXIF tags not written to files

- Check the backend logs for `[EXIF] File not found for EXIF write:`
- Ensure the absolute path you entered in the prompt is correct and the server can read those files
- `exiftool-vendored` requires write permissions on the photo files

### Model Returns Empty / Wrong Tags

- **qwen3-vl issue**: This model's "thinking mode" causes inconsistent JSON output. Switch to `minicpm-v`
- Check the connection status indicator in the header

### Slow Processing

- Vision models need a GPU for acceptable performance
- Without GPU: use a cloud API (OpenRouter / Gemini) — free tiers available
- Or use `moondream` (2 GB VRAM, much faster)

### RAW Files Not Showing

Intentional. RAW files (CR2, CR3, DNG, etc.) and TIFF/PSD are filtered out automatically. Export to JPEG first, or use RAW+JPEG shooting mode.

---

## 🔀 Migrating from v1 (IndexedDB → SQLite)

If you used the original app (data in Chrome IndexedDB):

**Step 1** — Export from the old app:
1. Open the app in Chrome
2. Click the database icon → **Export Backup** → save as `backup.json` in the project folder

**Step 2** — Run migration:
```bash
npm run server          # Terminal 1: start backend
npm run migrate         # Terminal 2: import backup
```

**Step 3** — Start normally:
```bash
npm run dev:all
```

The migration is idempotent — running it multiple times is safe.

---

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a Pull Request.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) file.

---

## 🙏 Acknowledgments

- [Ollama](https://ollama.com/) — Local LLM runtime
- [OpenBMB](https://github.com/OpenBMB) — MiniCPM-V
- [Qwen Team](https://github.com/QwenLM) — Qwen vision models
- [OpenRouter](https://openrouter.ai/) — Multi-model API gateway
- [Hono](https://hono.dev/) — Lightweight web framework
- [exiftool-vendored](https://github.com/photostructure/exiftool-vendored.js) — EXIF metadata writing

---

<div align="center">

**Made with care for privacy-conscious photographers**

[Report Bug](https://github.com/OnoSendai13/LocalSmartPhotoIndexer/issues) | [Request Feature](https://github.com/OnoSendai13/LocalSmartPhotoIndexer/issues)

</div>
