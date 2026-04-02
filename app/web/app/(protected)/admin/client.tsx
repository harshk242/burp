"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useUserStore } from "@/stores/userStore";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, Loader2, Clock, Users, Save } from "lucide-react";

interface AccessRequest {
  id: string;
  email: string;
  name: string;
  institution: string | null;
  research_area: string | null;
  use_case: string | null;
  status: "pending" | "approved" | "rejected";
  submitted_at: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
}

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: "waitlist" | "user" | "admin";
  total_queries: number;
  daily_query_limit: number | null;
  daily_token_limit: number | null;
  created_at: number;
  last_active_at: number | null;
  today_queries: number;
  today_input_tokens: number;
  today_output_tokens: number;
}

export function AdminPageClient() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const { get, post, patch } = useApi();

  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    action: "approve" | "reject";
    request: AccessRequest | null;
  }>({ open: false, action: "approve", request: null });

  // Users tab state
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [limitEdits, setLimitEdits] = useState<Record<string, { queryLimit: string; tokenLimit: string }>>({});
  const [savingLimits, setSavingLimits] = useState<string | null>(null);

  // Client-side admin guard
  useEffect(() => {
    if (user && user.role !== "admin") {
      router.push("/chat");
    }
  }, [user, router]);

  const fetchRequests = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await get<{ requests: AccessRequest[] }>("/waitlist/all");
      setRequests(data.requests);
    } catch (err) {
      console.error("Failed to fetch access requests:", err);
    } finally {
      setIsLoading(false);
    }
  }, [get]);

  useEffect(() => {
    if (user?.role === "admin") {
      fetchRequests();
    }
  }, [user, fetchRequests]);

  const fetchUsers = useCallback(async () => {
    try {
      setUsersLoading(true);
      const data = await get<{ users: AdminUser[] }>("/admin/users");
      setAdminUsers(data.users);
      // Pre-populate edit state with current values
      const edits: Record<string, { queryLimit: string; tokenLimit: string }> = {};
      for (const u of data.users) {
        edits[u.id] = {
          queryLimit: u.daily_query_limit != null ? String(u.daily_query_limit) : "",
          tokenLimit: u.daily_token_limit != null ? String(u.daily_token_limit) : "",
        };
      }
      setLimitEdits(edits);
    } catch (err) {
      console.error("Failed to fetch users:", err);
    } finally {
      setUsersLoading(false);
    }
  }, [get]);

  const handleSaveLimits = async (userId: string) => {
    setSavingLimits(userId);
    try {
      const edit = limitEdits[userId];
      const queryVal = edit.queryLimit.trim();
      const tokenVal = edit.tokenLimit.trim();
      await patch(`/admin/users/${userId}/limits`, {
        daily_query_limit: queryVal === "" ? null : parseInt(queryVal, 10),
        daily_token_limit: tokenVal === "" ? null : parseInt(tokenVal, 10),
      });
      // Refresh list
      await fetchUsers();
    } catch (err) {
      console.error("Failed to save limits:", err);
    } finally {
      setSavingLimits(null);
    }
  };

  const handleAction = async (action: "approve" | "reject", id: string) => {
    setActionLoading(id);
    try {
      await post(`/waitlist/${id}/${action}`, {});
      // Update local state
      setRequests((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                status: action === "approve" ? "approved" : "rejected",
                reviewed_at: Math.floor(Date.now() / 1000),
              }
            : r
        )
      );
    } catch (err) {
      console.error(`Failed to ${action} request:`, err);
    } finally {
      setActionLoading(null);
      setConfirmDialog({ open: false, action: "approve", request: null });
    }
  };

  const openConfirm = (action: "approve" | "reject", request: AccessRequest) => {
    setConfirmDialog({ open: true, action, request });
  };

  // Filter requests by status
  const pending = requests.filter((r) => r.status === "pending");
  const approved = requests.filter((r) => r.status === "approved");
  const rejected = requests.filter((r) => r.status === "rejected");

  if (!user || user.role !== "admin") {
    return (
      <div className="flex h-dvh flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <Skeleton className="h-8 w-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <Header />
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Stats */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Admin Panel</h1>
              <p className="text-sm text-muted-foreground">
                Manage access requests and user limits
              </p>
            </div>
            <div className="flex gap-2 sm:gap-3">
              <StatCard
                label="Pending"
                count={pending.length}
                icon={<Clock className="h-4 w-4 text-yellow-500" />}
              />
              <StatCard
                label="Approved"
                count={approved.length}
                icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
              />
              <StatCard
                label="Total"
                count={requests.length}
                icon={<Users className="h-4 w-4 text-muted-foreground" />}
              />
            </div>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="pending" onValueChange={(v) => { if (v === "users" && adminUsers.length === 0) fetchUsers(); }}>
            <TabsList>
              <TabsTrigger value="pending">
                Pending{" "}
                {pending.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-xs">
                    {pending.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="approved">Approved</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
              <TabsTrigger value="users">Users</TabsTrigger>
            </TabsList>

            <TabsContent value="pending">
              <RequestTable
                requests={pending}
                isLoading={isLoading}
                showActions
                actionLoading={actionLoading}
                onApprove={(r) => openConfirm("approve", r)}
                onReject={(r) => openConfirm("reject", r)}
              />
            </TabsContent>

            <TabsContent value="approved">
              <RequestTable
                requests={approved}
                isLoading={isLoading}
                showReviewDate
              />
            </TabsContent>

            <TabsContent value="rejected">
              <RequestTable
                requests={rejected}
                isLoading={isLoading}
                showReviewDate
              />
            </TabsContent>

            <TabsContent value="users">
              <UsersTable
                users={adminUsers}
                isLoading={usersLoading}
                limitEdits={limitEdits}
                savingLimits={savingLimits}
                onLimitChange={(userId, field, value) =>
                  setLimitEdits((prev) => ({
                    ...prev,
                    [userId]: { ...prev[userId], [field]: value },
                  }))
                }
                onSave={handleSaveLimits}
              />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmDialog.open}
        onOpenChange={(open) =>
          !open && setConfirmDialog({ open: false, action: "approve", request: null })
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmDialog.action === "approve" ? "Approve" : "Reject"} Access
              Request
            </DialogTitle>
            <DialogDescription>
              {confirmDialog.action === "approve"
                ? `This will grant ${confirmDialog.request?.name} (${confirmDialog.request?.email}) access to BURP.`
                : `This will deny ${confirmDialog.request?.name} (${confirmDialog.request?.email}) access to BURP.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setConfirmDialog({ open: false, action: "approve", request: null })
              }
            >
              Cancel
            </Button>
            <Button
              variant={confirmDialog.action === "approve" ? "default" : "destructive"}
              disabled={actionLoading !== null}
              onClick={() =>
                confirmDialog.request &&
                handleAction(confirmDialog.action, confirmDialog.request.id)
              }
            >
              {actionLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {confirmDialog.action === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────── */

function UsersTable({
  users,
  isLoading,
  limitEdits,
  savingLimits,
  onLimitChange,
  onSave,
}: {
  users: AdminUser[];
  isLoading: boolean;
  limitEdits: Record<string, { queryLimit: string; tokenLimit: string }>;
  savingLimits: string | null;
  onLimitChange: (userId: string, field: "queryLimit" | "tokenLimit", value: string) => void;
  onSave: (userId: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3 pt-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">No users found</div>
    );
  }

  const formatTokens = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <div className="border rounded-lg mt-2 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name / Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="text-right">Today</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="w-28">Query limit</TableHead>
            <TableHead className="w-32">Token limit</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const edit = limitEdits[u.id] ?? { queryLimit: "", tokenLimit: "" };
            const todayTokens = u.today_input_tokens + u.today_output_tokens;
            return (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground truncate max-w-[180px]">{u.email}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin" ? "default" : u.role === "user" ? "secondary" : "outline"} className="text-xs">
                    {u.role}
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-sm">
                  <div>{u.today_queries} queries</div>
                  <div className="text-xs text-muted-foreground">{formatTokens(todayTokens)} tokens</div>
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {u.total_queries}
                </TableCell>
                <TableCell>
                  <Input
                    className="h-7 text-sm"
                    placeholder="default"
                    value={edit.queryLimit}
                    onChange={(e) => onLimitChange(u.id, "queryLimit", e.target.value)}
                    type="number"
                    min={-1}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="h-7 text-sm"
                    placeholder="default"
                    value={edit.tokenLimit}
                    onChange={(e) => onLimitChange(u.id, "tokenLimit", e.target.value)}
                    type="number"
                    min={-1}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    disabled={savingLimits === u.id}
                    onClick={() => onSave(u.id)}
                    title="Save limits"
                  >
                    {savingLimits === u.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function StatCard({
  label,
  count,
  icon,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
}) {
  return (
    <Card className="px-3 py-1.5 sm:px-4 sm:py-2">
      <div className="flex items-center gap-1.5 sm:gap-2">
        {icon}
        <span className="text-xs sm:text-sm text-muted-foreground">{label}</span>
        <span className="text-sm sm:text-base font-semibold">{count}</span>
      </div>
    </Card>
  );
}

function RequestTable({
  requests,
  isLoading,
  showActions,
  showReviewDate,
  actionLoading,
  onApprove,
  onReject,
}: {
  requests: AccessRequest[];
  isLoading: boolean;
  showActions?: boolean;
  showReviewDate?: boolean;
  actionLoading?: string | null;
  onApprove?: (r: AccessRequest) => void;
  onReject?: (r: AccessRequest) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3 pt-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No requests found
      </div>
    );
  }

  return (
    <div className="border rounded-lg mt-2 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="hidden md:table-cell">Institution</TableHead>
            <TableHead className="hidden lg:table-cell">Research Area</TableHead>
            <TableHead className="hidden xl:table-cell">Use Case</TableHead>
            <TableHead>
              {showReviewDate ? "Reviewed" : "Submitted"}
            </TableHead>
            {showActions && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((req) => (
            <TableRow key={req.id}>
              <TableCell className="font-medium">{req.name}</TableCell>
              <TableCell className="text-sm max-w-[150px] truncate">{req.email}</TableCell>
              <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                {req.institution || "—"}
              </TableCell>
              <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                {req.research_area || "—"}
              </TableCell>
              <TableCell className="hidden xl:table-cell text-sm text-muted-foreground max-w-xs truncate">
                {req.use_case || "—"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                {formatDate(showReviewDate ? req.reviewed_at : req.submitted_at)}
              </TableCell>
              {showActions && (
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700"
                      disabled={actionLoading === req.id}
                      onClick={() => onApprove?.(req)}
                    >
                      <CheckCircle2 className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">Approve</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                      disabled={actionLoading === req.id}
                      onClick={() => onReject?.(req)}
                    >
                      <XCircle className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">Reject</span>
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "—";
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
