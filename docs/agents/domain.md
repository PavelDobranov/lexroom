# Domain Docs

This repository uses a single-context domain-documentation layout.

## Before exploring, read these

- `GLOSSARY.md` at the repository root.
- Relevant ADRs under `docs/adr/`.

If these files do not exist, proceed silently. The domain-modeling skill creates them lazily when terminology or decisions are resolved.

## File structure

```
/
├── GLOSSARY.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

Use domain concepts as defined in `GLOSSARY.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is absent, reconsider whether it reflects project language or note the gap for domain modeling.

## Flag ADR conflicts

Explicitly identify output that contradicts an existing ADR rather than silently overriding it.
