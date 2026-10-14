import { expect, it } from "bun:test";
import { APP_DIR } from "../config";

it("validates admin limits and returns zero/unlimited usage through the actual routers", async () => {
  const source = `
    const { sqlite, runMigrations } = await import('./server/db');
    runMigrations(sqlite);
    const { admin } = await import('./server/routes/admin');
    const { usage } = await import('./server/routes/usage');
    const listing = await admin.request('/users');
    if (listing.status !== 200) throw new Error(await listing.text());
    const { users } = await listing.json();
    const id = users[0].id;
    const fields = ['daily_query_limit', 'daily_token_limit', 'daily_cost_limit_microusd', 'monthly_cost_limit_microusd'];
    const statuses = [];
    for (const value of [-2, -0.5, 0.5, 0, -1, null]) {
      statuses.push((await admin.request('/users/' + id + '/limits', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(fields.map(field => [field, value]))),
      })).status);
      if (value === 0 || value === -1) {
        const current = await (await usage.request('/')).json();
        if (current.limit !== value || current.remaining !== value || current.tokens.limit !== value || current.cost.daily_limit_microusd !== value) {
          throw new Error(JSON.stringify(current));
        }
      }
    }
    console.log(JSON.stringify(statuses));
  `;
  const child = Bun.spawn([process.execPath, "-e", source], {
    cwd: APP_DIR,
    env: { ...process.env, AUTH_MODE: "development", NODE_ENV: "test", CLERK_SECRET_KEY: "", DATABASE_URL: ":memory:", LOG_LEVEL: "ERROR", LOG_DIR: "/tmp/medium-logs-m6" },
    stdout: "pipe", stderr: "pipe",
  });
  const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(exit, error).toBe(0);
  expect(JSON.parse(output.trim().split("\n").at(-1)!)).toEqual([400, 400, 400, 200, 200, 200]);
});
