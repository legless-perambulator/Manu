import { EXPLORER_ROOTS } from "./paths";

/** A node in the project explorer tree. */
export interface TreeNode {
  readonly name: string;
  readonly path: string;
  readonly kind: "dir" | "file";
  readonly children: TreeNode[];
}

/**
 * Build an explorer tree from a flat list of project-relative file paths. The
 * canonical top-level content areas are always included (even when empty) so the
 * explorer shows the project's shape from the moment it is created; `.writer`
 * internals are hidden by default.
 */
export function buildProjectTree(files: readonly string[], includeWriterDir = false): TreeNode {
  const root: TreeNode = { name: "", path: "", kind: "dir", children: [] };

  const ensureDir = (parent: TreeNode, name: string, path: string): TreeNode => {
    let node = parent.children.find((c) => c.kind === "dir" && c.name === name);
    if (node === undefined) {
      node = { name, path, kind: "dir", children: [] };
      parent.children.push(node);
    }
    return node;
  };

  // Always surface the canonical content areas, even when empty.
  for (const area of EXPLORER_ROOTS) ensureDir(root, area, area);

  for (const file of files) {
    if (!includeWriterDir && (file === ".writer" || file.startsWith(".writer/"))) continue;
    const segments = file.split("/").filter(Boolean);
    let cursor = root;
    let acc = "";
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as string;
      acc = acc === "" ? segment : `${acc}/${segment}`;
      if (i === segments.length - 1) {
        cursor.children.push({ name: segment, path: acc, kind: "file", children: [] });
      } else {
        cursor = ensureDir(cursor, segment, acc);
      }
    }
  }

  sortTree(root);
  return root;
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortTree(child);
}
