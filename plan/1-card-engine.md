---
parent: plan/root.md
root: plan/root.md
children:
  - plan/1.1-frontmatter-parser.md
  - plan/1.2-card-parser.md
  - plan/1.3-link-integrity.md
  - plan/1.4-guid.md
---
# 1 Card Engine [DONE]

## Description
The card engine handles parsing, validation, and manipulation of card files.
Cards are markdown files with YAML frontmatter containing structural metadata
(parent, root, children, blocked-by) and markdown body with status, description,
file manifest, and acceptance criteria.

## Acceptance Criteria
- Parses YAML frontmatter for card links (parent, root, children, blocked-by)
- Parses heading for dot-path, title, and status (all phases + special statuses)
- Parses file manifest from markdown body
- Discovers cards in a plan directory
- Finds sibling cards by dot-path prefix
- Validates link integrity across all cards
- Dot-path ↔ GUID conversion is deterministic and reversible
