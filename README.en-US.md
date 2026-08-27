# EasierLightNovel

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-19+-cyan.svg)](https://react.dev/)

---

## Project Introduction

**EasierLightNovel** is a locally deployed Japanese learning reader designed for users who want to read original light novels but are limited by their foundation in Japanese.

### Core Features

| Feature | Description |
|------|------|
| **EPUB/PDF Parsing** | Supports uploading EPUB/PDF files, automatically extracts illustrations, and preserves original layout. (Currently, PDF processing is suboptimal and is being optimized). |
| **Intelligent Tokenization** + **Offline Instant Dictionary** | Japanese tokenization based on SudachiPy with automatic furigana generation; integrated Jamdict Japanese dictionary—click a word to view definitions. |
| **Vocabulary Book** + **Highlighter** | Collect new words, supporting categorization by book and spaced repetition review; multiple highlighting styles to mark important sentences and grammar points. |
| **AI Deep Analysis** | Optional LLM calls for grammar, translation, and linguistic nuance analysis. |
| **Reading Progress** | Automatically saves your position to resume reading at any time. |
| **TTS Pronunciation** | Uses the browser's built-in engine for Japanese text-to-speech. |

### Design Philosophy

- **Hybrid Architecture**: Traditional NLP (tokenization, furigana) + Large Language Models (deep analysis).
- **Progressive Learning**: From basic furigana to AI grammar analysis, adapting to different proficiency levels.
- **Local Deployment**: Controllable data privacy, suitable for personal use.
- **Immersive Reading**: Retains original book layout and supports mixed illustration placement.

---

## Quick Start

> **Tip**: Windows users can download the packaged files from the `release` section for a quicker and more lightweight setup.

### Environment Requirements

- **Python**: 3.11+
- **Node.js**: 18+
- **Operating System**: Windows / macOS / Linux

### 1. Install Dependencies

```bash
# Backend dependencies (uv recommended)
cd backend
pip install uv
uv sync

# Frontend dependencies
cd ../web
npm install
```

### 2. Configuration File

Copy the configuration template and modify it:

```bash
# Windows
copy config\user.json.example config\user.json

# macOS / Linux / Git Bash
cp config/user.json.example config/user.json
```

### 3. Start Services

**Method 1: Development Mode (Recommended for beginners)**

```bash
# Terminal 1 - Start Backend
cd backend
uv run python main.py

# Terminal 2 - Start Frontend
cd web
npm run dev
```

Visit http://localhost:5173

**Method 2: Production Mode**

```bash
# Build Frontend
cd web
npm run build

# Start Backend (will automatically host frontend static files)
cd ../backend
uv run python main.py
```

Visit http://localhost:8010


---

## Project Structure

```
EasierLightNovel/
├── backend/              # FastAPI Backend
│   ├── app/
│   │   ├── routers/      # API Routes
│   │   ├── services/     # Business Logic
│   │   ├── models.py     # Data Models
│   │   └── schemas.py    # Pydantic Models
│   ├── main.py           # App Entry Point
│   └── pyproject.toml    # Python Dependencies
├── web/                  # React Frontend
│   ├── src/
│   │   ├── components/   # Components
│   │   ├── pages/        # Pages
│   │   ├── stores/       # State Management
│   │   └── services/     # API Services
│   └── package.json      # Node Dependencies
├── config/               # Configuration Files
│   ├── schema.json       # Config Schema
│   └── user.json.example # Config Template
└── static_data/          # Runtime Generated (Books, Database)
```

---

## User Guide

### 1. Uploading Books

Click the "Import Book" button on the homepage and select an EPUB or PDF file. The system will automatically parse and tokenize the text.

> **Note**: PDF parsing requires a MinerU API Token (see configuration section below).

### 2. Reading and Learning

- **Click Kanji**: Displays furigana (reading).
- **Click Word**: Pops up a dictionary definition window.
- **Add to Vocab**: Click "Add to Vocabulary Book" in the dictionary window.
- **Highlighting**: Drag to select text and choose a highlight style.
- **AI Analysis**: Click a highlighted area to request deep AI analysis.

#### 2.1 Mobile Usage Instructions

This project is adapted for mobile browsers and supports reading on phones and tablets.

**Mobile Interaction Differences:**

| Feature | Desktop | Mobile |
|------|--------|--------|
| Navigation Bar | Fixed left sidebar | Bottom Tab bar |
| Sidebar | Right sliding panel (320px) | Bottom drawer (draggable height) |
| Back/Settings | Left navigation bar | Top navigation bar |

**Bottom Drawer Operation:**

- Click the Bottom Tab bar icons to open the corresponding function drawer.
- When the drawer is open, the Bottom Tab bar hides automatically; Tab switching buttons are integrated into the top of the drawer.
- Drag the handle at the top of the drawer to adjust height (30%-90vh).
- Click the close button (×) at the top of the drawer or switch to another function to close it.

**Text Highlighting (Special Mobile Interaction):**

After selecting text on a mobile device, the system's native copy/share menu will appear. To add a highlight, please **click the selected text again** to trigger the highlight menu.

A guide will be displayed upon the first mobile visit, which can be skipped at any time.

---

## Roadmap

- [ ] Support more e-book formats (TXT, MOBI)
- [ ] Vocabulary book export (Anki format)
- [ ] Reading statistics visualization

### 3. Learning Center

On the "Learning Center" page, you can:
- View and manage your vocabulary book.
- Review highlighted sections and AI analysis results.
- Perform spaced repetition reviews.

### 4. System Settings

Click "System Settings" on the bookshelf page to:
- Modify all configuration items via the Web UI.
- Configure tokenization modes, EPUB parsing options, and dictionary settings.
- Configure LLM and MinerU APIs.
- *Note*: The backend must be restarted for changes to take effect (a popup will notify you).

---

## API Documentation

After starting the backend, visit http://localhost:8010/docs to view the Swagger API documentation.

---

## Tech Stack

### Backend

| Component | Technology |
|------|------|
| Framework | FastAPI |
| Database | SQLite + SQLAlchemy |
| EPUB Parsing | ebooklib + BeautifulSoup4 |
| PDF Parsing | MinerU API + MarkdownParser |
| Tokenization | SudachiPy |
| Dictionary | Jamdict |
| LLM Integration | litellm |

### Frontend

| Component | Technology |
|------|------|
| Framework | React 19 + TypeScript |
| Build Tool | Vite |
| Routing | React Router DOM |
| Styling | Tailwind CSS |
| State | Zustand |
| Requests | Axios + React Query |

---

## Configuration Guide

### PDF Parsing Configuration (Required for PDF functionality)

PDF parsing uses the MinerU cloud API, which requires an API Token:

```json
{
  "pdf": {
    "mineru_api_token": "your-mineru-token",
    "mineru_model_version": "vlm",
    "mineru_language": "japan"
  }
}
```

To obtain a token, please visit the [MinerU official website](https://mineru.net/) and register an account.

### LLM Configuration (Optional)

AI analysis requires an LLM configuration, supporting various models via litellm:

```json
{
  "llm": {
    "model": "openai/gpt-4o-mini",    // OpenAI
    // "model": "deepseek/deepseek-chat",  // DeepSeek
    // "model": "ollama/llama3",            // Local Ollama
    "api_key": "your-api-key",
    "base_url": "https://api.example.com"
  }
}
```

Basic reading and dictionary functions are not affected if an LLM is not configured.

### Other Configurations

The project includes a complete **System Settings page** where all configurations can be modified directly in the Web UI.

The `config/user.json` file supports:
- Tokenization modes (A/B/C granularity)
- Dictionary language preferences
- Port and path configurations
- Upload file size limits
- EPUB chapter merging strategies

Refer to `config/schema.json` for a full list of available configuration options.

---

## FAQ

**Q: What should I do if AI analysis throws an error?**

A: Check if the API configuration is correct and ensure the `api_key` and `base_url` match. Refer to the [litellm documentation](https://docs.litellm.ai/docs/providers) for model names and ensure they are entered in the `provider/model_name` format.

**Q: Does it support other e-book formats?**

A: Currently, EPUB and PDF are supported. EPUB is parsed locally, while PDF is parsed via the MinerU API.

**Q: What if PDF parsing fails?**

A: Ensure the MinerU API Token is configured. If you encounter network errors, try disabling your proxy or checking your internet connection.

**Q: Where is data stored?**

A: All data is stored **completely locally** in the `static_data/` directory, including the book information database and extracted images.

---

## Roadmap

- [ ] Support more e-book formats (TXT, MOBI)
- [ ] Vocabulary book export (Anki format)
- [ ] Reading statistics visualization

### Contributions are welcome!

---

## License

[MIT License](LICENSE)

---

## Acknowledgments

- [SudachiPy](https://github.com/WorksApplications/SudachiPy) - Japanese tokenization
- [Jamdict](https://github.com/neocl/jamdict) - Japanese dictionary
- [FastAPI](https://fastapi.tiangolo.com/) - Backend framework
- [React](https://react.dev/) - Frontend framework
- [Teacher Xue]() - Source of motivation

## Other Useful Projects
- [Jamdict Chinese Translation Version](https://github.com/5945ggh/jamdict-cn) - Can be used to replace the .db files in `jamdict_data`.

---

## Feedback and Contribution

If you find this project helpful, please give it a Star for support!

Issues and Pull Requests are welcome; the author is actively maintaining the project.
