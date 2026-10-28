/**
 * The library's tag filter (S26, R3.14): a labeled tag field with Filter, writing ?tag= to the
 * URL (the route validates it again, drills/search.ts), and, while a filter is on, a line naming
 * it with a link back to every drill. A value that is not a tag is refused here with the rule in
 * words, so GET /drills never sees it.
 */
import { Link } from "@tanstack/react-router";
import { useId, useState, type FormEvent } from "react";

import { Button } from "../../components/ui/index.js";
import { TAG_PATTERN } from "../../drills/limits.js";
import { ErrorText } from "./form-parts.js";

export interface TagFilterProps {
  tag: string | undefined;
  onFilter: (tag: string) => void;
}

const NOT_A_TAG = "A tag is lower-case letters, digits, - and _, starting with a letter or digit.";

export function TagFilter({ tag, onFilter }: TagFilterProps) {
  const id = useId();
  const [text, setText] = useState(tag ?? "");
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = text.trim();
    const ok = TAG_PATTERN.test(value);
    setInvalid(!ok);
    if (ok) onFilter(value);
  }

  return (
    <div className="flex flex-col gap-2">
      <form role="search" aria-label="Filter drills by tag" onSubmit={submit} className="flex flex-wrap items-end gap-2 text-sm" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="font-medium">
            Tag
          </label>
          <input
            id={id}
            type="text"
            value={text}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${id}-error` : undefined}
            onChange={(event) => setText(event.target.value)}
            className="h-9 rounded-md border border-border bg-surface-raised px-2"
          />
        </div>
        <Button type="submit">Filter</Button>
      </form>
      <ErrorText id={`${id}-error`} messages={invalid ? [NOT_A_TAG] : undefined} />
      {tag === undefined ? null : (
        <p className="text-sm" data-testid="tag-filter-note">
          {`Showing drills tagged ${tag}. `}
          <Link to="/drills" className="underline">
            Show all drills
          </Link>
        </p>
      )}
    </div>
  );
}
