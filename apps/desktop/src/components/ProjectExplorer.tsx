import { useCallback, useEffect, useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import { buildProjectTree, type TreeNode } from "@jellytind/story-repository";

interface Props {
  repo: StoryRepository;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  refreshToken: number;
}

export function ProjectExplorer({ repo, activePath, onOpenFile, refreshToken }: Props) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["manuscript", "story"]));

  const reload = useCallback(async () => {
    const files = await repo.listProjectFiles();
    setTree(buildProjectTree(files));
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="explorer">
      <div className="explorer__header">
        <span>{repo.project.title}</span>
        <button className="explorer__refresh" title="Refresh" onClick={() => void reload()}>
          ⟳
        </button>
      </div>
      <div className="explorer__tree">
        {tree === null ? (
          <p className="placeholder">Loading…</p>
        ) : (
          tree.children.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              expanded={expanded}
              activePath={activePath}
              onToggle={toggle}
              onOpenFile={onOpenFile}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ItemProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  activePath: string | null;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}

function TreeItem({ node, depth, expanded, activePath, onToggle, onOpenFile }: ItemProps) {
  const pad = { paddingLeft: `${depth * 14 + 8}px` };
  if (node.kind === "dir") {
    const isOpen = expanded.has(node.path);
    return (
      <div>
        <button
          className="tree__row tree__row--dir"
          style={pad}
          onClick={() => onToggle(node.path)}
        >
          <span className="tree__chevron">{isOpen ? "▾" : "▸"}</span>
          {node.name}
        </button>
        {isOpen &&
          node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              activePath={activePath}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ))}
      </div>
    );
  }
  return (
    <button
      className={`tree__row tree__row--file${node.path === activePath ? " tree__row--active" : ""}`}
      style={pad}
      onClick={() => onOpenFile(node.path)}
    >
      {node.name}
    </button>
  );
}
