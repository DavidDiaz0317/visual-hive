import type { ReactNode } from "react";
import { Check, Clipboard, ExternalLink, Loader2 } from "lucide-react";
import type { Tone } from "../types/controlPlane";

interface CardProps {
  title?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Card({ title, eyebrow, action, children, className = "" }: CardProps) {
  return (
    <section className={`vh-card ${className}`}>
      {(title || eyebrow || action) && (
        <header className="vh-card-header">
          <div>
            {eyebrow && <div className="vh-eyebrow">{eyebrow}</div>}
            {title && <h2>{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
  className = ""
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Card className={`metric metric-${tone} ${className}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {detail && <div className="metric-detail">{detail}</div>}
    </Card>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`vh-badge tone-${tone}`}>{children}</span>;
}

export function Button({
  children,
  ariaLabel,
  onClick,
  disabled,
  variant = "secondary",
  type = "button",
  title
}: {
  children: ReactNode;
  ariaLabel?: string;
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button aria-label={ariaLabel} className={`vh-button vh-button-${variant}`} disabled={disabled} onClick={onClick} type={type} title={title}>
      {children}
    </button>
  );
}

export function ConfirmButton({
  children,
  message,
  disabled,
  variant = "secondary",
  onConfirm
}: {
  children: ReactNode;
  message: string;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Button
      disabled={disabled}
      variant={variant}
      onClick={() => {
        if (window.confirm(message)) {
          void onConfirm();
        }
      }}
    >
      {children}
    </Button>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  return (
    <Button
      variant="ghost"
      title={label}
      onClick={async () => {
        await navigator.clipboard?.writeText(value);
      }}
    >
      <Clipboard size={15} />
      {label}
    </Button>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <Check size={20} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="loading-state">
      <Loader2 className="spin" size={20} />
      Loading Control Plane snapshot
    </div>
  );
}

export function CodeBlock({ value }: { value: string }) {
  return (
    <pre className="code-block">
      <code>{value}</code>
    </pre>
  );
}

export function KeyValueTable({ rows }: { rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <div className="kv-table">
      {rows.map(([key, value], index) => (
        <div className="kv-row" key={index}>
          <div className="kv-key">{key}</div>
          <div className="kv-value">{value}</div>
        </div>
      ))}
    </div>
  );
}

export function ExternalArtifactLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="artifact-link" href={href} rel="noreferrer" target="_blank">
      {label}
      <ExternalLink size={14} />
    </a>
  );
}

export function statusTone(status?: string): Tone {
  const normalized = (status ?? "").toLowerCase();
  if (["passed", "healthy", "ready", "approved", "success", "killed"].includes(normalized)) return "success";
  if (["failed", "error", "blocked", "missing_baseline", "rejected", "danger", "survived"].includes(normalized)) return "danger";
  if (["created", "warning", "review", "not_applicable", "missing"].includes(normalized)) return "warning";
  if (["running", "info", "planned"].includes(normalized)) return "info";
  return "neutral";
}

export function formatPercent(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}

export function safeText(value: unknown, fallback = "n/a") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
