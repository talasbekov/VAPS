"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { EMPLOYEE_STATUS_LABELS } from "@/lib/status";

export function StatusOverview() {
  const statusData = [
    { name: EMPLOYEE_STATUS_LABELS.in_service, count: 892, color: "bg-green-500", percentage: 71.5 },
    { name: EMPLOYEE_STATUS_LABELS.on_duty, count: 45, color: "bg-blue-500", percentage: 3.6 },
    {
      name: EMPLOYEE_STATUS_LABELS.business_trip,
      count: 78,
      color: "bg-purple-500",
      percentage: 6.3,
    },
    { name: EMPLOYEE_STATUS_LABELS.vacation, count: 156, color: "bg-yellow-500", percentage: 12.5 },
    { name: EMPLOYEE_STATUS_LABELS.sick_leave, count: 34, color: "bg-red-500", percentage: 2.7 },
    { name: "Не обновлено", count: 42, color: "bg-gray-500", percentage: 3.4 },
  ];

  const totalEmployees = statusData.reduce(
    (sum, status) => sum + status.count,
    0
  );

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Обзор статусов</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {statusData.map((status) => (
          <div key={status.name} className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${status.color}`} />
                <span className="text-sm font-medium">{status.name}</span>
              </div>
              <Badge variant="secondary" className="text-xs">
                {status.count}
              </Badge>
            </div>
            <Progress value={status.percentage} className="h-2" />
            <div className="text-xs text-muted-foreground text-right">
              {status.percentage}%
            </div>
          </div>
        ))}

        <div className="pt-3 border-t">
          <div className="flex justify-between items-center">
            <span className="font-medium">Всего сотрудников:</span>
            <Badge className="bg-blue-600">{totalEmployees}</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}








