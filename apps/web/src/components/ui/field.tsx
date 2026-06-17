"use client";

// Form controls — one Toybox input treatment instead of the ~8 raw <input>/
// <textarea> scattered across screens (2px ink outline, cream-on-white,
// pink focus border). `Input`/`Textarea` are styled native elements for
// standalone use (search, chat, comment). `Field` + `FieldLabel` + `FieldError`
// wrap base-ui Field for labelled, validated forms (welcome email/name).
import { Field as BaseField } from "@base-ui-components/react/field";
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

export const inputClass =
  "w-full border-2 border-ink rounded-toy bg-card px-4 py-3 text-body font-semibold text-ink placeholder:text-faint outline-none transition-shadow focus:border-pink focus:ring-[3px] focus:ring-pink/30 disabled:opacity-50 disabled:bg-paper";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputClass, className)} {...rest} />;
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(inputClass, "resize-none", className)}
      {...rest}
    />
  );
});

export function Field({
  children,
  className,
  invalid,
  name,
}: {
  children: ReactNode;
  className?: string;
  invalid?: boolean;
  name?: string;
}) {
  return (
    <BaseField.Root
      name={name}
      invalid={invalid}
      className={cx("flex flex-col gap-1.5", className)}
    >
      {children}
    </BaseField.Root>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <BaseField.Label className="text-small font-bold text-muted">
      {children}
    </BaseField.Label>
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  return (
    <BaseField.Error className="text-small font-semibold text-pink">
      {children}
    </BaseField.Error>
  );
}

/** A base-ui-integrated control (validity wiring) styled like `Input`. */
export const FieldInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function FieldInput({ className, ...rest }, ref) {
  return (
    <BaseField.Control
      ref={ref}
      className={cx(inputClass, className)}
      {...rest}
    />
  );
});
