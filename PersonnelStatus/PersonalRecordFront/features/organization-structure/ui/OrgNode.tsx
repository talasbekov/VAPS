"use client";

import type { ReactNode } from "react";
import { useRef, useState, useLayoutEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Crown,
  Users,
  Building,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { OrgUnit, Employee } from "@/lib/api";

interface OrgNodeProps {
  unit: OrgUnit;
  level: number;
  isExpanded: boolean;
  focusedUnitId: string;
  expandedUnits: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelectUnit: (unit: OrgUnit) => void;
  renderEmployee: (
    employee: Employee,
    size?: "small" | "medium" | "large"
  ) => ReactNode;
  rootId: string;
}

// Компонент для отдельного узла дерева
export function OrgNode({
  unit,
  level,
  isExpanded,
  focusedUnitId,
  expandedUnits,
  onToggleExpand,
  onSelectUnit,
  renderEmployee,
  rootId,
}: OrgNodeProps) {
  const hasChildren = unit.children && unit.children.length > 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const [childPositions, setChildPositions] = useState<number[]>([]);

  const allEmployees = [unit.head, ...unit.employees].filter(Boolean);
  const isFocused = focusedUnitId === unit.id;
  const isInFocusPath =
    focusedUnitId !== rootId &&
    (unit.id === focusedUnitId ||
      (unit.children &&
        unit.children.some(
          (child) =>
            child.id === focusedUnitId ||
            (child.children &&
              child.children.some(
                (grandChild) => grandChild.id === focusedUnitId
              ))
        )));

  const childrenCount = unit.children?.length || 0;

  // Обновляем позиции детей после рендера с использованием debounce
  useLayoutEffect(() => {
    if (containerRef.current && hasChildren && isExpanded && unit.children) {
      let debounceTimeout: NodeJS.Timeout | undefined;
      let resizeObserver: ResizeObserver | undefined;
      let mutationObserver: MutationObserver | undefined;

      const updatePositions = () => {
        const container = containerRef.current;
        if (!container) return;

        const childCards = container.querySelectorAll("[data-child-card]");
        if (childCards.length === 0) return;

        const containerRect = container.getBoundingClientRect();
        if (containerRect.width === 0) return;

        const positions: number[] = [];
        childCards.forEach((card) => {
          const cardElement = card as HTMLElement;
          const cardRect = cardElement.getBoundingClientRect();

          const relativeLeft = cardRect.left - containerRect.left;
          const cardCenter = relativeLeft + cardRect.width / 2;
          const percentage = (cardCenter / containerRect.width) * 100;
          positions.push(percentage);
        });

        if (unit.children && positions.length === unit.children.length) {
          setChildPositions(positions);
        }
      };

      // Debounce функция для пересчета линий после обновления DOM
      const scheduleUpdateLines = () => {
        if (debounceTimeout) {
          clearTimeout(debounceTimeout);
        }

        // Используем requestAnimationFrame для ожидания завершения layout
        debounceTimeout = setTimeout(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              updatePositions();
            });
          });
        }, 100); // Debounce 100ms - достаточно для завершения анимации
      };

      // Обновляем позиции сразу при монтировании
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          updatePositions();
        });
      });

      // ResizeObserver для отслеживания изменений размеров
      resizeObserver = new ResizeObserver(() => {
        scheduleUpdateLines();
      });

      // MutationObserver для отслеживания изменений в DOM
      mutationObserver = new MutationObserver((mutations) => {
        // Когда добавляются новые дочерние элементы, добавляем их в ResizeObserver
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as HTMLElement;
              if (element.hasAttribute("data-child-card")) {
                resizeObserver?.observe(element);
              }
              // Также проверяем вложенные элементы
              const nestedCards = element.querySelectorAll("[data-child-card]");
              nestedCards.forEach((card) => {
                resizeObserver?.observe(card as HTMLElement);
              });
            }
          });
        });

        // Пересчитываем позиции при любых изменениях DOM
        scheduleUpdateLines();
      });

      if (containerRef.current) {
        // Наблюдаем за изменениями размеров контейнера
        resizeObserver.observe(containerRef.current);

        // Наблюдаем за изменениями размеров всех дочерних элементов
        const childCards =
          containerRef.current.querySelectorAll("[data-child-card]");
        childCards.forEach((card) => {
          resizeObserver?.observe(card as HTMLElement);
        });

        // Наблюдаем за изменениями в структуре дочерних элементов
        mutationObserver.observe(containerRef.current, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style"],
        });
      }

      // Также слушаем изменения размера окна
      const handleResize = () => {
        scheduleUpdateLines();
      };
      window.addEventListener("resize", handleResize);

      return () => {
        if (debounceTimeout) {
          clearTimeout(debounceTimeout);
        }
        if (resizeObserver) {
          resizeObserver.disconnect();
        }
        if (mutationObserver) {
          mutationObserver.disconnect();
        }
        window.removeEventListener("resize", handleResize);
      };
    } else {
      setChildPositions([]);
    }
  }, [
    hasChildren,
    isExpanded,
    childrenCount,
    unit.children,
    level,
    expandedUnits,
  ]);

  return (
    <div key={unit.id} className="flex flex-col items-center relative">
      <div className="relative">
        <Card
          className={`w-80 ${
            unit.color
          } border-2 cursor-pointer transition-all duration-300 ease-in-out ${
            isFocused
              ? "ring-4 ring-yellow-400 shadow-2xl"
              : isInFocusPath
              ? "shadow-lg"
              : "shadow-md hover:shadow-xl"
          } ${isFocused ? "z-20" : isInFocusPath ? "z-10" : "z-0"}`}
          onClick={() => onSelectUnit(unit)}
        >
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {unit.type === "leadership" && (
                  <Crown className="w-4 h-4 text-yellow-600" />
                )}
                {unit.type === "department" && (
                  <Building className="w-4 h-4 text-blue-600" />
                )}
                {unit.type === "directorate" && (
                  <Users className="w-4 h-4 text-green-600" />
                )}
                <h3 className="font-semibold text-foreground text-xs">
                  {unit.name}
                </h3>
              </div>
              {hasChildren && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand(unit.id);
                  }}
                  className="p-1 h-6 w-6"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </Button>
              )}
            </div>

            {unit.head && (
              <div className="mb-2">{renderEmployee(unit.head, "small")}</div>
            )}

            {unit.employees.length > 0 && (
              <div className="mb-2">
                {/* Вакансии лежат в том же списке (иначе их не было бы видно
                    вовсе), но в счётчик «Сотрудники» не входят: пустая ставка
                    не человек. Число вакансий называется отдельно. */}
                <div className="text-xs text-muted-foreground mb-1 font-medium">
                  Сотрудники (
                  {
                    unit.employees.filter(
                      (emp) => emp.name !== "Вакантная должность"
                    ).length
                  }
                  )
                  {unit.employees.some(
                    (emp) => emp.name === "Вакантная должность"
                  ) &&
                    ` · вакансий (${
                      unit.employees.filter(
                        (emp) => emp.name === "Вакантная должность"
                      ).length
                    })`}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  {unit.employees.map((emp) => renderEmployee(emp, "small"))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {hasChildren && isExpanded && (
        <div className="flex flex-col items-center mt-6 relative">
          {/* Дети - сначала рендерим детей */}
          <div
            ref={containerRef}
            className="flex items-start gap-8 mt-16 relative justify-center flex-nowrap"
          >
            {/* Контейнер для линий - позиционируется относительно детей */}
            {childPositions.length > 0 &&
              childPositions.length === childrenCount && (
                <div
                  key={`lines-${unit.id}-${childPositions.join("-")}`}
                  className="absolute pointer-events-none"
                  style={{
                    top: "-64px",
                    left: "0",
                    right: "0",
                    height: "64px",
                    width: "100%",
                  }}
                >
                  {/* SVG для точных линий */}
                  <svg
                    key={`svg-${unit.id}-${childPositions.join("-")}`}
                    className="absolute"
                    style={{
                      top: "0px",
                      left: "0",
                      width: "100%",
                      height: "64px",
                      overflow: "visible",
                    }}
                  >
                    {/* Вертикальная линия от родителя - привязана к центру диапазона детей */}
                    {childPositions.length > 0 && (
                      <line
                        x1={`${
                          childPositions.reduce((a, b) => a + b, 0) /
                          childPositions.length
                        }%`}
                        y1="0"
                        x2={`${
                          childPositions.reduce((a, b) => a + b, 0) /
                          childPositions.length
                        }%`}
                        y2="32"
                        stroke="#9CA3AF"
                        strokeWidth="2"
                      />
                    )}

                    {/* Горизонтальная линия между детьми (только если детей больше 1) */}
                    {childrenCount > 1 && childPositions.length > 1 && (
                      <line
                        x1={`${childPositions[0]}%`}
                        y1="32"
                        x2={`${childPositions[childPositions.length - 1]}%`}
                        y2="32"
                        stroke="#9CA3AF"
                        strokeWidth="2"
                      />
                    )}

                    {/* Вертикальные линии к каждому ребенку - используем реальные позиции */}
                    {childPositions.map((position: number, index: number) => {
                      // Безопасная проверка существования ребенка
                      const child = unit.children?.[index];
                      if (!child) return null;

                      return (
                        <g key={`${child.id}-line`}>
                          <line
                            x1={`${position}%`}
                            y1="32"
                            x2={`${position}%`}
                            y2="64"
                            stroke="#9CA3AF"
                            strokeWidth="2"
                          />
                          <circle
                            cx={`${position}%`}
                            cy="64"
                            r="3"
                            fill="#3B82F6"
                          />
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}

            {/* Рендерим детей */}
            {unit.children?.map((child) => {
              if (!child) return null;

              return (
                <div
                  key={child.id}
                  className="transition-all duration-300"
                  data-child-card
                >
                  <OrgNode
                    unit={child}
                    level={level + 1}
                    isExpanded={expandedUnits.has(child.id)}
                    focusedUnitId={focusedUnitId}
                    expandedUnits={expandedUnits}
                    onToggleExpand={onToggleExpand}
                    onSelectUnit={onSelectUnit}
                    renderEmployee={renderEmployee}
                    rootId={rootId}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
