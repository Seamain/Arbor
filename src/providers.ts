// ─── Git Provider types & persistence ───────────────────────────────────────

export type ProviderKind = "github" | "gitlab" | "gitee";

export interface GitProvider {
  id: string;           // uuid
  kind: ProviderKind;
  label: string;        // user-visible nickname, e.g. "GitHub (work)"
  host: string;         // e.g. "github.com", "gitlab.myco.com", "gitee.com"
  token: string;        // Personal Access Token or OAuth token
  oauth?: boolean;      // true = token is OAuth (use Bearer), false/undefined = PAT
  // Populated after token verification:
  username?: string;
  avatarUrl?: string;
  name?: string;        // display name from provider profile
}

export interface ProviderRepo {
  id: number | string;
  fullName: string;     // "owner/repo"
  description: string;
  private: boolean;
  cloneUrl: string;     // HTTPS clone URL
  webUrl: string;       // browser URL
  updatedAt: string;
}

export interface PullRequest {
  id: number | string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  author: string;
  authorAvatarUrl?: string;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
  createdAt: string;
  updatedAt: string;
  draft: boolean;
}

const PROVIDERS_KEY = "arbor-providers";

export function loadProviders(): GitProvider[] {
  try {
    const raw = localStorage.getItem(PROVIDERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as GitProvider[];
  } catch {
    return [];
  }
}

export function saveProviders(providers: GitProvider[]): void {
  localStorage.setItem(PROVIDERS_KEY, JSON.stringify(providers));
}

// ─── API helpers ─────────────────────────────────────────────────────────────

function apiBase(p: GitProvider): string {
  switch (p.kind) {
    case "github": return `https://api.${p.host}`;
    case "gitlab": return `https://${p.host}/api/v4`;
    case "gitee":  return `https://gitee.com/api/v5`;
  }
}

function authHeaders(p: GitProvider): Record<string, string> {
  switch (p.kind) {
    case "github": return { Authorization: `token ${p.token}` };
    case "gitlab":
      // OAuth tokens use Bearer; PATs use PRIVATE-TOKEN
      return p.oauth
        ? { Authorization: `Bearer ${p.token}` }
        : { "PRIVATE-TOKEN": p.token };
    case "gitee":  return {};  // gitee uses ?access_token= query param
  }
}

function giteeTokenParam(p: GitProvider): string {
  return p.kind === "gitee" ? `?access_token=${encodeURIComponent(p.token)}` : "";
}

/** Verify token and return enriched provider (username, avatarUrl, name). */
export async function verifyProvider(p: GitProvider): Promise<GitProvider> {
  const base = apiBase(p);
  const headers = { "Content-Type": "application/json", ...authHeaders(p) };

  if (p.kind === "github") {
    const res = await fetch(`${base}/user`, { headers });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const data = await res.json();
    return { ...p, username: data.login, avatarUrl: data.avatar_url, name: data.name ?? data.login };
  }

  if (p.kind === "gitlab") {
    const res = await fetch(`${base}/user`, { headers });
    if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
    const data = await res.json();
    return { ...p, username: data.username, avatarUrl: data.avatar_url, name: data.name ?? data.username };
  }

  // gitee
  const res = await fetch(`${base}/user${giteeTokenParam(p)}`, { headers });
  if (!res.ok) throw new Error(`Gitee API error: ${res.status}`);
  const data = await res.json();
  return { ...p, username: data.login, avatarUrl: data.avatar_url, name: data.name ?? data.login };
}

/** Search repos for the authenticated user (own + starred keyword search). */
export async function searchRepos(p: GitProvider, query: string): Promise<ProviderRepo[]> {
  const base = apiBase(p);
  const headers = { "Content-Type": "application/json", ...authHeaders(p) };
  const q = encodeURIComponent(query);

  if (p.kind === "github") {
    const url = query
      ? `${base}/search/repositories?q=${q}+user:${p.username}&sort=updated&per_page=30`
      : `${base}/user/repos?sort=updated&per_page=50`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const data = await res.json();
    const items = query ? data.items : data;
    return (items as Record<string, unknown>[]).map((r) => ({
      id: r.id as number,
      fullName: r.full_name as string,
      description: (r.description as string) ?? "",
      private: r.private as boolean,
      cloneUrl: r.clone_url as string,
      webUrl: r.html_url as string,
      updatedAt: r.updated_at as string,
    }));
  }

  if (p.kind === "gitlab") {
    const url = query
      ? `${base}/projects?search=${q}&order_by=last_activity_at&per_page=30&membership=true`
      : `${base}/projects?order_by=last_activity_at&per_page=50&membership=true`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
    const items = await res.json() as Record<string, unknown>[];
    return items.map((r) => ({
      id: r.id as number,
      fullName: r.path_with_namespace as string,
      description: (r.description as string) ?? "",
      private: r.visibility === "private",
      cloneUrl: r.http_url_to_repo as string,
      webUrl: r.web_url as string,
      updatedAt: r.last_activity_at as string,
    }));
  }

  // gitee
  const url = query
    ? `${base}/repos/search${giteeTokenParam(p)}&q=${q}&sort=updated&limit=30`
    : `${base}/user/repos${giteeTokenParam(p)}&sort=updated&per_page=50`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Gitee API error: ${res.status}`);
  const items = await res.json() as Record<string, unknown>[];
  return items.map((r) => ({
    id: r.id as number,
    fullName: r.full_name as string,
    description: (r.description as string) ?? "",
    private: r.private as boolean,
    cloneUrl: r.clone_url as string,
    webUrl: r.html_url as string,
    updatedAt: r.updated_at as string,
  }));
}

/** Fetch open PRs / MRs for a given repo path ("owner/repo"). */
export async function fetchPullRequests(p: GitProvider, repoFullName: string): Promise<PullRequest[]> {
  const base = apiBase(p);
  const headers = { "Content-Type": "application/json", ...authHeaders(p) };

  if (p.kind === "github") {
    const [owner, repo] = repoFullName.split("/");
    const res = await fetch(`${base}/repos/${owner}/${repo}/pulls?state=open&per_page=30`, { headers });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const items = await res.json() as Record<string, unknown>[];
    return items.map((r) => ({
      id: r.id as number,
      number: r.number as number,
      title: r.title as string,
      state: "open" as const,
      author: (r.user as Record<string, string>).login,
      authorAvatarUrl: (r.user as Record<string, string>).avatar_url,
      sourceBranch: (r.head as Record<string, string>).ref,
      targetBranch: (r.base as Record<string, string>).ref,
      webUrl: r.html_url as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      draft: r.draft as boolean,
    }));
  }

  if (p.kind === "gitlab") {
    const encoded = encodeURIComponent(repoFullName);
    const res = await fetch(`${base}/projects/${encoded}/merge_requests?state=opened&per_page=30`, { headers });
    if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
    const items = await res.json() as Record<string, unknown>[];
    return items.map((r) => ({
      id: r.id as number,
      number: r.iid as number,
      title: r.title as string,
      state: "open" as const,
      author: (r.author as Record<string, string>).username,
      authorAvatarUrl: (r.author as Record<string, string>).avatar_url,
      sourceBranch: r.source_branch as string,
      targetBranch: r.target_branch as string,
      webUrl: r.web_url as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      draft: (r.title as string).startsWith("Draft:") || (r.title as string).startsWith("WIP:"),
    }));
  }

  // gitee
  const [owner, repo] = repoFullName.split("/");
  const res = await fetch(
    `${base}/repos/${owner}/${repo}/pulls${giteeTokenParam(p)}&state=open&per_page=30`,
    { headers }
  );
  if (!res.ok) throw new Error(`Gitee API error: ${res.status}`);
  const items = await res.json() as Record<string, unknown>[];
  return items.map((r) => ({
    id: r.id as number,
    number: r.number as number,
    title: r.title as string,
    state: "open" as const,
    author: (r.user as Record<string, string>).login,
    authorAvatarUrl: (r.user as Record<string, string>).avatar_url,
    sourceBranch: (r.head as Record<string, unknown> & { ref: string }).ref,
    targetBranch: (r.base as Record<string, unknown> & { ref: string }).ref,
    webUrl: r.html_url as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    draft: false,
  }));
}

/** Given a git remote URL, find a matching connected provider and return
 *  the repo's fullName (owner/repo). Returns null if no match. */
export function matchRemoteToProvider(
  remoteUrl: string,
  providers: GitProvider[]
): { provider: GitProvider; repoFullName: string } | null {
  // Normalise SSH → HTTPS style for matching
  // git@github.com:owner/repo.git  →  github.com/owner/repo
  // https://github.com/owner/repo.git  →  github.com/owner/repo
  const normalise = (url: string): string =>
    url
      .replace(/^git@([^:]+):/, "https://$1/")
      .replace(/\.git$/, "")
      .replace(/^https?:\/\/[^@]+@/, "https://");

  const norm = normalise(remoteUrl);

  for (const p of providers) {
    if (norm.includes(p.host)) {
      // Extract "owner/repo" portion after the host
      const idx = norm.indexOf(p.host);
      const rest = norm.slice(idx + p.host.length).replace(/^\//, "");
      if (rest) return { provider: p, repoFullName: rest };
    }
  }
  return null;
}

/** Build a "Create PR" URL for a given provider + repo + branch. */
export function createPrUrl(p: GitProvider, repoFullName: string, branch: string): string {
  if (p.kind === "github") {
    return `https://${p.host}/${repoFullName}/compare/${branch}?expand=1`;
  }
  if (p.kind === "gitlab") {
    return `https://${p.host}/${repoFullName}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(branch)}`;
  }
  // gitee
  const [owner, repo] = repoFullName.split("/");
  return `https://gitee.com/${owner}/${repo}/compare/master...${encodeURIComponent(branch)}`;
}

/** Build an authenticated HTTPS clone URL (embeds token for private repos). */
export function authenticatedCloneUrl(p: GitProvider, cloneUrl: string): string {
  if (!p.token) return cloneUrl;
  try {
    const u = new URL(cloneUrl);
    if (p.kind === "github" || p.kind === "gitlab") {
      u.username = p.username ?? "oauth2";
      u.password = p.token;
    } else {
      // gitee uses ?access_token=
      u.searchParams.set("access_token", p.token);
    }
    return u.toString();
  } catch {
    return cloneUrl;
  }
}

export const PROVIDER_META: Record<ProviderKind, { label: string; defaultHost: string; color: string; tokenUrl: string }> = {
  github: {
    label: "GitHub",
    defaultHost: "github.com",
    color: "#24292f",
    tokenUrl: "https://github.com/settings/tokens/new?scopes=repo,read:user",
  },
  gitlab: {
    label: "GitLab",
    defaultHost: "gitlab.com",
    color: "#fc6d26",
    tokenUrl: "https://gitlab.com/-/user_settings/personal_access_tokens",
  },
  gitee: {
    label: "Gitee",
    defaultHost: "gitee.com",
    color: "#c71d23",
    tokenUrl: "https://gitee.com/profile/personal_access_tokens",
  },
};
