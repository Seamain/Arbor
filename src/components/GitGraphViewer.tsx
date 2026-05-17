import React, { useMemo, useRef, useEffect, useState } from "react";
import { useT } from "../i18n";

interface GitGraphViewerProps {
  logs: string[];
  headOid: string;
  headBranch: string;
}

interface Commit {
  hash: string;
  parents: string[];
  subject: string;
  author: string;
  email: string;
  date: string;
  refs: string;
}

interface CommitRow extends Commit {
  col: number;
  color: string;
  lanesAfter: (string | null)[];
  laneColors: string[];
}

const COLORS = [
  "#0A84FF", "#30D158", "#FF9F0A", "#BF5AF2",
  "#FF375F", "#64D2FF", "#FF6B35", "#FF2D55",
];
const ROW_H = 48;
const COL_W = 20;
const DOT_R = 4;
const HASH_W = 72;
const AUTHOR_W = 180;
const REFS_W = 220;

// ── helpers ──────────────────────────────────────────────────────────────────
function parseLog(logs: string[]): Commit[] {
  return logs.flatMap(line => {
    const parts = line.split("~|~");
    if (parts.length < 4) return [];
    return [{
      hash:    parts[0].trim(),
      parents: parts[1].trim() ? parts[1].trim().split(" ") : [],
      subject: parts[2].trim() || "(no message)",
      author:  parts[3].trim() || "Unknown",
      date:    parts[4]?.trim() ?? "",
      refs:    parts[5]?.trim() ?? "",
      email:   parts[6]?.trim() ?? "",
    }];
  });
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 52%, 44%)`;
}

function AuthorAvatar({ name, email, size = 26 }: { name: string; email: string; size?: number }) {
  const initials = name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const bg = stringToColor(email || name);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: bg, color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.37, fontWeight: 700, flexShrink: 0,
      letterSpacing: 0,
      boxShadow: `0 1px 3px ${bg}55`,
    }}>
      {initials}
    </div>
  );
}

function layoutCommits(commits: Commit[]): CommitRow[] {
  const lanes: (string | null)[] = [];
  const laneColors: string[] = [];
  const rows: CommitRow[] = [];

  function findOrAlloc(hash: string): number {
    let col = lanes.indexOf(hash);
    if (col !== -1) return col;
    col = lanes.indexOf(null);
    if (col === -1) col = lanes.length;
    lanes[col] = hash;
    laneColors[col] = COLORS[col % COLORS.length];
    return col;
  }

  for (const commit of commits) {
    let col = lanes.indexOf(commit.hash);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) col = lanes.length;
      laneColors[col] = COLORS[col % COLORS.length];
    }
    const color = laneColors[col];
    lanes[col] = null;

    if (commit.parents.length === 0) {
      // root
    } else if (commit.parents.length === 1) {
      const p = commit.parents[0];
      if (lanes.indexOf(p) === -1) lanes[col] = p;
    } else {
      const [first, ...rest] = commit.parents;
      if (lanes.indexOf(first) === -1) lanes[col] = first;
      for (const p of rest) {
        if (lanes.indexOf(p) === -1) findOrAlloc(p);
      }
    }

    rows.push({ ...commit, col, color, lanesAfter: [...lanes], laneColors: [...laneColors] });
  }
  return rows;
}

function parseRefs(refs: string) {
  if (!refs) return { branches: [], tags: [], head: false, headBranch: "" };
  const cleaned = refs.replace(/^\(|\)$/g, "");
  const parts = cleaned.split(",").map(s => s.trim()).filter(Boolean);
  const branches: string[] = [];
  const tags: string[] = [];
  let head = false;
  let headBranch = "";
  for (const p of parts) {
    if (p === "HEAD") { head = true; continue; }
    if (p.startsWith("HEAD -> ")) { head = true; headBranch = p.slice(8); branches.push(headBranch); continue; }
    if (p.startsWith("tag: ")) { tags.push(p.slice(5)); continue; }
    if (p === "origin/HEAD" || p.endsWith("/HEAD")) continue;
    branches.push(p);
  }
  return { branches, tags, head, headBranch };
}

// ── theme hook ────────────────────────────────────────────────────────────────
function useDark() {
  const [dark, setDark] = useState(() =>
    document.documentElement.getAttribute("data-theme") === "dark"
  );
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setDark(document.documentElement.getAttribute("data-theme") === "dark");
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// ── main component ────────────────────────────────────────────────────────────
export function GitGraphViewer({ logs, headOid, headBranch }: GitGraphViewerProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const dark = useDark();

  // Derived colour tokens — everything in one place
  const c = useMemo(() => dark ? {
    headerBg:        "rgba(18, 24, 32, 0.98)",
    headerBorder:    "rgba(255,255,255,0.07)",
    headerText:      "#4e6070",
    rowBorder:       "rgba(255,255,255,0.05)",
    rowEven:         "rgba(255,255,255,0.03)",
    rowHead:         "rgba(10,132,255,0.10)",
    rowHover:        "rgba(10,132,255,0.13)",
    dotInner:        "#1a2130",
    authorName:      "#c8d8e8",
    authorDate:      "#4e6070",
    subjectDefault:  "#b8c8d8",
    subjectHead:     "#7dc4ff",
    hashBadgeBorder: (col: string) => `${col}35`,
    hashBadgeBg:     (col: string) => `${col}20`,
    headBadgeBg:     "#0d1825",
    headBadgeColor:  "#e2ecf8",
    branchBg:        "rgba(10,132,255,0.18)",
    branchColor:     "#5aadff",
    branchBorder:    "rgba(10,132,255,0.32)",
    tagBg:           "rgba(234,179,8,0.16)",
    tagColor:        "#f0b940",
    tagBorder:       "rgba(234,179,8,0.30)",
  } : {
    headerBg:        "rgba(248,250,252,0.96)",
    headerBorder:    "rgba(21,32,43,0.08)",
    headerText:      "#93a3b4",
    rowBorder:       "rgba(21,32,43,0.05)",
    rowEven:         "rgba(255,255,255,0.22)",
    rowHead:         "rgba(10,132,255,0.05)",
    rowHover:        "rgba(10,132,255,0.07)",
    dotInner:        "white",
    authorName:      "#1e2a35",
    authorDate:      "#97aabb",
    subjectDefault:  "#1e2a35",
    subjectHead:     "#0a3d8f",
    hashBadgeBorder: (col: string) => `${col}25`,
    hashBadgeBg:     (col: string) => `${col}15`,
    headBadgeBg:     "#1a2330",
    headBadgeColor:  "#fff",
    branchBg:        "rgba(10,132,255,0.10)",
    branchColor:     "#0a5eb6",
    branchBorder:    "rgba(10,132,255,0.20)",
    tagBg:           "rgba(234,179,8,0.11)",
    tagColor:        "#92560a",
    tagBorder:       "rgba(234,179,8,0.26)",
  }, [dark]);

  const rows = useMemo(() => {
    if (!logs || logs.length === 0) return [];
    return layoutCommits(parseLog(logs));
  }, [logs]);

  if (rows.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: c.authorDate, fontSize: "0.88rem" }}>
        {t.graphNoHistory}
      </div>
    );
  }

  const maxCol = Math.max(...rows.map(r => Math.max(r.col, ...r.lanesAfter.map((_, i) => i))));
  const totalCols = maxCol + 1;
  const graphW = totalCols * COL_W + 12;
  const totalH = rows.length * ROW_H;

  const COL_HEADER: React.CSSProperties = {
    fontSize: "0.67rem", fontWeight: 750,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: c.headerText,
  };

  return (
    <div ref={containerRef} style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Sticky column header ── */}
      <div style={{
        display: "flex", alignItems: "center", height: 30, flexShrink: 0,
        background: c.headerBg,
        borderBottom: `1px solid ${c.headerBorder}`,
        position: "sticky", top: 0, zIndex: 10, userSelect: "none",
      }}>
        <div style={{ width: graphW, flexShrink: 0 }} />
        <div style={{ width: HASH_W, paddingLeft: 6, flexShrink: 0 }}><span style={COL_HEADER}>{t.graphColHash}</span></div>
        <div style={{ width: AUTHOR_W, flexShrink: 0 }}><span style={COL_HEADER}>{t.graphColAuthor}</span></div>
        <div style={{ width: REFS_W, flexShrink: 0 }}><span style={COL_HEADER}>{t.graphColRefs}</span></div>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}><span style={COL_HEADER}>{t.graphColSubject}</span></div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ display: "flex", width: "100%" }}>

          {/* ── SVG graph ── */}
          <svg width={graphW} height={totalH} style={{ flexShrink: 0, display: "block" }}>
            {rows.map((row, rowIdx) => {
              const cy = rowIdx * ROW_H + ROW_H / 2;
              const cx = row.col * COL_W + COL_W / 2;
              const nextRow = rows[rowIdx + 1];
              const elements: React.ReactNode[] = [];
              const prevRow = rowIdx > 0 ? rows[rowIdx - 1] : null;
              const yTop = rowIdx * ROW_H;
              const yBot = (rowIdx + 1) * ROW_H;
              const incomingLanes = prevRow ? prevRow.lanesAfter : [];
              const incomingColors = prevRow ? prevRow.laneColors : [];

              for (let lc = 0; lc < incomingLanes.length; lc++) {
                const targetHash = incomingLanes[lc];
                if (targetHash === null) continue;
                const x = lc * COL_W + COL_W / 2;
                if (targetHash === row.hash) {
                  if (lc === row.col) {
                    elements.push(<line key={`in-${rowIdx}-${lc}`} x1={x} y1={yTop} x2={cx} y2={cy} stroke={incomingColors[lc] ?? "#ccc"} strokeWidth={1.8} />);
                  } else {
                    elements.push(<path key={`in-diag-${rowIdx}-${lc}`} d={`M ${x} ${yTop} C ${x} ${cy - ROW_H*0.4}, ${cx} ${cy - ROW_H*0.4}, ${cx} ${cy}`} stroke={incomingColors[lc] ?? "#ccc"} strokeWidth={1.8} fill="none" />);
                  }
                } else {
                  elements.push(<line key={`pass-${rowIdx}-${lc}`} x1={x} y1={yTop} x2={x} y2={yBot} stroke={incomingColors[lc] ?? "#ccc"} strokeWidth={1.8} />);
                }
              }

              if (nextRow) {
                if (row.lanesAfter[row.col] !== null) {
                  elements.push(<line key={`out-self-${rowIdx}`} x1={cx} y1={cy} x2={cx} y2={yBot} stroke={row.color} strokeWidth={1.8} />);
                }
                if (row.parents.length >= 1) {
                  const firstParent = row.parents[0];
                  const existingCol = row.lanesAfter.indexOf(firstParent);
                  if (existingCol !== -1 && existingCol !== row.col) {
                    const x2 = existingCol * COL_W + COL_W / 2;
                    elements.push(<path key={`conv-${rowIdx}`} d={`M ${cx} ${cy} C ${cx} ${cy + ROW_H*0.5}, ${x2} ${yBot - ROW_H*0.5}, ${x2} ${yBot}`} stroke={row.color} strokeWidth={1.8} fill="none" />);
                  }
                }
                for (let pi = 1; pi < row.parents.length; pi++) {
                  const p = row.parents[pi];
                  const targetCol = row.lanesAfter.indexOf(p);
                  if (targetCol !== -1) {
                    const x2 = targetCol * COL_W + COL_W / 2;
                    const branchColor = row.laneColors[targetCol] ?? row.color;
                    elements.push(<path key={`merge-${rowIdx}-${pi}`} d={`M ${cx} ${cy} C ${cx} ${cy + ROW_H*0.5}, ${x2} ${yBot - ROW_H*0.5}, ${x2} ${yBot}`} stroke={branchColor} strokeWidth={1.8} fill="none" />);
                  }
                }
              }

              elements.push(
                <circle key={`glow-${rowIdx}`} cx={cx} cy={cy} r={DOT_R + 2.5} fill={row.color} opacity={0.18} />,
                <circle key={`dot-${rowIdx}`} cx={cx} cy={cy} r={DOT_R} fill={row.color} />,
                <circle key={`inner-${rowIdx}`} cx={cx} cy={cy} r={DOT_R - 2} fill={c.dotInner} />,
              );

              return <g key={rowIdx}>{elements}</g>;
            })}
          </svg>

          {/* ── Text columns ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            {rows.map((row, rowIdx) => {
              const { branches, tags } = parseRefs(row.refs);
              const isHead = headOid.length >= 7 && (row.hash === headOid || headOid.startsWith(row.hash));
              const rowHeadBranch = isHead ? (headBranch === "HEAD" ? "" : headBranch) : "";
              const isEven = rowIdx % 2 === 0;

              const rowBg = isHead ? c.rowHead : isEven ? c.rowEven : "transparent";

              return (
                <div
                  key={row.hash}
                  style={{
                    height: ROW_H, display: "flex", alignItems: "center",
                    borderBottom: `1px solid ${c.rowBorder}`,
                    cursor: "default", overflow: "hidden",
                    background: rowBg,
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = c.rowHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                >
                  {/* Hash */}
                  <div style={{ width: HASH_W, paddingLeft: 6, flexShrink: 0 }}>
                    <code style={{
                      fontSize: "0.71rem",
                      fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
                      color: row.color, fontWeight: 700,
                      background: c.hashBadgeBg(row.color),
                      padding: "2px 5px", borderRadius: 5,
                      border: `1px solid ${c.hashBadgeBorder(row.color)}`,
                    }}>
                      {row.hash.slice(0, 7)}
                    </code>
                  </div>

                  {/* Author */}
                  <div style={{ width: AUTHOR_W, flexShrink: 0, display: "flex", alignItems: "center", gap: 7, paddingRight: 10 }}>
                    <AuthorAvatar name={row.author} email={row.email} size={26} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: "0.76rem", color: c.authorName, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.3 }}>
                        {row.author}
                      </div>
                      <div style={{ fontSize: "0.66rem", color: c.authorDate, whiteSpace: "nowrap", lineHeight: 1.3 }}>
                        {row.date}
                      </div>
                    </div>
                  </div>

                  {/* Refs */}
                  <div style={{ width: REFS_W, flexShrink: 0, display: "flex", flexWrap: "nowrap", gap: 3, paddingRight: 8, alignItems: "center", overflow: "hidden" }}>
                    {isHead && (
                      <span style={{
                        fontSize: "0.66rem", padding: "2px 6px", borderRadius: 5,
                        background: c.headBadgeBg, color: c.headBadgeColor, fontWeight: 700,
                        whiteSpace: "nowrap", lineHeight: "1.55",
                        display: "inline-flex", alignItems: "center", gap: 3,
                        boxShadow: "0 1px 4px rgba(0,0,0,0.25)", flexShrink: 0,
                      }}>
                        HEAD{rowHeadBranch ? <span style={{ opacity: 0.55, fontWeight: 400, marginLeft: 1 }}>→ {rowHeadBranch}</span> : null}
                      </span>
                    )}
                    {branches.filter(b => b !== rowHeadBranch).slice(0, 2).map(b => (
                      <span key={b} style={{
                        fontSize: "0.66rem", padding: "2px 6px", borderRadius: 5,
                        background: c.branchBg, color: c.branchColor,
                        border: `1px solid ${c.branchBorder}`,
                        whiteSpace: "nowrap", maxWidth: 108, overflow: "hidden", textOverflow: "ellipsis",
                        lineHeight: "1.55", flexShrink: 0,
                        display: "inline-flex", alignItems: "center", gap: 3,
                      }}>
                        <svg width="8" height="9" viewBox="0 0 8 9" fill="none" style={{ opacity: 0.6 }}>
                          <path d="M1 1v4.5a1.5 1.5 0 0 0 1.5 1.5H5M1 1l2-0M1 1l2 2M6.5 6a1.5 1.5 0 1 1 0 .001" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                        </svg>
                        {b}
                      </span>
                    ))}
                    {tags.slice(0, 1).map(t => (
                      <span key={t} style={{
                        fontSize: "0.66rem", padding: "2px 6px", borderRadius: 5,
                        background: c.tagBg, color: c.tagColor,
                        border: `1px solid ${c.tagBorder}`,
                        whiteSpace: "nowrap", lineHeight: "1.55", flexShrink: 0,
                      }}>
                        🏷 {t}
                      </span>
                    ))}
                  </div>

                  {/* Subject */}
                  <div style={{ flex: 1, paddingRight: 16, minWidth: 0 }}>
                    <span style={{
                      fontSize: "0.84rem",
                      color: isHead ? c.subjectHead : c.subjectDefault,
                      display: "block", whiteSpace: "nowrap",
                      overflow: "hidden", textOverflow: "ellipsis",
                      lineHeight: "1.4", fontWeight: isHead ? 600 : 400,
                    }}>
                      {row.subject}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
