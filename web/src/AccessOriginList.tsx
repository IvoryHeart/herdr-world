import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type Props = {
  label: string;
  values: string[];
  suggestions?: readonly string[];
  onChange: (values: string[]) => void;
};

export function AccessOriginList({ label, values, suggestions = [], onChange }: Props) {
  const [input, setInput] = useState("");

  return (
    <div className="remote-access-permission-list">
      <span>{label}</span>
      {values.map((value) => (
        <div className="remote-access-chip" key={value}>
          <span>{value}</span>
          <button
            type="button"
            aria-label={`Remove ${value}`}
            onClick={() => onChange(values.filter((item) => item !== value))}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      {suggestions.filter((item) => !values.includes(item)).map((suggestion) => (
        <label className="remote-access-suggestion" key={suggestion}>
          <input
            type="checkbox"
            checked={false}
            onChange={(event) => {
              if (event.target.checked) onChange([...values, suggestion]);
            }}
          />
          <span>{suggestion}</span>
          <small>Suggested</small>
        </label>
      ))}
      <div className="remote-access-add-row">
        <input
          className="field"
          aria-label={`Add ${label.toLowerCase()}`}
          placeholder="http(s)://host:port"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button
          type="button"
          className="btn"
          onClick={() => {
            const value = input.trim();
            if (value && !values.includes(value)) {
              onChange([...values, value]);
              setInput("");
            }
          }}
        >
          <Plus size={13} /> Add
        </button>
      </div>
    </div>
  );
}

export function uniqueHttpOrigins(values: readonly (string | undefined)[]) {
  const origins: string[] = [];
  for (const value of values) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.pathname === "/" &&
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash &&
        !origins.includes(parsed.origin)
      ) {
        origins.push(parsed.origin);
      }
    } catch {
      // Suggestions are optional and untrusted profile values are ignored.
    }
  }
  return origins.slice(0, 32);
}
