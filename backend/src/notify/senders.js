import { config } from "../config.js";

export async function postSlack(text, webhookUrl = config.slackWebhookUrl) {
  if (!webhookUrl) return;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Slack webhook HTTP ${res.status}`);
}

/**
 * Transactional email via Brevo (POST /v3/smtp/email).
 * Without BREVO_API_KEY the message is logged instead (development).
 */
export async function sendEmail(email) {
  if (!config.brevoApiKey) {
    console.log(`[email:dry-run] to=${email.to} subject=${JSON.stringify(email.subject)}\n${email.text}`);
    return;
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": config.brevoApiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: config.mailFromName, email: config.mailFromEmail },
      to: [{ email: email.to }],
      ...(email.replyTo ? { replyTo: { email: email.replyTo } } : {}),
      subject: email.subject,
      htmlContent: email.html,
      textContent: email.text,
      ...(email.headers ? { headers: email.headers } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Brevo HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
