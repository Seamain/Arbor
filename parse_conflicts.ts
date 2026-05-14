export type ConflictBlock = 
  | { type: "normal"; content: string }
  | { type: "conflict"; current: string; incoming: string; currentName: string; incomingName: string; id: number };

export function parseConflicts(text: string): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  const lines = text.split('\n');
  
  let i = 0;
  let normalAcc: string[] = [];
  let conflictId = 0;

  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      if (normalAcc.length > 0) {
        blocks.push({ type: "normal", content: normalAcc.join('\n') });
        normalAcc = [];
      }
      
      const currentName = lines[i].substring(8).trim() || 'Current Change';
      i++;
      
      let currentAcc: string[] = [];
      while (i < lines.length && !lines[i].startsWith('=======')) {
        currentAcc.push(lines[i]);
        i++;
      }
      
      if (lines[i] && lines[i].startsWith('=======')) i++;
      
      let incomingAcc: string[] = [];
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        incomingAcc.push(lines[i]);
        i++;
      }
      
      const incomingName = lines[i] ? (lines[i].substring(8).trim() || 'Incoming Change') : 'Incoming Change';
      if (lines[i] && lines[i].startsWith('>>>>>>>')) i++;
      
      blocks.push({
        type: "conflict",
        current: currentAcc.join('\n'),
        incoming: incomingAcc.join('\n'),
        currentName,
        incomingName,
        id: conflictId++
      });
    } else {
      normalAcc.push(lines[i]);
      i++;
    }
  }
  
  if (normalAcc.length > 0) {
    blocks.push({ type: "normal", content: normalAcc.join('\n') });
  }
  
  return blocks;
}
