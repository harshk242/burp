import type { MiddlewareHandler } from "hono";

const WWW_HOSTNAME = "www.tryburp.com";
const CANONICAL_HOSTNAME = "tryburp.com";

export const redirectWwwToCanonical: MiddlewareHandler = async (c, next) => {
  const url = new URL(c.req.url);

  if (url.hostname === WWW_HOSTNAME) {
    url.protocol = "https:";
    url.hostname = CANONICAL_HOSTNAME;
    url.port = "";
    return c.redirect(url.toString(), 308);
  }

  await next();
};
