# Refactoring Best Practices

## When to Refactor

**Rule of Three** - When you do something similar the third time, refactor it.

**Add Function** - When you need to add a feature, refactor first to make adding the feature easy.

**Fix Bug** - When fixing a bug, refactor to make the code clearer so the bug is obvious.

**Code Review** - Refactor during code reviews to improve code understanding.

## What to Refactor

**Long Method** - Break down methods that are too long.

**Large Class** - Split classes that are doing too much.

**Long Parameter List** - Replace with objects or method calls.

**Duplicate Code** - Extract common code into methods or classes.

**Dead Code** - Remove unused code immediately.

**Speculative Generality** - Remove unnecessary abstractions added "just in case."

**Feature Envy** - Move methods to the class they're most interested in.

**Data Clumps** - Group related data into objects.

**Primitive Obsession** - Replace primitives with small objects.

**Switch Statements** - Replace with polymorphism.

## How to Refactor Safely

**Small Steps** - Make tiny changes, one at a time.

**Run Tests** - Ensure tests pass after each small change.

**Commit Often** - Commit working code frequently.

**No Functional Changes** - Refactoring should not change behavior.

**Automated Tests** - Have comprehensive test coverage before refactoring.

**Version Control** - Always work with version control to enable rollbacks.

## Core Refactoring Techniques

**Extract Method** - Turn code fragments into methods with descriptive names.

**Inline Method** - Replace method calls with method body when method is trivial.

**Extract Variable** - Put complex expressions into well-named variables.

**Rename** - Use clear, intention-revealing names.

**Move Method/Field** - Move to the class where they belong.

**Extract Class** - Create new class when one class is doing work of two.

**Inline Class** - Merge when a class isn't doing much.

**Replace Magic Numbers** - Use named constants instead of literals.
