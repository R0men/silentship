/**
 * The Office application an API path or type belongs to: the /reference filter and the subscriber's
 * "Applications" setting share this rule. Host namespaces are their own application; Outlook's API lives in
 * the Office namespace (`Office.context.mailbox`, `Office.MailboxEnums`); everything else (`Office`,
 * `OfficeExtension`, `OfficeCore`, `OSF`) is the Common API every host shares.
 */
export const HOST_APPS = ["Excel", "Word", "PowerPoint", "Outlook", "OneNote", "Visio"];
export const COMMON_APP = "Common";
/** In display order. */
export const APPS = [...HOST_APPS, COMMON_APP];

const OUTLOOK = /^Office\.(?:MailboxEnums|Mailbox|context\.mailbox)(?:\.|$)/;

export function appOf(path) {
  const ns = String(path).split(".")[0];
  if (HOST_APPS.includes(ns)) return ns;
  if (OUTLOOK.test(path)) return "Outlook";
  return COMMON_APP;
}

export const appLabel = (app) => (app === COMMON_APP ? "Common API" : app);

/** Changes in the chosen applications; no choice (an empty list) keeps every change. */
export function changesInApps(apps, changes) {
  if (!apps?.length) return changes;
  return changes.filter((c) => apps.includes(appOf(c.path)));
}
