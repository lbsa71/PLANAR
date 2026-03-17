/** Leaf phase lifecycle */
export type LeafPhase = "PLAN" | "ARCHITECT" | "IMPLEMENT" | "REVIEW" | "DONE";

/** Node phase lifecycle (simpler) */
export type NodePhase = "PLAN" | "DONE";

/** Special statuses */
export type SpecialStatus =
  | { kind: "BLOCKED-BY"; dotPath: string }
  | { kind: "CONFLICTS-WITH"; dotPath: string }
  | { kind: "INACTIONABLE" };

/** Combined status type */
export type CardStatus = LeafPhase | SpecialStatus;

/** Card links parsed from YAML frontmatter */
export interface CardReferences {
  parent: string | null;
  root: string | null;
  children: string[];
  blockedBy: string[];
}

/** A parsed card */
export interface Card {
  /** Dot-path extracted from the heading (e.g. "2.1") */
  dotPath: string;
  /** Slug portion of the heading (e.g. "Plan Parser") */
  title: string;
  /** Current phase/status */
  status: CardStatus;
  /** Card links from YAML frontmatter */
  refs: CardReferences;
  /** Whether this card is a node (has children) */
  isNode: boolean;
  /** File manifest entries */
  fileManifest: string[];
  /** Full file path */
  filePath: string;
  /** Raw markdown content */
  rawContent: string;
}

/** Plan operation types */
export type PlanOperation =
  | "Split"
  | "Hierarchize"
  | "Move"
  | "Aggregate"
  | "Collapse"
  | "Annotate"
  | "Reorder"
  | "Prune"
  | "Advance"
  | "Challenge"
  | "Flag Conflict";

/** Orchestrator agent slot */
export interface AgentSlot {
  dotPath: string;
  sessionId: string;
  cardFile: string;
  pid: number;
  startedAt: Date;
}

/** Wrapper iteration result */
export interface IterationResult {
  cardFile: string;
  changed: boolean;
  beforeContent: string;
  afterContent: string;
  iterationNumber: number;
}

/** Wrapper configuration */
export interface WrapperConfig {
  maxIterations: number;
  rootPlanFile: string;
  planDir: string;
  /** Max cost in dollars before stopping (budget exhausted termination) */
  maxCostDollars: number;
}

/** Orchestrator configuration */
export interface OrchestratorConfig {
  maxParallelAgents: number;
  maxIterationsPerCard: number;
  rootPlanFile: string;
  planDir: string;
}

/** The LEAF_PHASES in order for progression checks */
export const LEAF_PHASES: LeafPhase[] = [
  "PLAN",
  "ARCHITECT",
  "IMPLEMENT",
  "REVIEW",
  "DONE",
];

// ---------------------------------------------------------------------------
// Dependency injection interfaces
// ---------------------------------------------------------------------------

/** Minimal filesystem abstraction for testability */
export interface FileSystem {
  readFileSync(path: string, encoding: "utf-8"): string;
  writeFileSync(path: string, content: string): void;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
}

/** Abstraction over Claude Code CLI invocation (synchronous, for wrapper) */
export interface ClaudeInvoker {
  invoke(args: string[], timeoutMs: number): string | null;
}

/** Abstraction over child process spawning (for orchestrator) */
export interface ProcessHandle {
  pid: number;
  stdout: { on(event: "data", cb: (data: Buffer) => void): void } | null;
  stderr: { on(event: "data", cb: (data: Buffer) => void): void } | null;
  on(event: "close", cb: (code: number | null) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  kill(): void;
}

export interface ProcessSpawner {
  spawn(command: string, args: string[], options: object): ProcessHandle;
}

// ---------------------------------------------------------------------------
// Git operations interfaces (5.1 Fetch, Detect & Pull)
// ---------------------------------------------------------------------------

/** Runs a git command and returns stdout. Throws on non-zero exit. */
export interface GitRunner {
  run(args: string[]): Promise<string>;
}

/** Discriminated union for fetchDetectPull outcomes */
export type FetchResult =
  | { status: "up-to-date" }
  | { status: "pulled"; diff: string; changedFiles: string[] }
  | { status: "diverged"; warning: string };
