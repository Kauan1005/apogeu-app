"use client";
import { useState } from "react";
import { Icon } from "./ui";

/** Campo de senha com olho para mostrar ou esconder o que foi digitado. */
export function PasswordInput({ name, autoComplete, minLength, required = true }: { name: string; autoComplete: "current-password" | "new-password"; minLength?: number; required?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw">
      <input className="input" name={name} type={show ? "text" : "password"} autoComplete={autoComplete} required={required} minLength={minLength}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="button" className="pw-eye" aria-label={show ? "Esconder a senha" : "Mostrar a senha"} aria-pressed={show} onClick={() => setShow((v) => !v)}>
        <Icon name={show ? "eyeoff" : "eye"} size="sm" />
      </button>
    </span>
  );
}
