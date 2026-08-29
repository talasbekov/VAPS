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
import {
  fetchIncomingSecondmentRequests,
  approveSecondmentRequest,
  rejectSecondmentRequest,
  SecondmentRequest,
} from "../api/secondment-requests-api";

export function SecondmentRequestsDialog() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["incoming-secondments"],
    queryFn: fetchIncomingSecondmentRequests,
    enabled: open,
  });

  const approveMutation = useMutation({
    mutationFn: approveSecondmentRequest,
    onSuccess: () => {
      toast({ title: "Одобрено" });
      queryClient.invalidateQueries({ queryKey: ["incoming-secondments"] });
    },
    onError: () => toast({ title: "Ошибка", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: rejectSecondmentRequest,
    onSuccess: () => {
      toast({ title: "Отклонено" });
      queryClient.invalidateQueries({ queryKey: ["incoming-secondments"] });
    },
    onError: () => toast({ title: "Ошибка", variant: "destructive" }),
  });

  const handleApprove = (id: number) => approveMutation.mutate(id);
  const handleReject = (id: number) => rejectMutation.mutate(id);

  const requests = data || [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Users className="h-4 w-4 mr-2" /> Прикомандировать
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Запросы на прикомандирование</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-red-500 text-center">Ошибка загрузки</div>
        ) : requests.length === 0 ? (
          <div className="text-muted-foreground text-center py-6">
            Запросов нет
          </div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {requests.map((req: SecondmentRequest) => (
              <div
                key={req.id}
                className="border p-4 rounded-md flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">
                    {req.employee_detail.full_name}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {req.from_division_detail.name} → {req.to_division_detail.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {req.start_date} — {req.end_date}
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(req.id)}
                    disabled={approveMutation.isPending}
                  >
                    Одобрить
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleReject(req.id)}
                    disabled={rejectMutation.isPending}
                  >
                    Отклонить
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

