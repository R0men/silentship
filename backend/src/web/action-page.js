import { html } from "../util/html.js";

/**
 * The page behind the confirm and unsubscribe links in emails. Corporate mail gateways (Defender Safe
 * Links, Mimecast, …) open every link in a message to scan it, so a GET must never change a subscription:
 * it only shows this page, and the button POSTs back to the same URL.
 */
export function actionPage({ title, text, button, action }) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>${title} — silentship</title>
        <style>
          :root {
            color-scheme: dark;
          }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #060607;
            color: #f4f4f5;
            font:
              400 15px/1.6 system-ui,
              -apple-system,
              "Segoe UI",
              sans-serif;
          }
          main {
            max-width: 420px;
            padding: 32px 16px;
          }
          h1 {
            margin: 0 0 8px;
            font-size: 24px;
            letter-spacing: -0.02em;
          }
          p {
            margin: 0 0 24px;
            color: #8d8f98;
          }
          button {
            padding: 12px 22px;
            border: 0;
            border-radius: 8px;
            background: #f4f4f5;
            color: #060607;
            font: 600 14px/1 system-ui, sans-serif;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>${title}</h1>
          <p>${text}</p>
          <form method="post" action="${action}">
            <button type="submit">${button}</button>
          </form>
        </main>
      </body>
    </html>`.value;
}
