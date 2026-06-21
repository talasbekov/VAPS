"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Building2,
  Edit,
  X,
  FileText,
  Clock,
  Award,
  Users,
} from "lucide-react";
import { useAuth, PermissionGate } from "@/lib/auth";
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
  const [activeTab, setActiveTab] = useState("overview");
  const { hasPermission } = useAuth();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getStatusBadge = (status: string) => {
    if (status === "Не обновлено") {
      return <Badge className="bg-gray-100 text-gray-800">{status}</Badge>;
    }

    const code = EMPLOYEE_STATUS_CODE_BY_LABEL[status];
    const colorClass = getEmployeeStatusColor(code);

    return <Badge className={colorClass}>{status}</Badge>;
  };

  const calculateWorkExperience = (hireDate: string) => {
    const hire = new Date(hireDate);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - hire.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const years = Math.floor(diffDays / 365);
    const months = Math.floor((diffDays % 365) / 30);

    if (years > 0) {
      return `${years} лет ${months} месяцев`;
    } else {
      return `${months} месяцев`;
    }
  };

  // Mock additional data
  const statusHistory = [
    {
      date: "2024-01-15",
      status: "В строю",
      comment: "Возвращение из отпуска",
    },
    {
      date: "2023-12-20",
      status: "Отпуск",
      comment: "Ежегодный оплачиваемый отпуск",
    },
    { date: "2023-12-01", status: "В строю", comment: "Обычный рабочий режим" },
  ];

  const documents = [
    { name: "Трудовой договор", date: "2020-09-15", type: "PDF" },
    { name: "Должностная инструкция", date: "2023-01-10", type: "PDF" },
    { name: "Справка о доходах", date: "2024-01-01", type: "PDF" },
  ];

  const achievements = [
    {
      title: "Лучший сотрудник месяца",
      date: "2023-11-01",
      description: "За выдающиеся результаты в работе",
    },
    {
      title: "Сертификат повышения квалификации",
      date: "2023-06-15",
      description: "Управление персоналом",
    },
  ];

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
                <p className="text-gray-600">{employee.position}</p>
                <div className="flex items-center space-x-2 mt-2">
                  {getStatusBadge(employee.status)}
                  <Badge variant="outline">№{employee.number}</Badge>
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
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsContent value="overview" className="space-y-6">
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
                  <Calendar className="h-4 w-4 mr-3 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium">Дата рождения</p>
                    <p className="text-sm text-gray-600">
                      {formatDate(employee.birthDate)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center">
                  <Phone className="h-4 w-4 mr-3 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium">Телефон</p>
                    <p className="text-sm text-gray-600">{employee.phone}</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <Mail className="h-4 w-4 mr-3 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium">Email</p>
                    <p className="text-sm text-gray-600">{employee.email}</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <MapPin className="h-4 w-4 mr-3 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Адрес</p>
                    <p className="text-sm text-gray-600">{employee.address}</p>
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
                  <Building2 className="h-4 w-4 mr-3 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium">Отдел</p>
                    <p className="text-sm text-gray-600">
                      {employee.department}
                    </p>
                  </div>
                </div>
                <div className="flex items-center">
                  <Users className="h-4 w-4 mr-3 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium">Руководитель</p>
                    <p className="text-sm text-gray-600">{employee.manager}</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 mr-3 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium">Дата найма</p>
                    <p className="text-sm text-gray-600">
                      {formatDate(employee.hireDate)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center">
                  <Clock className="h-4 w-4 mr-3 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium">Стаж работы</p>
                    <p className="text-sm text-gray-600">
                      {calculateWorkExperience(employee.hireDate)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Clock className="h-5 w-5 mr-2" />
                История изменения статусов
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {statusHistory.map((record, index) => (
                  <div
                    key={index}
                    className="flex items-start space-x-4 pb-4 border-b last:border-b-0"
                  >
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <Clock className="h-4 w-4 text-blue-600" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        {getStatusBadge(record.status)}
                        <span className="text-sm text-gray-500">
                          {formatDate(record.date)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">{record.comment}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <FileText className="h-5 w-5 mr-2" />
                Документы сотрудника
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {documents.map((doc, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center space-x-3">
                      <FileText className="h-5 w-5 text-gray-400" />
                      <div>
                        <p className="font-medium">{doc.name}</p>
                        <p className="text-sm text-gray-500">
                          Добавлен {formatDate(doc.date)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline">{doc.type}</Badge>
                      <Button variant="ghost" size="sm">
                        Скачать
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="achievements" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Award className="h-5 w-5 mr-2" />
                Достижения и награды
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {achievements.map((achievement, index) => (
                  <div
                    key={index}
                    className="flex items-start space-x-4 pb-4 border-b last:border-b-0"
                  >
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                        <Award className="h-4 w-4 text-yellow-600" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium">{achievement.title}</h4>
                      <p className="text-sm text-gray-600 mb-1">
                        {achievement.description}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDate(achievement.date)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
