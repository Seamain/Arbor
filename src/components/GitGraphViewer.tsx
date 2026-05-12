import { useMemo, useRef, useEffect } from "react";

interface GitGraphViewerProps {
  logs: string[];
  headOid: string;    // full SHA of current HEAD
  headBranch: string; // current branch name ("(detached)" when detached)
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
  // active lanes AFTER this commit is processed: lane[col] = hash it's heading to
  lanesAfter: (string | null)[];
  laneColors: string[];
}

const COLORS = [
  "#0A84FF", "#30D158", "#FF9F0A", "#BF5AF2",
  "#FF375F", "#64D2FF", "#FFD60A", "#FF2D55",
];
const ROW_H = 56;
const COL_W = 20;
const DOT_R = 4;

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

// Generate a color from a string (for avatar backgrounds)
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

function AuthorAvatar({ name, email, size = 26 }: { name: string; email: string; size?: number }) {
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const bg = stringToColor(email || name);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: bg, color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 700, flexShrink: 0,
      letterSpacing: "-0.02em",
    }}>
      {initials}
    </div>
  );
}

function layoutCommits(commits: Commit[]): CommitRow[] {
  // lanes[col] = hash of the commit this lane is heading toward (null = free)
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
    // Assign column for this commit
    let col = lanes.indexOf(commit.hash);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) col = lanes.length;
      laneColors[col] = COLORS[col % COLORS.length];
    }
    const color = laneColors[col];

    // Close this lane
    lanes[col] = null;

    // Wire parents into lanes
    if (commit.parents.length === 0) {
      // root — lane stays closed
    } else if (commit.parents.length === 1) {
      const p = commit.parents[0];
      const existing = lanes.indexOf(p);
      if (existing !== -1) {
        // This lane converges into an existing one — stays closed
      } else {
        lanes[col] = p; // continue same lane
      }
    } else {
      // Merge commit
      const [first, ...rest] = commit.parents;
      const existingFirst = lanes.indexOf(first);
      if (existingFirst === -1) lanes[col] = first; // continue lane for first parent
      for (const p of rest) {
        if (lanes.indexOf(p) === -1) findOrAlloc(p);
      }
    }

    rows.push({
      ...commit,
      col,
      color,
      lanesAfter: [...lanes],
      laneColors: [...laneColors],
    });
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
    if (p === "HEAD") {
      // Detached HEAD
      head = true;
      continue;
    }
    if (p.startsWith("HEAD -> ")) {
      // Attached HEAD — extract the branch name
      head = true;
      headBranch = p.slice(8);
      branches.push(headBranch);
      continue;
    }
    if (p.startsWith("tag: ")) {
      tags.push(p.slice(5));
      continue;
    }
    // Skip "origin/HEAD" — it's a remote tracking pointer, not a real branch to display
    if (p === "origin/HEAD" || p.endsWith("/HEAD")) continue;
    branches.push(p);
  }
  return { branches, tags, head, headBranch };
}

export function GitGraphViewer({ logs, headOid, headBranch }: GitGraphViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Just to keep the effect observing, though we might not need to force re-render right now
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => {
    if (!logs || logs.length === 0) return [];
    return layoutCommits(parseLog(logs));
  }, [logs]);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-default-400 text-sm">
        No commit history found.
      </div>
    );
  }


  // How many lanes do we need?
  const maxCol = Math.max(...rows.map(r =>
    Math.max(r.col, ...r.lanesAfter.map((_, i) => i))
  ));
  const totalCols = maxCol + 1;
  const graphW = totalCols * COL_W + 8;
  const totalH = rows.length * ROW_H;

  // Column widths: hash | author | refs | subject(flex)
  const hashW = 64;
  const authorW = 160;  // avatar + name + date
  const refsW = 200;    // branch/tag badges

  return (
    <div ref={containerRef} style={{ height: "100%", overflowY: "auto", overflowX: "hidden" }}>
      <div style={{ display: "flex", width: "100%" }}>

        {/* ── Unified SVG graph column ── */}
        <svg
          width={graphW}
          height={totalH}
          style={{ flexShrink: 0, display: "block" }}
        >
          {rows.map((row, rowIdx) => {
            const cy = rowIdx * ROW_H + ROW_H / 2;
            const cx = row.col * COL_W + COL_W / 2;
            const nextRow = rows[rowIdx + 1];
            const elements: React.ReactNode[] = [];

            // ── Draw edges for this row ──
            // Each row is responsible for drawing ALL lines that run through it,
            // from yTop (top of row) to yBot (bottom of row).
            // Lines passing through a commit dot are split: top→dot and dot→bottom.

            const prevRow = rowIdx > 0 ? rows[rowIdx - 1] : null;
            const yTop = rowIdx * ROW_H;        // top of this row
            const yBot = (rowIdx + 1) * ROW_H; // bottom of this row

            // ── Incoming lines (top of row → dot or pass-through) ──
            // Based on the PREVIOUS row's lanesAfter (what was active coming in)
            const incomingLanes = prevRow ? prevRow.lanesAfter : [];
            const incomingColors = prevRow ? prevRow.laneColors : [];

            for (let c = 0; c < incomingLanes.length; c++) {
              const targetHash = incomingLanes[c];
              if (targetHash === null) continue;
              const x = c * COL_W + COL_W / 2;

              if (targetHash === row.hash) {
                if (c === row.col) {
                  // Straight incoming line to this commit
                  elements.push(
                    <line key={`in-${rowIdx}-${c}`}
                      x1={x} y1={yTop} x2={cx} y2={cy}
                      stroke={incomingColors[c] ?? "#ccc"} strokeWidth={1.5} />
                  );
                } else {
                  // Diagonal incoming: another lane converges into this commit
                  elements.push(
                    <path key={`in-diag-${rowIdx}-${c}`}
                      d={`M ${x} ${yTop} C ${x} ${cy - ROW_H*0.4}, ${cx} ${cy - ROW_H*0.4}, ${cx} ${cy}`}
                      stroke={incomingColors[c] ?? "#ccc"} strokeWidth={1.5} fill="none" />
                  );
                }
              } else {
                // Pass-through: draw full top→bottom straight line
                elements.push(
                  <line key={`pass-${rowIdx}-${c}`}
                    x1={x} y1={yTop} x2={x} y2={yBot}
                    stroke={incomingColors[c] ?? "#ccc"} strokeWidth={1.5} />
                );
              }
            }

            // ── Outgoing lines (dot → bottom of row) ──
            // Based on THIS row's lanesAfter (what becomes active after this commit)
            if (nextRow) {
              // 1. Straight outgoing: this commit's lane continues down
              if (row.lanesAfter[row.col] !== null) {
                elements.push(
                  <line key={`out-self-${rowIdx}`}
                    x1={cx} y1={cy} x2={cx} y2={yBot}
                    stroke={row.color} strokeWidth={1.5} />
                );
              }

              // 2. Convergence: first parent already in a different lane
              if (row.parents.length >= 1) {
                const firstParent = row.parents[0];
                const existingCol = row.lanesAfter.indexOf(firstParent);
                if (existingCol !== -1 && existingCol !== row.col) {
                  const x2 = existingCol * COL_W + COL_W / 2;
                  elements.push(
                    <path key={`conv-${rowIdx}`}
                      d={`M ${cx} ${cy} C ${cx} ${cy + ROW_H*0.5}, ${x2} ${yBot - ROW_H*0.5}, ${x2} ${yBot}`}
                      stroke={row.color} strokeWidth={1.5} fill="none" />
                  );
                }
              }

              // 3. Merge parents (2nd+): branch out to newly opened lanes
              for (let pi = 1; pi < row.parents.length; pi++) {
                const p = row.parents[pi];
                const targetCol = row.lanesAfter.indexOf(p);
                if (targetCol !== -1) {
                  const x2 = targetCol * COL_W + COL_W / 2;
                  const branchColor = row.laneColors[targetCol] ?? row.color;
                  elements.push(
                    <path key={`merge-${rowIdx}-${pi}`}
                      d={`M ${cx} ${cy} C ${cx} ${cy + ROW_H*0.5}, ${x2} ${yBot - ROW_H*0.5}, ${x2} ${yBot}`}
                      stroke={branchColor} strokeWidth={1.5} fill="none" />
                  );
                }
              }

              // 4. New lanes opened that are NOT this commit's col (new branches from merge)
              // These are lanes in lanesAfter that weren't in incomingLanes
              for (let c = 0; c < row.lanesAfter.length; c++) {
                if (c === row.col) continue; // handled above
                if (row.lanesAfter[c] === null) continue;
                // Check if this lane existed before (then it's a pass-through, already drawn)
                const wasActive = c < incomingLanes.length && incomingLanes[c] !== null;
                if (!wasActive) {
                  // New lane opened at this row — it was already drawn as a merge branch above
                  // (handled by merge parent loop), so skip
                }
              }
            }

            // Commit dot
            elements.push(
              <circle key={`outer-${rowIdx}`} cx={cx} cy={cy} r={DOT_R} fill={row.color} />,
              <circle key={`inner-${rowIdx}`} cx={cx} cy={cy} r={DOT_R - 2} fill="white" />,
            );

            return <g key={rowIdx}>{elements}</g>;
          })}
        </svg>

        {/* ── Text columns ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {rows.map((row) => {
            const { branches, tags } = parseRefs(row.refs);
            const isHead = headOid.length >= 7 && (
              row.hash === headOid || headOid.startsWith(row.hash)
            );
            const rowHeadBranch = isHead ? (headBranch === "HEAD" ? "" : headBranch) : "";
            return (
              <div
                key={row.hash}
                style={{
                  height: ROW_H,
                  display: "flex",
                  alignItems: "center",
                  borderBottom: "1px solid #f0f0f0",
                  cursor: "default",
                  transition: "background 0.1s",
                  overflow: "hidden",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.4)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                {/* Hash */}
                <div style={{ width: hashW, paddingLeft: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: "0.75rem", fontFamily: "monospace", color: row.color, fontWeight: 700 }}>
                    {row.hash.slice(0, 7)}
                  </span>
                </div>

                {/* Author: avatar + name + date */}
                <div style={{ width: authorW, flexShrink: 0, display: "flex", alignItems: "center", gap: 8, paddingRight: 10 }}>
                  <AuthorAvatar name={row.author} email={row.email} size={26} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.78rem", color: "#24292f", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {row.author}
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "#999", whiteSpace: "nowrap" }}>
                      {row.date}
                    </div>
                  </div>
                </div>

                {/* Refs badges */}
                <div style={{ width: refsW, flexShrink: 0, display: "flex", flexWrap: "wrap", gap: 3, paddingRight: 8, alignItems: "center", overflow: "hidden" }}>
                  {isHead && (
                    <span style={{ fontSize: "0.68rem", padding: "1px 5px", borderRadius: 4, background: "#24292f", color: "#fff", fontWeight: 700, whiteSpace: "nowrap", lineHeight: "1.5", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      HEAD{rowHeadBranch ? <span style={{ opacity: 0.65, fontWeight: 400 }}>→ {rowHeadBranch}</span> : ""}
                    </span>
                  )}
                  {branches.filter(b => b !== rowHeadBranch).map(b => (
                    <span key={b} style={{ fontSize: "0.68rem", padding: "1px 5px", borderRadius: 4, background: "#dbeafe", color: "#1d4ed8", border: "1px solid #bfdbfe", whiteSpace: "nowrap", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", lineHeight: "1.5" }}>
                      {b}
                    </span>
                  ))}
                  {tags.map(t => (
                    <span key={t} style={{ fontSize: "0.68rem", padding: "1px 5px", borderRadius: 4, background: "#fef9c3", color: "#854d0e", border: "1px solid #fde047", whiteSpace: "nowrap", lineHeight: "1.5" }}>
                      🏷 {t}
                    </span>
                  ))}
                </div>

                {/* Subject — fills remaining space */}
                <div style={{ flex: 1, paddingRight: 16, minWidth: 0 }}>
                  <span style={{
                    fontSize: "0.85rem",
                    color: "#24292f",
                    display: "block",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: "1.4",
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
  );
}
