const API_ROOT = "https://api.github.com";
export const REPOSITORIES = Object.freeze([
  { name: "Resonance", repository: "cknowlesbadluck/Resonance" },
  { name: "Quicksilver", repository: "cknowlesbadluck/QuicksilverV1" },
  { name: "Conduit", repository: "cknowlesbadluck/Conduit" },
]);

async function apiGet(fetchImpl, url, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "conduit-portfolio-health",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned HTTP ${response.status}`);
  }
  return response.json();
}

function classifyRun(run) {
  if (!run) return "unknown";
  if (run.status !== "completed") return "in_progress";
  return run.conclusion === "success" ? "healthy" : "failing";
}

function safeRunUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.href : null;
  } catch {
    return null;
  }
}

async function scanRepository(repository, { fetchImpl, token }) {
  const base = `${API_ROOT}/repos/${repository.repository}`;
  try {
    const [workflowPayload, pullsPayload] = await Promise.all([
      apiGet(fetchImpl, `${base}/actions/workflows?per_page=100`, token),
      apiGet(fetchImpl, `${base}/pulls?state=open&per_page=100`, token),
    ]);

    const ciWorkflow = Array.isArray(workflowPayload.workflows)
      ? workflowPayload.workflows.find((workflow) =>
          typeof workflow.path === "string" && workflow.path.endsWith("/ci.yml"))
      : null;
    if (!ciWorkflow || !Number.isInteger(ciWorkflow.id)) {
      throw new Error("Required CI workflow was not found.");
    }

    const runsPayload = await apiGet(
      fetchImpl,
      `${base}/actions/workflows/${ciWorkflow.id}/runs?branch=main&per_page=1`,
      token,
    );
    const latestRun = Array.isArray(runsPayload.workflow_runs)
      ? runsPayload.workflow_runs[0]
      : null;
    const openPullRequests = Array.isArray(pullsPayload) ? pullsPayload.length : 0;

    return {
      ...repository,
      status: classifyRun(latestRun),
      workflowName: ciWorkflow.name ?? "CI",
      conclusion: latestRun?.conclusion ?? null,
      runUrl: safeRunUrl(latestRun?.html_url),
      runCreatedAt: latestRun?.created_at ?? null,
      openPullRequests,
      error: latestRun ? null : "No CI workflow run found for the default branch.",
    };
  } catch {
    return {
      ...repository,
      status: "unknown",
      workflowName: null,
      conclusion: null,
      runUrl: null,
      runCreatedAt: null,
      openPullRequests: null,
      error: "Repository status unavailable (network or GitHub API error).",
    };
  }
}

export async function collectPortfolio({
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN,
  now = () => new Date(),
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A Fetch-compatible implementation is required.");
  }
  const projects = await Promise.all(
    REPOSITORIES.map((repository) => scanRepository(repository, { fetchImpl, token })),
  );
  const statuses = projects.map((project) => project.status);
  const overall = statuses.includes("failing")
    ? "failing"
    : statuses.includes("unknown")
      ? "degraded"
      : statuses.includes("in_progress")
        ? "in_progress"
        : "healthy";

  return { checkedAt: now().toISOString(), overall, projects };
}

function escapeCell(value) {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function formatPortfolioMarkdown(report) {
  const rows = report.projects.map((project) => {
    const workflow = project.runUrl && project.workflowName
      ? `[${escapeCell(project.workflowName)}](${project.runUrl})`
      : escapeCell(project.workflowName);
    return `| ${escapeCell(project.name)} | ${escapeCell(project.status)} | ${workflow} | ${escapeCell(project.openPullRequests)} | ${escapeCell(project.error)} |`;
  });

  return [
    "# Portfolio health",
    "",
    `- Checked: ${report.checkedAt}`,
    `- Overall: **${report.overall}**`,
    "- Scope: latest GitHub Actions run on each repository's main branch and open pull-request count.",
    "- This is a read-only status report; it does not modify repositories, approve PRs, or merge code.",
    "",
    "| Project | Status | Latest workflow | Open PRs | Notes |",
    "|---|---|---|---:|---|",
    ...rows,
    "",
    "A missing or inaccessible check is reported as unknown/degraded, never as a pass.",
  ].join("\n");
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  try {
    const report = await collectPortfolio();
    process.stdout.write(`${formatPortfolioMarkdown(report)}\n`);
    if (report.overall === "failing") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Portfolio report failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
