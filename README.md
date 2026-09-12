# StudyScout

**Stop searching. Start learning.**

StudyScout is an AI browser agent for smarter learning. A student describes what they need to learn, their level, goal, and available time. StudyScout creates research paths, uses **Webcmd** to research the real web, extracts and evaluates learning resources, ranks them against the student's needs, and builds a personalized study plan.

## Demo

Built for the **SLAB Hackathon @ MAIT Delhi — Browser Agents**.

## How it works

```text
Student request
      ↓
Goal & concept analysis
      ↓
Multiple research paths
      ↓
Webcmd browser research
      ↓
Resource extraction
      ↓
Personalized ranking
      ↓
Learning map + study plan
```

## Key features

- Natural-language learning requests
- Beginner / Intermediate / Advanced profiles
- Exam Prep, Understand, and Quick Revision goals
- Time-budget aware recommendations
- Multi-path web research through Webcmd
- Resource extraction and ranking
- Explainable recommendations
- Learning map and personalized study plan
- Syllabus / study PDF upload support
- Browser fallback using Playwright/Cloak

## Tech stack

- Node.js + Express
- Webcmd
- Playwright / Cloak
- Vanilla HTML, CSS and JavaScript
- PDF parsing for syllabus extraction

## Run locally

### Requirements

- Node.js
- Webcmd installed and connected

### Setup

```bash
npm install
copy .env.example .env
npm start
```

Keep API keys and other secrets in `.env`. **Never commit `.env`.**

## Webcmd

StudyScout uses Webcmd as the browser/research layer. Browser interaction is kept separate from resource extraction, ranking, and study-plan generation so the workflow remains inspectable and testable.

## Status

Hackathon prototype focused on a reliable browser-agent workflow for personalized learning-resource research.
