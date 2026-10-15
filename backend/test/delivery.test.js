import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

/** Alert delivery and subscription links against an in-memory MongoDB; env is set before config.js loads. */
const sent = [];
let failing = false;
vi.mock("../src/notify/senders.js", () => ({
  sendEmail: vi.fn(async (email) => {
    if (failing) throw new Error("Brevo HTTP 503");
    sent.push({ transport: "email", ...email });
  }),
  postSlack: vi.fn(async (text) => {
    if (failing) throw new Error("Slack webhook HTTP 503");
    sent.push({ transport: "slack", text });
  }),
}));

let mongo;
let alerts;
let col;

const base = Date.now() - 6 * 3600_000;
const at = (min) => new Date(base + min * 60_000);

async function addRollout(path, firstMin, changes) {
  const { insertedId } = await col.rollouts.insertOne({
    channel: "beta",
    region: "test",
    path,
    group: "16.0.3",
    toBuild: "16.0.3",
    fromBuild: "16.0.2",
    toSha: `sha-${path}`,
    fromSha: "a",
    status: "rolling",
    share: 0.5,
    recentShare: 0.5,
    severity: changes.some((c) => c.severity === "high") ? "high" : "low",
    apiChangeCount: changes.length,
    firstSeenAt: at(firstMin),
    lastSeenAt: at(firstMin + 20),
    history: [0.25, 0.5].map((share, i) => ({ at: at(firstMin + i * 10), share })),
    notifiedAt: null,
  });
  if (changes.length) {
    await col.apiChanges.insertMany(changes.map((c) => ({ rolloutId: insertedId, file: path, ...c })));
  }
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "delivery-test";
  process.env.REGION = "test";
  process.env.PUBLIC_URL = "https://example.test";
  alerts = await import("../src/notify/alerts.js");
  col = await (await import("../src/db.js")).db();
});

afterAll(async () => {
  await (await import("../src/db.js")).closeDb();
  await mongo?.stop();
});

beforeEach(async () => {
  sent.length = 0;
  failing = false;
  for (const c of ["rollouts", "apiChanges", "subscribers", "deliveries"]) await col[c].deleteMany({});
  await col.subscribers.insertOne({
    email: "dev@example.test",
    token: "tok",
    confirmedAt: at(0),
    unsubscribedAt: null,
    minSeverity: "low",
    channels: ["prod", "beta"],
    watchItems: [],
  });
});

describe("alert delivery", () => {
  it("sends one alert per build, then an update only for API changes not sent yet", async () => {
    await addRollout("excel-web-16.00.js", 0, [{ path: "Excel.Range.foo", kind: "removed", severity: "high" }]);
    await alerts.notifyPending(20, at(60));
    expect(sent.filter((m) => m.transport === "email")).toHaveLength(1);
    expect(sent.find((m) => m.transport === "email").subject).toBe("[high] Office.js beta: build 16.0.3 rolling out");

    // More files of the same build, same change: nothing new to say.
    sent.length = 0;
    await addRollout("excel-win32-16.01.js", 80, [{ path: "Excel.Range.foo", kind: "removed", severity: "high" }]);
    await alerts.notifyPending(20, at(140));
    expect(sent).toEqual([]);

    // A file that brings a change not reported yet: an update with only that change.
    await addRollout("word-web-16.00.js", 150, [{ path: "Word.Body.bar", kind: "added", severity: "low" }]);
    await alerts.notifyPending(20, at(200));
    const email = sent.find((m) => m.transport === "email");
    expect(email.subject).toBe("[low] Office.js beta: build 16.0.3 rolling out — update, 1 new API change(s)");
    expect(email.text).toContain("Word.Body.bar");
    expect(email.text).not.toContain("Excel.Range.foo");
    expect(sent.filter((m) => m.transport === "slack")).toHaveLength(1);
  });

  it("keeps a failed message queued and sends it on a later crawl", async () => {
    await addRollout("excel-web-16.00.js", 0, [{ path: "Excel.Range.foo", kind: "removed", severity: "high" }]);
    failing = true;
    await alerts.notifyPending(20, at(60));
    expect(sent).toEqual([]);
    expect(await col.deliveries.countDocuments({ sentAt: null, failedAt: null, attempts: 1 })).toBe(2);

    failing = false;
    expect(await alerts.flushDeliveries(at(70))).toEqual({ sent: 2, failed: 0, dropped: 0 });
    expect(sent.map((m) => m.transport).sort()).toEqual(["email", "slack"]);
    // Sent once: a further crawl sends nothing.
    expect(await alerts.flushDeliveries(at(80))).toEqual({ sent: 0, failed: 0, dropped: 0 });
  });

  it("alerts a pulled-back build once", async () => {
    await addRollout("excel-web-16.00.js", 0, []);
    await col.rollouts.updateMany({}, { $set: { status: "abandoned", notifiedAt: at(30), rollbackNotifiedAt: null } });
    await alerts.notifyPending(20, at(300));
    expect(sent.map((m) => m.transport).sort()).toEqual(["email", "slack"]);
    expect(sent.find((m) => m.transport === "email").subject).toBe("[pulled back] Office.js beta: build 16.0.3 rolled back");
    sent.length = 0;
    await alerts.notifyPending(20, at(310));
    expect(sent).toEqual([]);
  });

  it("drops a queued email when the subscriber unsubscribed meanwhile", async () => {
    await addRollout("excel-web-16.00.js", 0, [{ path: "Excel.Range.foo", kind: "removed", severity: "high" }]);
    failing = true;
    await alerts.notifyPending(20, at(60));
    await col.subscribers.updateOne({ token: "tok" }, { $set: { unsubscribedAt: at(65) } });
    failing = false;
    expect(await alerts.flushDeliveries(at(70))).toEqual({ sent: 1, failed: 0, dropped: 1 });
  });
});

describe("subscription links", () => {
  let app;
  beforeAll(async () => {
    app = await (await import("../src/web/server.js")).buildServer();
  });
  afterAll(async () => {
    await app?.close();
  });

  it("does not confirm on GET (mail scanners open every link), only on the button's POST", async () => {
    await col.subscribers.updateOne({ token: "tok" }, { $set: { confirmedAt: null } });
    const page = await app.inject({ method: "GET", url: "/confirm?token=tok" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('action="/confirm?token=tok"');
    expect((await col.subscribers.findOne({ token: "tok" })).confirmedAt).toBeNull();

    const done = await app.inject({ method: "POST", url: "/confirm?token=tok" });
    expect(done.statusCode).toBe(303);
    expect(done.headers.location).toBe("https://example.test/?notice=confirmed");
    expect((await col.subscribers.findOne({ token: "tok" })).confirmedAt).not.toBeNull();
  });

  it("does not unsubscribe on GET; the button and RFC 8058 one-click POST do", async () => {
    await app.inject({ method: "GET", url: "/unsubscribe?token=tok" });
    expect((await col.subscribers.findOne({ token: "tok" })).unsubscribedAt).toBeNull();

    const button = await app.inject({
      method: "POST",
      url: "/unsubscribe?token=tok",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "",
    });
    expect(button.statusCode).toBe(303);
    expect((await col.subscribers.findOne({ token: "tok" })).unsubscribedAt).not.toBeNull();

    await col.subscribers.updateOne({ token: "tok" }, { $set: { unsubscribedAt: null } });
    const oneClick = await app.inject({
      method: "POST",
      url: "/unsubscribe?token=tok",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "List-Unsubscribe=One-Click",
    });
    expect(oneClick.statusCode).toBe(200);
    expect((await col.subscribers.findOne({ token: "tok" })).unsubscribedAt).not.toBeNull();
  });

  const subscribe = (payload) => app.inject({ method: "POST", url: "/api/subscribe", payload });

  it("tells a subscribed address it is already subscribed instead of staying silent", async () => {
    await col.subscribers.updateOne({ token: "tok" }, { $set: { channels: ["prod"], confirmationsSent: [] } });
    expect((await subscribe({ email: "dev@example.test" })).json()).toEqual({ ok: true });
    expect(sent.map((m) => m.subject)).toEqual(["You're already subscribed to silentship alerts"]);
    expect(sent[0].text).toContain("/unsubscribe?token=tok");
  });

  it("adds beta to a subscribed address only after the confirm button", async () => {
    await col.subscribers.updateOne({ token: "tok" }, { $set: { channels: ["prod"], confirmationsSent: [] } });
    await subscribe({ email: "dev@example.test", beta: true });
    expect(sent.map((m) => m.subject)).toEqual(["Confirm your silentship alerts"]);
    expect((await col.subscribers.findOne({ token: "tok" })).channels).toEqual(["prod"]);

    const page = await app.inject({ method: "GET", url: "/confirm?token=tok" });
    expect(page.statusCode).toBe(200);
    await app.inject({ method: "POST", url: "/confirm?token=tok" });
    const sub = await col.subscribers.findOne({ token: "tok" });
    expect(sub.channels).toEqual(["prod", "beta"]);
    expect(sub.pendingChannels).toBeUndefined();
  });

  it("sends unknown tokens to the invalid-link notice", async () => {
    const res = await app.inject({ method: "GET", url: "/confirm?token=nope" });
    expect(res.headers.location).toBe("https://example.test/?notice=invalid-link");
  });
});
