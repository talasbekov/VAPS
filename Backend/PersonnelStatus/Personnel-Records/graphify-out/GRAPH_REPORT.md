# Graphify System Architecture Report

*Note: This is a fallback report. The initial `graphify extract` was run with `--no-cluster` because an LLM API key was not provided.*

## Overview
A code graph (`graph.json`) has been generated containing the AST representations and local relationships of all scanned application source files.

## Instructions for AI Agents
Do not manually browse the codebase. Always use Graphify CLI tools to navigate the generated graph:
- `graphify query "<question>"`: Ask natural language questions about the codebase structure.
- `graphify path "<source>" "<target>"`: Trace paths between two components.
- `graphify explain "<node>"`: Retrieve the context of a specific node.

To regenerate a full semantic cluster report, an API key is required (e.g., `GEMINI_API_KEY`).
