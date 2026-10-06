"use client";

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { s } from "@/lib/style";

function merge(css: string, extra?: string, on?: boolean): CSSProperties {
  return s(extra && on ? css + ";" + extra : css);
}

interface AProps {
  href: string;
  css: string;
  hover?: string;
  children: ReactNode;
  onClick?: (e: any) => void;
  target?: string;
  rel?: string;
  title?: string;
  ["aria-label"]?: string;
}

export function A({ href, css, hover, children, onClick, target, rel, ...rest }: AProps) {
  const [h, setH] = useState(false);
  const external = /^https?:/.test(href) || target === "_blank";
  const style = merge(css, hover, h);
  const handlers = {
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    onClick,
    style,
    ...rest,
  };
  if (external) {
    return (
      <a href={href} target={target} rel={rel} {...handlers}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} {...handlers}>
      {children}
    </Link>
  );
}

interface BtnProps {
  css: string;
  hover?: string;
  children: ReactNode;
  onClick?: (e: any) => void;
  disabled?: boolean;
  type?: "button" | "submit";
  tabIndex?: number;
  ["aria-label"]?: string;
}

export function Btn({ css, hover, children, onClick, disabled, type = "button", ...rest }: BtnProps) {
  const [h, setH] = useState(false);
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={merge(css, hover, h && !disabled)}
      {...rest}
    >
      {children}
    </button>
  );
}

interface BoxProps {
  tag?: "div" | "aside" | "span";
  css: string;
  hover?: string;
  children?: ReactNode;
  onClick?: (e: any) => void;
  onMouseEnter?: () => void;
  onFocus?: () => void;
  tabIndex?: number;
  role?: string;
  ["aria-label"]?: string;
}

export function Box({ tag = "div", css, hover, children, onMouseEnter, onFocus, ...rest }: BoxProps) {
  const [h, setH] = useState(false);
  const Tag = tag as any;
  return (
    <Tag
      onMouseEnter={() => {
        setH(true);
        onMouseEnter?.();
      }}
      onMouseLeave={() => setH(false)}
      onFocus={onFocus}
      style={merge(css, hover, h)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

interface FieldProps {
  id?: string;
  type?: string;
  value: string;
  onChange?: (e: any) => void;
  onKeyDown?: (e: any) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  readOnly?: boolean;
  css: string;
  focus?: string;
  spellCheck?: boolean;
  inputRef?: any;
}

export function Field({ css, focus, inputRef, ...rest }: FieldProps) {
  const [f, setF] = useState(false);
  return (
    <input
      ref={inputRef}
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      style={merge(css, focus, f)}
      {...rest}
    />
  );
}

interface AreaProps {
  value: string;
  onChange?: (e: any) => void;
  spellCheck?: boolean;
  disabled?: boolean;
  placeholder?: string;
  css: string;
}

export function Area({ css, ...rest }: AreaProps) {
  return <textarea style={s(css)} {...rest} />;
}
