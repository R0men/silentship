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

async function addRollout(path, firstMin, changes, extra = {}) {
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
    ...extra,
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
  process.env.MAIL_REPLY_TO = "hello@example.test";
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
    expect(sent.find((m) => m.transport === "email").subject).toBe("[high] Office.js beta: build 16.0.3 rolling out — 1 API change");

    // More files of the same build, same change: nothing new to say.
    sent.length = 0;
    await addRollout("excel-win32-16.01.js", 80, [{ path: "Excel.Range.foo", kind: "removed", severity: "high" }]);
    await alerts.notifyPending(20, at(140));
    expect(sent).toEqual([]);

    // A file that brings a change not reported yet: an update with only that change.
    await addRollout("word-web-16.00.js", 150, [{ path: "Word.Body.bar", kind: "added", severity: "low" }]);
    await alerts.notifyPending(20, at(200));
    const email = sent.find((m) => m.transport === "email");
    expect(email.subject).toBe("[low] Office.js beta: build 16.0.3 rolling out — update, 1 new API change");
    expect(email.text).toContain("Word.Body.bar");
    expect(email.text).not.toContain("Excel.Range.foo");
    expect(sent.filter((m) => m.transport === "slack")).toHaveLength(1);
  });

  it("counts an API change once however many files carry it, as the site does", async () => {
    const foo = { path: "Excel.Range.foo", kind: "removed", severity: "high" };
    await addRollout("excel-web-16.00.js", 0, [foo, { path: "Excel.Range.bar", kind: "added", severity: "low" }]);
    await addRollout("excel-win32-16.01.js", 0, [foo]);
    await alerts.notifyPending(20, at(60));
    const email = sent.find((m) => m.transport === "email");
    expect(email.subject).toBe("[high] Office.js beta: build 16.0.3 rolling out — 2 API changes");
    expect(email.text.split("\n")[0]).toContain("2 API changes in 2 files; 2 file(s)");
    expect(email.html).toContain("2 API changes in 2 files");
    expect(sent.find((m) => m.transport === "slack").text).toContain("2 API changes in 2 files");
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

describe("OneCDN channels", () => {
  const removed = [{ path: "Excel.Range.foo", kind: "removed", severity: "high" }];
  const emails = () => sent.filter((m) => m.transport === "email");

  it("alerts a build once (email and Slack) although it rolls out on both endpoints", async () => {
    await addRollout("excel-web-16.00.js", 0, removed);
    await addRollout("excel-web-16.00.js", 0, removed, { channel: "onecdn-beta", toSha: "sha-onecdn" });
    await alerts.notifyPending(20, at(60));
    expect(emails().map((m) => m.subject)).toEqual(["[high] Office.js beta: build 16.0.3 rolling out — 1 API change"]);
    expect(sent.filter((m) => m.transport === "slack")).toHaveLength(1);
    expect(sent.find((m) => m.transport === "slack").text).toContain("Office.js beta:");
  });

  it("emails a build legacy has not shown to the legacy channel's subscribers", async () => {
    await addRollout("excel-web-16.00.js", 0, removed, { channel: "onecdn-beta" });
    await alerts.notifyPending(20, at(60));
    expect(emails().map((m) => m.subject)).toEqual(["[high] Office.js onecdn-beta: build 16.0.3 rolling out — 1 API change"]);
    expect(emails()[0].html).toContain("for the beta channel");
    // One page per track: links go to /rollouts/beta/…, which shows both endpoints.
    expect(emails()[0].text).toContain("https://example.test/rollouts/beta/16.0.3");
  });

  const flags = {
    path: "office.js",
    role: "loader",
    severity: "high",
    fromFlags: { securityDefaults: null, loadMsAjax: null },
    toFlags: { securityDefaults: true, loadMsAjax: false },
    flagsChanged: true,
  };

  it("alerts loader-flags-changed even in a build that was alerted on before", async () => {
    await addRollout("excel-web-16.00.js", 0, removed);
    await alerts.notifyPending(20, at(60));
    sent.length = 0;

    // The same build, a new office.js with the OneCDN security defaults: no API change, still news.
    await addRollout("office.js", 80, [], flags);
    await alerts.notifyPending(20, at(140));
    expect(emails()).toHaveLength(1);
    expect(emails()[0].subject).toBe("[high] Office.js beta: loader security defaults changed");
    expect(emails()[0].text).toContain(
      "Office.js loader on beta changed security defaults: isOsfSecurityDefaultsEnabled unset→true, osfLoadMsAjax unset→false.",
    );
    expect(emails()[0].html).toContain("MicrosoftAjax");
    expect(sent.find((m) => m.transport === "slack").text).toContain("osfLoadMsAjax unset→false");
  });

  it("emails loader-flags-changed on OneCDN although legacy has the build", async () => {
    await addRollout("excel-web-16.00.js", 0, removed);
    await addRollout("office.js", 0, [], { ...flags, channel: "onecdn-beta" });
    await alerts.notifyPending(20, at(60));
    expect(emails().map((m) => m.subject).sort()).toEqual([
      "[high] Office.js beta: build 16.0.3 rolling out — 1 API change",
      "[high] Office.js onecdn-beta: loader security defaults changed",
    ]);
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

  it("sends one email per address per minute, even to parallel submits", async () => {
    await col.subscribers.updateOne({ token: "tok" }, { $set: { confirmationsSent: [] } });
    const submit = () =>
      app.inject({ method: "POST", url: "/api/subscribe", payload: { email: "dev@example.test" }, remoteAddress: "10.0.0.2" });
    const replies = await Promise.all([submit(), submit(), submit()]);
    expect(replies.map((r) => r.json())).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(sent).toHaveLength(1);
    expect((await col.subscribers.findOne({ token: "tok" })).confirmationsSent).toHaveLength(1);
  });

  it("allows 3 emails per address per 10 minutes and 10 per day, forgetting older ones", async () => {
    const ago = (min) => new Date(Date.now() - min * 60_000);
    let ip = 10;
    const trySend = async (history) => {
      sent.length = 0;
      await col.subscribers.updateOne({ token: "tok" }, { $set: { confirmationsSent: history } });
      // A fresh IP each time, so the per-IP limiter stays out of the way.
      await app.inject({ method: "POST", url: "/api/subscribe", payload: { email: "dev@example.test" }, remoteAddress: `10.0.1.${ip++}` });
      return sent.length;
    };
    expect(await trySend([ago(2), ago(3)])).toBe(1);
    expect(await trySend([ago(2), ago(3), ago(9)])).toBe(0);
    expect(await trySend([ago(2), ago(3), ago(11)])).toBe(1);
    const day = Array.from({ length: 10 }, (_, i) => ago(60 + i * 60));
    expect(await trySend(day)).toBe(0);
    expect(await trySend([ago(25 * 60), ...day.slice(1)])).toBe(1);
    expect((await col.subscribers.findOne({ token: "tok" })).confirmationsSent).toHaveLength(10);
  });

  it("stores where a subscriber came from and welcomes them once, with Reply-To", async () => {
    await subscribe({ email: "new@example.test", source: "Newsletter X!" });
    const fresh = await col.subscribers.findOne({ email: "new@example.test" });
    expect(fresh.source).toBe("newsletterx");
    expect(sent[0]).toMatchObject({ subject: "Confirm your silentship alerts", replyTo: "hello@example.test" });
    expect(sent[0].text).toContain("tell me what you build with Office.js");

    sent.length = 0;
    await app.inject({ method: "POST", url: `/confirm?token=${fresh.token}` });
    await app.inject({ method: "POST", url: `/confirm?token=${fresh.token}` });
    expect(sent.map((m) => m.subject)).toEqual(["You're subscribed to silentship alerts"]);
    expect(sent[0].replyTo).toBe("hello@example.test");

    await subscribe({ email: "plain@example.test" });
    expect((await col.subscribers.findOne({ email: "plain@example.test" })).source).toBe("direct");
  });

  it("sends unknown tokens to the invalid-link notice", async () => {
    const res = await app.inject({ method: "GET", url: "/confirm?token=nope" });
    expect(res.headers.location).toBe("https://example.test/?notice=invalid-link");
  });
});
