/** Settings persisted by the native application. */
export interface AppSettings {
  theme: string;
  density: string;
  font_family: string;
  font_size: number;
  line_height: number;
  word_wrap: boolean;
  tab_size: number;
  codex_path: string | null;
}
