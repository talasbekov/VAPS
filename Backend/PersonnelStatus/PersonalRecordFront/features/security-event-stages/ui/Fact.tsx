"use client";

// Ячейка «подпись: значение» справочных блоков карточки ОМ («Сведения об ОМ»
// в бюллетене, «Сведения об объекте» в рекогносцировке). Одна на оба блока —
// две копии разошлись бы по вёрстке, а читаются они на соседних этапах.
export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline font-semibold text-muted-foreground">{label}: </dt>
      <dd className="inline">{value}</dd>
    </div>
  );
}
