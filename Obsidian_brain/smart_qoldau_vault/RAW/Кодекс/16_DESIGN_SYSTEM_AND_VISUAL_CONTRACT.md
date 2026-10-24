# 16. Design system и visual contract

## 1. Характер продукта

- спокойный, конфиденциальный, тёплый;
- профессиональный, но не медицински-холодный;
- минимальная когнитивная нагрузка;
- одна явная primary action;
- честные статусы ожидания;
- кризисные элементы заметны, но не создают паники;
- mobile-first для клиента/эксперта, desktop-first для admin.

## 2. Извлечённые prototype tokens

### Цвета

| Token | Prototype value | Назначение |
| --- | --- | --- |
| `color.brand.deep` | `#0F3F3A` | primary text, dark surfaces |
| `color.brand.primary` | `#0F766E` | primary actions, active navigation |
| `color.brand.accent` | `#159A7C` | success/accent, progress |
| `color.surface.base` | `#FFFFFF` | cards/sheets |
| `color.surface.subtle` | `#F8FAF9` / `#FAFCFB` | page canvas |
| `color.surface.mint` | `#EEF2F0` / `#E3F3EE` | secondary blocks |
| `color.text.secondary` | `#6B8580` | secondary copy |
| `color.text.muted` | `#8FA6A1` | metadata/placeholders |
| `color.info` | `#3B82C4` | neutral info |
| `color.warning` | `#C98A2E` / `#E08A4D` | warning/expiring |
| `color.danger` | `#C0392B` / `#C0435F` | destructive/safety error |
| `color.premium` | `#8B5FC9` | Premium only, not generic highlight |

Два близких prototype оттенка объединяются в semantic token только после visual comparison, а не автоматически.

### Типографика

- семейство: `Inter` или system fallback с совместимыми метриками;
- display/hero: 24–32px, 700–800;
- page title: 22–26px, 700–800;
- section title: 16–20px, 700–800;
- body: 13–16px, 450–600;
- metadata: 11–13px, 500–650;
- line-height body: 1.4–1.6;
- цифры таймера/денег используют tabular numbers.

### Радиусы

| Token | Value |
| --- | ---: |
| `radius.control` | 12px |
| `radius.card` | 14–16px |
| `radius.large` | 20px |
| `radius.sheet` | 24–26px top |
| `radius.pill` | 999px |

### Тени

- default card: минимальная или border-first;
- elevated CTA: `0 8px 20px -12px rgba(15,118,110,.4)`;
- modal/sheet: мягкая большая тень;
- danger action не усиливается декоративной красной glow без причины.

### Spacing

Использовать 4px base grid:

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

Prototype random values нормализуются к ближайшему token только после screenshot diff.

## 3. Semantic components

### Core

- AppShell / PublicShell / AdminShell;
- TopBar / BottomNavigation / Sidebar;
- PrimaryButton / SecondaryButton / GhostButton / DestructiveButton;
- TextField / PhoneField / OTPField / Select / SegmentedControl;
- Card / ListItem / EmptyState / ErrorState / Skeleton;
- Dialog / BottomSheet / Toast / InlineAlert;
- Badge / StatusDot / SLAChip;
- Tabs / FilterChips / SearchField;
- Avatar / ExpertCard / RatingSummary;

### Domain

- TopicCard;
- FormatSelector;
- MatchProgress;
- OfferCountdown;
- ConsultationCard;
- SessionHeader;
- ChatComposer / MessageBubble;
- CallControls / ReconnectOverlay;
- PriceBreakdown / CoverageBadge;
- CancellationPolicyCard;
- VerificationChecklist;
- ScheduleGrid / SlotPicker;
- EarningsBreakdown / PayoutStatus;
- ComplaintTimeline;
- PremiumPlanCard;
- ContentCard / AudioPlayer / BreathingTimer;
- QueueTable / DecisionModal / AuditTimeline.

## 4. Status semantics

| Domain status | Visual semantic | Do not do |
| --- | --- | --- |
| SEARCHING | brand/accent progress + truthful copy | не показывать fake countdown |
| MATCHED/ACTIVE/VERIFIED/PAID | success token | не использовать success до commit |
| PENDING/PROCESSING | info/neutral + spinner/progress | не блокировать без объяснения |
| EXPIRING/WARNING | warning | не смешивать с error |
| FAILED/REJECTED/BLOCKED | danger + recovery path | не показывать только цвет |
| CANCELLED/REVOKED/ARCHIVED | muted neutral | не выдавать за error |
| URGENT/SAFETY | danger/high contrast + emergency action | не использовать как маркетинговый акцент |
| PREMIUM | premium purple only for entitlement | не применять ко всем CTA |

## 5. Запреты

- произвольные hex в feature-коде;
- generic SaaS dashboard визуальный язык для client app;
- градиенты/иллюстрации, меняющие спокойный характер без approval;
- три primary CTA на одном экране;
- icon-only critical action без label/tooltip;
- disabled action без объяснения, если пользователь ожидает действие;
- обрезание важных правил ellipsis;
- skeleton, не соответствующий реальному layout;
- success toast до server confirmation;
- использование цвета как единственного носителя статуса.

## 6. Visual baseline viewports

| Surface | Viewports |
| --- | --- |
| Client/Expert mobile | 390×844, 430×932, compact 360×800 |
| Tablet/web responsive | 768×1024, 1024×768 |
| Public/Expert web | 1440×900, 1280×800 |
| Admin | 1440×900 minimum; responsive degradation documented |

## 7. Visual acceptance workflow

1. Prototype screenshot/reference.
2. Current implementation screenshot.
3. Overlay/diff.
4. Classification: intentional / defect / business-copy change.
5. Fix only defect.
6. Intentional change enters visual changelog with owner approval.
7. Golden/visual regression stored per canonical viewport.
