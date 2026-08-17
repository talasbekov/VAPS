"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Crown,
  Users,
  Building,
  Eye,
  ChevronRight,
  Sparkles,
  AlertCircle,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  OrgUnit,
  Employee,
  convertStaffUnitsResponseToOrgUnit,
} from "@/lib/api";
import { useStaffUnits } from "@/hooks/use-staff-units";
import { EMPLOYEE_STATUS_LABELS } from "@/lib/status";
import { OrgNode } from "./OrgNode";

// Mock данные удалены - используем только данные из API

const statusColors = {
  in_service: "bg-green-500",
  vacation: "bg-yellow-500",
  leave_by_report: "bg-yellow-400",
  sick_leave: "bg-red-500",
  business_trip: "bg-blue-500",
  training: "bg-purple-500",
  competition: "bg-pink-500",
  conference: "bg-violet-500",
  other_absence: "bg-gray-500",
  on_duty: "bg-indigo-500",
  after_duty: "bg-cyan-500",
  seconded_from: "bg-orange-500",
  seconded_to: "bg-teal-500",
};

const statusStateLabels = {
  planned: "Запланирован",
  active: "Активен",
  completed: "Завершен",
  cancelled: "Отменен",
};

export default function OrgChart() {
  const { user } = useAuth();

  // Используем React Query для загрузки данных
  const {
    data: staffUnits = [],
    isLoading: loading,
    error: queryError,
    refetch,
  } = useStaffUnits();

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Произошла ошибка"
    : null;

  // Преобразуем данные из API в формат OrgUnit
  const orgData = useMemo(() => {
    if (staffUnits.length === 0) return null;
    return convertStaffUnitsResponseToOrgUnit(staffUnits);
  }, [staffUnits]);

  // Состояния компонента
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());
  const [selectedUnit, setSelectedUnit] = useState<OrgUnit | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [focusedUnitId, setFocusedUnitId] = useState<string>("");
  const [treePosition, setTreePosition] = useState({ x: 0, y: 0, scale: 1 });

  // Обновляем expandedUnits и focusedUnitId при изменении данных
  useEffect(() => {
    if (orgData?.id) {
      // Устанавливаем корневой элемент как развернутый
      setExpandedUnits(new Set([orgData.id]));
      setFocusedUnitId(orgData.id);
    }
  }, [orgData?.id]);

  const toggleExpand = (unitId: string) => {
    const newExpanded = new Set(expandedUnits);
    if (newExpanded.has(unitId)) {
      newExpanded.delete(unitId);
    } else {
      newExpanded.add(unitId);
    }
    setExpandedUnits(newExpanded);
  };

  const focusOnUnit = (unitId: string) => {
    setFocusedUnitId(unitId);
    const newExpanded = new Set(expandedUnits);
    const findPath = (
      unit: OrgUnit,
      targetId: string,
      path: string[] = []
    ): string[] | null => {
      if (unit.id === targetId) return [...path, unit.id];
      if (unit.children) {
        for (const child of unit.children) {
          const result = findPath(child, targetId, [...path, unit.id]);
          if (result) return result;
        }
      }
      return null;
    };

    const path = orgData ? findPath(orgData, unitId) : null;
    if (path) {
      path.forEach((id) => newExpanded.add(id));
      setExpandedUnits(newExpanded);
    }
  };

  const resetFocus = () => {
    if (orgData?.id) {
      setFocusedUnitId(orgData.id);
      setTreePosition({ x: 0, y: 0, scale: 1 });
    }
  };

  const expandAll = () => {
    if (!orgData) return;

    const allIds = new Set<string>();
    const collectIds = (unit: OrgUnit) => {
      allIds.add(unit.id);
      unit.children?.forEach(collectIds);
    };
    collectIds(orgData);
    setExpandedUnits(allIds);
  };

  const collapseAll = () => {
    if (orgData?.id) {
      setExpandedUnits(new Set([orgData.id]));
    }
  };

  const renderEmployee = (
    employee: Employee,
    size: "small" | "medium" | "large" = "small"
  ) => {
    const sizeClasses = {
      small: "w-8 h-8",
      medium: "w-12 h-12",
      large: "w-16 h-16",
    };

    return (
      <div
        key={employee.id}
        className="flex items-center gap-2 p-2 bg-card/80 backdrop-blur-sm rounded-lg border border-border shadow-sm hover:shadow-md transition-all duration-300 hover:scale-105 hover:bg-card group"
      >
        <div className="relative">
          <img
            src={employee.avatar || "/placeholder.svg"}
            alt={employee.name}
            className={`${sizeClasses[size]} rounded-full object-cover ring-2 ring-white shadow-sm group-hover:ring-blue-200 transition-all duration-300`}
          />
          <div
            className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${
              statusColors[employee.status] || statusColors.in_service
            } shadow-sm`}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate group-hover:text-blue-600 transition-colors duration-200">
            {employee.name}
          </div>
          <div className="text-xs text-muted-foreground truncate group-hover:text-blue-500 transition-colors duration-200">
            {employee.position}
          </div>
        </div>
      </div>
    );
  };

  const renderOrgUnit = (unit: OrgUnit, level = 0) => {
    const rootId = orgData?.id || "1";

    return (
      <OrgNode
        unit={unit}
        level={level}
        isExpanded={expandedUnits.has(unit.id)}
        focusedUnitId={focusedUnitId}
        expandedUnits={expandedUnits}
        onToggleExpand={toggleExpand}
        onSelectUnit={(unit) => {
          setSelectedUnit(unit);
          setIsModalOpen(true);
        }}
        renderEmployee={renderEmployee}
        rootId={rootId}
      />
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button onClick={expandAll} variant="outline" size="sm">
            Развернуть все
          </Button>
          <Button onClick={collapseAll} variant="outline" size="sm">
            Свернуть все
          </Button>
          <Button onClick={resetFocus} variant="outline" size="sm">
            Сбросить фокус
          </Button>
          {error && (
            <Button onClick={() => refetch()} variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              Обновить
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <Sparkles className="w-4 h-4 text-blue-500" />
          {focusedUnitId === orgData?.id
            ? "Кликните на подразделение для фокуса"
            : `Фокус: ${orgData?.name || "Структура организации"}`}
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-sm text-muted-foreground">Загрузка данных...</p>
        </div>
      )}

      {(!loading || error) && (
        <div className="bg-card p-8 rounded-2xl min-h-[800px] overflow-auto border border-border shadow-lg relative">
          <div className="flex justify-center">
            <div className="w-full max-w-6xl">
              {orgData ? (
                renderOrgUnit(orgData)
              ) : (
                <div className="flex flex-col items-center justify-center h-64 gap-4">
                  <AlertCircle className="w-12 h-12 text-muted-foreground" />
                  <p className="text-lg text-muted-foreground">
                    Нет данных для отображения
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Данные не загружены из API
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Красивое модальное окно */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent
          className="!max-w-2xl sm:!max-w-2xl max-h-[90vh] overflow-hidden p-0 bg-card"
          showCloseButton={false}
        >
          {selectedUnit && (
            <>
              {/* Компактный заголовок */}
              <div
                className={`${selectedUnit.color} p-4 relative overflow-hidden border-b border-border/50`}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-black/3 to-transparent"></div>
                <div className="relative z-10 flex items-center gap-3">
                  {selectedUnit.type === "leadership" && (
                    <div className="p-1.5 bg-yellow-100/80 rounded-lg backdrop-blur-sm">
                      <Crown className="w-4 h-4 text-yellow-700" />
                    </div>
                  )}
                  {selectedUnit.type === "department" && (
                    <div className="p-1.5 bg-blue-100/80 rounded-lg backdrop-blur-sm">
                      <Building className="w-4 h-4 text-blue-700" />
                    </div>
                  )}
                  {selectedUnit.type === "directorate" && (
                    <div className="p-1.5 bg-green-100/80 rounded-lg backdrop-blur-sm">
                      <Users className="w-4 h-4 text-green-700" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <DialogTitle className="text-lg font-bold text-foreground truncate">
                      {selectedUnit.name}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                      {selectedUnit.type === "leadership" &&
                        "Высшее руководство"}
                      {selectedUnit.type === "department" && "Департамент"}
                      {selectedUnit.type === "directorate" &&
                        "Управление департамента"}
                    </DialogDescription>
                  </div>
                </div>
              </div>

              {/* Контент с прокруткой */}
              <div className="overflow-y-auto max-h-[calc(85vh-180px)] p-4">
                <div className="space-y-4">
                  {/* Руководитель - компактный дизайн */}
                  {selectedUnit.head && (
                    <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/50 rounded-lg border border-blue-100/50 p-3.5 hover:shadow-sm transition-shadow">
                      <div className="flex items-center gap-3">
                        <div className="relative flex-shrink-0">
                          <img
                            src={selectedUnit.head.avatar || "/placeholder.svg"}
                            alt={selectedUnit.head.name}
                            className="w-14 h-14 rounded-full object-cover ring-2 ring-white shadow-md"
                          />
                          <div
                            className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white ${
                              statusColors[selectedUnit.head.status] ||
                              statusColors.in_service
                            } shadow-sm`}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-base text-foreground truncate mb-0.5">
                            {selectedUnit.head.name}
                          </div>
                          <div className="text-xs text-muted-foreground truncate mb-2">
                            {selectedUnit.head.position}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge
                              className={`${
                                statusColors[selectedUnit.head.status] ||
                                statusColors.in_service
                              } text-white border-0 text-[10px] px-1.5 py-0.5 h-5`}
                            >
                              {EMPLOYEE_STATUS_LABELS[
                                (selectedUnit.head
                                  .status as keyof typeof EMPLOYEE_STATUS_LABELS) ||
                                  "in_service"
                              ] || EMPLOYEE_STATUS_LABELS.in_service}
                            </Badge>
                            {selectedUnit.head.statusState && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0.5 h-5"
                              >
                                {
                                  statusStateLabels[
                                    selectedUnit.head.statusState
                                  ]
                                }
                              </Badge>
                            )}
                          </div>
                          {(selectedUnit.head.statusStartDate ||
                            selectedUnit.head.statusEndDate) && (
                            <div className="text-[10px] text-muted-foreground mt-1.5">
                              {selectedUnit.head.statusStartDate && (
                                <span>
                                  {new Date(
                                    selectedUnit.head.statusStartDate
                                  ).toLocaleDateString("ru-RU", {
                                    day: "2-digit",
                                    month: "2-digit",
                                  })}
                                </span>
                              )}
                              {selectedUnit.head.statusStartDate &&
                                selectedUnit.head.statusEndDate &&
                                " — "}
                              {selectedUnit.head.statusEndDate && (
                                <span>
                                  {new Date(
                                    selectedUnit.head.statusEndDate
                                  ).toLocaleDateString("ru-RU", {
                                    day: "2-digit",
                                    month: "2-digit",
                                  })}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Сотрудники - компактная сетка */}
                  {selectedUnit.employees.length > 0 && (
                    <div className="bg-card rounded-lg border border-border/50 p-3.5">
                      <h3 className="font-semibold text-sm text-foreground mb-3 flex items-center gap-2">
                        <Users className="w-4 h-4 text-green-600" />
                        Сотрудники
                        <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          {selectedUnit.employees.length}
                        </span>
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {selectedUnit.employees.map((emp) => (
                          <div
                            key={emp.id}
                            className="flex items-center gap-2.5 p-2.5 bg-muted/50 rounded-lg hover:bg-muted/50 transition-all border border-border/50 hover:border-border hover:shadow-sm group"
                          >
                            <div className="relative flex-shrink-0">
                              <img
                                src={emp.avatar || "/placeholder.svg"}
                                alt={emp.name}
                                className="w-10 h-10 rounded-full object-cover ring-1 ring-white shadow-sm group-hover:ring-2 transition-all"
                              />
                              <div
                                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                                  statusColors[emp.status] ||
                                  statusColors.in_service
                                }`}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-foreground truncate">
                                {emp.name}
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate">
                                {emp.position}
                              </div>
                              {emp.statusState && (
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  {statusStateLabels[emp.statusState]}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Подразделения - компактный список */}
                  {selectedUnit.children &&
                    selectedUnit.children.length > 0 && (
                      <div className="bg-card rounded-lg border border-border/50 p-3.5">
                        <h3 className="font-semibold text-sm text-foreground mb-3 flex items-center gap-2">
                          <Building className="w-4 h-4 text-purple-600" />
                          Подразделения
                          <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            {selectedUnit.children.length}
                          </span>
                        </h3>
                        <div className="space-y-2">
                          {selectedUnit.children.map((child) => (
                            <div
                              key={child.id}
                              className="flex items-center gap-3 p-3 bg-gradient-to-r from-gray-50/50 to-gray-100/50 rounded-lg cursor-pointer hover:from-blue-50/50 hover:to-indigo-50/50 transition-all border border-border/50 hover:border-blue-300/50 hover:shadow-sm group"
                              onClick={() => {
                                setSelectedUnit(child);
                              }}
                            >
                              <div className="flex-shrink-0">
                                {child.type === "department" && (
                                  <div className="w-10 h-10 rounded-lg bg-blue-100/80 flex items-center justify-center group-hover:bg-blue-200/80 transition-colors">
                                    <Building className="w-5 h-5 text-blue-700" />
                                  </div>
                                )}
                                {child.type === "directorate" && (
                                  <div className="w-10 h-10 rounded-lg bg-green-100/80 flex items-center justify-center group-hover:bg-green-200/80 transition-colors">
                                    <Users className="w-5 h-5 text-green-700" />
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-sm text-foreground truncate mb-0.5">
                                  {child.name}
                                </div>
                                {child.head && (
                                  <div className="text-xs text-muted-foreground truncate mb-1">
                                    {child.head.name}
                                  </div>
                                )}
                                <div className="text-[10px] text-muted-foreground">
                                  {child.employees.length} сотрудников
                                  {child.children &&
                                    child.children.length > 0 &&
                                    ` • ${child.children.length} подразделений`}
                                </div>
                              </div>
                              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-blue-600 transition-colors flex-shrink-0" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              </div>

              {/* Компактные кнопки действий */}
              <div className="border-t border-border bg-muted/50 p-3.5">
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      focusOnUnit(selectedUnit.id);
                      setIsModalOpen(false);
                    }}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow-md transition-all text-sm h-9"
                  >
                    <Eye className="w-3.5 h-3.5 mr-1.5" />
                    На схеме
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => setIsModalOpen(false)}
                    className="border-border hover:bg-muted hover:border-border text-sm h-9 px-4"
                  >
                    Закрыть
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
