// Inline SVG icon components — read SVG strings from the Icons map.

import type { JSX } from 'solid-js';
import { Icons } from './icons';

export function Icon(props: {
  name: string;
  size?: number;
  class?: string;
  style?: JSX.CSSProperties;
}) {
  const baseStyle = (): JSX.CSSProperties => {
    const sz = props.size ?? 14;
    return {
      display: 'inline-flex',
      width: `${sz}px`,
      height: `${sz}px`,
      ...(props.style || {}),
    };
  };
  return (
    <span
      class={`icon ${props.class || ''}`}
      style={baseStyle()}
      innerHTML={Icons[props.name] || ''}
    />
  );
}

const FILE_ICON_MAP: Record<string, string> = {
  tsx: 'file_tsx',
  ts: 'file_ts',
  rs: 'file_rs',
  toml: 'file_toml',
  json: 'file_json',
  md: 'file_md',
  css: 'file_css',
  lua: 'file_lua',
};

export function FileIcon(props: { type: string }) {
  const key = () => FILE_ICON_MAP[props.type] || 'file';
  return <span class="file-icon" innerHTML={Icons[key()]} />;
}
