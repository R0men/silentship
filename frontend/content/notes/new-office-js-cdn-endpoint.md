---
title: What the new Office.js CDN endpoint actually changes
seoTitle: New Office.js CDN endpoint vs. appsforoffice: what changes
description: officeapis.public.onecdn.static.microsoft serves the same Office.js as appsforoffice.microsoft.com, but its loader drops MicrosoftAjax and turns on Trusted Types.
keywords: Office.js CDN, officeapis.public.onecdn.static.microsoft, appsforoffice.microsoft.com, MicrosoftAjax, Trusted Types, Office.actions.associate, isOsfSecurityDefaultsEnabled, Office add-ins
date: 2026-10-20
checked: 19 Oct 2026, build 16.0.20606.15070
---

Since late September, Microsoft's docs list `appsforoffice.microsoft.com` as a **legacy** endpoint and recommend a new one:

| | Legacy | New |
|---|---|---|
| Release | `appsforoffice.microsoft.com/lib/1/hosted/office.js` | `officeapis.public.onecdn.static.microsoft/1/office.js` |
| Preview | `appsforoffice.microsoft.com/lib/beta/hosted/office.js` | `officeapis.public.onecdn.static.microsoft/beta/office.js` |

The docs say the new endpoint "serves the same current Office.js release, but it enables additional secure defaults", without saying which defaults. So we compared the two directly.

## Short answer

- **Same build.** Both endpoints serve 16.0.20606.15070.
- **Host files are byte-identical.** `excel-win32-16.01.js`, `word-win32-16.01.js`, `outlook-win32-16.02.js`, `powerpoint-web-16.00.js` and the rest have the same SHA-256 on both. Every Office API your add-in calls comes from the same code.
- **Only `office.js` (the loader) differs**, and only by two lines at the top:

```js
isOsfSecurityDefaultsEnabled = true;
osfLoadMsAjax = false;
```

Everything else in the loader is identical. Both endpoints also sit behind the same Akamai + Azure Front Door setup, with the same caching headers.

## What `isOsfSecurityDefaultsEnabled` and `osfLoadMsAjax` do

`isOsfSecurityDefaultsEnabled` is a global, and two places read it.

**The loader.** It decides whether to turn on Trusted Types:

1. If the `<script>` tag that loads `office.js` has a `data-enable-trusted-types` attribute, that attribute decides: `"1"` means on, **any other value means off**.
2. Otherwise, `isOsfSecurityDefaultsEnabled` decides.
3. If the result is "on", the loader **does not load MicrosoftAjax** and **creates a Trusted Types policy named `officejs`**.

The flag also skips the loader's separate initialization path for Office 2013 clients, and the attribute has no say in that.

**The host files.** The files that implement the API (`excel-win32-16.01.js` and the rest) read the same global. When it is on, a function command (`ExecuteFunction` in the manifest) is looked up **only** among handlers registered with `Office.actions.associate(...)`. Without it, Office.js also falls back to a global function of the same name on `window`. That fallback is what Microsoft's checklist item about `Office.actions.associate` is about.

On the legacy endpoint none of this happens unless you opt in. On the new endpoint all of it happens by default.

Another detail: the loader decides where to fetch host files from based on its own `src`. An add-in that loads `office.js` from the new endpoint gets *all* of its Office.js files from there, not a mix.

## Who can break when switching to the new endpoint

**Add-ins that use MicrosoftAjax without knowing it.** The legacy loader quietly pulls in `MicrosoftAjax.js`, so its globals have always been there. Code (yours or a dependency's) that touches `Sys.*`, `Type.registerNamespace`, `Function.createDelegate` or `$create` works today and throws a `ReferenceError` or `TypeError` on the new endpoint. Search your bundle, not just your source:

```bash
grep -rnE '\bSys\.|Type\.registerNamespace|Function\.createDelegate|\$create\(' dist/
```

**Add-ins with function commands defined as plain globals.** If your manifest's `ExecuteFunction` points at a function you only assigned to `window` (`function onAction(event) { … }` in a script), the button does nothing on the new endpoint. Register it: `Office.actions.associate("onAction", onAction)`.

**Pages with a strict CSP or Trusted Types.** With `require-trusted-types-for 'script'`, the `officejs` policy has to be allowed (`trusted-types officejs …`), and `*.static.microsoft` has to be allowed in `script-src` and in any corporate network allow list.

## Trying the new defaults on the legacy URL

Since the two endpoints differ only by those two lines at the top of the loader, you can set the same globals yourself right before the legacy `office.js`:

```html
<script>
  var isOsfSecurityDefaultsEnabled = true;
  var osfLoadMsAjax = false;
</script>
<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
```

To turn on only part of it, the loader also reads two attributes on its own `<script>` tag: `data-enable-trusted-types="1"` (Trusted Types, no MicrosoftAjax) and `data-use-associated-actions-only="1"` (function commands only through `Office.actions.associate`). The value must be `"1"`: `"true"` turns the feature **off**.

We read this from the code and haven't tested it in every host. Treat it as a quick way to find MicrosoftAjax and function-command dependencies in a test build, not as a production setting.

## The risk worth watching

Today the only difference between the endpoints is two flags in one file. Nothing stops the same two lines from appearing in the **legacy** loader one day. Microsoft ships loader updates the way it ships everything else on this CDN: without a changelog, [edge by edge](/#rollouts). If that happens, add-ins that still depend on MicrosoftAjax or on global function commands will start failing on a growing share of loads over a day or so, without a single line of their own code changing.

[silentship](/) now watches both endpoints. A change to either flag on any endpoint is treated as **High**, and subscribers are alerted as soon as it's confirmed on two runs. You can see both endpoints side by side on every [rollout page](/rollouts/prod/16.0.20606.15070).

<!-- subscribe: Get an email if the loader's security defaults change. -->

---

*Checked on 19 Oct 2026 against build 16.0.20606.15070. Microsoft's page: [Referencing the Office JavaScript API library from its CDN](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/referencing-the-javascript-api-for-office-library-from-its-cdn). Thanks to the commenter on [office-js#6513](https://github.com/OfficeDev/office-js/issues/6513) who pointed out the new endpoint.*
