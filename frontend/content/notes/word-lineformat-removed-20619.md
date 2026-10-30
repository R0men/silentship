---
title: Word.LineFormat lost 8 documented properties in Office.js 16.0.20619
seoTitle: Word.LineFormat properties removed in Office.js 16.0.20619
description: Office.js 16.0.20619 removed backgroundColor, pattern and six arrowhead properties from Word.LineFormat. Microsoft still documents them as WordApiDesktop 1.3.
keywords: Word.LineFormat, WordApiDesktop 1.3, Office.js 16.0.20619, beginArrowheadStyle, endArrowheadStyle, Word add-ins, Office.js breaking change, removed API
date: 2026-10-30
checked: 30 Oct 2026, build 16.0.20619.15190
builds: 16.0.20619.15190
---

Office.js **16.0.20619.15190** finished rolling out on 30 October. On every Word platform it removed eight properties from `Word.LineFormat`, the object behind the outline of shapes and text boxes:

| Removed from `Word.LineFormat` | Still there |
|---|---|
| `backgroundColor` | `dashStyle` |
| `pattern` | `foregroundColor` |
| `beginArrowheadLength`, `beginArrowheadStyle`, `beginArrowheadWidth` | `weight`, `style`, `transparency` |
| `endArrowheadLength`, `endArrowheadStyle`, `endArrowheadWidth` | `isVisible`, `insetPen` |

`set()` and `toJSON()` on the same class changed in the same build, which is consistent with the properties being taken out rather than moved.

## Why this matters: they are documented as production APIs

All eight properties belong to the **WordApiDesktop 1.3** requirement set. Microsoft's [requirement set page](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-desktop-1.3-requirement-set) lists every one of them and describes WordApiDesktop 1.3 as production for Word on **Windows and Mac**. The [`Word.LineFormat` reference](https://learn.microsoft.com/en-us/javascript/api/word/word.lineformat) still lists them too, with no deprecation note, at the time of writing.

The change reached `word-win32-16.01.js` and `word-mac-16.00.js` on the production CDN, so add-ins running in desktop Word are affected, not only iOS or web.

## How we know it's a real removal

The API diff comes from reflection, so we also checked the archived files directly. In every Word host file of the new build:

- `beginArrowheadLength` no longer appears anywhere;
- `dashStyle`, a sibling property of the same class, is still there;
- the file got about 1.1 KB **smaller**, while host files for other apps in the same build grew by about 1.8 KB.

So the code for these properties was cut out of Word's Office.js files. It wasn't renamed or hidden somewhere reflection can't see.

## What it probably means for your add-in

We haven't tested runtime behaviour in every Word version, so treat this as what to look for, not a guarantee:

- **Reading** (`shape.lineFormat.beginArrowheadStyle` after `load`) now gives `undefined` instead of a value.
- **Writing** (`shape.lineFormat.pattern = "Percent50"`) is the dangerous case. Office.js properties queue a change through a setter on the class. With the property gone, the assignment just creates a plain JavaScript property: no error, and nothing changes in the document.
- **`lineFormat.set({ endArrowheadStyle: ... })`** goes through the changed `set()`, so it may ignore the key or throw, depending on the host.

To find affected code, search your source and bundle:

```bash
grep -rnE "(begin|end)Arrowhead(Length|Style|Width)|lineFormat\.(pattern|backgroundColor)" src/ dist/
```

If you depend on these properties, check for them before use instead of trusting the requirement set check alone:

```js
const supported = "beginArrowheadStyle" in Word.LineFormat.prototype;
```

## How the rollout went

| | Production | Beta |
|---|---|---|
| First seen | 26 Oct, 18:50 UTC | 26 Oct, 18:51 UTC |
| Complete on OneCDN | 30 Oct, 01:50 UTC | 30 Oct, 00:20 UTC |
| Complete on legacy | 30 Oct, 03:10 UTC | 30 Oct, 06:20 UTC |

- **Over three days.** For most of 27 October the new build sat at about 1% of sampled edges. Then it moved again. During those days the same add-in in the same Word could load the old or the new build depending on which CDN edge answered, so a shape-formatting bug could appear and disappear between reloads.
- **The two endpoints rolled out separately.** OneCDN (`officeapis.public.onecdn.static.microsoft`) finished first on both tracks, hours ahead of the legacy `appsforoffice.microsoft.com`. Once complete, the host files on both endpoints were byte-identical.
- **Not a one-off.** Word's API surface has changed two weeks in a row: in 16.0.20612 the preview `SensitivityLabelUpdateResult` was renamed to `SensitivityLabelUpdateStatus` (following Excel and PowerPoint the week before), and now this.

The other changes in this build are internal and don't affect add-ins: an undocumented `OfficeCore.FlightingService.getABConfigs` and a new `immersiveReader` value in the undocumented `OneNote.ServiceId`.

Full data: [production rollout](/rollouts/prod/16.0.20619.15190) · [beta rollout](/rollouts/beta/16.0.20619.15190).

<!-- subscribe: Get an email when a documented Office.js API is removed. -->

---

*Checked on 30 Oct 2026 against build 16.0.20619.15190. If Microsoft restores these properties or updates the documentation, this note will be updated.*
