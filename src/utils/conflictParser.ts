export type ConflictBlock = 
  | { type: "normal"; content: string }
  | { type: "conflict"; current: string; incoming: string; currentName: string; incomingName: string; id: string };

export function parseConflicts(text: string): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  const lines = text.split('\n');
  
  let i = 0;
  let normalAcc: string[] = [];
  let conflictId = 0;

  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      if (normalAcc.length > 0) {
        // preserve the exact trailing newline behaviour by joining and tracking trailing empty elements if needed, 
        // but simple join is usually fine since split strips the newline character.
        blocks.push({ type: "normal", content: normalAcc.join('\n') });
        normalAcc = [];
      }
      
      const currentName = lines[i].substring(7).trim() || 'Current Change';
      i++;
      
      const currentAcc: string[] = [];
      while (i < lines.length && !lines[i].startsWith('=======')) {
        currentAcc.push(lines[i]);
        i++;
      }
      
      if (i < lines.length && lines[i].startsWith('=======')) {
        i++;
      }
      
      const incomingAcc: string[] = [];
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        incomingAcc.push(lines[i]);
        i++;
      }
      
      const incomingName = (i < lines.length && lines[i].startsWith('>>>>>>>')) 
        ? (lines[i].substring(7).trim() || 'Incoming Change') 
        : 'Incoming Change';
        
      if (i < lines.length && lines[i].startsWith('>>>>>>>')) {
        i++;
      }
      
      blocks.push({
        type: "conflict",
        current: currentAcc.join('\n'),
        incoming: incomingAcc.join('\n'),
        currentName,
        incomingName,
        id: `conflict-${conflictId++}`
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
