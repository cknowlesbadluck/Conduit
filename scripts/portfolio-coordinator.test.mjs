import test from "node:test";
import assert from "node:assert/strict";
import { selectReadyTasks, formatCoordinatorMarkdown } from "./portfolio-coordinator.mjs";

const repositories = [
  { name: "Resonance", repository: "cknowlesbadluck/Resonance" },
  { name: "Quicksilver", repository: "cknowlesbadluck/QuicksilverV1" },
  { name: "Conduit", repository: "cknowlesbadluck/Conduit" },
];

function issue(number, title, labels, body = "## Acceptance criteria\n- [ ] Verified behavior") {
  return { number, state: "open", title, labels: labels.map((name) => ({ name })), body, html_url: `https://github.com/owner/repo/issues/${number}` };
}

test("selects only explicitly ready issues with acceptance criteria", () => {
  const result = selectReadyTasks({
    repositories,
    issuesByRepository: {
      "cknowlesbadluck/Resonance": [
        issue(1, "Ready", ["portfolio:ready", "priority:high"]),
        issue(2, "Not ready", ["priority:high"]),
        issue(3, "Missing criteria", ["portfolio:ready"], "Needs work"),
      ],
    },
  });
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].issueNumber, 1);
  assert.equal(result.tasks[0].project, "Resonance");
});

test("orders security and release blockers before ordinary work", () => {
  const result = selectReadyTasks({
    repositories,
    issuesByRepository: {
      "cknowlesbadluck/Resonance": [issue(1, "Routine", ["portfolio:ready"])],
      "cknowlesbadluck/QuicksilverV1": [issue(2, "Release blocker", ["portfolio:ready", "priority:release-blocker"])],
      "cknowlesbadluck/Conduit": [issue(3, "Security", ["portfolio:ready", "priority:security"])],
    },
  });
  assert.deepEqual(result.tasks.map((task) => task.issueNumber), [3, 2, 1]);
});

test("never treats pull requests, closed issues, or untrusted URLs as tasks", () => {
  const result = selectReadyTasks({
    repositories,
    issuesByRepository: {
      "cknowlesbadluck/Resonance": [
        { ...issue(1, "PR", ["portfolio:ready"]), pull_request: { url: "https://api.github.com/pulls/1" } },
        { ...issue(2, "Closed", ["portfolio:ready"]), state: "closed" },
        { ...issue(3, "Bad URL", ["portfolio:ready"]), html_url: "https://evil.example/3" },
      ],
    },
  });
  assert.equal(result.tasks.length, 0);
});

test("does not leak tasks across repositories and reports inaccessible repositories", () => {
  const result = selectReadyTasks({
    repositories,
    issuesByRepository: {
      "cknowlesbadluck/Resonance": [issue(7, "Only Resonance", ["portfolio:ready"])],
    },
    unavailableRepositories: ["cknowlesbadluck/QuicksilverV1"],
  });
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].repository, "cknowlesbadluck/Resonance");
  assert.deepEqual(result.unavailableRepositories, ["QuicksilverV1"]);
});

test("formats coordinator output with an explicit human execution gate", () => {
  const report = {
    checkedAt: "2026-11-12T12:00:00.000Z",
    tasks: [{
      project: "Conduit",
      repository: "cknowlesbadluck/Conduit",
      issueNumber: 9,
      title: "Harden handoff",
      priority: "security",
      url: "https://github.com/cknowlesbadluck/Conduit/issues/9",
    }],
    unavailableRepositories: [],
  };
  const markdown = formatCoordinatorMarkdown(report);
  assert.match(markdown, /Harden handoff/);
  assert.match(markdown, /human engineering session/i);
  assert.match(markdown, /does not modify source code/i);
});
