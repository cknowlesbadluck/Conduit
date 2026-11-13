import test from "node:test";
import assert from "node:assert/strict";
import { collectReadyTasks, selectReadyTasks, formatCoordinatorMarkdown } from "./portfolio-coordinator.mjs";

const repositories = [
  { name: "Resonance", repository: "cknowlesbadluck/Resonance" },
  { name: "Quicksilver", repository: "cknowlesbadluck/QuicksilverV1" },
  { name: "Conduit", repository: "cknowlesbadluck/Conduit" },
];

function issue(number, title, labels, body = "## Acceptance criteria\n- [ ] Verified behavior") {
  return { number, state: "open", title, labels: labels.map((name) => ({ name })), body, html_url: `https://github.com/owner/repo/issues/${number}` };
}

function response(body, link = null) {
  return {
    ok: true,
    status: 200,
    headers: { get(name) { return name.toLowerCase() === "link" ? link : null; } },
    async json() { return body; },
  };
}

test("selects only explicitly ready issues with non-empty acceptance criteria", () => {
  const result = selectReadyTasks({
    repositories,
    issuesByRepository: {
      "cknowlesbadluck/Resonance": [
        issue(1, "Ready", ["portfolio:ready", "priority:high"]),
        issue(2, "Not ready", ["priority:high"]),
        issue(3, "Missing criteria", ["portfolio:ready"], "Needs work"),
        issue(4, "Empty criteria", ["portfolio:ready"], "## Acceptance criteria\n\n## Notes\nNothing yet"),
        issue(5, "Prose criteria", ["portfolio:ready"], "## Acceptance criteria\nThe endpoint must reject unauthenticated requests before parsing input."),
      ],
    },
  });
  assert.deepEqual(result.tasks.map((task) => task.issueNumber), [1, 5]);
  assert.equal(result.tasks[1].project, "Resonance");
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
  assert.deepEqual(result.unavailableRepositories, ["Quicksilver"]);
});

test("fetches a second bounded page rather than silently omitting ready issues", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed.searchParams.get("page"));
    if (parsed.searchParams.get("page") === "1") {
      return response([issue(1, "First page", ["not-ready"])], `<${parsed.origin}${parsed.pathname}?state=open&labels=portfolio%3Aready&per_page=100&page=2>; rel="next"`);
    }
    return response([issue(2, "Second page", ["portfolio:ready"])]);
  };
  const result = await collectReadyTasks({ repositories: [repositories[0]], fetchImpl });
  assert.deepEqual(calls, ["1", "2"]);
  assert.deepEqual(result.tasks.map((task) => task.issueNumber), [2]);
  assert.deepEqual(result.unavailableRepositories, []);
});

test("marks a repository unavailable when the bounded pagination limit is exceeded", async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get("page"));
    const next = `<${parsed.origin}${parsed.pathname}?state=open&labels=portfolio%3Aready&per_page=100&page=${page + 1}>; rel="next"`;
    return response([], next);
  };
  const result = await collectReadyTasks({ repositories: [repositories[0]], fetchImpl });
  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.unavailableRepositories, ["Resonance"]);
});

test("escapes issue titles so Markdown link text cannot inject a second link", () => {
  const report = {
    checkedAt: "2026-11-12T12:00:00.000Z",
    tasks: [{
      project: "Conduit",
      repository: "cknowlesbadluck/Conduit",
      issueNumber: 9,
      title: "Fix](https://evil.example) [details",
      priority: "security",
      url: "https://github.com/cknowlesbadluck/Conduit/issues/9",
    }],
    unavailableRepositories: [],
  };
  const markdown = formatCoordinatorMarkdown(report);
  // The hostile-looking URL remains plain label text; only the trusted issue URL is a link.
  assert.ok(markdown.includes("[#9 — Fix\\](https://evil.example) \\[details](https://github.com/cknowlesbadluck/Conduit/issues/9)"));
  assert.equal((markdown.match(/\]\(https:\/\/evil\.example/g) ?? []).length, 0);
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
