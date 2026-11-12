import test from "node:test";
import assert from "node:assert/strict";
import {
  collectPortfolio,
  formatPortfolioMarkdown,
  REPOSITORIES,
} from "./portfolio-report.mjs";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test("portfolio scan reports the latest CI workflow and open PR counts", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/actions/workflows?per_page=100")) {
      return response({ workflows: [
        { id: 9, name: "Docs hygiene", path: ".github/workflows/docs.yml" },
        { id: 42, name: "CI", path: ".github/workflows/ci.yml" },
      ] });
    }
    if (url.includes("/actions/workflows/42/runs?")) {
      return response({
        workflow_runs: [{
          name: "CI",
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/example/repo/actions/runs/1",
          created_at: "2026-11-12T10:00:00Z",
        }],
      });
    }
    return response([{ number: 1 }, { number: 2 }]);
  };

  const report = await collectPortfolio({ fetchImpl, now: () => new Date("2026-11-12T12:00:00Z") });

  assert.equal(report.projects.length, REPOSITORIES.length);
  assert.ok(report.projects.every((project) => project.conclusion === "success"));
  assert.ok(report.projects.every((project) => project.openPullRequests === 2));
  assert.ok(report.projects.every((project) => project.status === "healthy"));
  assert.ok(report.projects.every((project) => project.workflowName === "CI"));
});

test("portfolio scan isolates an unavailable repository instead of hiding other results", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("QuicksilverV1")) throw new Error("network details must not leak");
    if (url.endsWith("/actions/workflows?per_page=100")) {
      return response({ workflows: [{ id: 42, name: "CI", path: ".github/workflows/ci.yml" }] });
    }
    if (url.includes("/actions/workflows/42/runs?")) {
      return response({ workflow_runs: [{ status: "completed", conclusion: "failure" }] });
    }
    return response([]);
  };

  const report = await collectPortfolio({ fetchImpl });
  const quicksilver = report.projects.find((project) => project.name === "Quicksilver");
  const resonance = report.projects.find((project) => project.name === "Resonance");
  assert.equal(quicksilver.status, "unknown");
  assert.match(quicksilver.error, /unavailable/i);
  assert.doesNotMatch(quicksilver.error, /network details/);
  assert.equal(resonance.status, "failing");
});

test("portfolio scan treats a missing CI workflow as unknown, not healthy", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/actions/workflows?per_page=100")) {
      return response({ workflows: [{ id: 9, name: "Docs hygiene", path: ".github/workflows/docs.yml" }] });
    }
    return response([]);
  };
  const report = await collectPortfolio({ fetchImpl });
  assert.ok(report.projects.every((project) => project.status === "unknown"));
});

test("portfolio markdown identifies blocked evidence and links known workflow runs", () => {
  const markdown = formatPortfolioMarkdown({
    checkedAt: "2026-11-12T12:00:00.000Z",
    overall: "healthy",
    projects: [{
      name: "Conduit",
      repository: "cknowlesbadluck/Conduit",
      status: "healthy",
      workflowName: "CI",
      conclusion: "success",
      runUrl: "https://github.com/cknowlesbadluck/Conduit/actions/runs/2",
      openPullRequests: 3,
      error: null,
    }],
  });

  assert.match(markdown, /Conduit/);
  assert.match(markdown, /healthy/i);
  assert.match(markdown, /\[CI\]\(https:\/\/github\.com\/cknowlesbadluck\/Conduit\/actions\/runs\/2\)/);
  assert.match(markdown, /3/);
});
