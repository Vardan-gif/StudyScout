'use strict';

require('dotenv').config();

const express  = require('express');
const path     = require('path');

const { parseGoal }          = require('./src/goalParser');
const { mapGoalToQueries }   = require('./src/conceptMapper');
const { smartFetch } = require('./src/webcmdBrowser');
const { mergeResources }     = require('./src/resourceExtractor');
const { rankResources }      = require('./src/resourceRanker');
const { generateStudyPlan }  = require('./src/studyPlanGenerator');
const { extractTopicsFromPDF, parseAndClassify } = require('./src/syllabusParser');

// PDF upload support — multer stores in memory (no temp files needed)
let multer;
try {
  multer = require('multer');
} catch {
  multer = null;
  console.warn('[StudyScout] multer not installed — PDF upload disabled. Run: npm install multer pdf-parse');
}

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * GET /
 * Serve the student UI.
 */
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * GET /api/health
 * Quick health check for the demo.
 */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0', webcmd: '0.8.4' });
});

/**
 * POST /api/research
 *
 * Main research pipeline. Accepts student input, runs the full
 * webcmd-powered research workflow, and returns ranked resources
 * + a personalized study plan.
 *
 * Request body:
 *   { topic, level, availableMinutes, goalType }
 *
 * Response:
 *   { goal, resources, studyPlan, meta }
 */
app.post('/api/research', async (req, res) => {
  const startTime = Date.now();

  try {
    // ── Step 1: Parse and validate the student's goal ─────────────────────────
    let goal;
    try {
      goal = parseGoal(req.body);
    } catch (parseErr) {
      return res.status(400).json({ error: parseErr.message });
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[StudyScout] New research request`);
    console.log(`  Topic:   ${goal.topic}`);
    console.log(`  Level:   ${goal.levelLabel}`);
    console.log(`  Time:    ${goal.availableMinutes} min`);
    console.log(`  Goal:    ${goal.goalLabel}`);
    console.log(`${'═'.repeat(60)}`);

    // ── Step 2: Map goal to search queries ────────────────────────────────────
    const searchQueries = await mapGoalToQueries(goal);
    console.log(`[StudyScout] Generated ${searchQueries.length} search queries`);

    // ── Step 3: Fetch resources via webcmd (real browser agent) ───────────────
    // Run up to 3 fetches concurrently to keep latency reasonable
    const CONCURRENT_LIMIT = 3;
    const fetchBatches = [];
    for (let i = 0; i < searchQueries.length; i += CONCURRENT_LIMIT) {
      fetchBatches.push(searchQueries.slice(i, i + CONCURRENT_LIMIT));
    }

    const allFetchResults = [];
    for (const batch of fetchBatches) {
      const batchResults = await Promise.all(
        batch.map(async query => {
          // Build DuckDuckGo search URL for each query
          const ddgURL = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const result = await smartFetch(ddgURL);
          return { fetchResult: result, query };
        })
      );
      allFetchResults.push(...batchResults);
    }

    const successCount = allFetchResults.filter(r => r.fetchResult.success).length;
    console.log(`[StudyScout] ${successCount}/${allFetchResults.length} fetches succeeded`);

    // ── Step 4: Extract resources from raw webcmd output ─────────────────────
    const rawResources = mergeResources(allFetchResults);
    console.log(`[StudyScout] Extracted ${rawResources.length} raw resources`);

    // ── Step 5: Rank resources against the student goal ───────────────────────
    const rankedResources = rankResources(rawResources, goal, 6);
    console.log(`[StudyScout] Ranked to top ${rankedResources.length} resources`);

    // ── Step 6: Generate study plan ───────────────────────────────────────────
    const studyPlan = generateStudyPlan(rankedResources, goal);
    console.log(`[StudyScout] Study plan: ${studyPlan.summary}`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[StudyScout] Done in ${elapsed}s\n`);

    // ── Step 7: Respond ───────────────────────────────────────────────────────
    res.json({
      goal,
      resources:  rankedResources,
      studyPlan,
      meta: {
        searchQueries,
        totalResearchedCount: rawResources.length,
        elapsedSeconds:       parseFloat(elapsed),
        webcmdMode:           allFetchResults.map(r => r.fetchResult.mode),
      },
    });

  } catch (err) {
    console.error('[StudyScout] Unhandled error in /api/research:', err);
    res.status(500).json({
      error: 'Research pipeline encountered an error. Please try again.',
      detail: err.message,
    });
  }
});

// ── PDF Syllabus Upload ────────────────────────────────────────────────────────
/**
 * POST /api/upload-syllabus
 *
 * Accepts a PDF file upload (field name: "syllabus") and returns extracted topics.
 * If multer is not installed, returns a helpful error message.
 */
if (multer) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
        cb(null, true);
      } else {
        cb(new Error('Only PDF files are supported.'));
      }
    },
  });

  app.post('/api/upload-syllabus', upload.single('syllabus'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded.' });
    }

    console.log(`[StudyScout] Syllabus upload: ${req.file.originalname} (${req.file.size} bytes)`);

    const result = await extractTopicsFromPDF(req.file.buffer);
    console.log(`[StudyScout] Extracted ${result.topics.length} topics${result.warning ? ' (warning: ' + result.warning + ')' : ''}`);

    res.json({
      topics:  result.topics,
      warning: result.warning ?? null,
      pageCount: result.rawText ? Math.ceil(result.rawText.length / 2000) : 0,
    });
  });
} else {
  app.post('/api/upload-syllabus', (_req, res) => {
    res.status(503).json({ error: 'PDF upload is not available — multer is not installed. Run: npm install multer pdf-parse' });
  });
}

// ── Intelligent Document Analysis ─────────────────────────────────────────────
/**
 * POST /api/analyze-document
 *
 * Accepts a PDF upload (field name: "syllabus") and returns a full
 * DocumentAnalysis — document type, confidence, extracted topics/units/
 * questions, and a composed research topic ready for the pipeline.
 *
 * Response shape:
 *   {
 *     topics:   string[],          ← backward-compat flat list
 *     warning:  string|null,
 *     analysis: DocumentAnalysis,  ← full structured result
 *   }
 *
 * Invalid or non-academic documents get isAcademic=false in analysis;
 * they do NOT trigger Webcmd research.
 */
if (multer) {
  const uploadAnalyze = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
        cb(null, true);
      } else {
        cb(new Error('Only PDF files are supported.'));
      }
    },
  });

  app.post('/api/analyze-document', uploadAnalyze.single('syllabus'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded.' });
    }

    const { originalname, buffer, size } = req.file;
    console.log(`[StudyScout] Document analysis: ${originalname} (${size} bytes)`);

    const analysis = await parseAndClassify(buffer, originalname);

    console.log(`[StudyScout] Classified as: ${analysis.documentType} (confidence: ${(analysis.confidence * 100).toFixed(0)}%)`);
    console.log(`[StudyScout] isAcademic=${analysis.isAcademic}, topics=${analysis.topics.length}, units=${analysis.units.length}`);

    res.json({
      topics:   analysis.topics,   // flat list — backward compat
      warning:  analysis.isAcademic ? null : analysis.reason,
      analysis,
    });
  });
} else {
  app.post('/api/analyze-document', (_req, res) => {
    res.status(503).json({ error: 'PDF analysis is not available — multer/pdf-parse not installed. Run: npm install multer pdf-parse' });
  });
}

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n');
  console.log('  ███████╗████████╗██╗   ██╗██████╗ ██╗   ██╗███████╗ ██████╗ ██████╗ ██╗   ██╗████████╗');
  console.log('  ██╔════╝╚══██╔══╝██║   ██║██╔══██╗╚██╗ ██╔╝██╔════╝██╔════╝██╔═══██╗██║   ██║╚══██╔══╝');
  console.log('  ███████╗   ██║   ██║   ██║██║  ██║ ╚████╔╝ ███████╗██║     ██║   ██║██║   ██║   ██║   ');
  console.log('  ╚════██║   ██║   ██║   ██║██║  ██║  ╚██╔╝  ╚════██║██║     ██║   ██║██║   ██║   ██║   ');
  console.log('  ███████║   ██║   ╚██████╔╝██████╔╝   ██║   ███████║╚██████╗╚██████╔╝╚██████╔╝   ██║   ');
  console.log('  ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝    ╚═╝   ╚══════╝ ╚═════╝ ╚═════╝  ╚═════╝    ╚═╝   ');
  console.log('\n  AI-powered browser research agent for students');
  console.log(`  Powered by webcmd 0.8.4 + Playwright/Cloak\n`);
  console.log(`  → http://localhost:${PORT}\n`);
});
