# StudyScout — Project Plan

## Overview

**StudyScout** is an AI-powered browser research agent for students.  
Built for the **SLAB (Self-Learning Agent Browser) hackathon by webcmd**.

### Problem
Students waste significant time searching YouTube and educational websites, manually comparing resources, and deciding what is actually best for their specific syllabus, level, available time, and goal.

### Solution
StudyScout uses a real browser agent (webcmd + Cloak) to research educational websites, extract meaningful content, compare resources against the student's requirements, and generate a personalized, time-boxed study plan.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (public/)                │
│  index.html  ·  style.css  ·  app.js                │
│  - Input form (topic, level, time, goal-type)       │
│  - Results area (resource cards + study plan)       │
└─────────────────────┬───────────────────────────────┘
                      │ POST /api/research
                      ▼
┌─────────────────────────────────────────────────────┐
│               Express Server (server.js)            │
│  - Serves static frontend                           │
│  - Orchestrates the research pipeline               │
└──┬──────────────────────────────────────────────────┘
   │
   ├─► goalParser.js         Parse raw input → StudyGoal object
   ├─► conceptMapper.js      StudyGoal → search query strings
   ├─► webcmdBrowser.js      ◄── REAL webcmd CLI calls (isolated here only)
   │    ├─ fetchURL()             webcmd web fetch (primary, no browser)
   │    └─ browserFetch()         webcmd browser run (fallback, Playwright/Cloak)
   ├─► resourceExtractor.js  Raw webcmd text → normalized Resource objects
   ├─► resourceRanker.js     Score + rank resources vs. StudyGoal
   └─► studyPlanGenerator.js Build time-boxed study sequence
```

---

## Components

| File | Responsibility |
|---|---|
| `server.js` | Express HTTP server; route orchestration |
| `src/goalParser.js` | Parses student input into a typed `StudyGoal` |
| `src/conceptMapper.js` | Expands a goal into educational search queries |
| `src/webcmdBrowser.js` | **Sole** webcmd integration point; exposes `fetchURL` and `browserFetch` |
| `src/resourceExtractor.js` | Normalizes raw webcmd output into `Resource` objects |
| `src/resourceRanker.js` | Scores resources against the student goal; produces ranked list with reasons |
| `src/studyPlanGenerator.js` | Converts ranked resources + time budget → `StudyPlan` with slots |
| `public/index.html` | Student-facing UI |
| `public/style.css` | Clean, demo-friendly stylesheet |
| `public/app.js` | Frontend JS: form → API call → render cards + plan |

---

## Data Flow

```
Student input (topic, level, time, goalType)
        │
        ▼
  goalParser → StudyGoal { topic, level, availableMinutes, goalType, keywords[] }
        │
        ▼
  conceptMapper → searchTerms[]
        │
        ▼
  webcmdBrowser.fetchURL(searchURL)   ← REAL webcmd CLI call
        │
        ▼
  resourceExtractor → Resource[] { url, title, summary, type, estimatedMinutes }
        │
        ▼
  resourceRanker → RankedResource[] { ...resource, score, reasons[] }
        │
        ▼
  studyPlanGenerator → StudyPlan { totalMinutes, slots[], tips[] }
        │
        ▼
  POST /api/research response → frontend renders cards + plan
```

---

## Webcmd Integration

Webcmd is called exclusively from `src/webcmdBrowser.js` via Node.js `child_process.execFile`.

### Primary: `webcmd web fetch`
```bash
webcmd web fetch --url <url> --max-chars 15000 -f json
```
- No browser session needed
- Returns extracted article text from any public URL
- Used for: DuckDuckGo search results, Khan Academy, Wikipedia, educational blogs

### Fallback: `webcmd browser run` (Playwright/Cloak)
```bash
webcmd --profile studyscout --session <id> browser run --stdin --no-snapshot-diff
```
- Full Playwright browser via Cloak
- Used when a site returns 403 or requires JavaScript rendering
- Session lifecycle fully managed inside `webcmdBrowser.js`

### Search Entry Point
DuckDuckGo HTML search (`https://duckduckgo.com/html/?q=...`) is used as the
search entry point because it is publicly fetchable without JavaScript or auth,
unlike Google which blocks scrapers.

---

## First MVP Workflow

**Student input:** "Teach me Kirchhoff's Laws for my first-year engineering exam. I have 60 minutes."

1. `goalParser` → `{ topic: "Kirchhoff's Laws", level: "undergraduate", availableMinutes: 60, goalType: "exam-prep" }`
2. `conceptMapper` → `["kirchhoff's laws tutorial site:youtube.com", "kirchhoff's laws explained engineering", "kirchhoff's laws khan academy"]`
3. `webcmdBrowser.fetchURL` called for each query (real webcmd → real internet)
4. `resourceExtractor` → 5–10 resource objects with title, URL, summary
5. `resourceRanker` → top 5 ranked with score + reasons
6. `studyPlanGenerator` → 60-min plan (e.g. 20-min video → 15-min article → 25-min practice)
7. JSON returned to frontend → cards + plan rendered

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Express server port |
| `GEMINI_API_KEY` | *(unset)* | Optional: enables LLM ranking/mapping |
| `WEBCMD_FETCH_TIMEOUT` | `30` | Seconds per webcmd fetch call |
| `WEBCMD_MAX_CHARS` | `15000` | Max chars returned per fetch |

---

## Future Features (Not in MVP)

- **LLM integration** — Gemini API for smarter concept mapping + ranking
- **YouTube transcript extraction** via `browser run`
- **Khan Academy course structure** parsing
- **Session persistence** — multi-query conversations
- **Export** study plan as PDF or Markdown
- **Saved history** of previous research sessions
- **React frontend** upgrade (server stays as API)

---

## Dependencies

| Package | Purpose |
|---|---|
| `express` | HTTP server + static file serving |
| `dotenv` | Load `.env` config into `process.env` |

No build tools. No bundler. No transpiler. Single `node server.js` to run.
