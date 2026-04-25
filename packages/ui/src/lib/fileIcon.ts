// Map a filename to one of the icon keys understood by FileIcon.
// Extend the switch as more icons are added to design/data.ts.

export function iconForName(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot + 1) : '';
  switch (ext) {
    case 'ts':
      return 'ts';
    case 'tsx':
      return 'tsx';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'ts';
    case 'jsx':
      return 'tsx';
    case 'rs':
      return 'rs';
    case 'toml':
      return 'toml';
    case 'md':
    case 'markdown':
      return 'md';
    case 'json':
      return 'json';
    case 'css':
    case 'scss':
    case 'sass':
      return 'css';
    case 'lua':
      return 'lua';
    default:
      return 'file';
  }
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}
