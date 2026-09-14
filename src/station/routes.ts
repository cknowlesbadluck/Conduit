import type { Express, Request, Response, NextFunction } from "express";
import { loadStationSnapshot } from "./data.js";
import { renderStationPage } from "./html.js";

export type StationAuthMiddleware = (req: Request, res: Response, next: NextFunction) => void;

function wantsJson(req: Request): boolean {
  const accept = req.header("accept") ?? "";
  if (accept.includes("application/json") && !accept.includes("text/html")) return true;
  return req.query.format === "json";
}

/**
 * Register monitor-only station routes. Caller supplies the same auth middleware used for /events.
 */
export function registerStationRoutes(app: Express, authMiddleware: StationAuthMiddleware): void {
  app.get("/station", authMiddleware, async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === "string" && req.query.projectId.length > 0
        ? req.query.projectId
        : undefined;
      const snapshot = await loadStationSnapshot(req.auth, projectId);
      if (wantsJson(req)) {
        res.type("application/json").status(200).json(snapshot);
        return;
      }
      res
        .status(200)
        .type("html")
        .set({
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'",
          "Cache-Control": "no-store",
        })
        .send(renderStationPage(snapshot));
    } catch (error) {
      console.error("station_failed", error);
      res.status(500).json({ error: "station_failed" });
    }
  });
}
