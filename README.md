<div align="center">

# Local Smart Photo Indexer

**AI-powered photo organization that runs 100% on your machine**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Ollama](https://img.shields.io/badge/Ollama-Required-blue)](https://ollama.com)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev)

*Index and organize your photos using local AI vision models. Your data never leaves your computer.*

[Features](#-features) | [Quick Start](#-quick-start) | [Model Selection](#-recommended-models) | [Cloud Alternatives](#-cloud-alternatives-api) | [Troubleshooting](#-troubleshooting)

</div>

---

## Features

- **100% Private** - All processing happens locally, no data sent to external servers
- **AI-Powered Tagging** - Automatic semantic tags using vision language models
- **Smart Categories** - People, Animals, Scenes, Locations, Weather, Activities, Objects
- **Manual Editing** - Add, remove, and customize tags per photo
- **Folder Import** - Import entire folders with automatic RAW file filtering
- **Persistent Storage** - Tags saved locally in IndexedDB with auto-save during indexing
- **Export/Import** - Backup your index to JSON and restore anytime
- **Cloud Options** - Optional OpenRouter/Gemini API for users without GPU

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or higher
- [Ollama](https://ollama.com/download) installed and running

### 5-Minute Setup

```bash
# 1. Install Ollama (visit https://ollama.com/download)

# 2. Pull the recommended vision model
ollama pull minicpm-v

# 3. Start Ollama with CORS enabled (REQUIRED for browser access)
OLLAMA_ORIGINS="*" ollama serve

# 4. Clone and run the app
git clone https://github.com/OnoSendai13/LocalSmartPhotoIndexer.git
cd LocalSmartPhotoIndexer
npm install
npm run dev
```

Open http://localhost:5173 in your browser and start importing photos!

---

## Recommended Models

### Best Choice: `minicpm-v` (Recommended)

After extensive testing, **MiniCPM-V** provides the best results for photo classification:

```bash
ollama pull minicpm-v
```

**Why minicpm-v?**
- Excellent accuracy for everyday photos (people, landscapes, events)
- Good balance of speed and quality
- ~8GB VRAM required
- Specifically optimized for visual understanding

### Model Comparison (January 2025)

| Model | VRAM | Speed | Accuracy | Recommendation |
|-------|------|-------|----------|----------------|
| **minicpm-v** | ~8GB | Fast | Excellent | **Best choice for photo indexing** |
| qwen2.5vl:7b | ~8GB | Fast | Good | Good alternative |
| qwen3-vl:8b | ~12GB | Medium | Good* | *Has "thinking mode" issues |
| llama3.2-vision | ~12GB | Medium | Good | Meta's option |
| llava:7b | ~6GB | Very Fast | Average | Lightweight option |
| moondream | ~2GB | Very Fast | Basic | For very limited hardware |

> **Note**: `qwen3-vl` models have a "thinking mode" that can cause inconsistent results. We recommend `minicpm-v` or `qwen2.5vl` for best experience.

### Hardware Recommendations

| Your Setup | Recommended Model | Command |
|------------|-------------------|---------|
| No GPU / 8GB RAM | Use Cloud API (see below) | - |
| 8GB+ VRAM | minicpm-v | `ollama pull minicpm-v` |
| 12GB+ VRAM | minicpm-v or qwen2.5vl:7b | `ollama pull minicpm-v` |

---

## Installation

### Step 1: Install Ollama

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
<summary><b>Windows</b></summary>

1. Download from [ollama.com/download](https://ollama.com/download)
2. Run the installer
3. Set CORS environment variable:

```powershell
# PowerShell (run as Administrator)
[System.Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', '*', 'User')
```

</details>

<details>
<summary><b>Docker (with GPU)</b></summary>

```bash
docker run -d --gpus=all -v ollama:/root/.ollama -p 11434:11434 \
  -e OLLAMA_ORIGINS="*" \
  --name ollama ollama/ollama

# Pull the model
docker exec ollama ollama pull minicpm-v
```

</details>

### Step 2: Start Ollama with CORS

**This is required for the browser to communicate with Ollama!**

```bash
# Linux/macOS
OLLAMA_ORIGINS="*" ollama serve

# Windows (after setting environment variable)
ollama serve
```

### Step 3: Run the App

```bash
git clone https://github.com/OnoSendai13/LocalSmartPhotoIndexer.git
cd LocalSmartPhotoIndexer
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Cloud Alternatives (API)

If you don't have a GPU or want faster/better results, you can use cloud APIs.

### Option 1: OpenRouter (Recommended Cloud Option)

[OpenRouter](https://openrouter.ai/) provides access to multiple vision models via a single API.

**Free Vision Models on OpenRouter:**
| Model | ID | Cost |
|-------|-----|------|
| Qwen2.5-VL 7B | `qwen/qwen2.5-vl-7b-instruct:free` | Free |
| Llama 3.2 Vision | `meta-llama/llama-3.2-11b-vision-instruct:free` | Free |

**Paid Models (better quality):**
| Model | ID | Cost/image |
|-------|-----|------------|
| GPT-4o | `openai/gpt-4o` | ~$0.005 |
| Claude 3.5 Sonnet | `anthropic/claude-3.5-sonnet` | ~$0.005 |
| Gemini 1.5 Flash | `google/gemini-flash-1.5` | ~$0.0001 |
| Qwen2-VL 72B | `qwen/qwen2-vl-72b-instruct` | ~$0.001 |

**Setup:**
1. Create account at [openrouter.ai](https://openrouter.ai/)
2. Get API key from dashboard
3. In app Settings: Select "OpenRouter", enter API key, choose model

### Option 2: Google Gemini (Free Tier)

1. Get free API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. In app Settings: Select "Gemini", enter API key
3. Free tier: 1500 requests/day

---

## Supported File Formats

The app only processes standard image formats (RAW files are automatically skipped):

**Supported:**
- JPEG (.jpg, .jpeg)
- PNG (.png)
- WebP (.webp)
- GIF (.gif)
- BMP (.bmp)

**Automatically Excluded:**
- RAW files: CR2, CR3, DNG, NEF, ARW, ORF, RW2, RAF, etc.
- This allows you to import folders containing both RAW and JPEG without issues

---

## Data Storage & Recovery

### How Data is Saved

Your photo index is stored locally in your browser using **IndexedDB**:

- **Auto-save**: Each photo is saved immediately after indexing (crash-safe)
- **Persistent**: Data survives browser restarts
- **Private**: Never leaves your computer

### Export Your Data (Backup)

1. Click the database icon in the header
2. Click "Export Backup (JSON)"
3. Save the file somewhere safe

### Import / Restore Data

1. Click the database icon in the header
2. Click "Import Backup"
3. Select your previously exported JSON file
4. Your tags will be restored

### Resume After Crash / Interruption

If indexing is interrupted (browser closed, crash, or you stop it):

1. **Relaunch the app** (`npm run dev`)
2. **Select the same folder again**
3. The app automatically detects already-indexed photos and **skips them**
4. Only new/unindexed photos will be processed

Console output will show:
```
📚 Found 1234 already indexed photos in database
⏭️ Skipping 1234 already indexed photos, processing 567 new ones
```

This means you can safely index huge photo collections (10,000+) without worrying about crashes - progress is saved after each photo!

### Data Location

Data is stored in IndexedDB under:
- **Database**: `LocalPhotoIndexer`
- **Stores**: `photos` (your indexed photos), `settings` (your preferences)

To manually clear data:
1. Open browser DevTools (F12)
2. Go to Application > Storage > IndexedDB
3. Delete `LocalPhotoIndexer`

Or use the "Clear All Data" button in the Data Management modal.

---

## Troubleshooting

### "Ollama Disconnected" / CORS Error

```bash
# Stop Ollama, then restart with CORS enabled:
OLLAMA_ORIGINS="*" ollama serve
```

For Docker:
```bash
docker run -e OLLAMA_ORIGINS="*" ...
```

### Model Returns Empty/Wrong Tags

- **qwen3-vl issue**: This model has a "thinking mode" that causes problems. Switch to `minicpm-v`
- In Settings, change model to `minicpm-v` and re-index

### Slow Processing

- Vision models need GPU for good performance
- Without GPU: Use cloud API (OpenRouter/Gemini) or `moondream` model
- Large photo collections: Process in batches of 100-500

### RAW Files Not Showing

This is intentional! RAW files (CR2, CR3, DNG, etc.) are automatically filtered out. Export your RAWs to JPEG first, or the app will use the JPEG versions if you shoot RAW+JPEG.

---

## Contributing

Contributions welcome! Please submit a Pull Request.

---

## License

MIT License - see [LICENSE](LICENSE) file.

---

## Acknowledgments

- [Ollama](https://ollama.com/) - Local LLM runtime
- [OpenBMB](https://github.com/OpenBMB) - MiniCPM-V (recommended model)
- [Qwen Team](https://github.com/QwenLM) - Qwen vision models
- [OpenRouter](https://openrouter.ai/) - Multi-model API gateway

---

<div align="center">

**Made with care for privacy-conscious photographers**

[Report Bug](https://github.com/OnoSendai13/LocalSmartPhotoIndexer/issues) | [Request Feature](https://github.com/OnoSendai13/LocalSmartPhotoIndexer/issues)

</div>
