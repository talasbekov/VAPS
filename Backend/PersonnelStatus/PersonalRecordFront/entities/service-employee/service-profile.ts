export const INVENTORY_LABELS = { weapon: 'Оружие', magazine: 'Магазины', grenade: 'Гранаты', other: 'Прочее' } as const;
export const SKILL_LABELS = { shooting: 'Стрельба', hand_to_hand: 'Рукопашный бой', physical_fitness: 'Физическая подготовка' } as const;
export const HEALTH_LABELS = { condition: 'Состояние здоровья', chronic_conditions: 'Хронические заболевания', restrictions: 'Ограничения' } as const;
export type InventoryCategory = keyof typeof INVENTORY_LABELS;
export type SkillKey = keyof typeof SKILL_LABELS;
export type HealthKey = keyof typeof HEALTH_LABELS;
export interface EmployeeServiceProfile {
  inventory: { category: InventoryCategory; name: string; quantity: number }[] | null;
  skills: Record<SkillKey, number | null>;
  health: Record<HealthKey, string | null>;
  height_cm: number | null;
  weight_kg: number | null;
  updated_at: string | null;
}
export interface ServiceProfileResponse { profile: EmployeeServiceProfile; revision: number; can_edit: boolean }
export interface ServiceProfileDraft {
  inventoryKnown: boolean;
  inventory: { category: InventoryCategory; name: string; quantity: string }[];
  skills: Record<SkillKey, string>;
  health: Record<HealthKey, string | null>;
  height_cm: string;
  weight_kg: string;
}

export function draftFromProfile(profile: EmployeeServiceProfile): ServiceProfileDraft {
  return {
    inventoryKnown: profile.inventory !== null,
    inventory: (profile.inventory ?? []).map(item => ({ ...item, quantity: String(item.quantity) })),
    skills: {
      shooting: profile.skills.shooting === null ? '' : String(profile.skills.shooting),
      hand_to_hand: profile.skills.hand_to_hand === null ? '' : String(profile.skills.hand_to_hand),
      physical_fitness: profile.skills.physical_fitness === null ? '' : String(profile.skills.physical_fitness),
    },
    health: { ...profile.health },
    height_cm: profile.height_cm === null ? '' : String(profile.height_cm),
    weight_kg: profile.weight_kg === null ? '' : String(profile.weight_kg),
  };
}

export function profileFromDraft(draft: ServiceProfileDraft): Omit<EmployeeServiceProfile, 'updated_at'> {
  const unsafeText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  const measurement = (value: string, label: string) => {
    if (!value.trim()) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}: укажите положительное число.`);
    return number;
  };
  const skills = {} as Record<SkillKey, number | null>;
  for (const key of Object.keys(SKILL_LABELS) as SkillKey[]) {
    const raw = draft.skills[key];
    if (raw !== '' && !/^[1-5]$/.test(raw)) throw new Error(`${SKILL_LABELS[key]}: оценка от 1 до 5.`);
    skills[key] = raw === '' ? null : Number(raw);
  }
  for (const key of Object.keys(HEALTH_LABELS) as HealthKey[]) {
    if ((draft.health[key]?.length ?? 0) > 2000) throw new Error(`${HEALTH_LABELS[key]}: не более 2000 символов.`);
    if (unsafeText.test(draft.health[key] ?? '')) throw new Error(`${HEALTH_LABELS[key]}: удалите управляющие символы.`);
  }
  if (draft.inventory.length > 100) throw new Error('Допустимо не более 100 позиций.');
  return {
    inventory: draft.inventoryKnown ? draft.inventory.map((item, index) => {
      if (!(item.category in INVENTORY_LABELS) || !item.name.trim() || item.name.length > 2000 || unsafeText.test(item.name)) {
        throw new Error(`Позиция ${index + 1}: выберите категорию и укажите наименование до 2000 символов.`);
      }
      const quantity = Number(item.quantity);
      if (!/^\d+$/.test(item.quantity) || !Number.isSafeInteger(quantity) || quantity < 0) {
        throw new Error(`Позиция ${index + 1}: укажите целое количество от 0.`);
      }
      return { category: item.category, name: item.name, quantity };
    }) : null,
    skills, health: { ...draft.health },
    height_cm: measurement(draft.height_cm, 'Рост'), weight_kg: measurement(draft.weight_kg, 'Вес'),
  };
}
