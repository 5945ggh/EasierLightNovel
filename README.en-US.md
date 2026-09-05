# EasierLightNovel

[简体中文](README.md) | English

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
| **Vocabulary Collection** + **Highlights** | Save words, excerpts, and related AI analysis, with cross-book browsing; spaced repetition review is not currently available. |
| **Book Learning Map** | View chapter vocabulary load, in-book high-frequency coverage, and optional explicit-knowledge coverage for a book. |
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

> **Tip**: If packaged releases are available, Windows users can download one from the repository's Releases page for a quicker and lighter setup.

### Environment Requirements

- **Python**: 3.11+
- **Node.js**: 20.19+ or 22.12+ (required by Vite 7)
- **Operating System**: Windows / macOS / Linux

### 1. Install Dependencies

```bash
# Backend dependencies (uv recommended)
cd backend
pip install uv
uv sync
cd ..

# Frontend dependencies
cd web
npm install
cd ..
```

### 2. Configuration File

From the repository root, copy and edit the configuration template:

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
└── static_data/          # Runtime generated (database, images, private source copies)
```

---

## User Guide

### 1. Uploading Books

Click the "Import Book" button on the homepage and select an EPUB or PDF file. The system will automatically parse and tokenize the text.

> **Note**: PDF parsing requires a MinerU API token (see the configuration section below). Newly imported books retain a private, local-only copy of the original EPUB or PDF so analysis data can be rebuilt later; this does not change reader content or reading behavior.

### 2. Reading and Learning

#### 2.0 Book Home / Reading Workbench

Selecting a processed book from the library opens its Book Home before the reader. It brings together book details, the table of contents, and reading progress:

- **Continue Reading / Start Reading** restores the latest saved position for the book, or opens the first chapter when reading has not started.
- **Table of Contents** opens a selected chapter. A chapter with its own checkpoint resumes there; otherwise it opens at the top.
- **Book Learning Map** shows chapter vocabulary load, in-book high-frequency coverage, and optional personal coverage.
- **Vocabulary and Excerpts** opens the cross-book collection of saved words, source excerpts, and AI analysis.

The Book Home loads only the table of contents and progress, not chapter text. Reader content, dictionary data, vocabulary, and highlights load when the reader needs them.

- Book-level progress is the resume location: chapter, paragraph, and scroll percentage within that chapter.
- Loading Book Home or opening a chapter alone does not write book-level progress. Progress is saved only after a confirmed scroll, paragraph-position change, or explicit chapter navigation.
- Each chapter has its own checkpoint independent of the book-level resume position.

- **Click Kanji**: shows furigana.
- **Click a word**: opens its dictionary definition.
- **Save vocabulary**: select "Add to Vocabulary Collection" in the dictionary popover.
- **Highlight text**: drag to select text, then choose a highlight style.
- **AI analysis**: select a saved highlight to request and retain reading support.

#### 2.1 Book Learning Map

Open the Learning Map from Book Home, a book's library menu, or the reader. It is a per-book vocabulary-readiness and chapter-route view with optional explicit-knowledge coverage, a chapter route with not-explicitly-known occurrence rates and first-occurrence hints, and a high-frequency coverage curve.

- Newly imported books with rebuildable source material are analyzed after import.
- Older books without an active analysis run show that re-analysis is needed; the map does not compute temporary results from legacy chapter JSON.
- Without a personal vocabulary baseline, coverage is shown as uninitialized instead of a misleading `0%`.
- "Not explicitly known" means no explicit known evidence exists. It does not mean the application has decided that the user does not know the word.
- The map does not provide word annotation, review, or Anki actions. Personal vocabulary import and context cards are separate capabilities.
- Selecting a reader token to look it up records an immutable lookup fact; it does not change knowledge state or the Learning Map coverage calculation.

#### 2.2 Mobile Usage Instructions

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

### 3. Vocabulary and Excerpts

"Vocabulary and Excerpts" is a cross-book reference collection, not a learning center or review queue:

- **Vocabulary Collection** retains words the reader deliberately saved, together with reading, available definitions, source book, and current context. Saving a word does not mean it has been mastered.
- **Excerpts and Analysis** retains highlighted source text and its related AI analysis. Personal note editing is not yet available.

Spaced repetition, due reviews, and SRS are not implemented. The Book Learning Map remains responsible for a single book's vocabulary load, chapter route, and reading decisions; it is not a submodule of this collection.

AnkiConnect baseline import is an explicitly requested, read-only external operation. It stores reversible evidence in the local database and does not write back to Anki. Writing an Anki context card is a separate explicit action after an excerpt analysis is complete; the local ledger makes retries idempotent. Bulk Anki export is not implemented.

### 4. System Settings

Open "System Settings" from the application workspace to:
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
    "model": "openai/gpt-4o-mini",
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

A: The book database, reading progress, saved vocabulary, excerpts, extracted images, and private original EPUB/PDF copies are stored locally in `static_data/`. Private source copies live in `static_data/sources/` and are not exposed through static URLs. Note that PDF import uploads the PDF to the MinerU cloud API, and AI analysis sends selected text to the LLM provider you configure.

**Q: Do previously imported books need to be read from the beginning after an update?**

A: No. Existing chapters, reading progress, highlights, and vocabulary remain available. Earlier versions did not preserve the original EPUB/PDF, so old books cannot automatically gain rebuildable source material; this affects only future source-dependent analysis, not current reading. New imports retain a private original copy. Do not delete and re-import an old book solely to gain this capability, because its existing learning records are not migrated automatically.

**Q: Why does a Book Learning Map say that re-analysis is needed?**

A: The map reads only completed, active analysis results so that different tokenization contracts are not mixed. Older imports without rebuildable source material remain readable but cannot generate a map automatically. New imports are analyzed after import.

---

## Roadmap

- [ ] Support more e-book formats (TXT, MOBI)
- [x] Write context Anki cards explicitly from completed excerpt analysis
- [ ] Create or export Anki cards in bulk from saved vocabulary or excerpts
- [x] Book Learning Map (explicit-knowledge coverage, chapter vocabulary load, and in-book frequency curve)
- [x] Chapter-level reading checkpoints (the definition of reading-coverage statistics is still pending)
- [ ] Reading statistics visualization

Bulk Anki export is not implemented. Future stable GUIDs must be held by an append-only `AnkiExportLedger`, not derived directly from the database's auto-incrementing `lexeme_id`; sentence, i+1, example-cache, and media export remain deferred.

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
- Teacher Xue - Source of motivation

## Other Useful Projects
- [Jamdict Chinese Translation Version](https://github.com/5945ggh/jamdict-cn) - Can be used to replace the .db files in `jamdict_data`.

---

## Feedback and Contribution

If you find this project helpful, please give it a Star for support!

Issues and Pull Requests are welcome.

The project's high-density iteration and optimization phase has come to an end. The author will continue basic maintenance, including occasional small updates and handling Issues and Pull Requests.

Most future effort will go into a new project aimed at providing an open-source, free Immersion Learning Data Layer/Pipeline with multimodal input support. The experience and technical foundation from this project will inform that work.

Updates will be shared here when available. Thank you again for supporting this project!
