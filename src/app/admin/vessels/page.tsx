"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Power, PowerOff } from "lucide-react";
import { z } from "zod";
import { AdminGuard } from "@/components/admin/admin-guard";
import { AdminPageShell } from "@/components/admin/page-shell";
import { useCreateVessel, useUpdateVessel, useVessels } from "@/lib/queries/fleet";
import { humanError } from "@/lib/errors";
import type { Vessel } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const vesselSchema = z.object({
  name: z.string().trim().min(2, "A vessel name is required."),
  imo_number: z.union([
    z.string().regex(/^\d{7}$/, "An IMO number is exactly seven digits."),
    z.literal(""),
  ]),
});

export default function VesselsPage() {
  return <AdminGuard><VesselsScreen /></AdminGuard>;
}

function VesselsScreen() {
  const { data: vessels, isPending } = useVessels();

  return (
    <AdminPageShell
      title="Vessels"
      description="The fleet. Names and IMO numbers are unique across every vessel, active or not. A vessel carrying open work cannot be deactivated."
      action={<CreateVesselDialog />}
    >
      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(vessels ?? []).map((v) => <VesselCard key={v.id} vessel={v} />)}
        </div>
      )}
    </AdminPageShell>
  );
}

function VesselCard({ vessel }: { vessel: Vessel }) {
  const update = useUpdateVessel();

  const toggle = async () => {
    try {
      await update.mutateAsync({ id: vessel.id, changes: { is_active: !vessel.is_active } });
      toast.success(vessel.is_active ? `${vessel.name} deactivated.` : `${vessel.name} reactivated.`);
    } catch (error) {
      toast.error(humanError(error), { duration: 8000 });
    }
  };

  return (
    <div
      data-testid="vessel-card"
      data-vessel-name={vessel.name}
      className={`rounded-lg border p-4 ${vessel.is_active ? "" : "opacity-60"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{vessel.name}</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {vessel.imo_number ? `IMO ${vessel.imo_number}` : "No IMO number"}
          </p>
        </div>
        {vessel.is_active
          ? <Badge variant="secondary">Active</Badge>
          : <Badge variant="outline">Deactivated</Badge>}
      </div>
      <Button
        variant="outline" size="sm" className="mt-4 w-full"
        onClick={() => void toggle()} disabled={update.isPending}
      >
        {update.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden />
          : vessel.is_active ? <PowerOff className="size-4" aria-hidden />
          : <Power className="size-4" aria-hidden />}
        {vessel.is_active ? "Deactivate" : "Reactivate"}
      </Button>
    </div>
  );
}

function CreateVesselDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", imo_number: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useCreateVessel();

  const submit = async () => {
    const parsed = vesselSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    try {
      await create.mutateAsync({
        name: parsed.data.name,
        imo_number: parsed.data.imo_number === "" ? null : parsed.data.imo_number,
      });
      toast.success("Vessel added to the fleet.");
      setOpen(false);
      setForm({ name: "", imo_number: "" });
      setErrors({});
    } catch (error) {
      toast.error(humanError(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="size-4" aria-hidden /> New vessel</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New vessel</DialogTitle>
          <DialogDescription>
            The IMO number is a ship&apos;s permanent seven-digit registration. It is
            optional, but unique across the fleet when given.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="v-name">Name</Label>
            <Input id="v-name" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-imo">IMO number (optional)</Label>
            <Input id="v-imo" inputMode="numeric" placeholder="9074729" value={form.imo_number}
              onChange={(e) => setForm({ ...form, imo_number: e.target.value })} />
            {errors.imo_number && <p className="text-xs text-destructive">{errors.imo_number}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Add vessel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
