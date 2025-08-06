---
description: Refactor the code base
---

## Context

- Current code base: `src/`
- Project background: `README.md`
- Skills: `llm-skills/refactor.md`

## Your task

1. Understand the current code base and its background.
2. Rethink the code structure and organization.
3. Identify areas for improvement and refactoring.
4. Show me your understanding and questions, if you want to clarify any points.
5. If everything is clear, provide a refactoring plan and details.

Before you start, please ensure:

1. Follow the refactoring best practices.
2. Don't over-engineer and keep it practical.
3. Don't try to make it perfect in one go; focus on incremental improvements.
4. If you think new tests are needed, include them in your plan. But remember, I need real tests that can detect regressions, which means:
   - Don't try to write a lot of unncessary unit tests with a lot of mocks.
   - Focus on integration tests that cover the main functionalities.
   - For e2e tests, focus on the most important user journeys.
5. If you think the code is already good enough, explain why and stop here.

## Output

- A detailed refactoring plan with phases. Each phase includes:
  - The goal of the phase
  - Areas of the code that need refactoring
  - Proposed changes and improvements
  - Justification for each change
  - Any new tests that will be added

Note: try to keep each phase focuses on one goal to avoid complexity.

Write your plan in `refactor-plan.md` under the root directory of the project.
