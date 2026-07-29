import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  children: ReactNode;
  label: string;
};

export function IconButton({ children, label, title = label, ...buttonProps }: IconButtonProps) {
  return (
    <button
      {...buttonProps}
      aria-label={label}
      className={`icon-button ${buttonProps.className ?? ""}`.trim()}
      title={title}
    >
      {children}
    </button>
  );
}
