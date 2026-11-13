import { REPOSITORIES } from "./portfolio-report.mjs";

const API_ROOT = "https://api.github.com";
const PRIORITY = Object.freeze({
  security: 0,
  "release-blocker": 1,
  blocker: 2,
  high: 3,
  normal: 4,
});

function labelsOf(issue) {
  return Array.isArray(issue.labels)
    ? issue.labels.map((label) => typeof label === "string" ? label : label?.name).filter(Boolean)
    : [];
}

function hasAcceptanceCriteria(body) {
  if (typeof body !== "string") return false;
  const heading = /^#{1,3}\s+acceptance criteria\s*$/im;
  const match = body.match(heading);
  if (!match || match.index === undefined) return false;
  const section = body.slice(match.index + match[0].length).split(/^#{1,3}\s+/m)[0];
  return /^\s*(?:[-*+]\s+|\d+\.\s+).+/m.test(section);
}

function safeIssueUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.href : null;
  } catch {
    return null;
  }
}

function priorityOf(labels) {
  for (const name of Object.keys(PRIORITY)) {
    if (labels.includes(`priority:${name}`)) return name;
  }
  return "normal";
}

export function selectReadyTasks({
  repositories = REPOSITORIES,
  issuesByRepository = {},
  unavailableRepositories = [],
  maxTasks = 9,
} = {}) {
  const tasks = [];
  for (const repository of repositories) {
    const issues = issuesByRepository[repository.repository];
    if (!Array.isArray(issues)) continue;
    for (const issue of issues) {
      const labels = labelsOf(issue);
      const url = safeIssueUrl(issue.html_url);
      if (issue.state !== "open" || issue.pull_request || !url) continue;
      if (!labels.includes("portfolio:ready") || !hasAcceptanceCriteria(issue.body)) continue;
      const priority = priorityOf(labels);
      tasks.push({
        project: repository.name,
        repository: repository.repository,
        issueNumber: issue.number,
        title: String(issue.title ?? `Issue #${issue.number}`).slice(0, 160),
        priority,
        priorityRank: PRIORITY[priority],
        url,
      });
    }
  }

  tasks.sort((a, b) =>
    a.priorityRank - b.priorityRank
    || a.repository.localeCompare(b.repository)
    || a.issueNumber - b.issueNumber);
  const unavailableNames = unavailableRepositories.map((repository) =>
    repositories.find((item) => item.repository === repository)?.name ?? repository);
  return {
    tasks: tasks.slice(0, Math.max(0, Math.min(maxTasks, 50))).map(({ priorityRank, ...task }) => task),
    unavailableRepositories: unavailableNames,
  };
}

async function getOpenReadyIssues(repository, { fetchImpl, token }) {
  const url = new URL(`${API_ROOT}/repos/${repository}/issues`);
  url.searchParams.set("state", "open");
  url.searchParams.set("labels", "portfolio:ready");
  url.searchParams.set("per_page", "100");
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "conduit-portfolio-coordinator",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("GitHub issue response was malformed.");
  return payload;
}

export async function collectReadyTasks({
  repositories = REPOSITORIES,
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN,
  maxTasks = 9,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A Fetch-compatible implementation is required.");
  }
  const issuesByRepository = {};
  const unavailableRepositories = [];
  await Promise.all(repositories.map(async (repository) => {
    try {
      issuesByRepository[repository.repository] = await getOpenReadyIssues(
        repository.repository,
        { fetchImpl, token },
      );
    } catch {
      unavailableRepositories.push(repository.repository);
    }
  }));
  return {
    checkedAt: new Date().toISOString(),
    ...selectReadyTasks({
      repositories,
      issuesByRepository,
      unavailableRepositories,
      maxTasks,
    }),
  };
}

export function formatCoordinatorMarkdown(report) {
  const rows = report.tasks.length
    ? report.tasks.map((task, index) =>
        `| ${index + 1} | ${task.project} | [#${task.issueNumber} — ${task.title.replaceAll("|", "\\|").replaceAll("\n", " ")}](${task.url}) | ${task.priority} |`)
    : ["| — | — | No eligible tasks | — |"];
  const unavailable = report.unavailableRepositories.length
    ? report.unavailableRepositories.join(", ")
    : "None";
  return [
    "# Portfolio development queue",
    "",
    `- Checked: ${report.checkedAt}`,
    "- Selection: open issues explicitly labeled `portfolio:ready` with a non-empty Acceptance criteria section.",
    "- Priority order: security, release blocker, blocker, high, normal.",
    "- Project boundaries: each issue stays in its own repository; no cross-repository code or branch writes.",
    "- Execution status: **human engineering session required** until a free authenticated agent runner is connected.",
    "- Safety: this report does not modify source code, create branches, assign issues, approve reviews, merge PRs, or deploy.",
    `- Repositories with unavailable issue data: ${unavailable}`,
    "",
    "| Rank | Project | Ready task | Priority |",
    "|---:|---|---|---|",
    ...rows,
    "",
    "To queue work, add the `portfolio:ready` label and an `## Acceptance criteria` section to the issue in its own repository.",
    "Missing or inaccessible data is not treated as an empty queue.",
  ].join("\n");
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  try {
    const report = await collectReadyTasks();
    const markdown = formatCoordinatorMarkdown(report);
    process.stdout.write(`${markdown}\n`);
    if (report.unavailableRepositories.length) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Portfolio coordinator failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
