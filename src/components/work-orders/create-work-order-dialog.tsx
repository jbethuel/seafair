"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { z } from "zod";
import { useCreateWorkOrder } from "@/lib/queries/work-orders";
import { useAssignableCrew } from "@/lib/queries/fleet";
import { humanError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const schema = z.object({
  title: z.string().trim().min(3, "Give the work order a title."),
  issue: z.string().trim().min(10, "Describe the issue in a sentence or two."),
  assigneeId: z.uuid("Choose a crew member."),
});

export function CreateWorkOrderDialog({ vesselId }: { vesselId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [issue, setIssue] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: crew, isPending } = useAssignableCrew(open ? vesselId : null);
  const create = useCreateWorkOrder();

  const reset = () => {
    setTitle(""); setIssue(""); setAssigneeId(""); setErrors({});
  };

  const submit = async () => {
    const parsed = schema.safeParse({ title, issue, assigneeId });
    if (!parsed.success) {
      setErrors(Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0]), i.message]),
      ));
      return;
    }
    try {
      await create.mutateAsync({ vesselId, ...parsed.data });
      toast.success("Work order raised.");
      setOpen(false);
      reset();
    } catch (error) {
      toast.error(humanError(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="size-4" aria-hidden /> Raise work order</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise a work order</DialogTitle>
          <DialogDescription>
            It opens assigned to the crew member you choose, with status Open.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wo-title">Title</Label>
            <Input id="wo-title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Bilge pump cycling" />
            {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wo-issue">Issue</Label>
            <Textarea id="wo-issue" value={issue} rows={4}
              onChange={(e) => setIssue(e.target.value)}
              placeholder="What is wrong, and what has already been observed?" />
            {errors.issue && <p className="text-xs text-destructive">{errors.issue}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wo-assignee">Assign to</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger id="wo-assignee" className="w-full">
                <SelectValue placeholder={isPending ? "Loading crew…" : "Choose a crew member"} />
              </SelectTrigger>
              <SelectContent>
                {(crew ?? []).length === 0 ? (
                  <div className="px-2 py-3 text-sm text-muted-foreground">
                    No active crew are assigned to this vessel.
                  </div>
                ) : (
                  crew!.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex w-full items-center gap-2">
                        <span className="truncate">{c.full_name}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {c.open_work} open
                        </span>
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {errors.assigneeId && <p className="text-xs text-destructive">{errors.assigneeId}</p>}
            <p className="text-xs text-muted-foreground">
              Open counts are shown to help you choose. There is no cap on how much
              work one person may hold.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Raise work order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
