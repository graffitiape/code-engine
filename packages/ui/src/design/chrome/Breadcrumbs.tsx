// Path + symbol breadcrumbs above each pane.

import { For, Show } from 'solid-js';
import type { CodeFile, DiagCounts } from '../types';
import { Icon, FileIcon } from '../Icon';

export interface BreadcrumbsProps {
  file: CodeFile | null | undefined;
  diagCounts: DiagCounts;
  lspName?: string;
}

export function Breadcrumbs(props: BreadcrumbsProps) {
  return (
    <Show when={props.file} fallback={<div class="breadcrumbs" />}>
      {(file) => (
        <div class="breadcrumbs" data-screen-label="Breadcrumbs">
          <For each={file().path}>
            {(seg, i) => {
              const isLast = () => i() === file().path.length - 1;
              const ext = () => {
                const last = file().path[file().path.length - 1];
                return last.split('.').pop() || 'file';
              };
              return (
                <>
                  <span class={`crumb ${isLast() ? 'current' : ''}`}>
                    <Show when={isLast()}>
                      <FileIcon type={ext()} />
                    </Show>
                    {seg}
                  </span>
                  <Show when={!isLast()}>
                    <Icon name="chevronRight" class="sep" style={{ width: '10px', height: '10px' }} />
                  </Show>
                </>
              );
            }}
          </For>
          <Show when={file().symbols && file().symbols!.length > 0}>
            <Icon
              name="chevronRight"
              class="sep"
              style={{ width: '10px', height: '10px', 'margin-left': '4px' }}
            />
            <For each={file().symbols}>
              {(s, i) => (
                <>
                  <span class="crumb">
                    <span
                      style={{
                        color: 'var(--cyan)',
                        'font-weight': '700',
                        'font-family': 'var(--font-mono)',
                        'font-size': '10px',
                      }}
                    >
                      ƒ
                    </span>
                    {s}
                  </span>
                  <Show when={i() < file().symbols!.length - 1}>
                    <Icon
                      name="chevronRight"
                      class="sep"
                      style={{ width: '10px', height: '10px' }}
                    />
                  </Show>
                </>
              )}
            </For>
          </Show>
          <div class="right">
            <span class="lsp">
              <span class="pulse" />
              {props.lspName ?? 'tsserver'}
            </span>
            <span style={{ color: 'var(--red)' }}>● {props.diagCounts.error}</span>
            <span style={{ color: 'var(--yellow)' }}>▲ {props.diagCounts.warn}</span>
          </div>
        </div>
      )}
    </Show>
  );
}
