/** Settings persisted by the native application. */
export interface LspServerSettings {
  id: string;
  enabled: boolean;
  executable: string | null;
}

export interface AppSettings {
  theme: string;
  editor_theme: string;
  density: string;
  app_zoom: number;
  ui_font_size: number;
  font_family: string;
  font_size: number;
  line_height: number;
  word_wrap: boolean;
  tab_size: number;
  lsp_enabled: boolean;
  lsp_servers: LspServerSettings[];
  codex_path: string | null;
  pipeline_agent_instructions: string;
}
