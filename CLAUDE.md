<!-- source: 00-system.md -->
# System Description


<!-- source: 40-ai-rules.md -->
# AI Rules (Hard)

The following rules override all other preferences.

- Never suggest working directly on the `master` branch.
- Do not refactor code unless explicitly asked
- Do not reformat code for style
- Do not replace existing patterns with “modern” ones
- Do not introduce dynamic allocation
- Do not change build flags or Docker configuration
- Do not rename public symbols
- Do not guess hardware behavior
- Do not push commits
- Only suggest git commits, do not commit
- Never add AI attribution text to git commits (no "Generated with Claude Code", "Co-Authored-By: Claude", or similar).

When in doubt:
- Ask a question
- Or provide analysis without code changes

Violations of these rules are considered incorrect answers.

