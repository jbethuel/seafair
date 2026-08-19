"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, UserCheck, UserX } from "lucide-react";
import { z } from "zod";
import { AdminGuard } from "@/components/admin/admin-guard";
import { AdminPageShell } from "@/components/admin/page-shell";
import { useCreateUser, useUpdateUser, useUsers } from "@/lib/queries/fleet";
import { humanError } from "@/lib/errors";
import { ROLES, ROLE_LABELS, type Role, type User } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RowsSkeleton, UsersPageSkeleton } from "@/components/layout/skeletons";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const userSchema = z.object({
  full_name: z.string().trim().min(2, "A full name is required."),
  email: z.email("That does not look like an email address."),
  role: z.enum(ROLES),
});

export default function UsersPage() {
  return (
    <AdminGuard fallback={<UsersPageSkeleton />}>
      <UsersScreen />
    </AdminGuard>
  );
}

function UsersScreen() {
  const { data: users, isPending } = useUsers();
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [showInactive, setShowInactive] = useState(true);

  const visible = useMemo(
    () => (users ?? []).filter(
      (u) => (roleFilter === "all" || u.role === roleFilter) && (showInactive || u.is_active)),
    [users, roleFilter, showInactive],
  );

  return (
    <AdminPageShell
      title="Users"
      description="Create people, change their role, and deactivate them. Deactivation is refused when it would leave open work without an authorised owner — that rule lives in the database, so the refusal is genuine."
      action={<CreateUserDialog />}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as Role | "all")}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          variant={showInactive ? "secondary" : "outline"} size="sm"
          aria-pressed={showInactive}
          onClick={() => setShowInactive((v) => !v)}
        >
          Show deactivated
        </Button>
        <span className="ml-auto text-sm text-muted-foreground">{visible.length} people</span>
      </div>

      {isPending ? (
        <RowsSkeleton rows={8} className="h-14" />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Email</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Role</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((u) => <UserRow key={u.id} user={u} />)}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {visible.map((u) => <li key={u.id}><UserCard user={u} /></li>)}
          </ul>
        </>
      )}
    </AdminPageShell>
  );
}

function useUserActions(user: User) {
  const update = useUpdateUser();

  const setRole = async (role: Role) => {
    try {
      await update.mutateAsync({ id: user.id, changes: { role } });
      toast.success(`${user.full_name} is now ${ROLE_LABELS[role]}.`);
    } catch (error) { toast.error(humanError(error)); }
  };

  const toggleActive = async () => {
    try {
      await update.mutateAsync({ id: user.id, changes: { is_active: !user.is_active } });
      toast.success(user.is_active ? `${user.full_name} deactivated.` : `${user.full_name} reactivated.`);
    } catch (error) {
      // The database names the vessel or the count, so surface its wording.
      toast.error(humanError(error), { duration: 8000 });
    }
  };

  return { setRole, toggleActive, pending: update.isPending };
}

function UserRow({ user }: { user: User }) {
  const { setRole, toggleActive, pending } = useUserActions(user);
  return (
    <tr className={user.is_active ? "" : "opacity-60"}>
      <td className="px-4 py-3 font-medium">{user.full_name}</td>
      <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
      <td className="px-4 py-3">
        <Select value={user.role} onValueChange={(v) => void setRole(v as Role)} disabled={pending}>
          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
          </SelectContent>
        </Select>
      </td>
      <td className="px-4 py-3">
        {user.is_active
          ? <Badge variant="secondary">Active</Badge>
          : <Badge variant="outline">Deactivated</Badge>}
      </td>
      <td className="px-4 py-3 text-right">
        <Button variant="ghost" size="sm" onClick={() => void toggleActive()} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden />
            : user.is_active ? <UserX className="size-4" aria-hidden />
            : <UserCheck className="size-4" aria-hidden />}
          {user.is_active ? "Deactivate" : "Reactivate"}
        </Button>
      </td>
    </tr>
  );
}

function UserCard({ user }: { user: User }) {
  const { setRole, toggleActive, pending } = useUserActions(user);
  return (
    <div className={`rounded-lg border p-4 ${user.is_active ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{user.full_name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        {user.is_active
          ? <Badge variant="secondary">Active</Badge>
          : <Badge variant="outline">Deactivated</Badge>}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Select value={user.role} onValueChange={(v) => void setRole(v as Role)} disabled={pending}>
          <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void toggleActive()} disabled={pending}>
          {user.is_active ? "Deactivate" : "Reactivate"}
        </Button>
      </div>
    </div>
  );
}

function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", role: "crew" as Role });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useCreateUser();

  const submit = async () => {
    const parsed = userSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      toast.success("User created.");
      setOpen(false);
      setForm({ full_name: "", email: "", role: "crew" });
      setErrors({});
    } catch (error) {
      toast.error(humanError(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="size-4" aria-hidden /> New user</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>
            Email addresses are unique across the whole fleet, including
            deactivated people — reactivate rather than duplicate.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="u-name">Full name</Label>
            <Input id="u-name" value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            {errors.full_name && <p className="text-xs text-destructive">{errors.full_name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" type="email" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-role">Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
              <SelectTrigger id="u-role" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
