export const en = {
  // ── General ────────────────────────────────────────────────────────────────
  cancel: "Cancel",
  save: "Save",
  close: "Close",
  confirm: "Confirm",
  loading: "Loading…",
  error: "Error",
  optional: "optional",
  show: "Show",
  hide: "Hide",

  // ── Toolbar / main actions ─────────────────────────────────────────────────
  openFolder: "Open Folder",
  refresh: "Refresh",
  pull: "Pull",
  push: "Push",
  commit: "Commit",
  stash: "Stash",
  fetch: "Fetch",
  rebase: "Rebase",
  reset: "Reset",
  merge: "Merge",
  clone: "Clone",
  settings: "Settings",
  gitAccounts: "Git Accounts",

  // ── Sidebar / panels ───────────────────────────────────────────────────────
  gitGraph: "Git Graph",
  localChanges: "Local Changes",
  uncommittedChanges: "Uncommitted Changes",
  branches: "Branches",
  pullRequests: "Pull Requests",
  mergeRequests: "Merge Requests",
  noOpenPullRequests: "No open pull requests",
  noOpenMergeRequests: "No open merge requests",
  refreshPullRequests: "Refresh pull requests",
  draft: "Draft",

  // ── Welcome screen ─────────────────────────────────────────────────────────
  welcomeTitle: "Welcome to Arbor",
  welcomeSubtitle: "Git repository client",
  welcomeOpen: "Open a repository to get started",

  // ── Git Graph ──────────────────────────────────────────────────────────────
  graphColHash: "Hash",
  graphColAuthor: "Author",
  graphColRefs: "Refs",
  graphColSubject: "Subject",
  graphNoHistory: "No commit history found.",

  // ── Commit / status ────────────────────────────────────────────────────────
  commitMsgPlaceholder: "Commit message…",
  commitAll: "Commit All",
  stageAll: "Stage All",
  unstageAll: "Unstage All",
  discardAll: "Discard All",
  discardAllConfirm: "Are you sure you want to discard all changes?",
  noChanges: "No changes",
  staged: "Staged",
  unstaged: "Unstaged",

  // ── Clone Modal ────────────────────────────────────────────────────────────
  cloneRepository: "Clone Repository",
  cloneSearchPlaceholder: (username: string) => `Search ${username}'s repositories…`,
  cloneDestPlaceholder: "Choose destination folder…",
  cloneNoProviders: "No Git accounts connected.",
  cloneNoProvidersHint: "Go to Git Accounts to add a GitHub, GitLab, or Gitee account first.",
  cloneNoRepos: "No repositories found for this account.",
  cloneNoReposQuery: (q: string) => `No repositories found matching "${q}".`,
  cloneLoading: "Loading repositories…",
  clonePrivate: "Private",
  clonePublic: "Public",
  cloneUpdated: (date: string) => `Updated ${date}`,
  cloneInto: (path: string) => `Will clone into: ${path}`,
  cloneSuccess: (path: string) => `Cloned into ${path}`,
  cloneButton: "Clone",

  // ── Providers Modal ────────────────────────────────────────────────────────
  gitAccountsTitle: "Git Accounts",
  addAccount: "Add Account",
  connectedAccounts: "Connected Accounts",
  noAccountsYet: "No accounts connected yet.",
  noAccountsHint: "Sign in with OAuth or a Personal Access Token to clone private repos and view pull requests.",
  removeAccount: "Remove account",
  host: "Host",
  label: "Label",
  personalAccessToken: "Personal Access Token",
  generateToken: "Generate",
  oauthHint: "Your browser will open to authorize Arbor. No credentials are stored by the app.",
  oauthWaiting: "Browser opened — complete authorization, then return here…",
  signInWith: (provider: string) => `Sign in with ${provider}`,
  waitingForBrowser: "Waiting for browser…",
  verifyAndAdd: "Verify & Add",
  verifying: "Verifying…",
  accessToken: "Access Token",

  // ── Settings Modal ─────────────────────────────────────────────────────────
  settingsTitle: "Settings",
  settingsLanguage: "Language",
  settingsLanguageHint: "UI display language",
  settingsAppearance: "Appearance",
  settingsGitBehaviour: "Git Behaviour",
  settingsEditorTools: "Editor & Tools",
  settingsNotifications: "Notifications",
  settingsTheme: "Theme",
  settingsThemeHint: "Controls colour scheme across the app",
  settingsThemeSystem: "System default",
  settingsThemeLight: "Light",
  settingsThemeDark: "Dark",
  settingsFontSize: "Font Size",
  settingsFontSizePx: (v: number) => `${v} px`,
  settingsGlassIntensity: "Glass Intensity",
  settingsGlassHint: "Blur & transparency of panel backgrounds",
  settingsGlassNone: "None (solid)",
  settingsGlassLow: "Low",
  settingsGlassMedium: "Medium",
  settingsGlassHigh: "High",
  settingsPullStrategy: "Pull Strategy",
  settingsPullHint: "Default strategy used when pulling",
  settingsPullMerge: "Merge",
  settingsPullRebase: "Rebase",
  settingsPullFF: "Fast-forward only",
  settingsAutoPrune: "Auto Prune on Fetch",
  settingsAutoPruneHint: "Pass --prune when fetching remote",
  settingsCommitTemplate: "Commit Message Template",
  settingsCommitTemplateHint: "Pre-filled message when committing",
  settingsCommitTemplatePlaceholder: "e.g. feat: ",
  settingsExternalEditor: "External Editor",
  settingsExternalEditorHint: "CLI command used to open files",
  settingsExternalEditorPlaceholder: "e.g. code, cursor, vim",
  settingsExternalDiff: "External Diff Tool",
  settingsExternalDiffHint: "Leave blank to use built-in diff viewer",
  settingsExternalDiffPlaceholder: "e.g. vimdiff, meld, opendiff",
  settingsFileWatcher: "File Watcher",
  settingsFileWatcherHint: "Automatically refresh when files change on disk",
  settingsWatcherDebounce: "Watcher Debounce",
  settingsWatcherDebounceHint: (v: number) => `${v} ms — wait this long after last change`,
  settingsNotifyPush: "Notify on Push",
  settingsNotifyPushHint: "Show a notification when push succeeds",
  settingsNotifyPull: "Notify on Pull",
  settingsNotifyPullHint: "Show a notification when pull succeeds",
  settingsResetDefaults: "Reset to defaults",
  settingsResetConfirm: "Reset all settings to defaults?",

  // ── Conflict Modal ─────────────────────────────────────────────────────────
  resolveConflicts: "Resolve Conflicts",
  conflictedFiles: (n: number) => `Conflicted Files (${n})`,
  allConflictsResolved: "All conflicts resolved!",
  visualMode: "Visual Mode",
  rawEditor: "Raw Editor",
  saveAndMarkResolved: "Save & Mark Resolved",
  acceptCurrent: "Accept Current",
  acceptIncoming: "Accept Incoming",
  acceptBoth: "Accept Both",
  conflictsResolved: "Conflicts Resolved",
  conflictsResolvedInfo: "All conflicted files have been resolved and staged. You can now commit the merge.",
  mergeCommitMessage: "Merge Commit Message",
  commitMerge: "Commit Merge",

  // ── Local Changes Modal ────────────────────────────────────────────────────
  localChangesTitle: "Local Changes",
  autoStashAndApply: "Auto Stash and Apply",
  autoStashAndApplyDesc: "Conflicts may occur while restoring the stash.",
  discardOverwritten: "Discard Overwritten Changes",
  discardOverwrittenDesc: "Only discard files that block the operation.",
  discardAllChanges: "Discard All Changes",
  discardAllChangesDesc: "Tracked local changes will be reset.",

  // ── Time ───────────────────────────────────────────────────────────────────
  timeJustNow: "just now",
  timeMinutesAgo: (n: number) => `${n}m ago`,
  timeHoursAgo: (n: number) => `${n}h ago`,
  timeDaysAgo: (n: number) => `${n}d ago`,
};

export type Translations = {
  // General
  cancel: string;
  save: string;
  close: string;
  confirm: string;
  loading: string;
  error: string;
  optional: string;
  show: string;
  hide: string;

  // Toolbar / main actions
  openFolder: string;
  refresh: string;
  pull: string;
  push: string;
  commit: string;
  stash: string;
  fetch: string;
  rebase: string;
  reset: string;
  merge: string;
  clone: string;
  settings: string;
  gitAccounts: string;

  // Sidebar / panels
  gitGraph: string;
  localChanges: string;
  uncommittedChanges: string;
  branches: string;
  pullRequests: string;
  mergeRequests: string;
  noOpenPullRequests: string;
  noOpenMergeRequests: string;
  refreshPullRequests: string;
  draft: string;

  // Welcome screen
  welcomeTitle: string;
  welcomeSubtitle: string;
  welcomeOpen: string;

  // Git Graph
  graphColHash: string;
  graphColAuthor: string;
  graphColRefs: string;
  graphColSubject: string;
  graphNoHistory: string;

  // Commit / status
  commitMsgPlaceholder: string;
  commitAll: string;
  stageAll: string;
  unstageAll: string;
  discardAll: string;
  discardAllConfirm: string;
  noChanges: string;
  staged: string;
  unstaged: string;

  // Clone Modal
  cloneRepository: string;
  cloneSearchPlaceholder: (username: string) => string;
  cloneDestPlaceholder: string;
  cloneNoProviders: string;
  cloneNoProvidersHint: string;
  cloneNoRepos: string;
  cloneNoReposQuery: (q: string) => string;
  cloneLoading: string;
  clonePrivate: string;
  clonePublic: string;
  cloneUpdated: (date: string) => string;
  cloneInto: (path: string) => string;
  cloneSuccess: (path: string) => string;
  cloneButton: string;

  // Providers Modal
  gitAccountsTitle: string;
  addAccount: string;
  connectedAccounts: string;
  noAccountsYet: string;
  noAccountsHint: string;
  removeAccount: string;
  host: string;
  label: string;
  personalAccessToken: string;
  generateToken: string;
  oauthHint: string;
  oauthWaiting: string;
  signInWith: (provider: string) => string;
  waitingForBrowser: string;
  verifyAndAdd: string;
  verifying: string;
  accessToken: string;

  // Settings Modal
  settingsTitle: string;
  settingsLanguage: string;
  settingsLanguageHint: string;
  settingsAppearance: string;
  settingsGitBehaviour: string;
  settingsEditorTools: string;
  settingsNotifications: string;
  settingsTheme: string;
  settingsThemeHint: string;
  settingsThemeSystem: string;
  settingsThemeLight: string;
  settingsThemeDark: string;
  settingsFontSize: string;
  settingsFontSizePx: (v: number) => string;
  settingsGlassIntensity: string;
  settingsGlassHint: string;
  settingsGlassNone: string;
  settingsGlassLow: string;
  settingsGlassMedium: string;
  settingsGlassHigh: string;
  settingsPullStrategy: string;
  settingsPullHint: string;
  settingsPullMerge: string;
  settingsPullRebase: string;
  settingsPullFF: string;
  settingsAutoPrune: string;
  settingsAutoPruneHint: string;
  settingsCommitTemplate: string;
  settingsCommitTemplateHint: string;
  settingsCommitTemplatePlaceholder: string;
  settingsExternalEditor: string;
  settingsExternalEditorHint: string;
  settingsExternalEditorPlaceholder: string;
  settingsExternalDiff: string;
  settingsExternalDiffHint: string;
  settingsExternalDiffPlaceholder: string;
  settingsFileWatcher: string;
  settingsFileWatcherHint: string;
  settingsWatcherDebounce: string;
  settingsWatcherDebounceHint: (v: number) => string;
  settingsNotifyPush: string;
  settingsNotifyPushHint: string;
  settingsNotifyPull: string;
  settingsNotifyPullHint: string;
  settingsResetDefaults: string;
  settingsResetConfirm: string;

  // Conflict Modal
  resolveConflicts: string;
  conflictedFiles: (n: number) => string;
  allConflictsResolved: string;
  visualMode: string;
  rawEditor: string;
  saveAndMarkResolved: string;
  acceptCurrent: string;
  acceptIncoming: string;
  acceptBoth: string;
  conflictsResolved: string;
  conflictsResolvedInfo: string;
  mergeCommitMessage: string;
  commitMerge: string;

  // Local Changes Modal
  localChangesTitle: string;
  autoStashAndApply: string;
  autoStashAndApplyDesc: string;
  discardOverwritten: string;
  discardOverwrittenDesc: string;
  discardAllChanges: string;
  discardAllChangesDesc: string;

  // Time
  timeJustNow: string;
  timeMinutesAgo: (n: number) => string;
  timeHoursAgo: (n: number) => string;
  timeDaysAgo: (n: number) => string;
};
