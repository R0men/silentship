---
title: "Office.js 16.0.20710: Excel data labels get allowTextToOverflow, ahead of the docs"
seoTitle: "Office.js 16.0.20710: ChartDataLabel.allowTextToOverflow and what else changed"
description: Office.js 16.0.20710 adds allowTextToOverflow to Excel chart data labels (ExcelApi 1.20, undocumented) and changes Office.ribbon.requestUpdate inside.
keywords: Office.js 16.0.20710, Excel.ChartDataLabel, ChartDataLabels, allowTextToOverflow, ExcelApi 1.20, Excel add-ins, Office.js changelog
date: 2026-11-20
checked: 20 Nov 2026, build 16.0.20710.15050
builds: 16.0.20710.15050
---

Office.js **16.0.20710.15050** finished rolling out on 20 November on both tracks and both endpoints. Two changes matter to add-in developers. Excel chart data labels get a new property, and `Office.ribbon.requestUpdate` gets a new implementation. No documented API was removed or changed its signature.

## The new property: `allowTextToOverflow`

All six Excel host files (Windows, Mac, web, iOS, Android, WinRT) now have `allowTextToOverflow` on both `Excel.ChartDataLabel` and `Excel.ChartDataLabels`. It is a regular scalar property: it has a getter and a setter, it can be loaded, and it is included in `set()` and `toJSON()`.

The property is not in the documentation yet. Neither `@types/office-js` (1.0.617) nor `@types/office-js-preview` (1.0.738) mentions it, so TypeScript won't know about it. In the code, it is guarded by a requirement check for version **1.20**. The data-label properties added in ExcelApi 1.19 (such as `geometricShapeType`) are guarded by "1.19" in the same way, so this one most likely belongs to **ExcelApi 1.20**.

From the name, it probably controls whether a label's text may run outside its shape. That is a guess until Microsoft documents it. Until then:

- don't ship code that depends on it;
- if you experiment, check for it first: `context.requirements.isSetSupported("ExcelApi", "1.20")`, or `"allowTextToOverflow" in Excel.ChartDataLabel.prototype`.

## Why our alert said "medium" for the wrong reason

Our first alert for this build was marked **medium**. Four of its fifteen changes were medium: `set()` and `toJSON()` on both data-label classes had a new body with the same signature.

We compared the old and new code of these methods. The only difference was one more name in the list of properties they handle: `allowTextToOverflow`. These methods are generated, and they list every property of their class. Whenever Microsoft adds a property, they change too, but they don't do anything new.

Starting with this build, silentship treats such a change as a side effect of the new member. It is now **low**, and the page says which member caused it. The same applies to removals: in [16.0.20619](/notes/word-lineformat-removed-20619), `Word.LineFormat.set()` and `toJSON()` changed because eight properties were removed. Those removals are still high.

With this rule, the four data-label changes are **low**. You don't need to change anything about chart data labels because of that email. The build is still **medium**, but now for a real reason that our classifier missed the first time: `Office.ribbon.requestUpdate`, below.

## Everything else is internal

With one exception (below), the other changes are in undocumented members, which add-ins shouldn't use:

| Change | Member |
|---|---|
| added | `Office.api`, `OfficeCore.ApiVersionService`, `OfficeExtension.MarkOfAi` |
| removed | `launchAgent` from `Office.ExtensionLifeCycle` and `OfficeCore.ExtensionLifeCycle`, `Excel.ActionCellValueType` |
| new body | `OfficeCore.DimeApi.launch`, `Excel.CustomFunctionProxy` |

**The exception: `Office.ribbon.requestUpdate`.** Its body changed, and its signature stayed the same. Add-ins use this documented method (RibbonApi 1.1) to show and update contextual tabs and to enable or disable ribbon buttons. Our first alert called it undocumented. The types describe it on the `Office.Ribbon` interface, while at runtime it lives at `Office.ribbon`, and our catalogue didn't connect the two. It does now, for `Office.ribbon`, `Office.context.*` and other APIs reached through an object. The rollout page lists this change as medium: same signature, possibly new behaviour. If your add-in calls `requestUpdate`, test your contextual tabs and button states on this build, and [tell us](mailto:hello@silentship.dev) if anything changed.

## How the rollout went

| | Production | Beta |
|---|---|---|
| First seen | 16 Nov, 22:30 UTC | 16 Nov, 22:30 UTC |
| Complete on OneCDN | 20 Nov, 10:50 UTC | 20 Nov, 11:40 UTC |
| Complete on legacy | 20 Nov, 10:10 UTC | 20 Nov, 06:50 UTC |

- **It overlapped with the previous build.** 16.0.20710 appeared on 16 November, before [16.0.20702](/notes/office-js-20626-20702) had finished its own rollout (17 November). Some edges went straight from 16.0.20626 to 16.0.20710. During that week, one add-in could load any of three builds, depending on which edge answered.
- **About three and a half days** from first sighting to every sampled edge, about the same as the last few builds.

Full data: [production rollout](/rollouts/prod/16.0.20710.15050) · [beta rollout](/rollouts/beta/16.0.20710.15050) · [`Excel.ChartDataLabel`](/reference/Excel.ChartDataLabel).

<!-- subscribe: Get an email when Office.js changes an API your add-in uses. -->

---

*Checked on 20 Nov 2026 against build 16.0.20710.15050. When Microsoft documents `allowTextToOverflow`, this note will be updated.*
