"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface TagInputProps {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  max?: number;
}

/** Free-text list input: Enter or comma adds a tag, Backspace on empty removes the last. */
export function TagInput({ id, value, onChange, placeholder, disabled, max = 30 }: TagInputProps) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const tag = raw.trim().slice(0, 80);
    if (!tag || value.some((v) => v.toLowerCase() === tag.toLowerCase()) || value.length >= max) return;
    onChange([...value, tag]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
      setDraft("");
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1">
              {tag}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${tag}`}
                  className="rounded-sm hover:bg-muted-foreground/20"
                  onClick={() => onChange(value.filter((v) => v !== tag))}
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      <Input
        id={id}
        value={draft}
        disabled={disabled}
        placeholder={placeholder ?? "Type and press Enter"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          add(draft);
          setDraft("");
        }}
      />
    </div>
  );
}
