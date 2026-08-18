import { Anchor } from "lucide-react";

export function NoSession() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-24 text-center">
      <div className="rounded-full bg-primary/10 p-4">
        <Anchor className="size-7 text-primary" aria-hidden />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Choose a member to begin</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Use the bar above to pick a vessel, narrow by role, and select a member.
        The dashboard switches to that person entirely — what you can see and do
        from then on is decided by the database, not by this interface.
      </p>
      <p className="text-xs text-muted-foreground">
        Start with <span className="font-medium text-foreground">Ada Harbour</span> for the
        admin view, or a captain of <span className="font-medium text-foreground">Northern Star</span>{" "}
        to review completed work.
      </p>
    </div>
  );
}
