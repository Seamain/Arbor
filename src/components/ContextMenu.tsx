import { useEffect, useRef } from "react";

interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  divider?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position so the menu doesn't overflow the viewport
  const MENU_W = 220;
  const ITEM_H = 32;
  const estimatedH = items.length * ITEM_H + 8;
  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.min(y, window.innerHeight - estimatedH - 8);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left, top }}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="ctx-menu-divider" />
        ) : (
          <button
            key={i}
            className={`ctx-menu-item ${item.danger ? "ctx-menu-item-danger" : ""}`}
            onClick={() => { item.onClick(); onClose(); }}
          >
            {item.icon && <span className="ctx-menu-icon">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        )
      )}
    </div>
  );
}
