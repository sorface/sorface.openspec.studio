export interface AgentEditResult {
  markdown: string;
  replacement: string;
}

export interface AgentEditSelection {
  text: string;
  prefix?: string;
  suffix?: string;
}
