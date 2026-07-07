// Обёртка над донорским tailwind.config.js для design-sync.
// Единственное отличие от прод-сборки донора: включён aria-invalid вариант.
// Причина: shadcn-компоненты донора (input, textarea, button…) написаны под
// Tailwind v4, где aria-invalid — дефолтный вариант; донор собирает v3.4, и
// объявленные в исходниках классы aria-invalid:border-destructive выпадают из
// CSS. Для дизайн-системы реализуем заявленное исходниками поведение.
// Донорский конфиг не трогаем — это его прод-сборка.
const base = require("../Backend/PersonnelStatus/PersonalRecordFront/tailwind.config.js");

module.exports = {
  ...base,
  theme: {
    ...base.theme,
    extend: {
      ...(base.theme?.extend ?? {}),
      aria: {
        ...(base.theme?.extend?.aria ?? {}),
        invalid: 'invalid="true"',
      },
    },
  },
};
