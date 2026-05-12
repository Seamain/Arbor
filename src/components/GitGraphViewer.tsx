import { Gitgraph, TemplateName, templateExtend } from "@gitgraph/react";

interface GitGraphViewerProps {
  logs: string[];
}

export function GitGraphViewer({ logs }: GitGraphViewerProps) {
  if (!logs || logs.length === 0) {
    return (
      <div className="p-8 text-center text-default-400">
        No commit history found or still loading...
      </div>
    );
  }

  return (
    <div className="bg-content1 h-full w-full overflow-auto">
      <div className="p-4 min-w-max">
        <Gitgraph
          options={{
            template: templateExtend(TemplateName.Metro, {
              commit: {
                message: {
                  displayAuthor: true,
                  displayHash: true,
                  font: "normal 12px ui-sans-serif, system-ui, sans-serif",
                },
                dot: {
                  size: 8,
                },
              },
              colors: ["#0070f3", "#17c964", "#f5a524", "#f31260", "#7828c8"],
            }),
          }}
        >
          {(gitgraph) => {
            const main = gitgraph.branch("main");
            
            // Git log returns newest first. 
            // GitGraph draws from the first commit added (bottom) to the last (top).
            // So we reverse to draw oldest at the bottom and newest at the top.
            const chronologicalLogs = [...logs].reverse();

            chronologicalLogs.forEach((log) => {
              const parts = log.split("~|~");
              if (parts.length < 4) return;
              
              const hash = parts[0];
              // parts[1] is parents, skipping for simple linear graph
              const subject = parts[2] || "No message";
              const author = parts[3] || "Unknown";
              const date = parts[4] || "";
              const refs = parts[5] || "";

              let tagNames: string[] = [];
              if (refs) {
                const cleanRefs = refs.replace(/[() ]/g, "").split(",");
                for (const ref of cleanRefs) {
                  if (ref.startsWith("tag:")) {
                    tagNames.push(ref.replace("tag:", ""));
                  }
                }
              }

              main.commit({
                hash,
                subject,
                author: `${author} (${date})`,
                tag: tagNames.length > 0 ? tagNames[0] : undefined,
              });
            });
          }}
        </Gitgraph>
      </div>
    </div>
  );
}
