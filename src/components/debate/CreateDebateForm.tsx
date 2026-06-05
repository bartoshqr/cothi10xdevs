import React, { useState } from "react";
import { MessageSquarePlus, Type, Flag } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { Button } from "@/components/ui/button";
import { NODE_CONSTRAINTS, DEBATE_CONSTRAINTS } from "@/lib/debate/nodeConstraints";

export default function CreateDebateForm() {
  const [title, setTitle] = useState("");
  const [rootTitle, setRootTitle] = useState("");
  const [rootBody, setRootBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ title?: string; rootTitle?: string }>({});

  function validate() {
    const next: typeof errors = {};
    if (!title.trim()) next.title = "Debate title is required";
    else if (title.length > DEBATE_CONSTRAINTS.title.max) next.title = `Max ${DEBATE_CONSTRAINTS.title.max} characters`;
    if (!rootTitle.trim()) next.rootTitle = "Root claim is required";
    else if (rootTitle.length > NODE_CONSTRAINTS.title.max)
      next.rootTitle = `Max ${NODE_CONSTRAINTS.title.max} characters`;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/debates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          rootTitle: rootTitle.trim(),
          rootBody: rootBody.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setServerError(`Could not create the debate (${res.status}). Please try again.`);
        setSubmitting(false);
        return;
      }
      const { id } = (await res.json()) as { id: string };
      // Full navigation into the editor, which server-loads the freshly created graph.
      window.location.href = `/debates/${id}`;
    } catch {
      setServerError("Network error. Please check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="title"
        label="Debate title"
        value={title}
        onChange={(v) => {
          setTitle(v);
          if (errors.title) setErrors((p) => ({ ...p, title: undefined }));
        }}
        placeholder="e.g. Should cities ban cars downtown?"
        error={errors.title}
        icon={<Type className="size-4" />}
      />

      <FormField
        id="rootTitle"
        label="Root claim"
        value={rootTitle}
        onChange={(v) => {
          setRootTitle(v);
          if (errors.rootTitle) setErrors((p) => ({ ...p, rootTitle: undefined }));
        }}
        placeholder="The central claim you'll defend"
        error={errors.rootTitle}
        icon={<Flag className="size-4" />}
      />

      <div>
        <label htmlFor="rootBody" className="text-foreground mb-1 block text-sm font-medium">
          Root claim details <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="rootBody"
          value={rootBody}
          maxLength={NODE_CONSTRAINTS.body.max}
          rows={3}
          onChange={(e) => {
            setRootBody(e.target.value);
          }}
          placeholder="Add supporting context for the root claim"
          className="bg-background border-input text-foreground placeholder:text-muted-foreground focus:ring-ring/50 w-full resize-none rounded-lg border px-3 py-2 transition-colors focus:ring-2 focus:outline-none"
        />
        <p className="text-muted-foreground mt-1 text-right text-xs">
          {rootBody.length}/{NODE_CONSTRAINTS.body.max}
        </p>
      </div>

      <ServerError message={serverError} />

      <Button type="submit" disabled={submitting} size="lg" className="w-full">
        {submitting ? (
          <span className="flex items-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Creating debate...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <MessageSquarePlus className="size-4" />
            Create debate
          </span>
        )}
      </Button>
    </form>
  );
}
