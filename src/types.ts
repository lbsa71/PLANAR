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
  /** ISO 8601 timestamp of last integrity check, from frontmatter */
  lastIntegrityCheck?: string;
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
  cardFile: string;
  pid: number;
  startedAt: Date;
  waitingForRateLimitUntil?: Date;
  rateLimitType?: string;
}

/** Wrapper iteration result */
export interface IterationResult {
  cardFile: string;
  changed: boolean;
  beforeContent: string;
  afterContent: string;
  iterationNumber: number;
}

/** Gate enforcement mode */
export type GateMode = "advisory" | "blocking";

/** Wrapper configuration */
export interface WrapperConfig {
  maxIterations: number;
  rootPlanFile: string;
  planDir: string;
  /** Max cost in dollars before stopping (budget exhausted termination) */
  maxCostDollars: number;
  /** Gate enforcement mode: "blocking" (default) reverts transitions, "advisory" logs warnings */
  gateMode: GateMode;
}

/** Orchestrator configuration */
export interface OrchestratorConfig {
  maxParallelAgents: number;
  maxIterationsPerCard: number;
  rootPlanFile: string;
  planDir: string;
  /** Interval in seconds between automated integrity checks during orchestration (0 = disabled) */
  integrityIntervalSeconds: number;
}

// ---------------------------------------------------------------------------
// Integrity check types
// ---------------------------------------------------------------------------

export type IssueKind =
  | "broken-parent-link"
  | "parent-not-in-children"
  | "broken-child-link"
  | "child-missing-parent-ref"
  | "status-inconsistency"
  | "missing-manifest-file"
  | "duplicate-file-ownership";

export type SuggestedAction = "regress-to-plan" | "regress-to-review" | "flag-only";

export interface IntegrityIssue {
  dotPath: string;
  filePath: string;
  kind: IssueKind;
  message: string;
  suggestedAction: SuggestedAction;
}

export interface ComplianceIssue {
  kind: "unowned-source-file";
  file: string;
  message: string;
}

export interface IntegrityReport {
  timestamp: string;
  cardIssues: IntegrityIssue[];
  complianceIssues: ComplianceIssue[];
  scannedCards: number;
  manifestFilesChecked: number;
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
  | { status: "merged"; diff: string; changedFiles: string[] }
  | { status: "diverged"; warning: string };
