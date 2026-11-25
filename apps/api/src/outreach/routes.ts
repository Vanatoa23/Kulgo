import { Hono } from "hono";
import type { OutreachService } from "./service.js";

export interface OutreachRoutesDependencies {
  outreachService: OutreachService;
}

/**
 * Public 1-click unsubscribe endpoints (RFC 8058 / GDPR Art. 21).
 * Uses HMAC-SHA256 signed tokens so unsubscribe requires no login and cannot
 * be spoofed for arbitrary emails.
 */
export function createOutreachRoutes({
  outreachService,
}: OutreachRoutesDependencies): Hono {
  const routes = new Hono();

  routes.get("/unsubscribe", async (c) => {
    const token = c.req.query("token") ?? "";
    if (!token) {
      return c.json({ error: "Missing unsubscribe token" }, 400);
    }
    const suppressed = await outreachService.suppressByToken(token);
    if (!suppressed) {
      return c.json({ error: "Invalid unsubscribe token" }, 400);
    }
    return c.json(
      {
        ok: true,
        unsubscribed: true,
        reason: suppressed.reason,
      },
      200,
    );
  });

  routes.post("/unsubscribe", async (c) => {
    let token = c.req.query("token") ?? "";
    if (!token) {
      try {
        const body = (await c.req.json()) as { token?: unknown };
        if (typeof body?.token === "string") {
          token = body.token;
        }
      } catch {
        // Ignore empty or non-JSON RFC 8058 POST body when token is in query
      }
    }
    if (!token) {
      return c.json({ error: "Missing unsubscribe token" }, 400);
    }
    const suppressed = await outreachService.suppressByToken(token);
    if (!suppressed) {
      return c.json({ error: "Invalid unsubscribe token" }, 400);
    }
    return c.json(
      {
        ok: true,
        unsubscribed: true,
        reason: suppressed.reason,
      },
      200,
    );
  });

  return routes;
}
