// Re-exports for the design system port.

export * from './types';
export { Icons } from './icons';
export { Icon, FileIcon } from './Icon';
export { MarkdownText } from './MarkdownText';
export { Select } from './forms/Select';
export type { SelectOption, SelectProps } from './forms/Select';

// Chrome
export { TitleBar } from './chrome/TitleBar';
export type { TitleBarProps } from './chrome/TitleBar';
export { PageSwitcher } from './chrome/PageSwitcher';
export type { PageSwitcherProps, PageKey } from './chrome/PageSwitcher';
export { ProjectSwitcher } from './chrome/ProjectSwitcher';
export { Sidebar } from './chrome/Sidebar';
export type { SidebarProps } from './chrome/Sidebar';
export { Breadcrumbs } from './chrome/Breadcrumbs';
export type { BreadcrumbsProps } from './chrome/Breadcrumbs';
export { StatusBar } from './chrome/StatusBar';
export type { StatusBarProps } from './chrome/StatusBar';

// Overlays
export { CommandPalette } from './overlays/CommandPalette';
export type { CommandPaletteProps, PaletteCommand } from './overlays/CommandPalette';
export { Minimap } from './overlays/Minimap';
export type { MinimapProps } from './overlays/Minimap';
export { SearchReplace } from './overlays/SearchReplace';
export type { SearchReplaceProps } from './overlays/SearchReplace';
export { GitPanel } from './overlays/GitPanel';
export type { GitPanelProps } from './overlays/GitPanel';
export { SettingsPanel } from './overlays/SettingsPanel';
export type { SettingsPanelProps } from './overlays/SettingsPanel';
