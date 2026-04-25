// Re-exports for the design system port.

export * from './types';
export {
  Icons,
  FileTree,
  Tabs,
  PaneViewCode,
  HandlerCode,
  PaletteSections,
  GitStatus,
  GitDiff,
  SearchResults,
  MinimapBuffers,
  synthMinimap,
  l,
} from './data';
export { Icon, FileIcon } from './Icon';

// Chrome
export { TitleBar } from './chrome/TitleBar';
export type { TitleBarProps } from './chrome/TitleBar';
export { PageSwitcher } from './chrome/PageSwitcher';
export type { PageSwitcherProps, PageKey } from './chrome/PageSwitcher';
export { Sidebar } from './chrome/Sidebar';
export type { SidebarProps } from './chrome/Sidebar';
export { Breadcrumbs } from './chrome/Breadcrumbs';
export type { BreadcrumbsProps } from './chrome/Breadcrumbs';
export { NvimPaneMock } from './chrome/NvimPaneMock';
export type { NvimPaneMockProps } from './chrome/NvimPaneMock';
export { StatusBar } from './chrome/StatusBar';
export type { StatusBarProps } from './chrome/StatusBar';

// Overlays
export { CommandPalette } from './overlays/CommandPalette';
export type { CommandPaletteProps } from './overlays/CommandPalette';
export { Minimap } from './overlays/Minimap';
export type { MinimapProps } from './overlays/Minimap';
export { SearchReplace } from './overlays/SearchReplace';
export type { SearchReplaceProps } from './overlays/SearchReplace';
export { GitPanel } from './overlays/GitPanel';
export type { GitPanelProps } from './overlays/GitPanel';
export { SettingsPanel } from './overlays/SettingsPanel';
export type { SettingsPanelProps } from './overlays/SettingsPanel';

// Pipeline
export { I, PIcons, TicketSeed, STAGES, STAGE_DURATIONS, chatFor } from './pipeline/data';
export { TicketRail } from './pipeline/TicketRail';
export type { TicketRailProps } from './pipeline/TicketRail';
export { PipelineStage } from './pipeline/PipelineStage';
export type { PipelineStageProps } from './pipeline/PipelineStage';
export { ChatPanel } from './pipeline/ChatPanel';
export type { ChatPanelProps } from './pipeline/ChatPanel';
