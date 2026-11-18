// Fiori Horizon is a CSS component set: components are class names on plain HTML (see each component's README).
// These types document the options as markup props; window.FioriHorizon only carries small helpers.

export type ValueState = "none" | "error" | "warning" | "success" | "information";
export type Density = "cozy" | "compact";

/** <button class="fh-btn fh-btn--{design}"> */
export interface ButtonProps {
  /** default | emphasized | transparent | positive | negative | attention → class fh-btn--{design} */
  design?: "default" | "emphasized" | "transparent" | "positive" | "negative" | "attention";
  /** Icon name from the SAP-icons-v5 set, rendered in <span class="fh-icon" data-icon> */
  icon?: string;
  /** Icon only (class fh-btn--icon); requires aria-label */
  iconOnly?: boolean;
  /** Toggle button state → aria-pressed */
  pressed?: boolean;
  disabled?: boolean;
}

/** <a class="fh-link"> */
export interface LinkProps { href: string; }

/** <span class="fh-input fh-input--{valueState}"><input></span> inside <label class="fh-field"> */
export interface InputProps {
  label: string;
  required?: boolean;
  placeholder?: string;
  valueState?: ValueState;
  /** Shown under the field in .fh-valuestate for error and warning */
  valueStateMessage?: string;
  readonly?: boolean;
  disabled?: boolean;
  /** Trailing icon, e.g. "search", "calendar" */
  icon?: string;
}

/** <span class="fh-input fh-input--select" role="combobox"> */
export interface SelectProps { label: string; value?: string; placeholder?: string; valueState?: ValueState; }

/** <label class="fh-checkbox"><input type="checkbox"><span class="fh-checkbox__box"></span>text</label> */
export interface CheckBoxProps { text?: string; checked?: boolean; valueState?: "none" | "error"; disabled?: boolean; }

/** <label class="fh-switch"><input type="checkbox" role="switch"><span class="fh-switch__track"></span>text</label> */
export interface SwitchProps { text?: string; checked?: boolean; }

/** <span class="fh-status fh-status--{state}"> */
export interface ObjectStatusProps {
  state?: "none" | "success" | "error" | "warning" | "information";
  inverted?: boolean;
  /** message-success | message-error | message-warning | message-information */
  icon?: string;
}

/** <span class="fh-tag fh-tag--{design}"> */
export interface TagProps { design?: "neutral" | "success" | "error" | "warning" | "information"; }

/** <div class="fh-msg fh-msg--{design}"> */
export interface MessageStripProps { design?: "neutral" | "information" | "success" | "warning" | "error"; closable?: boolean; }

/** <span class="fh-avatar fh-avatar--{size} fh-avatar--{scheme}"> */
export interface AvatarProps {
  size?: "xs" | "s" | "m" | "l";
  shape?: "circle" | "square";
  colorScheme?: "accent1" | "accent2" | "accent5" | "accent6" | "placeholder";
  initials?: string;
  icon?: string;
}

/** <span class="fh-icon" data-icon="{name}"> */
export interface IconProps { name: string; size?: "m" | "l" | "xl"; }

/** <header class="fh-shellbar"> */
export interface ShellBarProps {
  primaryTitle: string;
  secondaryTitle?: string;
  showSearch?: boolean;
  notificationsCount?: number;
  userInitials?: string;
}

/** <div class="fh-toolbar"> or <footer class="fh-footer"> */
export interface ToolbarProps { title?: string; variant?: "toolbar" | "footer"; }

/** <div class="fh-card"> */
export interface CardProps { title: string; subtitle?: string; status?: string; interactive?: boolean; }

/** <table class="fh-table"> inside .fh-table-wrap */
export interface TableProps {
  selectionMode?: "none" | "multi";
  /** Rows navigate: tr.is-interactive and a trailing .fh-nav chevron */
  navigable?: boolean;
  density?: Density;
}

/** <nav class="fh-tabs"><button class="fh-tab" aria-selected> */
export interface TabsProps { items: { text: string; count?: number; selected?: boolean }[]; }

/** <section class="fh-objheader"> */
export interface ObjectPageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumb?: string[];
  status?: ObjectStatusProps & { text: string };
  attributes?: { label: string; value: string }[];
}

/** <div class="fh-dialog" role="dialog"> over <div class="fh-blocklayer"> */
export interface DialogProps { headerText: string; state?: "none" | "error" | "warning"; }

/** Floorplan page: ShellBar + filter bar + table */
export interface ListReportProps { title: string; count?: number; }

// ---------- AI (SAP AI and Joule Design) ----------

/** <button class="fh-btn fh-ai-btn"> with the "ai" icon */
export interface AIButtonProps {
  text: string;
  state?: "generate" | "generating" | "revise";
  design?: "default" | "emphasized" | "transparent";
  variant?: "button" | "menu" | "split";
}

/** <div class="fh-prompt [fh-prompt--large]"> */
export interface AIPromptInputProps { placeholder?: string; maxLength?: number; size?: "default" | "large"; busy?: boolean; }

/** AI menu button + <div class="fh-menu"> */
export interface QuickPromptsProps { items: { text: string; submenu?: string[] }[]; }

/** <span class="fh-ai-notice [fh-ai-notice--local]"> */
export interface AINoticeProps {
  scope?: "global" | "local";
  kind?: "general" | "generated" | "recommended" | "predicted" | "created";
}

/** <span class="fh-ai-mark"> or <span class="fh-input fh-input--ai"> */
export interface AIHighlightProps { on?: boolean; }

/** <div class="fh-response-actions"> (+ .fh-feedback) */
export interface ResponseFeedbackProps { feedback?: "none" | "up" | "down"; }

// ---------- Agents (intentional additions) ----------

export type AgentState = "running" | "waiting" | "completed" | "failed" | "paused";

/** <section class="fh-convo"> */
export interface AgentConversationProps { title?: string; busyText?: string; }

/** <div class="fh-agent-card"> */
export interface AgentCardProps { name: string; goal: string; state: AgentState; progress?: number; lastAction?: string; }

/** <ol class="fh-steps"> */
export interface AgentStepsProps { steps: { title: string; detail?: string; time?: string; state: "done" | "running" | "waiting" | "failed" | "pending" }[]; }

/** <article class="fh-approval"> */
export interface ApprovalRequestProps {
  agent: string;
  action: string;
  attributes?: { label: string; value: string }[];
  reasons: string[];
  sources?: { text: string; href: string }[];
}

/** "Why?" button + <div class="fh-popover"> */
export interface ExplanationProps { reasoning: string; sources: { text: string; href: string }[]; }

/** Greeting + large prompt + intent chips */
export interface IntentPromptProps { greeting: string; summary?: string; intents: { text: string; icon?: string }[]; }

/** Floorplan page: rail + main + attention panel */
export interface AgentWorkspaceProps { title: string; context?: string; }

export interface FioriHorizonNamespace {
  version: string;
  /** Version of @ui5/webcomponents-icons the icon loader pins */
  iconVersion: string;
  /** jsDelivr ESM URL whose module exports pathData for the named icon */
  iconUrl(name: string): string;
  /** SVG markup for pathData exported by an icon module */
  iconSvg(pathData: string | string[]): string;
  setDensity(el: Element | null, mode: Density): void;
  setTheme(id: "light" | "dark"): void;
}
