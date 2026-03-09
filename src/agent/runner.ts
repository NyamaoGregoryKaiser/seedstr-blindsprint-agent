import { EventEmitter } from "events";
import Conf from "conf";
import PusherClient from "pusher-js";
import { SeedstrClient } from "../api/client.js";
import { getLLMClient } from "../llm/client.js";
import { getConfig, configStore } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { cleanupProject } from "../tools/projectBuilder.js";
import { runSubmissionGuard, type ProjectMode } from "../tools/submissionGuardTool.js";
import type { Job, AgentEvent, TokenUsage, FileAttachment, WebSocketJobEvent } from "../types/index.js";

// Approximate costs per 1M tokens for common models (input/output)
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-4": { input: 3.0, output: 15.0 },
  "anthropic/claude-opus-4": { input: 15.0, output: 75.0 },
  "anthropic/claude-3.5-sonnet": { input: 3.0, output: 15.0 },
  "anthropic/claude-3-opus": { input: 15.0, output: 75.0 },
  "openai/gpt-4-turbo": { input: 10.0, output: 30.0 },
  "openai/gpt-4o": { input: 5.0, output: 15.0 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "meta-llama/llama-3.1-405b-instruct": { input: 3.0, output: 3.0 },
  "meta-llama/llama-3.1-70b-instruct": { input: 0.5, output: 0.5 },
  "google/gemini-pro-1.5": { input: 2.5, output: 7.5 },
  // Default fallback
  default: { input: 1.0, output: 3.0 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const costs = MODEL_COSTS[model] || MODEL_COSTS.default;
  const inputCost = (promptTokens / 1_000_000) * costs.input;
  const outputCost = (completionTokens / 1_000_000) * costs.output;
  return inputCost + outputCost;
}

function inferProjectMode(files: string[]): ProjectMode {
  const set = new Set(files.map((p) => p.replace(/\\/g, "/")));
  if (set.has("package.json") || set.has("vite.config.ts") || set.has("tailwind.config.js")) {
    return "vite-react-ts-tailwind";
  }
  return "static-html-css-js";
}

function getProjectSnapshot(files: string[], getFileContent: (path: string) => string | undefined): string {
  const normalized = files.map((p) => p.replace(/\\/g, "/"));
  const set = new Set(normalized);

  const priority = [
    "README.md",
    "package.json",
    "index.html",
    "vite.config.ts",
    "tailwind.config.js",
    "postcss.config.js",
    "tsconfig.json",
    "src/main.tsx",
    "src/App.tsx",
    "src/index.css",
    "src/styles/globals.css",
    // common components
    "src/components/Header.tsx",
    "src/components/Hero.tsx",
    "src/components/FeatureGrid.tsx",
    "src/components/Footer.tsx",
    // static fallback
    "styles.css",
    "script.js",
  ];

  const picked: string[] = [];
  for (const p of priority) {
    if (set.has(p)) picked.push(p);
  }
  // Add a few extra component files if present
  for (const p of normalized) {
    if (picked.length >= 14) break;
    if (!picked.includes(p) && p.startsWith("src/components/") && p.endsWith(".tsx")) {
      picked.push(p);
    }
  }

  const header = `FILES (${normalized.length}):\n${normalized.sort().join("\n")}\n\n`;

  const MAX_TOTAL = 35_000;
  const MAX_PER_FILE = 5_000;
  let out = header;
  for (const p of picked) {
    if (out.length >= MAX_TOTAL) break;
    const content = getFileContent(p) ?? "";
    const clipped = content.length > MAX_PER_FILE ? content.slice(0, MAX_PER_FILE) + "\n/* ...truncated... */\n" : content;
    out += `--- ${p} ---\n${clipped}\n\n`;
  }

  if (out.length > MAX_TOTAL) {
    out = out.slice(0, MAX_TOTAL) + "\n/* ...snapshot truncated... */\n";
  }
  return out;
}

function getSelfCritiquePrompt(jobPrompt: string, projectSnapshot: string): string {
  return `
You are reviewing a front-end hackathon submission before final packaging.

Your job is to criticize the current project harshly but constructively.

Focus on:
1. Visual hierarchy
2. Spacing consistency
3. Responsiveness
4. CTA clarity
5. Interaction quality
6. Accessibility
7. Missing states (loading, empty, success, error)
8. Any placeholder/demo-looking content
9. Whether the app feels complete and polished
10. Whether it matches the user's prompt well

Original prompt:
${jobPrompt}

Project snapshot:
${projectSnapshot}

Return:
- a score out of 10
- top 5 issues
- exact file-level fixes to make
- prioritize the fixes that most improve design and functionality quickly
`.trim();
}

function getUiJudgePrompt(jobPrompt: string, projectSnapshot: string): string {
  return `
You are an unforgiving hackathon design and UX judge.

Review the current project as if deciding whether it deserves to beat other finalists.

Be blunt.
Do not praise weak work.
Assume the first version is not good enough.

Judge on:
- Functionality
- Design
- Speed-feel / simplicity
- Coherence
- Completeness

Original prompt:
${jobPrompt}

Project snapshot:
${projectSnapshot}

Return STRICT JSON only (no markdown, no trailing commas):
{
  "score": number,
  "issues": [
    {
      "title": string,
      "severity": "high" | "medium" | "low",
      "fix": string,
      "files": string[]
    }
  ],
  "summary": string
}
`.trim();
}

function getRepairPrompt(jobPrompt: string, critique: string): string {
  return `
You are improving an existing front-end hackathon project.

Original prompt:
${jobPrompt}

Critique:
${critique}

Now make the highest-impact improvements only.

Rules:
- Keep the project runnable
- Do not bloat the scope
- Prioritize polish, responsiveness, CTA clarity, spacing, accessibility, and completeness
- Improve existing files instead of unnecessary rewrites
- Ensure the UI feels premium and intentional
- Keep the design coherent

Implementation requirement:
- Use create_file to OVERWRITE only the specific files you are changing.
- Prefer changing 3–6 files max.
`.trim();
}

type UiJudgeJson = {
  score: number;
  issues: Array<{
    title: string;
    severity: "high" | "medium" | "low";
    fix: string;
    files: string[];
  }>;
  summary: string;
};

function tryParseJudgeJson(text: string): UiJudgeJson | null {
  try {
    return JSON.parse(text) as UiJudgeJson;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = text.slice(start, end + 1);
      try {
        return JSON.parse(slice) as UiJudgeJson;
      } catch {
        return null;
      }
    }
    return null;
  }
}

interface TypedEventEmitter {
  on(event: "event", listener: (event: AgentEvent) => void): this;
  emit(event: "event", data: AgentEvent): boolean;
}

// Persistent storage for processed jobs
const jobStore = new Conf<{ processedJobs: string[] }>({
  projectName: "seed-agent",
  projectVersion: "1.0.0",
  configName: "jobs",
  defaults: {
    processedJobs: [],
  },
});

/** BlindSprint: system prompt for the front-end competition agent */
function getBlindSprintSystemPrompt(effectiveBudget: number, job: Job): string {
  const budgetLine = `Job Budget: $${effectiveBudget.toFixed(2)} USD${job.jobType === "SWARM" ? ` (your share of $${job.budget.toFixed(2)} total across ${job.maxAgents} agents)` : ""}`;
  return `You are BlindSprint, an elite front-end competition agent built for the Seedstr blind hackathon.

Your goal is to maximize:
1. Functionality
2. Design quality
3. Speed of delivery

Rules:
- Always prefer a smaller complete project over a larger unfinished one.
- Build responsive interfaces for mobile and desktop.
- Use clean information hierarchy, consistent spacing, clear CTA, and polished interactions.
- Avoid unnecessary dependencies.
- When requirements are ambiguous, infer the most useful product structure and continue.
- Always include a README with setup instructions and assumptions.
- Before finalizing any project, perform one self-critique pass as a strict hackathon judge. Identify the most important design and UX weaknesses, apply focused improvements, then rerun submission_guard. Prefer targeted refinement over full rewrites.
- Do NOT call finalize_project. Create/overwrite files with create_file only; packaging + upload happens after the review pass.
- Deliver a runnable zipped project.

Winning workflow — follow this sequence for every mystery prompt that asks for a frontend:

Phase 1 — Understand
- Call classify_prompt with the job prompt.
- Extract required features; decide project mode (vite-react-ts-tailwind or static-html-css-js for tiny prompts).
- Call scaffold_project with that mode to get the file tree.

Phase 2 — Plan
- Call plan_ui with the appType from classify_prompt.
- Call design_system (tone: default|premium|minimal) for coherent colors, typography, spacing.
- Use the acceptance checklist from plan_ui.

Phase 3 — Build
- Create all files from the scaffold (create_file for each). Default stack: Vite + React + TypeScript + Tailwind.
- Include: polished hero/top section, clear user flow, responsive nav, at least one meaningful interaction.
- Add loading, empty, error, success states; accessible labels; keyboard-friendly where relevant.
- Use small mock data; no external APIs unless the prompt requires them; no backend unless necessary.
- Code quality: reusable components, no giant App.tsx, no dead imports, semantic HTML, max 2 font families.

Phase 4 — Harden
- Call submission_guard with your projectMode. Fix any reported errors (missing files, TODO/lorem).
- Stop after submission_guard passes. Do NOT zip inside the model.

Default templates (use these mental models):
- landing_page: hero, features, testimonials/stats, CTA, footer.
- dashboard: sidebar/top nav, KPI cards, chart placeholders, activity table, filters.
- workflow_app: stepper, form, validation, confirmation state.
- marketplace: search, filters, cards, detail drawer/modal.
- portfolio_brand: hero, work grid, about, contact.
- interactive_tool: input panel, result panel, history/help state.

Design rules: generous whitespace; one accent color; strong heading hierarchy; max-width containers; 8pt spacing rhythm; subtle motion only; no clutter; cards with consistent radius/shadow; one primary CTA per page.

README template — every project must include:
# Project Name
## Overview — short explanation of what was built.
## Features — responsive UI, core interactions, validation/states, accessibility.
## Tech Stack — Vite, React, TypeScript, Tailwind (or HTML/CSS/JS for static).
## Run Locally — npm install && npm run dev
## Assumptions — what was inferred from the prompt.

For text-only requests (tweets, emails, advice, analysis): respond with well-written text only. Do NOT use create_file or tools for those.

${budgetLine}`;
}

/**
 * Main agent runner that polls for jobs and processes them.
 * Supports v2 API with WebSocket (Pusher) for real-time job notifications.
 */
export class AgentRunner extends EventEmitter implements TypedEventEmitter {
  private client: SeedstrClient;
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private processingJobs: Set<string> = new Set();
  private processedJobs: Set<string>;
  private pusher: PusherClient | null = null;
  private wsConnected = false;
  private stats = {
    jobsProcessed: 0,
    jobsSkipped: 0,
    errors: 0,
    startTime: Date.now(),
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCost: 0,
  };

  constructor() {
    super();
    this.client = new SeedstrClient();

    // Load previously processed jobs from persistent storage
    const stored = jobStore.get("processedJobs") || [];
    this.processedJobs = new Set(stored);
    logger.debug(`Loaded ${this.processedJobs.size} previously processed jobs`);
  }

  /**
   * Mark a job as processed and persist to storage
   */
  private markJobProcessed(jobId: string): void {
    this.processedJobs.add(jobId);

    // Keep only the last 1000 job IDs to prevent unlimited growth
    const jobArray = Array.from(this.processedJobs);
    if (jobArray.length > 1000) {
      const trimmed = jobArray.slice(-1000);
      this.processedJobs = new Set(trimmed);
    }

    // Persist to storage
    jobStore.set("processedJobs", Array.from(this.processedJobs));
  }

  /**
   * Emit a typed event
   */
  private emitEvent(event: AgentEvent): void {
    this.emit("event", event);
  }

  // ─────────────────────────────────────────
  // WebSocket (Pusher) connection
  // ─────────────────────────────────────────

  /**
   * Connect to Pusher for real-time job notifications.
   * Falls back to polling-only if Pusher is not configured.
   */
  private connectWebSocket(): void {
    const config = getConfig();

    if (!config.useWebSocket) {
      logger.info("WebSocket disabled by config, using polling only");
      return;
    }

    if (!config.pusherKey) {
      logger.warn("PUSHER_KEY not set — WebSocket disabled, falling back to polling");
      return;
    }

    const agentId = configStore.get("agentId");
    if (!agentId) {
      logger.warn("Agent ID not found — cannot subscribe to WebSocket channel");
      return;
    }

    try {
      this.pusher = new PusherClient(config.pusherKey, {
        cluster: config.pusherCluster,
        // Auth endpoint for private channels
        channelAuthorization: {
          endpoint: `${config.seedstrApiUrlV2}/pusher/auth`,
          transport: "ajax",
          headers: {
            Authorization: `Bearer ${config.seedstrApiKey}`,
          },
        },
      });

      // Connection state handlers
      this.pusher.connection.bind("connected", () => {
        this.wsConnected = true;
        this.emitEvent({ type: "websocket_connected" });
        logger.info("WebSocket connected to Pusher");
      });

      this.pusher.connection.bind("disconnected", () => {
        this.wsConnected = false;
        this.emitEvent({ type: "websocket_disconnected", reason: "disconnected" });
        logger.warn("WebSocket disconnected");
      });

      this.pusher.connection.bind("error", (err: unknown) => {
        this.wsConnected = false;
        logger.error("WebSocket error:", err);
        this.emitEvent({ type: "websocket_disconnected", reason: "error" });
      });

      // Subscribe to the agent's private channel
      const channel = this.pusher.subscribe(`private-agent-${agentId}`);

      channel.bind("pusher:subscription_succeeded", () => {
        logger.info(`Subscribed to private-agent-${agentId}`);
      });

      channel.bind("pusher:subscription_error", (err: unknown) => {
        logger.error("Channel subscription error:", err);
        logger.warn("Will rely on polling for job discovery");
      });

      // Listen for new job notifications
      channel.bind("job:new", (data: WebSocketJobEvent) => {
        logger.info(`[WS] New job received: ${data.jobId} ($${data.budget})`);
        this.emitEvent({ type: "websocket_job", jobId: data.jobId });
        this.handleWebSocketJob(data);
      });
    } catch (err) {
      logger.error("Failed to initialize Pusher:", err);
      logger.warn("Falling back to polling only");
    }
  }

  /**
   * Handle a job received via WebSocket.
   * Fetches full job details from v2 API and processes it.
   */
  private async handleWebSocketJob(event: WebSocketJobEvent): Promise<void> {
    const config = getConfig();

    // Skip if already processing or processed
    if (this.processingJobs.has(event.jobId) || this.processedJobs.has(event.jobId)) {
      return;
    }

    // Check capacity
    if (this.processingJobs.size >= config.maxConcurrentJobs) {
      logger.debug(`[WS] At capacity, skipping job ${event.jobId}`);
      return;
    }

    // Check minimum budget (use budgetPerAgent for swarm, otherwise full budget)
    const effectiveBudget = event.jobType === "SWARM" && event.budgetPerAgent
      ? event.budgetPerAgent
      : event.budget;

    if (effectiveBudget < config.minBudget) {
      logger.debug(`[WS] Job ${event.jobId} budget $${effectiveBudget} below minimum $${config.minBudget}`);
      this.markJobProcessed(event.jobId);
      this.stats.jobsSkipped++;
      return;
    }

    try {
      // Fetch full job details
      const job = await this.client.getJobV2(event.jobId);
      this.emitEvent({ type: "job_found", job });

      // For SWARM jobs, accept first then process
      if (job.jobType === "SWARM") {
        await this.acceptAndProcessSwarmJob(job);
      } else {
        // STANDARD job — process directly (same as v1)
        this.processJob(job).catch((error) => {
          this.emitEvent({
            type: "error",
            message: `Failed to process job ${job.id}`,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        });
      }
    } catch (error) {
      logger.error(`[WS] Failed to handle job ${event.jobId}:`, error);
      this.stats.errors++;
    }
  }

  /**
   * Disconnect WebSocket
   */
  private disconnectWebSocket(): void {
    if (this.pusher) {
      this.pusher.disconnect();
      this.pusher = null;
      this.wsConnected = false;
    }
  }

  // ─────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────

  /**
   * Start the agent runner
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn("Agent is already running");
      return;
    }

    this.running = true;
    this.stats.startTime = Date.now();
    this.emitEvent({ type: "startup" });

    // Connect WebSocket for real-time job notifications
    this.connectWebSocket();

    // Start polling loop (always runs as fallback, slower when WS is active)
    await this.poll();
  }

  /**
   * Stop the agent runner
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.disconnectWebSocket();
    this.emitEvent({ type: "shutdown" });
  }

  // ─────────────────────────────────────────
  // Polling (fallback / supplement to WebSocket)
  // ─────────────────────────────────────────

  /**
   * Poll for new jobs using v2 API
   */
  private async poll(): Promise<void> {
    if (!this.running) return;

    const config = getConfig();

    try {
      this.emitEvent({ type: "polling", jobCount: this.processingJobs.size });

      // Use v2 API for job listing (skill-matched)
      const response = await this.client.listJobsV2(20, 0);
      const jobs = response.jobs;

      // Filter and process new jobs
      for (const job of jobs) {
        // Skip if already processing or processed
        if (this.processingJobs.has(job.id) || this.processedJobs.has(job.id)) {
          continue;
        }

        // Check if we're at capacity
        if (this.processingJobs.size >= config.maxConcurrentJobs) {
          break;
        }

        // Check minimum budget (use budgetPerAgent for swarm)
        const effectiveBudget = job.jobType === "SWARM" && job.budgetPerAgent
          ? job.budgetPerAgent
          : job.budget;

        if (effectiveBudget < config.minBudget) {
          this.emitEvent({
            type: "job_skipped",
            job,
            reason: `Budget $${effectiveBudget} below minimum $${config.minBudget}`,
          });
          this.markJobProcessed(job.id);
          this.stats.jobsSkipped++;
          continue;
        }

        // Process the job
        this.emitEvent({ type: "job_found", job });

        if (job.jobType === "SWARM") {
          this.acceptAndProcessSwarmJob(job).catch((error) => {
            this.emitEvent({
              type: "error",
              message: `Failed to process swarm job ${job.id}`,
              error: error instanceof Error ? error : new Error(String(error)),
            });
          });
        } else {
          this.processJob(job).catch((error) => {
            this.emitEvent({
              type: "error",
              message: `Failed to process job ${job.id}`,
              error: error instanceof Error ? error : new Error(String(error)),
            });
          });
        }
      }
    } catch (error) {
      this.emitEvent({
        type: "error",
        message: "Failed to poll for jobs",
        error: error instanceof Error ? error : new Error(String(error)),
      });
      this.stats.errors++;
    }

    // Schedule next poll — slower when WebSocket is active
    if (this.running) {
      const interval = this.wsConnected
        ? config.pollInterval * 3 * 1000  // 3x slower when WS is active (fallback only)
        : config.pollInterval * 1000;
      this.pollTimer = setTimeout(() => this.poll(), interval);
    }
  }

  // ─────────────────────────────────────────
  // Swarm job handling
  // ─────────────────────────────────────────

  /**
   * Accept a SWARM job first, then process it.
   * If acceptance fails (job full, etc.), skip gracefully.
   */
  private async acceptAndProcessSwarmJob(job: Job): Promise<void> {
    try {
      const result = await this.client.acceptJob(job.id);

      this.emitEvent({
        type: "job_accepted",
        job,
        budgetPerAgent: result.acceptance.budgetPerAgent,
      });

      logger.info(
        `Accepted swarm job ${job.id} — ${result.slotsRemaining} slots remaining, ` +
        `deadline: ${result.acceptance.responseDeadline}`
      );

      // Now process the job (generate response and submit via v2)
      await this.processJob(job, true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes("job_full") || msg.includes("All agent slots")) {
        logger.debug(`Swarm job ${job.id} is full, skipping`);
        this.markJobProcessed(job.id);
        this.stats.jobsSkipped++;
      } else if (msg.includes("already accepted")) {
        logger.debug(`Already accepted swarm job ${job.id}`);
      } else {
        throw error;
      }
    }
  }

  // ─────────────────────────────────────────
  // Job processing
  // ─────────────────────────────────────────

  /**
   * Process a single job
   * @param useV2Submit - If true, use v2 respond endpoint (for swarm auto-pay)
   */
  private async processJob(job: Job, useV2Submit = false): Promise<void> {
    this.processingJobs.add(job.id);
    this.emitEvent({ type: "job_processing", job });

    try {
      // Generate response using LLM
      const llm = getLLMClient();
      const config = getConfig();

      const effectiveBudget = job.jobType === "SWARM" && job.budgetPerAgent
        ? job.budgetPerAgent
        : job.budget;

      const result = await llm.generate({
        prompt: job.prompt,
        systemPrompt: getBlindSprintSystemPrompt(effectiveBudget, job),
        tools: true,
      });

      // Track token usage
      let usage: TokenUsage | undefined;
      if (result.usage) {
        const cost = estimateCost(
          config.model,
          result.usage.promptTokens,
          result.usage.completionTokens
        );
        usage = {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
          estimatedCost: cost,
        };

        // Update cumulative stats
        this.stats.totalPromptTokens += result.usage.promptTokens;
        this.stats.totalCompletionTokens += result.usage.completionTokens;
        this.stats.totalTokens += result.usage.totalTokens;
        this.stats.totalCost += cost;
      }

      this.emitEvent({
        type: "response_generated",
        job,
        preview: result.text.substring(0, 200),
        usage,
      });

      // If the model created files, run guard → judge → (optional) repair → guard → zip → upload → submit
      const builder = llm.getActiveProjectBuilder();
      const builtFiles = builder?.getFiles() ?? [];

      if (builder && builtFiles.length > 0) {
        const projectMode = inferProjectMode(builtFiles);

        // Guard pass 1 (code-side, deterministic)
        const firstGuard = runSubmissionGuard(builder, projectMode);
        const snapshot = getProjectSnapshot(builtFiles, (p) => builder.getFileContent(p));

        // Strict judge pass (no tools, preserve builder)
        const judgeResult = await llm.generate({
          systemPrompt: "You are BlindSprint's design and UX judge. Return strict JSON only.",
          prompt: getUiJudgePrompt(job.prompt, snapshot),
          tools: false,
          temperature: 0.2,
          maxTokens: 1200,
          preserveProjectBuilder: true,
        });

        const judgeJson = tryParseJudgeJson(judgeResult.text);
        const judgeScore = judgeJson?.score ?? 0;

        const shouldRepair =
          !firstGuard.passed ||
          firstGuard.warnings.length > 0 ||
          judgeScore < 8;

        let finalGuard = firstGuard;
        let finalText = result.text;

        if (shouldRepair) {
          const critiqueText =
            judgeJson
              ? JSON.stringify(judgeJson, null, 2)
              : getSelfCritiquePrompt(job.prompt, snapshot);

          const repairResult = await llm.generate({
            systemPrompt: getBlindSprintSystemPrompt(effectiveBudget, job) + "\n\nYou are in REPAIR MODE. Apply only targeted edits.",
            prompt: getRepairPrompt(job.prompt, critiqueText) + "\n\n(For reference) Current snapshot:\n" + snapshot,
            tools: true,
            temperature: 0.4,
            maxTokens: 3500,
            preserveProjectBuilder: true,
          });

          finalText = repairResult.text || finalText;
          finalGuard = runSubmissionGuard(builder, projectMode);
        }

        if (!finalGuard.passed) {
          // If still failing after one repair pass, submit text-only with guard errors
          const failureText =
            (finalText || "Project build attempted, but failed final submission checks.") +
            `\n\nSubmission guard errors:\n- ${finalGuard.errors.join("\n- ")}\n` +
            (finalGuard.warnings.length > 0 ? `\nWarnings:\n- ${finalGuard.warnings.join("\n- ")}\n` : "");

          const submitResult = useV2Submit
            ? await this.client.submitResponseV2(job.id, failureText)
            : await this.client.submitResponse(job.id, failureText);

          this.emitEvent({
            type: "response_submitted",
            job,
            responseId: submitResult.response.id,
            hasFiles: false,
          });

          builder.cleanup();
        } else {
          // Zip and upload
          const zipResult = await builder.createZip("submission.zip");
          if (!zipResult.success) {
            throw new Error(zipResult.error || "Failed to create zip");
          }

          this.emitEvent({
            type: "project_built",
            job,
            files: zipResult.files,
            zipPath: zipResult.zipPath,
          });

          try {
            this.emitEvent({ type: "files_uploading", job, fileCount: 1 });
            const uploadedFiles = await this.client.uploadFile(zipResult.zipPath);
            this.emitEvent({ type: "files_uploaded", job, files: [uploadedFiles] });

            const content = finalText || "Attached: submission.zip";
            const submitResult = useV2Submit
              ? await this.client.submitResponseV2(job.id, content, "FILE", [uploadedFiles])
              : await this.client.submitResponseWithFiles(job.id, {
                  content,
                  responseType: "FILE",
                  files: [uploadedFiles],
                });

            this.emitEvent({
              type: "response_submitted",
              job,
              responseId: submitResult.response.id,
              hasFiles: true,
            });

            cleanupProject(zipResult.projectDir, zipResult.zipPath);
          } catch (uploadError) {
            logger.error("Failed to upload project files, submitting text-only response:", uploadError);
            const submitResult = useV2Submit
              ? await this.client.submitResponseV2(job.id, finalText || "Submission upload failed.")
              : await this.client.submitResponse(job.id, finalText || "Submission upload failed.");

            this.emitEvent({
              type: "response_submitted",
              job,
              responseId: submitResult.response.id,
              hasFiles: false,
            });

            cleanupProject(zipResult.projectDir, zipResult.zipPath);
          }
        }
      } else {
        // Text-only response
        const submitResult = useV2Submit
          ? await this.client.submitResponseV2(job.id, result.text)
          : await this.client.submitResponse(job.id, result.text);

        this.emitEvent({
          type: "response_submitted",
          job,
          responseId: submitResult.response.id,
          hasFiles: false,
        });
      }

      this.stats.jobsProcessed++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Handle "already submitted" error gracefully - not really an error
      if (errorMessage.includes("already submitted")) {
        logger.debug(`Already responded to job ${job.id}, skipping`);
      } else {
        this.emitEvent({
          type: "error",
          message: `Error processing job ${job.id}: ${errorMessage}`,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        this.stats.errors++;
      }
    } finally {
      this.processingJobs.delete(job.id);
      this.markJobProcessed(job.id);
    }
  }

  /**
   * Get current stats
   */
  getStats() {
    return {
      ...this.stats,
      uptime: Date.now() - this.stats.startTime,
      activeJobs: this.processingJobs.size,
      wsConnected: this.wsConnected,
      avgTokensPerJob: this.stats.jobsProcessed > 0
        ? Math.round(this.stats.totalTokens / this.stats.jobsProcessed)
        : 0,
      avgCostPerJob: this.stats.jobsProcessed > 0
        ? this.stats.totalCost / this.stats.jobsProcessed
        : 0,
    };
  }

  /**
   * Check if the agent is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

export default AgentRunner;
