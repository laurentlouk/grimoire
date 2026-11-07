---
name: tdd
description: Test-driven development discipline. Red, green, then refactor, one behavior at a time, tested through the public interface. Use when building a feature or fixing a bug test first.
---

# Test-driven development

Write one failing test for one behavior, watch it fail, write the least code that makes it pass, then refactor. Do the next behavior the same way. Don't write all the tests up front and then all the code; tests written in bulk only check behavior you imagined, and they tend to pin down the shape of things rather than what the user actually needs. Let each test follow from what the last cycle taught you. The test comes first, never bolted on afterwards.

## What a good test looks like

It checks behavior through the public interface, the same entry point a real caller uses, and ignores whatever sits behind it. It reads like a specification ("a user can claim a reward once per session") and stays unchanged when you rework the code underneath.

Assert the whole value, not its shape. Compare against the full result, `toEqual(['a', 'b'])` or the complete object, not a loose `typeof x === 'object'` or "the list isn't empty". The expected value has to come from somewhere independent: a literal you know is correct, a worked example, the spec. If you build it the same way the code does, the test passes by construction and proves nothing.

When the code models what another tool writes or an engine stores (a generated migration or snapshot, a schema dump, a catalog, a serializer's output), that tool's own output is the independent value. Run the tool at development time, in a throwaway container when it needs a server, and commit what it wrote as a golden fixture the tests read, so CI stays hermetic. Reading the tool's source is not running it: readers built from the source reported false conflicts on schemas the tools themselves had generated in sync.

## What to avoid

Mocking your own modules. Testing private helpers. Asserting how often or in what order something was called. Reading the result through a side channel instead of the public interface. The tell is a test that breaks when you rename an internal function even though the behavior never changed; that test was measuring the implementation.

## Mocking

Mock only at the edges: outside APIs, the clock, randomness, and, sparingly, heavy services like a database or a queue where a real instance is better when you can run one. Never mock code you own. Keep the edges swappable by passing dependencies in instead of building them inside, and give each external call its own small interface so a mock returns one fixed shape with no branching.

## Input you do not control

Code that reads what someone else wrote (a repository's files, an upload, a network payload) gets two more kinds of test, written as you build it, not left to the review.

**Time the hostile shapes.** Build each shape the code can meet at a size where quadratic work takes seconds, and assert a bound with wide headroom (100× the linear time), so a loaded machine never fails it:
- two quantifiers that can match the same text (`\s*` runs side by side over a long run of blanks): one pattern per span, or a hand scan;
- deep nesting (JSON, YAML, code 20,000 levels deep): a depth cap, and one walk down the tree carrying context, never up a node's parents for each node;
- a lookup in a growing list for each item (an interpreter finding a column per statement): a map by name;
- anything that expands (spreads, includes, aliases, globs, recursive types): a cycle guard, a memo and a work budget; a glob matched folder by folder;
- a cache keyed by a path as written: key it by the real path;
- one fact attached to every candidate: cap the fan-out and say "and N more".

**Follow a planted secret.** Build a fake secret at runtime, put it wherever a literal can sit (a value, a default, a quoted string in an unknown dialect, a malformed file), and assert it reaches no output: the store and its write-ahead log, tool answers, the rendered page, error notes. Keep names and structure, never a literal's value. An error gives a position, never the text: a JSON parser's own message quotes the input around the error.

## Refactor only on green

Once the tests pass, tidy up: remove duplication, hide complexity behind a small interface, move logic next to the data it uses, and run the tests after each step. Never refactor while a test is red. Get to green first.

Before you move on, a test should describe behavior rather than implementation, use only the public interface, survive a refactor, assert an independent value, and rest on the least code needed to pass, with nothing speculative added.
