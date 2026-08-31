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
  Shield,
} from "lucide-react";
import Link from "next/link";
import { PermissionGate } from "@/lib/auth";
import { formatIsoDateLong } from "@/shared/lib/date";
import {
  getEmployeeStatusColor,
} from "@/lib/status";
import type { OpsStatusParticipation } from "@/lib/api";
import type { Employee } from "../model/types";
import { EmployeeAvatar } from "./EmployeeAvatar";

interface EmployeeProfileProps {
  employee: Employee;
  onClose: () => void;
  /** Мероприятия, на которые сотрудник привлечён СЕГОДНЯ (Plane №281).
   *  Приходит от вызывающего, а не запрашивается здесь: таблица статусов уже
   *  держит эти данные одним запросом на весь экран, и карточка, спрашивающая
   *  их заново на каждое открытие, платила бы за то же самое дважды. */
  events?: OpsStatusParticipation[];
}

export function EmployeeProfile({
  employee,
  onClose,
  events = [],
}: EmployeeProfileProps) {
  // Цвет — ПО КОДУ строки, а не обратным поиском по русской подписи
  // (Plane №366). Поиск «подпись → код» работал ровно до первого типа из
  // справочника: у «Участие в ОМ» строки в таблице подписей нет, поиск отдавал
  // `undefined`, и статус красился серым, как неизвестный.
  const getStatusBadge = (status: string, code: string | null) => {
    if (!code) {
      return <Badge className="bg-gray-100 text-gray-800">{status}</Badge>;
    }

    return <Badge className={getEmployeeStatusColor(code as never)}>{status}</Badge>;
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
              {/* Заглушка тут была КАРТИНКОЙ (`/placeholder.svg`), и это
                  подменяло инициалы: для Radix любой непустой `src` — попытка
                  показать изображение, а `AvatarFallback` включается только
                  когда показывать нечего. Правило одно на все экраны — см.
                  `EmployeeAvatar`. */}
              <EmployeeAvatar name={employee.name} photo={employee.photo} size="lg" />
              <div>
                <h2 className="text-2xl font-bold">{employee.name}</h2>
                {/* Шапка прототипа: «звание · должность». */}
                <p className="text-muted-foreground">
                  {employee.rank === ""
                    ? employee.position
                    : `${employee.rank} · ${employee.position}`}
                </p>
                <div className="flex items-center space-x-2 mt-2">
                  {getStatusBadge(employee.status, employee.statusCode)}
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
                {/* НА КАКОЕ ОМ ПРИВЛЕЧЁН (Plane №281). Блока не было вовсе:
                    карточка говорила «Участие в ОМ» статусом и молчала о том,
                    в каком именно мероприятии человек занят. Строка появляется
                    ТОЛЬКО когда мероприятия есть — пустой блок «Мероприятия: —»
                    занимал бы место у всех, а отвечал бы никому. */}
                {events.length > 0 && (
                  <div className="flex items-start">
                    <Shield
                      className="h-4 w-4 mr-3 mt-0.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="text-sm font-medium">Привлечён на ОМ</p>
                      <ul className="mt-0.5 space-y-0.5">
                        {events.map((participation) => (
                          <li key={participation.event_id}>
                            {/* Ссылка — только на существующее ОМ: пустой код
                                означает удалённое мероприятие, и переход вёл бы
                                в 404 (то же правило, что в таблице статусов). */}
                            {participation.event_code ? (
                              <Link
                                href={`/security-ops/events/${participation.event_id}`}
                                onClick={onClose}
                                className="text-primary-ink text-sm hover:underline"
                              >
                                {participation.event_code}
                                {participation.event_title
                                  ? ` — ${participation.event_title}`
                                  : ""}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground text-sm">
                                ОМ снят (#{participation.event_id})
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}
