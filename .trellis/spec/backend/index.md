# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Four-layer architecture, dependency rules, artifact constants | Filled |
| [Pipeline Contracts](./pipeline-contracts.md) | Stage executor, handoff protocol, validation matrix, resume semantics | Filled |
| [Error Handling](./error-handling.md) | CliError contract, three-branch catch, resume-safe writes | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Forbidden/required patterns, testing requirements, Windows gotchas | Filled |
| [Database Guidelines](./database-guidelines.md) | Not applicable — no database in this CLI | N/A |
| [Logging Guidelines](./logging-guidelines.md) | Not applicable — terminal progress output only, see error-handling | N/A |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
