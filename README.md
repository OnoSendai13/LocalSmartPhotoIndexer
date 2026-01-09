<div align="center">

# 📸 Local Smart Photo Indexer

**AI-powered photo organization that runs 100% on your machine**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Ollama](https://img.shields.io/badge/Ollama-Required-blue)](https://ollama.com)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev)

<img src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" alt="Local Smart Photo Indexer Banner" width="800"/>

*Index and organize your photos using local AI vision models. Your data never leaves your computer.*

[Features](#-features) • [Quick Start](#-quick-start) • [Installation](#-installation) • [Model Selection](#-choosing-the-right-model) • [Cloud Alternatives](#-cloud-alternatives) • [Troubleshooting](#-troubleshooting)

</div>

---

## ✨ Features

- 🔒 **100% Private** - All processing happens locally, no data sent to external servers
- 🤖 **AI-Powered Tagging** - Automatic semantic tags using vision language models
- 🏷️ **Smart Categories** - Environment, Living, Time & Light, Activity, Objects
- ✏️ **Manual Editing** - Add, remove, and customize tags per photo
- 📁 **Folder Import** - Drag & drop entire folders for batch processing
- 🎨 **Modern UI** - Beautiful dark theme with responsive design
- ☁️ **Cloud Options** - Optional OpenRouter/Gemini API for users without GPU

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or higher
- [Ollama](https://ollama.com/download) installed and running

### 5-Minute Setup

```bash
# 1. Install Ollama (if not already installed)
# Visit https://ollama.com/download or use:
curl -fsSL https://ollama.com/install.sh | sh   # Linux/macOS
# Windows: Download installer from https://ollama.com/download

# 2. Pull a vision model (choose based on your hardware - see Model Selection below)
ollama pull qwen2.5vl:7b       # Recommended for most users (8GB+ VRAM)
# OR
ollama pull llama3.2-vision    # Good alternative (11B model)
# OR  
ollama pull minicpm-v          # Excellent quality/performance ratio

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

## 📦 Installation

### Step 1: Install Ollama

<details>
<summary><b>🐧 Linux</b></summary>

```bash
# One-line installer
curl -fsSL https://ollama.com/install.sh | sh

# Or via package manager
# Arch Linux
yay -S ollama

# Ubuntu/Debian (manual)
wget https://ollama.com/download/ollama-linux-amd64
chmod +x ollama-linux-amd64
sudo mv ollama-linux-amd64 /usr/local/bin/ollama
```

</details>

<details>
<summary><b>🍎 macOS</b></summary>

```bash
# Using Homebrew (recommended)
brew install ollama

# Or download from https://ollama.com/download
# Double-click the .dmg and drag to Applications
```

</details>

<details>
<summary><b>🪟 Windows</b></summary>

1. Download the installer from [ollama.com/download](https://ollama.com/download)
2. Run `OllamaSetup.exe`
3. Follow the installation wizard

**Important for Windows users:** To enable CORS, you need to set an environment variable:

```powershell
# PowerShell (run as Administrator)
[System.Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', '*', 'User')

# Or via System Properties:
# 1. Press Win + R, type "sysdm.cpl", press Enter
# 2. Go to Advanced tab → Environment Variables
# 3. Under User variables, click New
# 4. Variable name: OLLAMA_ORIGINS
# 5. Variable value: *
# 6. Restart Ollama
```

</details>

<details>
<summary><b>🐳 Docker</b></summary>

```bash
# CPU only
docker run -d -v ollama:/root/.ollama -p 11434:11434 \
  -e OLLAMA_ORIGINS="*" \
  --name ollama ollama/ollama

# With NVIDIA GPU
docker run -d --gpus=all -v ollama:/root/.ollama -p 11434:11434 \
  -e OLLAMA_ORIGINS="*" \
  --name ollama ollama/ollama

# Pull a model inside the container
docker exec -it ollama ollama pull qwen2.5vl:7b
```

</details>

### Step 2: Download a Vision Model

Choose a model based on your hardware (see [Choosing the Right Model](#-choosing-the-right-model)):

```bash
# Pull your chosen model
ollama pull <model-name>

# Examples:
ollama pull qwen3-vl:8b        # Latest & best (needs ~12GB VRAM)
ollama pull qwen2.5vl:7b       # Excellent all-rounder
ollama pull minicpm-v          # Great quality, efficient
ollama pull llama3.2-vision    # Meta's vision model
ollama pull llava:7b           # Lightweight option
```

### Step 3: Start Ollama with CORS Enabled

**⚠️ This is required for the browser to communicate with Ollama!**

```bash
# Linux/macOS - Start with CORS enabled
OLLAMA_ORIGINS="*" ollama serve

# Or set it permanently in your shell profile (.bashrc, .zshrc):
export OLLAMA_ORIGINS="*"

# Windows (PowerShell)
$env:OLLAMA_ORIGINS="*"; ollama serve

# Windows (after setting environment variable as shown above)
ollama serve
```

### Step 4: Run the Application

```bash
# Clone the repository
git clone https://github.com/OnoSendai13/LocalSmartPhotoIndexer.git
cd LocalSmartPhotoIndexer

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## 🧠 Choosing the Right Model

### Model Comparison Table

| Model | VRAM Required | Speed | Quality | Best For |
|-------|---------------|-------|---------|----------|
| **qwen3-vl:8b** | ~12GB | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Best overall quality, latest tech |
| **qwen3-vl:2b** | ~4GB | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Quick tagging, limited hardware |
| **qwen2.5vl:7b** | ~8GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Best balance quality/speed |
| **qwen2.5vl:3b** | ~4GB | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Faster processing, good quality |
| **minicpm-v** | ~8GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Excellent OCR, documents |
| **llama3.2-vision:11b** | ~12GB | ⭐⭐⭐ | ⭐⭐⭐⭐ | Meta's latest vision model |
| **llava-llama3** | ~8GB | ⭐⭐⭐⭐ | ⭐⭐⭐ | Good general purpose |
| **llava:7b** | ~6GB | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Fast, lightweight |
| **moondream** | ~2GB | ⭐⭐⭐⭐⭐ | ⭐⭐ | Very low resources |

### Hardware Recommendations

<details>
<summary><b>💰 Budget Setup (8GB RAM, No GPU)</b></summary>

Best models:
- `moondream` - Runs on CPU
- `llava:7b` - Acceptable on CPU but slow
- `qwen2.5vl:3b` - Decent quality

Note: Processing will be significantly slower without a GPU. Consider using [Cloud Alternatives](#-cloud-alternatives).

```bash
ollama pull moondream
```

</details>

<details>
<summary><b>🖥️ Mid-Range (16GB RAM, 8GB+ VRAM)</b></summary>

Best models:
- `qwen2.5vl:7b` - **Recommended**
- `minicpm-v` - Excellent for documents/OCR
- `llava-llama3` - Good all-rounder

```bash
ollama pull qwen2.5vl:7b
```

</details>

<details>
<summary><b>🚀 High-End (32GB RAM, 12GB+ VRAM)</b></summary>

Best models:
- `qwen3-vl:8b` - **Recommended** - Latest and best quality
- `llama3.2-vision:11b` - Meta's premium vision model
- `qwen2.5vl:7b` - Fast with excellent quality

Your setup (RTX 5070Ti 12GB, 32GB RAM) is perfect for:
```bash
ollama pull qwen3-vl:8b    # Best quality
# or
ollama pull qwen2.5vl:7b   # Faster processing
```

</details>

### Model Features Comparison

| Feature | qwen3-vl | qwen2.5vl | minicpm-v | llama3.2-vision |
|---------|----------|-----------|-----------|-----------------|
| Object Recognition | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Scene Understanding | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| OCR (Text in Images) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| People/Faces | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Document Analysis | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Multilingual | 32 languages | 19 languages | EN/CN | 8 languages |

---

## ☁️ Cloud Alternatives

If you don't have a GPU or prefer cloud processing, you can use external APIs:

### Option 1: OpenRouter API

[OpenRouter](https://openrouter.ai/) provides access to multiple vision models via a single API.

1. Create an account at [openrouter.ai](https://openrouter.ai/)
2. Get your API key from the dashboard
3. In the app settings, select "OpenRouter" as provider
4. Enter your API key
5. Choose from available models (GPT-4V, Claude 3, Gemini Pro Vision, etc.)

**Pricing**: Pay-per-use, varies by model (~$0.001-0.01 per image)

### Option 2: Google Gemini API

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. In the app settings, select "Gemini" as provider
3. Enter your API key

**Pricing**: Free tier available (60 requests/minute)

### Option 3: OpenAI API

1. Get an API key from [OpenAI Platform](https://platform.openai.com/)
2. In the app settings, select "OpenAI" as provider
3. Enter your API key

**Pricing**: ~$0.01-0.03 per image with GPT-4V

---

## 🔧 Configuration

### In-App Settings

Click the ⚙️ settings icon in the app header to configure:

- **Server URL**: Default `http://localhost:11434` (change if Ollama runs elsewhere)
- **Model Name**: Your chosen vision model (e.g., `qwen3-vl:8b`)
- **Provider**: Local (Ollama), OpenRouter, Gemini, or OpenAI

### Environment Variables (Optional)

Create a `.env.local` file for default configurations:

```env
# Optional: Pre-configure API keys for cloud providers
VITE_OPENROUTER_API_KEY=your_openrouter_key
VITE_GEMINI_API_KEY=your_gemini_key
VITE_OPENAI_API_KEY=your_openai_key

# Optional: Default Ollama URL (if not localhost)
VITE_OLLAMA_URL=http://localhost:11434
```

---

## 💾 Data Storage

### Where is my data stored?

All indexed photo data (tags, metadata) is stored locally in your browser using **IndexedDB**. This means:

- ✅ Data persists across browser sessions
- ✅ No external database required
- ✅ Data stays on your machine
- ⚠️ Clearing browser data will remove indexed tags

### Export/Import (Coming Soon)

Future versions will support:
- Export tags to JSON/CSV
- Import previously exported data
- Sync with photo metadata (EXIF/XMP)

---

## 🐛 Troubleshooting

### "Ollama Disconnected (CORS?)"

This is the most common issue. The browser is blocked from connecting to Ollama.

**Solution:**
```bash
# Stop Ollama if running, then restart with CORS enabled:
OLLAMA_ORIGINS="*" ollama serve
```

For Windows, set the environment variable permanently (see [Windows installation](#-windows)).

### "Connection Failed"

1. **Is Ollama running?**
   ```bash
   # Check if Ollama is running
   curl http://localhost:11434/api/tags
   ```

2. **Is the port correct?** Default is 11434. Check your Ollama configuration.

3. **Firewall blocking?** Ensure port 11434 is open for local connections.

### "Model not found"

The model you selected isn't installed:
```bash
# List installed models
ollama list

# Pull the missing model
ollama pull qwen2.5vl:7b
```

### Slow processing

- **CPU-only mode**: Vision models are slow on CPU. Consider using a smaller model (`moondream`) or cloud alternatives.
- **Large images**: The app resizes images, but very large files may slow things down.
- **Too many photos**: Process folders in smaller batches.

### Images not loading

- Supported formats: JPEG, PNG, GIF, WebP, BMP
- Check file permissions
- Try refreshing the page

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Ollama](https://ollama.com/) - Local LLM runtime
- [Qwen Team](https://github.com/QwenLM) - Qwen vision models
- [Meta AI](https://ai.meta.com/) - Llama models
- [OpenBMB](https://github.com/OpenBMB) - MiniCPM-V

---

<div align="center">

**Made with ❤️ for privacy-conscious photographers**

[Report Bug](https://github.com/OnoSendai13/LocalSmartPhotoIndexer/issues) • [Request Feature](https://github.com/OnoSendai13/LocalSmartPhotoIndexer/issues)

</div>
