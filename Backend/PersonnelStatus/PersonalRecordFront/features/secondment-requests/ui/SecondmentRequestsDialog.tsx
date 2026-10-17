"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Users } from "lucide-react";
import { toast } from "@/shared/hooks/use-toast";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { canManageStatusInDivision } from "@/entities/status/access";
import {
  fetchIncomingSecondmentRequests,
  approveSecondmentRequest,
  rejectSecondmentRequest,
  SecondmentRequest,
} from "../api/secondment-requests-api";

export function SecondmentRequestsDialog() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const access = useOpsPermissions();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["incoming-secondments"],
    queryFn: fetchIncomingSecondmentRequests,
    enabled: open,
  });

  const approveMutation = useMutation({
    mutationFn: approveSecondmentRequest,
    onSuccess: async () => {
      toast({ title: "Одобрено" });
      await queryClient.invalidateQueries({ queryKey: ["incoming-secondments"] });
    },
    onError: () => toast({ title: "Не удалось одобрить запрос", description: "Обновите список и проверьте состояние запроса перед повтором.", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: rejectSecondmentRequest,
    onSuccess: async () => {
      toast({ title: "Отклонено" });
      await queryClient.invalidateQueries({ queryKey: ["incoming-secondments"] });
    },
    onError: () => toast({ title: "Не удалось отклонить запрос", description: "Обновите список и проверьте состояние запроса перед повтором.", variant: "destructive" }),
  });

  const handleApprove = (id: number) => approveMutation.mutate(id);
  const handleReject = (id: number) => rejectMutation.mutate(id);

  const requests = data || [];
  const deciding = approveMutation.isPending || rejectMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Users className="h-4 w-4 mr-2" /> Прикомандировать
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Запросы на прикомандирование</DialogTitle>
        </DialogHeader>
        {!error && <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching || deciding}>Обновить список</Button>}
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <div role="alert" className="space-y-3 text-center">
            <p>Не удалось загрузить запросы на прикомандирование.</p>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>Повторить загрузку</Button>
          </div>
        ) : requests.length === 0 ? (
          <div className="text-muted-foreground text-center py-6">
            Запросов нет
          </div>
        ) : (
          <div className="min-w-0 space-y-4 max-h-[60vh] overflow-y-auto">
            {requests.map((req: SecondmentRequest) => (
              <div
                key={req.id}
                className="min-w-0 border p-4 rounded-md flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1 break-words">
                  <div className="font-medium">
                    {req.employee_detail?.full_name ?? "Сотрудник не указан"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {req.from_division_detail?.name ?? "Отправляющее подразделение не указано"} → {req.to_division_detail?.name ?? "Принимающее подразделение не указано"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {req.start_date} — {req.end_date}
                  </div>
                </div>
                {req.status === "pending" ? !req.employee_detail || !req.to_division_detail ? <p className="text-sm text-muted-foreground">Недостаточно данных для решения: нужны сотрудник и принимающее подразделение.</p> : canManageStatusInDivision(access, req.to_division_detail.id) ? <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(req.id)}
                    disabled={deciding}
                  >
                    Одобрить
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleReject(req.id)}
                    disabled={deciding}
                  >
                    Отклонить
                  </Button>
                </div> : <p className="text-sm text-muted-foreground">Ожидает решения принимающего подразделения. Для вас доступен только просмотр.</p> : <p className="text-sm text-muted-foreground">{req.status === "approved" ? "Одобрен" : req.status === "rejected" ? "Отклонён" : "Прикомандирование завершено"}</p>}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

