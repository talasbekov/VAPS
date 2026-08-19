"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  User,
  BadgeCheck,
  Briefcase,
  Calendar,
  Building2,
  Edit,
  X,
  Clock,
} from "lucide-react";
import { PermissionGate } from "@/lib/auth";
import { formatIsoDateLong } from "@/shared/lib/date";
import {
  EMPLOYEE_STATUS_CODE_BY_LABEL,
  getEmployeeStatusColor,
} from "@/lib/status";
import type { Employee } from "../model/types";

interface EmployeeProfileProps {
  employee: Employee;
  onClose: () => void;
}

export function EmployeeProfile({ employee, onClose }: EmployeeProfileProps) {
  const getStatusBadge = (status: string) => {
    if (status === "Не обновлено") {
      return <Badge className="bg-gray-100 text-gray-800">{status}</Badge>;
    }

    const code = EMPLOYEE_STATUS_CODE_BY_LABEL[status];
    const colorClass = getEmployeeStatusColor(code);

    return <Badge className={colorClass}>{status}</Badge>;
  };

  // 🔴 Здесь лежали три набора выдуманных данных — «История изменения
  // статусов» с датами 2023–2024, документы («Трудовой договор», «Справка о
  // доходах») и достижения («Лучший сотрудник месяца»). Показаться они не
  // могли НИ РАЗУ: `<Tabs>` рисовался без `TabsList`, а `activeTab` никем не
  // менялся с «overview» — 130 строк фикстуры за недостижимой вкладкой.
  // Источника ни у документов, ни у достижений в системе нет вовсе; история
  // статусов есть (`/api/operations/statuses/?employee_id=`), но это отдельная
  // работа, а не оправдание держать на её месте вымысел.

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Avatar className="h-16 w-16">
                <AvatarImage
                  src={employee.photo || "/placeholder.svg"}
                  alt={employee.name}
                />
                <AvatarFallback className="text-lg">
                  {employee.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <div>
                <h2 className="text-2xl font-bold">{employee.name}</h2>
                {/* Шапка прототипа: «звание · должность». */}
                <p className="text-muted-foreground">
                  {employee.rank === ""
                    ? employee.position
                    : `${employee.rank} · ${employee.position}`}
                </p>
                <div className="flex items-center space-x-2 mt-2">
                  {getStatusBadge(employee.status)}
                  {employee.personnelNumber !== "" && (
                    <Badge variant="outline">
                      Табельный № {employee.personnelNumber}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <PermissionGate resource="employees" action="update">
                <Button variant="outline">
                  <Edit className="h-4 w-4 mr-2" />
                  Редактировать
                </Button>
              </PermissionGate>
              {/* Выход из карточки. `onClose` передавался сюда с самого
                  начала и не был подключён ни к чему: вкладка «Профиль
                  сотрудника» открывалась и не закрывалась. */}
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="h-4 w-4 mr-2" aria-hidden="true" />
                Закрыть
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Вкладок здесь больше нет: их было четыре, а переключателя не было ни
          одного — три из четырёх не могли показаться. Осталось то, что
          показывалось. */}
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Personal Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <User className="h-5 w-5 mr-2" />
                  Личная информация
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 mr-3 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Дата рождения</p>
                    <p className="text-sm text-muted-foreground">
                      {formatIsoDateLong(employee.birthDate)}
                    </p>
                  </div>
                </div>
                {/* Поле «Адрес» убрано: адреса проживания в модели сотрудника
                    нет вовсе, и печаталась пустая строка под подписью. */}
                <div className="flex items-center">
                  <BadgeCheck className="h-4 w-4 mr-3 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">ИИН</p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {employee.iinMasked === "" ? "—" : employee.iinMasked}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Work Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Building2 className="h-5 w-5 mr-2" />
                  Рабочая информация
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center">
                  <Building2 className="h-4 w-4 mr-3 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Отдел</p>
                    <p className="text-sm text-muted-foreground">
                      {employee.department}
                    </p>
                  </div>
                </div>
                {/* Поле «Руководитель» убрано: ручка штатки его не отдаёт, и
                    под подписью печаталась пустая строка. На его месте —
                    дата найма прототипа, которая теперь приезжает с бэка. */}
                <div className="flex items-center">
                  <Briefcase className="h-4 w-4 mr-3 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Дата найма</p>
                    <p className="text-sm text-muted-foreground">
                      {formatIsoDateLong(employee.hireDate)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 mr-3 text-muted-foreground" />
                  <div>
                    {/* Подпись «Дата найма» здесь врала: в поле лежит начало
                        ТЕКУЩЕГО статуса. Теперь оба поля рядом и подписаны
                        каждое своим. */}
                    <p className="text-sm font-medium">Статус с</p>
                    <p className="text-sm text-muted-foreground">
                      {formatIsoDateLong(employee.statusSince)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center">
                  <Clock className="h-4 w-4 mr-3 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Статус по</p>
                    <p className="text-sm text-muted-foreground">
                      {formatIsoDateLong(employee.statusUntil, "бессрочно")}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}
