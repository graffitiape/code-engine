// Code samples, icons, and mock data for CodeEngine.
// Direct port of public/design/data.js into typed TS.

import type {
  CodeFile,
  CodeLine,
  FileNode,
  Tab,
  PaletteSection,
  GitStatusData,
  GitDiffData,
  SearchResultsData,
  MinimapBuffer,
  MinimapLine,
} from './types';

// ============ ICONS ============
export const Icons: Record<string, string> = {
  chevronRight: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>',
  chevronDown: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
  search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
  folder: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.5h4l1.5 1.5h7.5v8.5a1 1 0 01-1 1H2.5a1 1 0 01-1-1v-10z" opacity=".85"/></svg>',
  folderOpen: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.5h4l1.5 1.5H15v2H1.5v-3.5zM1.5 7H15l-1.5 6.5a1 1 0 01-1 1H2.5a1 1 0 01-1-1V7z" opacity=".85"/></svg>',
  file: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M9 1.5H3.5a1 1 0 00-1 1V14a1 1 0 001 1h9a1 1 0 001-1V6L9 1.5z"/><path d="M9 1.5V6h4.5"/></svg>',
  git: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.73 7.32L8.68 1.27a.9.9 0 00-1.28 0L6.15 2.52l1.59 1.59a1.08 1.08 0 011.37 1.37l1.53 1.53a1.08 1.08 0 11-.65.61L8.56 6.18v3.76a1.08 1.08 0 11-.9 0V6.15a1.08 1.08 0 01-.58-1.42L5.5 3.17 1.27 7.4a.9.9 0 000 1.28l6.05 6.05a.9.9 0 001.28 0l6.13-6.13a.9.9 0 000-1.28z"/></svg>',
  branch: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="6" r="1.5"/><path d="M4 4.5v7"/><path d="M12 7.5c0 2-2 3-4 3.5"/></svg>',
  diagError: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6"/><path d="M5 5l6 6M11 5l-6 6" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>',
  diagWarn: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5L15 14H1L8 1.5z"/><path d="M8 6v4M8 12v0.5" stroke="#000" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>',
  terminal: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="3" width="13" height="10" rx="1"/><path d="M4 6.5l2 1.5-2 1.5M8 10.5h4"/></svg>',
  split: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M8 2.5v11"/></svg>',
  settings: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M15 8h-2M3 8H1M12.95 3.05l-1.4 1.4M4.45 11.55l-1.4 1.4M12.95 12.95l-1.4-1.4M4.45 4.45l-1.4-1.4"/></svg>',
  command: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 5a1.5 1.5 0 10-1.5 1.5H5V5zM5 11a1.5 1.5 0 11-1.5-1.5H5V11zM11 5a1.5 1.5 0 111.5 1.5H11V5zM11 11a1.5 1.5 0 101.5-1.5H11V11zM5 5h6v6H5z"/></svg>',
  minimap: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M3.5 5h5M3.5 7h7M3.5 9h4M3.5 11h6"/></svg>',
  replace: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 4h8M2 8h6M2 12h4"/><path d="M11 11l3 3"/><circle cx="13" cy="9" r="3"/></svg>',
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 3v10l9-5z"/></svg>',
  download: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v9M4 8l4 4 4-4M2 14h12"/></svg>',
  file_ts: '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#3178c6"/><text x="8" y="11" text-anchor="middle" font-family="monospace" font-size="7" font-weight="700" fill="white">TS</text></svg>',
  file_tsx: '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#61dafb"/><text x="8" y="11" text-anchor="middle" font-family="monospace" font-size="6.5" font-weight="700" fill="#0a2540">TSX</text></svg>',
  file_rs: '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#dea584"/><text x="8" y="11" text-anchor="middle" font-family="monospace" font-size="6.5" font-weight="700" fill="#1a1a1a">RS</text></svg>',
  file_toml: '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#9c4221"/><text x="8" y="11" text-anchor="middle" font-family="monospace" font-size="5" font-weight="700" fill="white">TOML</text></svg>',
  file_md: '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#519aba"/><text x="8" y="11" text-anchor="middle" font-family="monospace" font-size="6.5" font-weight="700" fill="white">MD</text></svg>',
  file_json: '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#cbcb41"/><text x="8" y="11" text-anchor="middle" font-family="monospace" font-size="5.5" font-weight="700" fill="#1a1a1a">JSON</text></svg>',
  file_css: '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#42a5f5"/><text x="8" y="11" text-anchor="middle" font-family="monospace" font-size="6.5" font-weight="700" fill="white">CSS</text></svg>',
  file_lua: '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#51a0cf"/><text x="8" y="11" text-anchor="middle" font-family="monospace" font-size="6.5" font-weight="700" fill="white">LUA</text></svg>',
};

// ============ FILE TREE ============
export const FileTree: FileNode[] = [
  { type: 'dir', name: 'codeengine2', depth: 0, expanded: true, children: [
    { type: 'dir', name: 'crates', depth: 1, expanded: true, children: [
      { type: 'dir', name: 'ce-core', depth: 2, expanded: true, children: [
        { type: 'dir', name: 'src', depth: 3, expanded: true, children: [
          { type: 'dir', name: 'nvim', depth: 4, expanded: true, children: [
            { type: 'file', name: 'process.rs', depth: 5, icon: 'rs', git: 'M' },
            { type: 'file', name: 'handler.rs', depth: 5, icon: 'rs', git: 'M' },
            { type: 'file', name: 'protocol.rs', depth: 5, icon: 'rs' },
            { type: 'file', name: 'input.rs', depth: 5, icon: 'rs', git: 'A' },
          ]},
          { type: 'dir', name: 'grid', depth: 4, expanded: false, children: [] },
          { type: 'dir', name: 'session', depth: 4, expanded: false, children: [] },
          { type: 'file', name: 'lib.rs', depth: 4, icon: 'rs' },
        ]},
        { type: 'file', name: 'Cargo.toml', depth: 3, icon: 'toml' },
      ]},
      { type: 'dir', name: 'ce-git', depth: 2, expanded: false, children: [] },
      { type: 'dir', name: 'ce-fs', depth: 2, expanded: false, children: [] },
      { type: 'dir', name: 'ce-tauri', depth: 2, expanded: false, children: [] },
    ]},
    { type: 'dir', name: 'packages', depth: 1, expanded: true, children: [
      { type: 'dir', name: 'ui', depth: 2, expanded: true, children: [
        { type: 'dir', name: 'src', depth: 3, expanded: true, children: [
          { type: 'dir', name: 'renderer', depth: 4, expanded: false, children: [] },
          { type: 'dir', name: 'components', depth: 4, expanded: true, children: [
            { type: 'dir', name: 'chrome', depth: 5, expanded: false, children: [] },
            { type: 'dir', name: 'panes', depth: 5, expanded: true, children: [
              { type: 'file', name: 'PaneContainer.tsx', depth: 6, icon: 'tsx', git: 'M' },
              { type: 'file', name: 'PaneView.tsx', depth: 6, icon: 'tsx', active: true },
              { type: 'file', name: 'PaneDivider.tsx', depth: 6, icon: 'tsx' },
            ]},
            { type: 'dir', name: 'overlays', depth: 5, expanded: false, children: [] },
          ]},
          { type: 'dir', name: 'stores', depth: 4, expanded: false, children: [] },
          { type: 'file', name: 'App.tsx', depth: 4, icon: 'tsx', git: 'M' },
        ]},
        { type: 'file', name: 'package.json', depth: 3, icon: 'json' },
      ]},
    ]},
    { type: 'file', name: 'Cargo.toml', depth: 1, icon: 'toml' },
    { type: 'file', name: 'package.json', depth: 1, icon: 'json' },
    { type: 'file', name: 'README.md', depth: 1, icon: 'md', git: 'U' },
  ]},
];

// ============ TAB SET ============
export const Tabs: Tab[] = [
  { id: 'pane', name: 'PaneView.tsx', icon: 'tsx', dirty: true },
  { id: 'handler', name: 'handler.rs', icon: 'rs', dirty: true },
  { id: 'cargo', name: 'Cargo.toml', icon: 'toml', dirty: false },
  { id: 'readme', name: 'README.md', icon: 'md', dirty: false },
];

// ============ CODE LINE HELPER ============
export function l(gutter: number, html: string, opts: Partial<CodeLine> = {}): CodeLine {
  return { gutter, html, ...opts };
}

// ============ CODE SAMPLES ============
export const PaneViewCode: CodeFile = {
  path: ['packages', 'ui', 'src', 'components', 'panes', 'PaneView.tsx'],
  language: 'typescriptreact',
  branch: 'main',
  dirty: true,
  symbols: ['PaneView', 'renderGrid'],
  lines: [
    l(1,  `<span class="kw">import</span> <span class="punct">{</span> <span class="var">createEffect</span><span class="punct">,</span> <span class="var">onCleanup</span> <span class="punct">}</span> <span class="kw">from</span> <span class="str">'solid-js'</span><span class="punct">;</span>`),
    l(2,  `<span class="kw">import</span> <span class="punct">{</span> <span class="var">Channel</span> <span class="punct">}</span> <span class="kw">from</span> <span class="str">'@tauri-apps/api/core'</span><span class="punct">;</span>`),
    l(3,  `<span class="kw">import</span> <span class="punct">{</span> <span class="var">GridRenderer</span> <span class="punct">}</span> <span class="kw">from</span> <span class="str">'../../renderer/GridRenderer'</span><span class="punct">;</span>`),
    l(4,  `<span class="kw">import</span> <span class="punct">{</span> <span class="var">KeyHandler</span> <span class="punct">}</span> <span class="kw">from</span> <span class="str">'../../input/KeyHandler'</span><span class="punct">;</span>`),
    l(5,  ``),
    l(6,  `<span class="cmt">// One nvim process per pane — see architecture docs §2.1</span>`),
    l(7,  `<span class="kw">export function</span> <span class="fn">PaneView</span><span class="punct">(</span><span class="var">props</span><span class="op">:</span> <span class="type">PaneProps</span><span class="punct">)</span> <span class="punct">{</span>`, { hunk: 'a' }),
    l(8,  `  <span class="kw">let</span> <span class="var">canvasRef</span><span class="op">!:</span> <span class="type">HTMLCanvasElement</span><span class="punct">;</span>`, { hunk: 'a' }),
    l(9,  `  <span class="kw">const</span> <span class="var">renderer</span> <span class="op">=</span> <span class="kw">new</span> <span class="fn">GridRenderer</span><span class="punct">(</span><span class="punct">{</span>`, { hunk: 'a' }),
    l(10, `    <span class="prop">font</span><span class="op">:</span> <span class="var">props</span><span class="punct">.</span><span class="var">theme</span><span class="punct">.</span><span class="var">font</span><span class="punct">,</span>`),
    l(11, `    <span class="prop">cellSize</span><span class="op">:</span> <span class="punct">{</span> <span class="prop">w</span><span class="op">:</span> <span class="num">8</span><span class="punct">,</span> <span class="prop">h</span><span class="op">:</span> <span class="num">18</span> <span class="punct">}</span><span class="punct">,</span>`),
    l(12, `    <span class="prop">palette</span><span class="op">:</span> <span class="var">props</span><span class="punct">.</span><span class="var">theme</span><span class="punct">.</span><span class="var">palette</span><span class="punct">,</span>`),
    l(13, `  <span class="punct">}</span><span class="punct">)</span><span class="punct">;</span>`),
    l(14, ``),
    l(15, `  <span class="fn">createEffect</span><span class="punct">(</span><span class="kw">async</span> <span class="punct">()</span> <span class="op">=></span> <span class="punct">{</span>`, { current: true }),
    l(16, `    <span class="kw">const</span> <span class="var">channel</span> <span class="op">=</span> <span class="kw">new</span> <span class="type">Channel</span><span class="op">&lt;</span><span class="type">RedrawEvent</span><span class="op">&gt;</span><span class="punct">(</span><span class="punct">)</span><span class="punct">;</span>`),
    l(17, `    <span class="var">channel</span><span class="punct">.</span><span class="prop">onmessage</span> <span class="op">=</span> <span class="punct">(</span><span class="var">evt</span><span class="punct">)</span> <span class="op">=></span> <span class="var">renderer</span><span class="punct">.</span><span class="fn">apply</span><span class="punct">(</span><span class="var">evt</span><span class="punct">)</span><span class="punct">;</span>`),
    l(18, ``),
    l(19, `    <span class="kw">await</span> <span class="fn">invoke</span><span class="punct">(</span><span class="str">'attach_pane'</span><span class="punct">,</span> <span class="punct">{</span>`),
    l(20, `      <span class="prop">paneId</span><span class="op">:</span> <span class="var">props</span><span class="punct">.</span><span class="var">id</span><span class="punct">,</span>`),
    l(21, `      <span class="prop">cols</span><span class="op">:</span> <span class="var">renderer</span><span class="punct">.</span><span class="var">cols</span><span class="punct">,</span>`),
    l(22, `      <span class="prop">rows</span><span class="op">:</span> <span class="var">renderer</span><span class="punct">.</span><span class="var">rows</span><span class="punct">,</span>`),
    l(23, `      <span class="var">channel</span><span class="punct">,</span>`),
    l(24, `    <span class="punct">}</span><span class="punct">)</span><span class="punct">;</span>`),
    l(25, `  <span class="punct">}</span><span class="punct">)</span><span class="punct">;</span>`),
    l(26, ``),
    l(27, `  <span class="fn">onCleanup</span><span class="punct">(</span><span class="punct">()</span> <span class="op">=></span> <span class="fn">invoke</span><span class="punct">(</span><span class="str">'detach_pane'</span><span class="punct">,</span> <span class="punct">{</span> <span class="prop">paneId</span><span class="op">:</span> <span class="var">props</span><span class="punct">.</span><span class="var">id</span> <span class="punct">}</span><span class="punct">)</span><span class="punct">)</span><span class="punct">;</span>`),
    l(28, ``),
    l(29, `  <span class="kw">return</span> <span class="punct">(</span>`),
    l(30, `    <span class="punct">&lt;</span><span class="tag">div</span> <span class="attr">class</span><span class="op">=</span><span class="str">"pane"</span> <span class="attr">classList</span><span class="op">=</span><span class="punct">{{</span> <span class="prop">focused</span><span class="op">:</span> <span class="var">props</span><span class="punct">.</span><span class="var">focused</span> <span class="punct">}}</span><span class="punct">&gt;</span>`),
    l(31, `      <span class="punct">&lt;</span><span class="tag">canvas</span>`),
    l(32, `        <span class="attr">ref</span><span class="op">=</span><span class="punct">{</span><span class="var">canvasRef</span><span class="op">!</span><span class="punct">}</span>`),
    l(33, `        <span class="attr">tabIndex</span><span class="op">=</span><span class="str">"0"</span>`),
    l(34, `        <span class="attr">onKeyDown</span><span class="op">=</span><span class="punct">{</span><span class="var">keyHandler</span><span class="punct">.</span><span class="var">handle</span><span class="punct">}</span>`),
    l(35, `      <span class="punct">/&gt;</span>`),
    l(36, `    <span class="punct">&lt;/</span><span class="tag">div</span><span class="punct">&gt;</span>`),
    l(37, `  <span class="punct">)</span><span class="punct">;</span>`),
    l(38, `<span class="punct">}</span>`),
  ],
};

export const HandlerCode: CodeFile = {
  path: ['crates', 'ce-core', 'src', 'nvim', 'handler.rs'],
  language: 'rust',
  branch: 'main',
  dirty: true,
  symbols: ['impl Handler', 'handle_notify'],
  lines: [
    l(1,  `<span class="kw">use</span> <span class="type">async_trait</span><span class="op">::</span><span class="fn">async_trait</span><span class="punct">;</span>`),
    l(2,  `<span class="kw">use</span> <span class="type">nvim_rs</span><span class="op">::</span><span class="punct">{</span><span class="type">Handler</span><span class="punct">,</span> <span class="type">Neovim</span><span class="punct">,</span> <span class="type">Value</span><span class="punct">}</span><span class="punct">;</span>`),
    l(3,  `<span class="kw">use</span> <span class="kw">crate</span><span class="op">::</span><span class="type">grid</span><span class="op">::</span><span class="type">GridState</span><span class="punct">;</span>`),
    l(4,  ``),
    l(5,  `<span class="cmt">/// Redraw event handler — parses UI events from Neovim</span>`),
    l(6,  `<span class="cmt">/// and forwards dirty regions to the frontend channel.</span>`),
    l(7,  `<span class="kw">pub struct</span> <span class="type">RedrawHandler</span> <span class="punct">{</span>`),
    l(8,  `    <span class="kw">pub</span> <span class="var">grid</span><span class="op">:</span> <span class="type">Arc</span><span class="op">&lt;</span><span class="type">Mutex</span><span class="op">&lt;</span><span class="type">GridState</span><span class="op">&gt;&gt;</span><span class="punct">,</span>`),
    l(9,  `    <span class="kw">pub</span> <span class="var">tx</span><span class="op">:</span> <span class="type">Sender</span><span class="op">&lt;</span><span class="type">RedrawEvent</span><span class="op">&gt;</span><span class="punct">,</span>`),
    l(10, `<span class="punct">}</span>`),
    l(11, ``),
    l(12, `<span class="punct">#[</span><span class="fn">async_trait</span><span class="punct">]</span>`),
    l(13, `<span class="kw">impl</span> <span class="type">Handler</span> <span class="kw">for</span> <span class="type">RedrawHandler</span> <span class="punct">{</span>`, { hunk: 'b' }),
    l(14, `    <span class="kw">type</span> <span class="type">Writer</span> <span class="op">=</span> <span class="type">Compat</span><span class="op">&lt;</span><span class="type">ChildStdin</span><span class="op">&gt;</span><span class="punct">;</span>`, { hunk: 'b' }),
    l(15, ``),
    l(16, `    <span class="kw">async fn</span> <span class="fn">handle_notify</span><span class="punct">(</span>`),
    l(17, `        <span class="op">&amp;</span><span class="this">self</span><span class="punct">,</span>`),
    l(18, `        <span class="var">name</span><span class="op">:</span> <span class="type">String</span><span class="punct">,</span>`),
    l(19, `        <span class="var">args</span><span class="op">:</span> <span class="type">Vec</span><span class="op">&lt;</span><span class="type">Value</span><span class="op">&gt;</span><span class="punct">,</span>`),
    l(20, `        <span class="var">_neovim</span><span class="op">:</span> <span class="type">Neovim</span><span class="op">&lt;</span><span class="type">Self</span><span class="op">::</span><span class="type">Writer</span><span class="op">&gt;</span><span class="punct">,</span>`),
    l(21, `    <span class="punct">)</span> <span class="punct">{</span>`),
    l(22, `        <span class="kw">if</span> <span class="var">name</span> <span class="op">!=</span> <span class="str">"redraw"</span> <span class="punct">{</span> <span class="kw">return</span><span class="punct">;</span> <span class="punct">}</span>`),
    l(23, ``),
    l(24, `        <span class="kw">let mut</span> <span class="var">grid</span> <span class="op">=</span> <span class="this">self</span><span class="punct">.</span><span class="var">grid</span><span class="punct">.</span><span class="fn">lock</span><span class="punct">()</span><span class="punct">.</span><span class="kw">await</span><span class="punct">;</span>`, { current: true }),
    l(25, `        <span class="kw">for</span> <span class="var">batch</span> <span class="kw">in</span> <span class="var">args</span> <span class="punct">{</span>`),
    l(26, `            <span class="kw">let</span> <span class="var">arr</span> <span class="op">=</span> <span class="var">batch</span><span class="punct">.</span><span class="fn">as_array</span><span class="punct">()</span><span class="punct">.</span><span class="fn">unwrap</span><span class="punct">()</span><span class="punct">;</span>`),
    l(27, `            <span class="kw">let</span> <span class="var">kind</span> <span class="op">=</span> <span class="var">arr</span><span class="punct">[</span><span class="num">0</span><span class="punct">]</span><span class="punct">.</span><span class="fn">as_str</span><span class="punct">()</span><span class="punct">.</span><span class="fn">unwrap</span><span class="punct">()</span><span class="punct">;</span>`),
    l(28, `            <span class="kw">match</span> <span class="var">kind</span> <span class="punct">{</span>`),
    l(29, `                <span class="str">"grid_line"</span>        <span class="op">=></span> <span class="var">grid</span><span class="punct">.</span><span class="fn">apply_line</span><span class="punct">(</span><span class="op">&amp;</span><span class="var">arr</span><span class="punct">[</span><span class="num">1</span><span class="op">..</span><span class="punct">])</span><span class="punct">,</span>`),
    l(30, `                <span class="str">"grid_scroll"</span>      <span class="op">=></span> <span class="var">grid</span><span class="punct">.</span><span class="fn">apply_scroll</span><span class="punct">(</span><span class="op">&amp;</span><span class="var">arr</span><span class="punct">[</span><span class="num">1</span><span class="op">..</span><span class="punct">])</span><span class="punct">,</span>`),
    l(31, `                <span class="str">"grid_resize"</span>      <span class="op">=></span> <span class="var">grid</span><span class="punct">.</span><span class="fn">apply_resize</span><span class="punct">(</span><span class="op">&amp;</span><span class="var">arr</span><span class="punct">[</span><span class="num">1</span><span class="op">..</span><span class="punct">])</span><span class="punct">,</span>`),
    l(32, `                <span class="str">"hl_attr_define"</span>   <span class="op">=></span> <span class="var">grid</span><span class="punct">.</span><span class="fn">apply_hl_attr</span><span class="punct">(</span><span class="op">&amp;</span><span class="var">arr</span><span class="punct">[</span><span class="num">1</span><span class="op">..</span><span class="punct">])</span><span class="punct">,</span>`),
    l(33, `                <span class="str">"flush"</span>            <span class="op">=></span> <span class="this">self</span><span class="punct">.</span><span class="fn">flush_diff</span><span class="punct">(</span><span class="op">&amp;</span><span class="var">grid</span><span class="punct">)</span><span class="punct">.</span><span class="kw">await</span><span class="punct">,</span>`),
    l(34, `                <span class="var">_</span> <span class="op">=></span> <span class="punct">{}</span><span class="punct">,</span>`, { diagnostic: 'unused match arm', diagType: 'w' }),
    l(35, `            <span class="punct">}</span>`),
    l(36, `        <span class="punct">}</span>`),
    l(37, `    <span class="punct">}</span>`),
    l(38, `<span class="punct">}</span>`),
  ],
};

// ============ PALETTE ITEMS ============
export const PaletteSections: PaletteSection[] = [
  { label: 'Files', items: [
    { kind: 'file', icon: 'tsx', primary: 'PaneView.tsx', secondary: 'packages/ui/src/components/panes', kbd: '↵' },
    { kind: 'file', icon: 'rs',  primary: 'handler.rs',   secondary: 'crates/ce-core/src/nvim', kbd: '' },
    { kind: 'file', icon: 'rs',  primary: 'process.rs',   secondary: 'crates/ce-core/src/nvim', kbd: '' },
    { kind: 'file', icon: 'tsx', primary: 'PaneContainer.tsx', secondary: 'packages/ui/src/components/panes', kbd: '' },
  ]},
  { label: 'Commands', items: [
    { kind: 'cmd', icon: 'split',    primary: 'Split Pane Vertically', secondary: 'workbench.action.splitEditor', kbd: '⌘⇧\\' },
    { kind: 'cmd', icon: 'git',      primary: 'Git: Open Panel',       secondary: 'git.openPanel', kbd: '⌘K G' },
    { kind: 'cmd', icon: 'terminal', primary: 'Toggle Terminal',       secondary: 'workbench.action.toggleTerminal', kbd: '⌃`' },
    { kind: 'cmd', icon: 'settings', primary: 'Open Settings',         secondary: 'workbench.action.openSettings', kbd: '⌘,' },
  ]},
];

// ============ GIT PANEL DATA ============
export const GitStatus: GitStatusData = {
  branch: 'feat/pane-system',
  upstream: 'origin/feat/pane-system',
  ahead: 3,
  behind: 0,
  staged: [
    { status: 'M', path: 'crates/ce-core/src/nvim/handler.rs', plus: 47, minus: 12 },
    { status: 'A', path: 'crates/ce-core/src/nvim/input.rs',   plus: 86, minus: 0 },
  ],
  unstaged: [
    { status: 'M', path: 'packages/ui/src/components/panes/PaneView.tsx', plus: 23, minus: 5, active: true },
    { status: 'M', path: 'packages/ui/src/components/panes/PaneContainer.tsx', plus: 9, minus: 3 },
    { status: 'M', path: 'packages/ui/src/App.tsx', plus: 4, minus: 1 },
    { status: 'U', path: 'README.md', plus: 0, minus: 0 },
  ],
};

export const GitDiff: GitDiffData = {
  path: 'packages/ui/src/components/panes/PaneView.tsx',
  plus: 23, minus: 5,
  hunks: [
    { header: '@@ -14,8 +14,12 @@  export function PaneView(props: PaneProps) {', lines: [
      { type: 'ctx', old: 14, new: 14, sign: ' ', text: `  <span class="kw">const</span> <span class="var">renderer</span> <span class="op">=</span> <span class="kw">new</span> <span class="fn">GridRenderer</span><span class="punct">({</span>` },
      { type: 'ctx', old: 15, new: 15, sign: ' ', text: `    <span class="prop">font</span><span class="op">:</span> <span class="var">props</span><span class="punct">.</span><span class="var">theme</span><span class="punct">.</span><span class="var">font</span><span class="punct">,</span>` },
      { type: 'del', old: 16, new: null, sign: '-', text: `    <span class="prop">cellSize</span><span class="op">:</span> <span class="punct">{</span> <span class="prop">w</span><span class="op">:</span> <span class="num">7</span><span class="punct">,</span> <span class="prop">h</span><span class="op">:</span> <span class="num">16</span> <span class="punct">}</span><span class="punct">,</span>` },
      { type: 'add', old: null, new: 16, sign: '+', text: `    <span class="prop">cellSize</span><span class="op">:</span> <span class="punct">{</span> <span class="prop">w</span><span class="op">:</span> <span class="num">8</span><span class="punct">,</span> <span class="prop">h</span><span class="op">:</span> <span class="num">18</span> <span class="punct">}</span><span class="punct">,</span>` },
      { type: 'add', old: null, new: 17, sign: '+', text: `    <span class="prop">palette</span><span class="op">:</span> <span class="var">props</span><span class="punct">.</span><span class="var">theme</span><span class="punct">.</span><span class="var">palette</span><span class="punct">,</span>` },
      { type: 'add', old: null, new: 18, sign: '+', text: `    <span class="prop">cursorStyle</span><span class="op">:</span> <span class="str">'block'</span><span class="punct">,</span>` },
      { type: 'ctx', old: 17, new: 19, sign: ' ', text: `  <span class="punct">})</span><span class="punct">;</span>` },
      { type: 'ctx', old: 18, new: 20, sign: ' ', text: `` },
    ]},
    { header: '@@ -32,11 +36,14 @@  createEffect(async () => {', lines: [
      { type: 'ctx', old: 32, new: 36, sign: ' ', text: `    <span class="var">channel</span><span class="punct">.</span><span class="prop">onmessage</span> <span class="op">=</span> <span class="punct">(</span><span class="var">evt</span><span class="punct">)</span> <span class="op">=></span> <span class="punct">{</span>` },
      { type: 'del', old: 33, new: null, sign: '-', text: `      <span class="var">renderer</span><span class="punct">.</span><span class="fn">apply</span><span class="punct">(</span><span class="var">evt</span><span class="punct">)</span><span class="punct">;</span>` },
      { type: 'add', old: null, new: 37, sign: '+', text: `      <span class="kw">if</span> <span class="punct">(</span><span class="var">props</span><span class="punct">.</span><span class="var">focused</span><span class="punct">)</span> <span class="var">renderer</span><span class="punct">.</span><span class="fn">apply</span><span class="punct">(</span><span class="var">evt</span><span class="punct">)</span><span class="punct">;</span>` },
      { type: 'add', old: null, new: 38, sign: '+', text: `      <span class="kw">else</span> <span class="var">pending</span><span class="punct">.</span><span class="fn">push</span><span class="punct">(</span><span class="var">evt</span><span class="punct">)</span><span class="punct">;</span>` },
      { type: 'ctx', old: 34, new: 39, sign: ' ', text: `    <span class="punct">}</span><span class="punct">;</span>` },
    ]},
  ],
};

// ============ SEARCH RESULTS ============
export const SearchResults: SearchResultsData = {
  query: 'renderer',
  replace: '',
  files: [
    { path: 'packages/ui/src/renderer/GridRenderer.ts', matches: [
      { ln: 12, before: 'export class ', hl: 'renderer', after: ' implements GridSink {' },
      { ln: 47, before: 'this.', hl: 'renderer', after: '.cols = Math.floor(w / cell.w);' },
    ]},
    { path: 'packages/ui/src/components/panes/PaneView.tsx', matches: [
      { ln: 9,  before: 'const ', hl: 'renderer', after: ' = new GridRenderer({' },
      { ln: 17, before: 'channel.onmessage = (evt) => ', hl: 'renderer', after: '.apply(evt);' },
      { ln: 21, before: '      cols: ', hl: 'renderer', after: '.cols,' },
      { ln: 22, before: '      rows: ', hl: 'renderer', after: '.rows,' },
    ]},
    { path: 'crates/ce-core/src/grid/diff.rs', matches: [
      { ln: 34, before: '// batched before forward to ', hl: 'renderer', after: '' },
    ]},
  ],
};

// ============ MINIMAP BUFFERS ============
export const MinimapBuffers: MinimapBuffer[] = [
  { icon: 'tsx', name: 'PaneView.tsx', lines: 38, active: true },
  { icon: 'rs',  name: 'handler.rs',   lines: 96 },
  { icon: 'rs',  name: 'process.rs',   lines: 124 },
  { icon: 'toml',name: 'Cargo.toml',   lines: 48 },
  { icon: 'md',  name: 'README.md',    lines: 210 },
  { icon: 'tsx', name: 'App.tsx',      lines: 64 },
];

function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthMinimap(count = 120): MinimapLine[] {
  const out: MinimapLine[] = [];
  const rand = mulberry32(42);
  for (let i = 0; i < count; i++) {
    const r = rand();
    let cls = '';
    let w = 0;
    if (r < 0.08)        { cls = 'blank'; w = 0; }
    else if (r < 0.18)   { cls = 'cmt';   w = 30 + rand() * 40; }
    else if (r < 0.32)   { cls = 'kw';    w = 25 + rand() * 55; }
    else if (r < 0.5)    { cls = 'fn';    w = 30 + rand() * 50; }
    else if (r < 0.62)   { cls = 'str';   w = 20 + rand() * 40; }
    else                 { cls = '';      w = 30 + rand() * 60; }
    out.push({ cls, w });
  }
  return out;
}
