export type LabelTextureWidth = 260 | 520 | 1040;

/** Two source samples per rendered pixel preserve small text. Hysteresis
 * delays downscaling until a tier boundary is clearly crossed. */
export function labelTextureWidth(
  projectedPhysicalWidth: number,
  previous?: LabelTextureWidth,
  visible = true,
): LabelTextureWidth {
  if (!visible || projectedPhysicalWidth <= 0) return 260;
  const desired = projectedPhysicalWidth * 2;
  if (previous === 1040 && desired >= 520 * 0.9) return 1040;
  if (previous === 520 && desired <= 520 && desired >= 260 * 0.9) return 520;
  return desired <= 260 ? 260 : desired <= 520 ? 520 : 1040;
}
